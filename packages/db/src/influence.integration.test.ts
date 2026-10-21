import './env';
import { afterAll, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { createDatabase } from './index';
import { GameService } from './operations';
import {
  betRequests,
  bettingMarkets,
  bets,
  draws,
  influenceLots,
  notificationOutbox,
  participants,
  places,
  settings,
  tokenLedger,
} from './schema';

const database = createDatabase();
const service = new GameService(database);
const [originalSettings] = await database.db
  .select()
  .from(settings)
  .where(eq(settings.id, 1));
const originalPlaces = await database.db.select().from(places);
const originalEconomy = await service.getEconomy();
const suffix = crypto.randomUUID();
const owner = await service.saveParticipant({ name: `influence-${suffix}` });
const teammate = await service.saveParticipant({
  name: `influence-teammate-${suffix}`,
});
const target = await service.savePlace({ name: `influence-place-${suffix}` });
const unaffected = await service.savePlace({
  name: `influence-other-${suffix}`,
});
const participantIds = [owner.id, teammate.id];
const placeIds = [target.id, unaffected.id];
const marketIds: string[] = [];
const betIds: string[] = [];
const drawIds: string[] = [];

afterAll(async () => {
  try {
    if (marketIds.length)
      await database.db
        .delete(influenceLots)
        .where(inArray(influenceLots.marketId, marketIds));
    if (participantIds.length)
      await database.db
        .delete(influenceLots)
        .where(inArray(influenceLots.participantId, participantIds));
    if (participantIds.length)
      await database.db
        .delete(tokenLedger)
        .where(inArray(tokenLedger.participantId, participantIds));
    if (participantIds.length)
      await database.db
        .delete(betRequests)
        .where(inArray(betRequests.participantId, participantIds));
    if (betIds.length)
      await database.db.delete(bets).where(inArray(bets.id, betIds));
    if (marketIds.length)
      await database.db
        .delete(bettingMarkets)
        .where(inArray(bettingMarkets.id, marketIds));
    if (drawIds.length)
      await database.db
        .delete(notificationOutbox)
        .where(inArray(notificationOutbox.drawId, drawIds));
    if (drawIds.length)
      await database.db.delete(draws).where(inArray(draws.id, drawIds));
    if (placeIds.length)
      await database.db.delete(places).where(inArray(places.id, placeIds));
    if (participantIds.length)
      await database.db
        .delete(participants)
        .where(inArray(participants.id, participantIds));
    for (const place of originalPlaces)
      await database.db
        .update(places)
        .set({ active: place.active, logWeight: place.logWeight })
        .where(eq(places.id, place.id));
    await service.setEconomy(originalEconomy);
    if (originalSettings)
      await database.db
        .update(settings)
        .set({
          timezone: originalSettings.timezone,
          spinTime: originalSettings.spinTime,
          weekdays: originalSettings.weekdays,
          wheelSwitchTime: originalSettings.wheelSwitchTime,
          checkInPledge: originalSettings.checkInPledge,
          bettingCloseMinutes: originalSettings.bettingCloseMinutes,
          setupCompleted: originalSettings.setupCompleted,
        })
        .where(eq(settings.id, 1));
  } finally {
    await database.close();
  }
});

it('keeps influence editable and refundable per person, place, and original purchase', async () => {
  await database.db
    .update(settings)
    .set({ setupCompleted: true })
    .where(eq(settings.id, 1));
  await service.setSchedule({
    timezone: 'UTC',
    time: '13:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  await service.setPreferences({
    wheelSwitchTime: '15:00',
    checkInPledge: 'I followed the wheel',
    bettingCloseMinutes: 5,
  });
  const drawTime = new Date('2198-06-17T13:00:00.000Z');
  const beforeCutoff = new Date('2198-06-17T12:54:00.000Z');
  const onCutoff = new Date('2198-06-17T12:55:00.000Z');
  for (const place of originalPlaces)
    await database.db
      .update(places)
      .set({ logWeight: -10000 })
      .where(eq(places.id, place.id));
  await database.db
    .update(places)
    .set({ logWeight: 0 })
    .where(inArray(places.id, placeIds));

  await service.correctTokens(
    { participantId: owner.id, delta: 100, reason: 'fund influence test' },
    crypto.randomUUID(),
  );
  await service.correctTokens(
    { participantId: teammate.id, delta: 100, reason: 'fund teammate test' },
    crypto.randomUUID(),
  );
  const window = await service.currentInfluence(owner.id, beforeCutoff);
  expect(window.window).toMatchObject({
    localDate: '2198-06-17',
    cutoffLocalTime: '12:55',
    open: true,
  });
  const markets = await database.db
    .select()
    .from(bettingMarkets)
    .where(eq(bettingMarkets.localDate, window.window.localDate));
  marketIds.push(...markets.map((market) => market.id));

  const boostKey = crypto.randomUUID();
  const firstBoost = await service.changeInfluence(
    owner.id,
    {
      localDate: window.window.localDate,
      placeId: target.id,
      action: 'boost',
      change: 1,
    },
    boostKey,
    beforeCutoff,
  );
  expect(firstBoost).toMatchObject({ balance: 95, tokenDelta: -5 });
  expect(
    await service.changeInfluence(
      owner.id,
      {
        localDate: window.window.localDate,
        placeId: target.id,
        action: 'boost',
        change: 1,
      },
      boostKey,
      beforeCutoff,
    ),
  ).toEqual(firstBoost);
  await expect(
    service.changeInfluence(
      owner.id,
      {
        localDate: window.window.localDate,
        placeId: target.id,
        action: 'boost',
        change: -1,
      },
      boostKey,
      beforeCutoff,
    ),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });

  const afterFirstBoost = firstBoost.place.logWeight;
  const firstReduction = await service.changeInfluence(
    owner.id,
    {
      localDate: window.window.localDate,
      placeId: unaffected.id,
      action: 'reduce',
      change: 1,
    },
    crypto.randomUUID(),
    beforeCutoff,
  );
  expect(firstReduction.balance).toBe(90);
  const changedEconomy = {
    ...originalEconomy,
    boostCost: 9,
    reduceCost: 8,
    boostMultiplier: 2,
    reduceMultiplier: 0.5,
  };
  await service.setEconomy(changedEconomy);
  const undoneReduction = await service.changeInfluence(
    owner.id,
    {
      localDate: window.window.localDate,
      placeId: unaffected.id,
      action: 'reduce',
      change: -1,
    },
    crypto.randomUUID(),
    beforeCutoff,
  );
  expect(undoneReduction.balance).toBe(95);
  expect(undoneReduction.place.logWeight).toBeCloseTo(0);
  const secondBoost = await service.changeInfluence(
    owner.id,
    {
      localDate: window.window.localDate,
      placeId: target.id,
      action: 'boost',
      change: 1,
    },
    crypto.randomUUID(),
    beforeCutoff,
  );
  expect(secondBoost.balance).toBe(86);
  expect(secondBoost.place.logWeight).toBeCloseTo(
    afterFirstBoost + Math.log(2),
  );

  const reduction = await service.changeInfluence(
    owner.id,
    {
      localDate: window.window.localDate,
      placeId: unaffected.id,
      action: 'reduce',
      change: 1,
    },
    crypto.randomUUID(),
    beforeCutoff,
  );
  expect(reduction.balance).toBe(78);
  expect(reduction.place.logWeight).toBeCloseTo(Math.log(0.5));
  const teammateBoost = await service.changeInfluence(
    teammate.id,
    {
      localDate: window.window.localDate,
      placeId: target.id,
      action: 'boost',
      change: 1,
    },
    crypto.randomUUID(),
    beforeCutoff,
  );
  expect(teammateBoost.balance).toBe(91);

  const withPositions = await service.currentInfluence(owner.id, beforeCutoff);
  expect(
    withPositions.places.find((position) => position.placeId === target.id),
  ).toMatchObject({
    boosts: 3,
    reductions: 0,
    yourBoosts: 2,
    yourReductions: 0,
  });
  await expect(
    service.changeInfluence(
      owner.id,
      {
        localDate: window.window.localDate,
        placeId: unaffected.id,
        action: 'boost',
        change: -1,
      },
      crypto.randomUUID(),
      beforeCutoff,
    ),
  ).rejects.toMatchObject({ code: 'INFLUENCE_NOT_FOUND' });
  const concurrentUndo = await Promise.allSettled([
    service.changeInfluence(
      owner.id,
      {
        localDate: window.window.localDate,
        placeId: target.id,
        action: 'boost',
        change: -1,
      },
      crypto.randomUUID(),
      beforeCutoff,
    ),
    service.changeInfluence(
      owner.id,
      {
        localDate: window.window.localDate,
        placeId: target.id,
        action: 'boost',
        change: -1,
      },
      crypto.randomUUID(),
      beforeCutoff,
    ),
    service.changeInfluence(
      owner.id,
      {
        localDate: window.window.localDate,
        placeId: target.id,
        action: 'boost',
        change: -1,
      },
      crypto.randomUUID(),
      beforeCutoff,
    ),
  ]);
  expect(
    concurrentUndo.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(2);
  expect(
    concurrentUndo.filter((result) => result.status === 'rejected'),
  ).toHaveLength(1);
  expect((await service.wallet(owner.id)).balance).toBe(92);
  expect(
    concurrentUndo
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value.tokenDelta)
      .sort(),
  ).toEqual([5, 9]);

  const beforeDraw = await service.currentInfluence(owner.id, beforeCutoff);
  const staged = await service.dailyActivity(
    owner.id,
    window.window.localDate,
    beforeCutoff,
  );
  expect(
    staged.positions?.find(
      (position) =>
        position.participantId === owner.id &&
        position.placeId === unaffected.id,
    ),
  ).toMatchObject({ boosts: 0, reductions: 1, status: 'staged' });
  expect((await service.currentInfluence(owner.id, onCutoff)).window.open).toBe(
    false,
  );
  for (const change of [-1, 1] as const)
    await expect(
      service.changeInfluence(
        owner.id,
        {
          localDate: window.window.localDate,
          placeId: target.id,
          action: 'reduce',
          change,
        },
        crypto.randomUUID(),
        onCutoff,
      ),
    ).rejects.toMatchObject({ code: 'INFLUENCE_CLOSED' });
  const locked = await service.dailyActivity(
    owner.id,
    window.window.localDate,
    onCutoff,
  );
  expect(
    locked.positions?.every((position) => position.status === 'locked'),
  ).toBe(true);
  const expectedTargetWeight = (await service.listPlaces()).find(
    (place) => place.id === target.id,
  )!.logWeight;
  const draw = await service.drawIfDue(drawTime);
  expect(
    draw?.snapshot.find((snapshot) => snapshot.placeId === target.id)
      ?.logWeight,
  ).toBeCloseTo(expectedTargetWeight);
  if (draw) drawIds.push(draw.id);
  const committed = await service.dailyActivity(
    owner.id,
    window.window.localDate,
    drawTime,
  );
  expect(
    committed.positions?.every((position) => position.status === 'committed'),
  ).toBe(true);
  const frozenWeight = draw?.snapshot.find(
    (snapshot) => snapshot.placeId === target.id,
  )?.logWeight;
  const nextWindow = await service.currentInfluence(
    owner.id,
    new Date('2198-06-18T12:00:00.000Z'),
  );
  const nextMarkets = await database.db
    .select()
    .from(bettingMarkets)
    .where(eq(bettingMarkets.localDate, nextWindow.window.localDate));
  marketIds.push(...nextMarkets.map((market) => market.id));
  const unaffectedWeight = (await service.listPlaces()).find(
    (place) => place.id === unaffected.id,
  )!.logWeight;
  await service.setEconomy(originalEconomy);
  const legacyPurchaseAt = new Date('2198-06-18T12:00:00.000Z');
  const legacyPurchase = await service.purchase(
    owner.id,
    { placeId: unaffected.id, action: 'boost' },
    crypto.randomUUID(),
    legacyPurchaseAt,
  );
  expect(legacyPurchase.place.logWeight).toBeCloseTo(
    unaffectedWeight + Math.log(originalEconomy.boostMultiplier),
  );
  await service.setEconomy(changedEconomy);
  const followingDay = new Date('2198-06-19T12:00:00.000Z');
  const afterExpiryPurchase = await service.purchase(
    owner.id,
    { placeId: unaffected.id, action: 'boost' },
    crypto.randomUUID(),
    followingDay,
  );
  expect(afterExpiryPurchase.balance).toBe(83);
  expect(afterExpiryPurchase.place.logWeight).toBeCloseTo(
    unaffectedWeight + Math.log(changedEconomy.boostMultiplier),
  );
  const refreshedNextMarket = await service.currentInfluence(
    owner.id,
    followingDay,
  );
  expect(
    refreshedNextMarket.places.find(
      (position) => position.placeId === unaffected.id,
    ),
  ).toMatchObject({ boosts: 1, yourBoosts: 1 });
  const followingMarkets = await database.db
    .select()
    .from(bettingMarkets)
    .where(eq(bettingMarkets.localDate, refreshedNextMarket.window.localDate));
  marketIds.push(...followingMarkets.map((market) => market.id));
  expect(
    draw?.snapshot.find((snapshot) => snapshot.placeId === target.id)
      ?.logWeight,
  ).toBe(frozenWeight);
  expect(
    beforeDraw.places.find((position) => position.placeId === target.id),
  ).toMatchObject({
    boosts: 1,
    reductions: 0,
    yourBoosts: 0,
    yourReductions: 0,
  });

  await expect(
    service.changeInfluence(
      owner.id,
      {
        localDate: window.window.localDate,
        placeId: target.id,
        action: 'reduce',
        change: -1,
      },
      crypto.randomUUID(),
      onCutoff,
    ),
  ).rejects.toMatchObject({ code: 'INFLUENCE_CLOSED' });
});

it('refunds every active place position and open bet when a place is banned', async () => {
  await service.setEconomy(originalEconomy);
  await service.setSchedule({
    timezone: 'UTC',
    time: '13:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  const now = new Date('2198-07-22T12:00:00.000Z');
  const market = await service.currentInfluence(owner.id, now);
  const markets = await database.db
    .select()
    .from(bettingMarkets)
    .where(eq(bettingMarkets.localDate, market.window.localDate));
  marketIds.push(...markets.map((row) => row.id));
  const activeMarket = markets.find((row) => row.status === 'open')!;

  for (const person of [owner, teammate]) {
    await service.correctTokens(
      {
        participantId: person.id,
        delta: 100,
        reason: 'fund place archive test',
      },
      crypto.randomUUID(),
    );
    await service.changeInfluence(
      person.id,
      {
        localDate: market.window.localDate,
        placeId: target.id,
        action: 'boost',
        change: 1,
      },
      crypto.randomUUID(),
      now,
    );
    await service.changeInfluence(
      person.id,
      {
        localDate: market.window.localDate,
        placeId: unaffected.id,
        action: 'reduce',
        change: 1,
      },
      crypto.randomUUID(),
      now,
    );
    const bet = await service.setBet(
      person.id,
      {
        localDate: market.window.localDate,
        placeId: target.id,
        stake: 10,
      },
      crypto.randomUUID(),
      now,
    );
    if (bet.bet) betIds.push(bet.bet.id);
  }

  const preBanBalances = new Map(
    await Promise.all(
      [owner, teammate].map(
        async (person) =>
          [person.id, (await service.wallet(person.id)).balance] as const,
      ),
    ),
  );
  const activeEconomy = await service.getEconomy();
  const banAt = new Date('2198-07-22T12:55:00.000Z');
  expect((await service.currentInfluence(owner.id, banAt)).window.open).toBe(
    false,
  );
  await service.purchase(
    owner.id,
    { placeId: target.id, action: 'remove' },
    crypto.randomUUID(),
    banAt,
  );

  for (const person of [owner, teammate]) {
    const afterBan = await service.wallet(person.id);
    expect(afterBan.balance).toBe(
      (preBanBalances.get(person.id) ?? 0) +
        activeEconomy.boostCost +
        10 -
        (person.id === owner.id ? activeEconomy.removePlaceCost : 0),
    );
    const positions = await service.currentInfluence(person.id, now);
    expect(
      positions.places.find((position) => position.placeId === target.id),
    ).toBeUndefined();
    expect(
      positions.places.find((position) => position.placeId === unaffected.id),
    ).toMatchObject({ boosts: 0, reductions: 2, yourReductions: 1 });
  }
  const removedBets = await database.db
    .select()
    .from(bets)
    .where(inArray(bets.id, betIds));
  expect(removedBets).toHaveLength(2);
  expect(removedBets.every((bet) => bet.status === 'refunded')).toBe(true);
  const bannedLots = await database.db
    .select()
    .from(influenceLots)
    .where(
      and(
        eq(influenceLots.marketId, activeMarket.id),
        eq(influenceLots.placeId, target.id),
      ),
    );
  expect(bannedLots).toHaveLength(2);
  expect(bannedLots.every((lot) => lot.withdrawnAt !== null)).toBe(true);
  const refunds = await database.db
    .select()
    .from(tokenLedger)
    .where(and(inArray(tokenLedger.participantId, participantIds)));
  expect(
    refunds.filter(
      (entry) =>
        entry.kind === 'boost-refund' &&
        entry.influenceMarketId === activeMarket.id,
    ),
  ).toHaveLength(2);
  expect(refunds.filter((entry) => entry.kind === 'bet-release')).toHaveLength(
    2,
  );
  expect(
    (
      await service.dailyActivity(owner.id, market.window.localDate, banAt)
    ).positions?.some((position) => position.placeId === target.id),
  ).toBe(false);
});

it('refunds pending units on schedule changes, deactivation and exact odds overrides', async () => {
  const beforeSchedule = await Promise.all(
    participantIds.map((id) => service.wallet(id)),
  );
  await service.setSchedule({
    timezone: 'UTC',
    time: '13:30',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  for (const [index, id] of participantIds.entries())
    expect((await service.wallet(id)).balance).toBe(
      beforeSchedule[index]!.balance + originalEconomy.reduceCost,
    );

  const now = new Date('2198-07-24T12:00:00.000Z');
  const market = await service.currentInfluence(owner.id, now);
  const rows = await database.db
    .select()
    .from(bettingMarkets)
    .where(eq(bettingMarkets.localDate, market.window.localDate));
  marketIds.push(...rows.map((row) => row.id));
  const baseWeight = (await service.listPlaces()).find(
    (place) => place.id === unaffected.id,
  )!.logWeight;
  const baseBalance = (await service.wallet(owner.id)).balance;
  const body = {
    localDate: market.window.localDate,
    placeId: unaffected.id,
    action: 'boost' as const,
    change: 1 as const,
  };
  await service.changeInfluence(owner.id, body, crypto.randomUUID(), now);
  await service.saveParticipant({ active: false }, owner.id);
  expect(
    (await service.listTokenBalances()).balances.find(
      (row) => row.participantId === owner.id,
    )?.balance,
  ).toBe(baseBalance);
  expect(
    (await service.listPlaces()).find((place) => place.id === unaffected.id)
      ?.logWeight,
  ).toBeCloseTo(baseWeight);
  await service.saveParticipant({ active: true }, owner.id);

  await service.changeInfluence(owner.id, body, crypto.randomUUID(), now);
  const active = await service.listPlaces();
  const overridden = await service.setRestaurantOdds({
    places: active.map((place) => ({
      placeId: place.id,
      percent: 100 / active.length,
    })),
  });
  expect((await service.wallet(owner.id)).balance).toBe(baseBalance);
  expect(
    overridden.places.every(
      (place) => Math.abs(place.percent - 100 / active.length) < 0.000001,
    ),
  ).toBe(true);
  expect(
    (await service.currentInfluence(owner.id, now)).places.every(
      (place) => place.boosts === 0 && place.reductions === 0,
    ),
  ).toBe(true);
});
