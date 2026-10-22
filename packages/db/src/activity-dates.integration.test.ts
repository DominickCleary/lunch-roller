import './env';
import { afterAll, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { createDatabase } from './index';
import { GameService } from './operations';
import {
  settings,
  places,
  participants,
  tokenLedger,
  influenceLots,
  betRequests,
  bets,
  bettingMarkets,
  draws,
  notificationOutbox,
} from './schema';

const database = createDatabase();
const game = new GameService(database);
const [original] = await database.db.select().from(settings);
const originalPlaces = await database.db.select().from(places);
const person = await game.saveParticipant({
  name: `activity-dates-${crypto.randomUUID()}`,
});
const place = await game.savePlace({
  name: `activity-dates-${crypto.randomUUID()}`,
});
const marketIds: string[] = [];
const drawIds: string[] = [];
const friday = '2026-10-23';
const monday = '2026-10-26';

afterAll(async () => {
  try {
    await database.db
      .delete(influenceLots)
      .where(eq(influenceLots.participantId, person.id));
    await database.db
      .delete(tokenLedger)
      .where(eq(tokenLedger.participantId, person.id));
    await database.db
      .delete(betRequests)
      .where(eq(betRequests.participantId, person.id));
    await database.db.delete(bets).where(eq(bets.participantId, person.id));
    if (marketIds.length)
      await database.db
        .delete(bettingMarkets)
        .where(inArray(bettingMarkets.id, marketIds));
    if (drawIds.length) {
      await database.db
        .delete(notificationOutbox)
        .where(inArray(notificationOutbox.drawId, drawIds));
      await database.db.delete(draws).where(inArray(draws.id, drawIds));
    }
    await database.db.delete(places).where(eq(places.id, place.id));
    await database.db
      .delete(participants)
      .where(eq(participants.id, person.id));
    for (const row of originalPlaces)
      await database.db
        .update(places)
        .set({ logWeight: row.logWeight })
        .where(eq(places.id, row.id));
    await database.db.update(settings).set(original!).where(eq(settings.id, 1));
  } finally {
    await database.close();
  }
});

it('keeps Friday actions for Monday together across midnight, weekend DST, refunds and settlement', async () => {
  await game.setSchedule({
    timezone: 'Europe/Dublin',
    time: '11:30',
    weekdays: [1, 2, 3, 4, 5],
  });
  await game.setPreferences({
    ...(await game.getPreferences()),
    wheelSwitchTime: '15:00',
    bettingCloseMinutes: 5,
    postDrawDelayMinutes: 210,
  });
  await game.correctTokens(
    {
      participantId: person.id,
      delta: 200,
      reason: 'Disposable activity date audit',
    },
    crypto.randomUUID(),
  );
  const fridayDraw = await game.drawIfDue(new Date(`${friday}T10:30:00Z`));
  expect(fridayDraw).not.toBeNull();
  drawIds.push(fridayDraw!.id);
  const beforeOpen = new Date(`${friday}T13:59:59Z`);
  const fridayAt = new Date(`${friday}T14:00:00Z`);
  const paused = await game.currentInfluence(person.id, beforeOpen);
  expect(paused.window).toMatchObject({
    localDate: monday,
    open: false,
    opensAt: `${friday}T14:00:00.000Z`,
  });
  expect((await game.currentBets(person.id, beforeOpen)).window.open).toBe(
    false,
  );
  const pausedStandings = await game.tokenOverview(person.id, beforeOpen);
  expect(pausedStandings.spinLocalDate).toBe(monday);
  expect(
    pausedStandings.rows.find((row) => row.participantId === person.id)
      ?.spinDelta,
  ).toBe(0);
  const walletBefore = await game.wallet(person.id);
  for (const action of ['boost', 'reduce'] as const) {
    await expect(
      game.changeInfluence(
        person.id,
        { localDate: monday, placeId: place.id, action, change: 1 },
        crypto.randomUUID(),
        beforeOpen,
      ),
    ).rejects.toMatchObject({ code: 'INFLUENCE_CLOSED' });
    await expect(
      game.purchase(
        person.id,
        { placeId: place.id, action },
        crypto.randomUUID(),
        beforeOpen,
      ),
    ).rejects.toMatchObject({ code: 'INFLUENCE_CLOSED' });
  }
  await expect(
    game.setBet(
      person.id,
      { localDate: monday, placeId: place.id, stake: 5 },
      crypto.randomUUID(),
      beforeOpen,
    ),
  ).rejects.toMatchObject({ code: 'BETTING_CLOSED' });
  await expect(
    game.cancelBet(
      person.id,
      { localDate: monday },
      crypto.randomUUID(),
      beforeOpen,
    ),
  ).rejects.toMatchObject({ code: 'BETTING_CLOSED' });
  await expect(
    game.refundInfluence(
      person.id,
      { localDate: monday, placeId: place.id },
      crypto.randomUUID(),
      beforeOpen,
    ),
  ).rejects.toMatchObject({ code: 'INFLUENCE_CLOSED' });
  await expect(
    game.purchase(
      person.id,
      { placeId: place.id, action: 'remove' },
      crypto.randomUUID(),
      beforeOpen,
    ),
  ).rejects.toMatchObject({ code: 'WHEEL_ACTIVITY_PAUSED' });
  await expect(
    game.addPlace(
      person.id,
      { name: 'Should not be created during pause' },
      crypto.randomUUID(),
      beforeOpen,
    ),
  ).rejects.toMatchObject({ code: 'WHEEL_ACTIVITY_PAUSED' });
  expect(await game.wallet(person.id)).toEqual(walletBefore);
  expect((await game.currentInfluence(person.id, fridayAt)).window.open).toBe(
    true,
  );
  // Model the old purchase system: one pre-roll purchase and one post-roll
  // purchase before the next wheel period. They have no persisted market link.
  const legacy = await database.db
    .insert(tokenLedger)
    .values(
      [new Date(`${friday}T09:00:00Z`), new Date(`${friday}T12:00:00Z`)].map(
        (createdAt) => ({
          participantId: person.id,
          placeId: place.id,
          kind: 'boost' as const,
          delta: -5,
          idempotencyKey: crypto.randomUUID(),
          requestHash: 'legacy-post-draw-fixture',
          createdAt,
        }),
      ),
    )
    .returning();
  // Still Friday in UTC, already Saturday in the workplace timezone.
  const saturdayAt = new Date('2026-10-23T23:30:00Z');
  const market = await game.currentInfluence(person.id, fridayAt);
  expect(market.window.localDate).toBe(monday);
  expect(market.places.find((row) => row.placeId === place.id)).toMatchObject({
    boosts: 1,
    reductions: 0,
    historicalBoosts: 1,
    historicalReductions: 0,
    yourBoosts: 0,
    yourReductions: 0,
  });
  await expect(
    game.refundInfluence(
      person.id,
      { localDate: monday, placeId: place.id },
      crypto.randomUUID(),
      fridayAt,
    ),
  ).rejects.toMatchObject({ status: 409 });
  marketIds.push(
    ...(
      await database.db
        .select()
        .from(bettingMarkets)
        .where(eq(bettingMarkets.localDate, monday))
    ).map((row) => row.id),
  );
  expect((await game.today(fridayAt)).wheel.localDate).toBe(monday);
  const body = { localDate: monday, placeId: place.id };
  await game.changeInfluence(
    person.id,
    { ...body, action: 'boost', change: 1 },
    crypto.randomUUID(),
    fridayAt,
  );
  await game.setBet(
    person.id,
    { ...body, stake: 12 },
    crypto.randomUUID(),
    fridayAt,
  );
  await game.changeInfluence(
    person.id,
    { ...body, action: 'reduce', change: 1 },
    crypto.randomUUID(),
    saturdayAt,
  );
  await game.cancelBet(
    person.id,
    { localDate: monday },
    crypto.randomUUID(),
    saturdayAt,
  );
  const sundayAt = new Date('2026-10-25T01:30:00Z');
  await game.changeInfluence(
    person.id,
    { ...body, action: 'boost', change: 1 },
    crypto.randomUUID(),
    sundayAt,
  );
  await game.setBet(
    person.id,
    { ...body, stake: 15 },
    crypto.randomUUID(),
    sundayAt,
  );

  const read = (date: string, scope: 'draw' | 'day') =>
    game.dailyActivity(person.id, date, sundayAt, scope);
  const sidebar = await game.currentInfluence(person.id, sundayAt);
  expect(sidebar.places.find((row) => row.placeId === place.id)).toMatchObject({
    boosts: 2,
    reductions: 0,
    historicalBoosts: 1,
    historicalReductions: 0,
    yourBoosts: 1,
    yourReductions: 0,
  });
  const target = await read(monday, 'draw');
  const entries = target.entries.filter(
    (entry) => entry.participantId === person.id,
  );
  expect(entries).toHaveLength(7);
  const standings = await game.tokenOverview(person.id, sundayAt);
  expect(standings).toMatchObject({
    localDate: '2026-10-25',
    spinLocalDate: monday,
  });
  expect(
    standings.rows.find((row) => row.participantId === person.id)?.spinDelta,
  ).toBe(-25);
  expect(
    standings.rows.find((row) => row.participantId === person.id)?.spinDelta,
  ).toBe(entries.reduce((sum, entry) => sum + entry.delta, 0));
  // The saved cutoff locks edits without resetting the spin's standings.
  const lockedStandings = await game.tokenOverview(
    person.id,
    new Date(`${monday}T12:00:00Z`),
  );
  expect(lockedStandings.spinLocalDate).toBe(monday);
  expect(
    lockedStandings.rows.find((row) => row.participantId === person.id)
      ?.spinDelta,
  ).toBe(-25);
  expect(
    entries.every(
      (entry) =>
        (entry.influenceLocalDate ??
          entry.betLocalDate ??
          entry.inferredDrawLocalDate) === monday,
    ),
  ).toBe(true);
  expect(entries.filter((entry) => entry.kind === 'boost')).toHaveLength(3);
  expect(
    entries.find((entry) => entry.id === legacy[1]!.id)?.inferredDrawLocalDate,
  ).toBe(monday);
  expect(entries.filter((entry) => entry.kind === 'boost-refund')).toHaveLength(
    1,
  );
  expect(
    target.positions?.find((row) => row.participantId === person.id),
  ).toMatchObject({ boosts: 1, reductions: 0, status: 'staged' });
  expect(
    target.bets.find((row) => row.participantId === person.id),
  ).toMatchObject({ localDate: monday, status: 'open', stake: 15 });
  const todayDraw = await read(friday, 'draw');
  expect(
    todayDraw.entries.filter((entry) => entry.participantId === person.id),
  ).toEqual([
    expect.objectContaining({
      id: legacy[0]!.id,
      inferredDrawLocalDate: friday,
    }),
  ]);
  expect(
    todayDraw.bets.filter((row) => row.participantId === person.id),
  ).toEqual([]);
  expect(
    todayDraw.positions?.filter((row) => row.participantId === person.id),
  ).toEqual([]);
  for (const [date, count] of [
    [friday, 4],
    ['2026-10-24', 2],
    ['2026-10-25', 2],
    [monday, 0],
  ] as const) {
    const calendar = await read(date, 'day');
    const actions = calendar.entries.filter(
      (entry) =>
        entry.participantId === person.id && entry.kind !== 'correction',
    );
    expect(actions).toHaveLength(count);
    expect(
      calendar.bets.filter((row) => row.participantId === person.id),
    ).toHaveLength(date === monday ? 1 : 0);
  }
  const locked = await game.dailyActivity(
    person.id,
    monday,
    new Date(`${monday}T11:26:00Z`),
    'draw',
  );
  expect(
    locked.positions?.find((row) => row.participantId === person.id)?.status,
  ).toBe('locked');
  const mondayDraw = await game.drawIfDue(new Date(`${monday}T11:30:00Z`));
  expect(mondayDraw).not.toBeNull();
  drawIds.push(mondayDraw!.id);
  // The next spin must not retain the completed spin's legacy counters.
  const nextSidebar = await game.currentInfluence(
    person.id,
    new Date(`${monday}T12:00:00Z`),
  );
  marketIds.push(
    ...(
      await database.db
        .select()
        .from(bettingMarkets)
        .where(eq(bettingMarkets.localDate, '2026-10-27'))
    ).map((row) => row.id),
  );
  expect(
    nextSidebar.places.find((row) => row.placeId === place.id),
  ).toMatchObject({
    boosts: 0,
    reductions: 0,
    historicalBoosts: 0,
    historicalReductions: 0,
  });
  const nextStandings = await game.tokenOverview(
    person.id,
    new Date(`${monday}T11:30:00Z`),
  );
  expect(nextStandings.spinLocalDate).toBe('2026-10-27');
  expect(
    nextStandings.rows.find((row) => row.participantId === person.id)
      ?.spinDelta,
  ).toBe(0);
  await game.setDrawSkip(true, new Date(`${monday}T12:00:00Z`));
  expect(
    (await game.tokenOverview(person.id, new Date(`${monday}T12:00:00Z`)))
      .spinLocalDate,
  ).toBe('2026-10-28');
  const settled = await game.dailyActivity(
    person.id,
    monday,
    new Date(`${monday}T12:00:00Z`),
    'draw',
  );
  const settledBet = settled.bets.find(
    (row) => row.participantId === person.id,
  )!;
  expect(settledBet.probability).toBe(
    mondayDraw!.snapshot.find((row) => row.placeId === place.id)!.probability,
  );
  expect(settledBet.currentProbability).toBeNull();
  expect(settledBet.estimatedWinPayout).toBeNull();
  expect(
    settled.positions?.find((row) => row.participantId === person.id)?.status,
  ).toBe('committed');
});

it('opens immediately by default and carries an optional delay across midnight', async () => {
  await game.setSchedule({
    timezone: 'UTC',
    time: '11:30',
    weekdays: [1, 2, 3, 4, 5],
  });
  await game.setPreferences({
    ...(await game.getPreferences()),
    wheelSwitchTime: '23:59',
    postDrawDelayMinutes: 0,
  });
  const drawnAt = new Date('2026-11-02T23:50:00Z');
  const draw = await game.drawIfDue(drawnAt);
  expect(draw).not.toBeNull();
  drawIds.push(draw!.id);
  expect((await game.today(drawnAt)).wheel).toEqual({
    mode: 'upcoming',
    localDate: '2026-11-03',
  });
  const market = await game.currentInfluence(person.id, drawnAt);
  expect(market.window).toMatchObject({
    open: true,
    opensAt: null,
    localDate: '2026-11-03',
  });
  marketIds.push(
    ...(
      await database.db
        .select()
        .from(bettingMarkets)
        .where(eq(bettingMarkets.localDate, '2026-11-03'))
    ).map((row) => row.id),
  );
  const body = { localDate: '2026-11-03', placeId: place.id };
  const key = crypto.randomUUID();
  const purchase = await game.purchase(
    person.id,
    { placeId: place.id, action: 'boost' },
    key,
    drawnAt,
  );
  await game.setBet(
    person.id,
    { ...body, stake: 5 },
    crypto.randomUUID(),
    drawnAt,
  );
  await game.setPreferences({
    ...(await game.getPreferences()),
    postDrawDelayMinutes: 30,
  });
  const beforeOpen = new Date('2026-11-03T00:19:59Z');
  for (const at of [drawnAt, beforeOpen, new Date('2026-11-03T00:20:00Z')]) {
    const standings = await game.tokenOverview(person.id, at);
    expect(standings.spinLocalDate).toBe('2026-11-03');
    expect(
      standings.rows.find((row) => row.participantId === person.id)?.spinDelta,
    ).toBe(-10);
  }
  expect((await game.currentBets(person.id, beforeOpen)).window).toMatchObject({
    open: false,
    opensAt: '2026-11-03T00:20:00.000Z',
  });
  await expect(
    game.purchase(
      person.id,
      { placeId: place.id, action: 'boost' },
      crypto.randomUUID(),
      beforeOpen,
    ),
  ).rejects.toMatchObject({ code: 'INFLUENCE_CLOSED' });
  // Successful retries still return their receipt while new edits are paused.
  expect(
    await game.purchase(
      person.id,
      { placeId: place.id, action: 'boost' },
      key,
      beforeOpen,
    ),
  ).toEqual(purchase);
  expect(
    (await game.currentInfluence(person.id, new Date('2026-11-03T00:20:00Z')))
      .window.open,
  ).toBe(true);
});
