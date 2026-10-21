import './env';
import { afterAll, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { createDatabase } from './index';
import { GameService, isReplay } from './operations';
import {
  bettingMarkets,
  bets,
  betRequests,
  draws,
  influenceLots,
  notificationOutbox,
  participants,
  places,
  settings,
  tokenLedger,
} from './schema';
const database = createDatabase();
const game = new GameService(database);
const [original] = await database.db.select().from(settings);
const originalPlaces = await database.db.select().from(places);
const originalEconomy = await game.getEconomy();
const suffix = crypto.randomUUID();
const person = await game.saveParticipant({ name: `ui-owner-${suffix}` });
const teammate = await game.saveParticipant({ name: `ui-team-${suffix}` });
const target = await game.savePlace({ name: `ui-target-${suffix}` });
const other = await game.savePlace({ name: `ui-other-${suffix}` });
const people = [person.id, teammate.id];
const marketIds: string[] = [];
const drawIds: string[] = [];
const before = new Date('2301-01-02T12:00:00Z');
const cutoff = new Date('2301-01-02T12:55:00Z');

afterAll(async () => {
  await database.db
    .delete(influenceLots)
    .where(inArray(influenceLots.participantId, people));
  await database.db
    .delete(tokenLedger)
    .where(inArray(tokenLedger.participantId, people));
  await database.db
    .delete(betRequests)
    .where(inArray(betRequests.participantId, people));
  await database.db.delete(bets).where(inArray(bets.participantId, people));
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
  await database.db
    .delete(places)
    .where(inArray(places.id, [target.id, other.id]));
  await database.db
    .delete(participants)
    .where(inArray(participants.id, people));
  for (const place of originalPlaces)
    await database.db
      .update(places)
      .set({ logWeight: place.logWeight })
      .where(eq(places.id, place.id));
  await game.setEconomy(originalEconomy);
  await database.db.update(settings).set(original!).where(eq(settings.id, 1));
  await database.close();
});

it('refunds all own directions at saved prices exactly once, preserving other users and bets', async () => {
  await game.setSchedule({
    timezone: 'UTC',
    time: '13:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  await game.setPreferences({
    ...(await game.getPreferences()),
    bettingCloseMinutes: 5,
  });
  await game.setEconomy({ ...originalEconomy, boostCost: 5, reduceCost: 5 });
  await game.correctTokens(
    { participantId: person.id, delta: 100, reason: 'Disposable UI test' },
    crypto.randomUUID(),
  );
  await game.correctTokens(
    { participantId: teammate.id, delta: 50, reason: 'Disposable UI test' },
    crypto.randomUUID(),
  );
  const market = await game.currentInfluence(person.id, before);
  marketIds.push(
    ...(
      await database.db
        .select()
        .from(bettingMarkets)
        .where(eq(bettingMarkets.localDate, market.window.localDate))
    ).map((row) => row.id),
  );
  const originalWeight = (await game.listPlaces()).find(
    (place) => place.id === target.id,
  )!.logWeight;
  const body = { localDate: market.window.localDate, placeId: target.id };
  await game.setBet(
    person.id,
    { ...body, stake: 10 },
    crypto.randomUUID(),
    before,
  );
  for (const action of [
    'reduce',
    'reduce',
    'boost',
    'boost',
    'boost',
    'boost',
  ] as const)
    await game.changeInfluence(
      person.id,
      { ...body, action, change: 1 },
      crypto.randomUUID(),
      before,
    );
  await game.changeInfluence(
    teammate.id,
    { ...body, action: 'boost', change: 1 },
    crypto.randomUUID(),
    before,
  );
  await game.setEconomy({ ...originalEconomy, boostCost: 7, reduceCost: 9 });
  await game.changeInfluence(
    person.id,
    { ...body, action: 'boost', change: 1 },
    crypto.randomUUID(),
    before,
  );
  const key = crypto.randomUUID();
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      game.refundInfluence(person.id, body, key, before),
    ),
  );
  expect(results[0]).toMatchObject({ tokenDelta: 17, balance: 90 });
  expect(results.filter(isReplay)).toHaveLength(3);
  expect(
    (await game.listPlaces()).find((place) => place.id === target.id)!
      .logWeight,
  ).toBeCloseTo(originalWeight + Math.log(originalEconomy.boostMultiplier));
  expect(
    (await game.currentInfluence(person.id, before)).places.find(
      (place) => place.placeId === target.id,
    ),
  ).toMatchObject({
    boosts: 1,
    reductions: 0,
    yourBoosts: 0,
    yourReductions: 0,
  });
  expect((await game.wallet(person.id)).bets[0]).toMatchObject({
    status: 'open',
    stake: 10,
  });
  expect(await game.refundInfluence(person.id, body, key, cutoff)).toEqual(
    results[0],
  );
  await expect(
    game.refundInfluence(person.id, body, crypto.randomUUID(), cutoff),
  ).rejects.toMatchObject({ code: 'INFLUENCE_CLOSED' });
  await expect(
    game.refundInfluence(person.id, body, crypto.randomUUID(), before),
  ).rejects.toMatchObject({ code: 'INFLUENCE_NOT_FOUND' });
});

it('serializes opposite clicks and never holds both directions, including the legacy purchase path', async () => {
  const window = await game.currentInfluence(person.id, before);
  const body = { localDate: window.window.localDate, placeId: target.id };
  await Promise.all([
    game.changeInfluence(
      person.id,
      { ...body, action: 'boost', change: 1 },
      crypto.randomUUID(),
      before,
    ),
    game.purchase(
      person.id,
      { placeId: target.id, action: 'reduce' },
      crypto.randomUUID(),
      before,
    ),
  ]);
  expect((await game.wallet(person.id)).balance).toBe(90);
  expect(
    (await game.currentInfluence(person.id, before)).places.find(
      (place) => place.placeId === target.id,
    ),
  ).toMatchObject({ yourBoosts: 0, yourReductions: 0, boosts: 1 });
  await game.changeInfluence(
    person.id,
    { ...body, action: 'reduce', change: 1 },
    crypto.randomUUID(),
    before,
  );
  await game.changeInfluence(
    person.id,
    { ...body, action: 'reduce', change: 1 },
    crypto.randomUUID(),
    before,
  );
  const key = crypto.randomUUID();
  const result = await game.purchase(
    person.id,
    { placeId: target.id, action: 'boost' },
    key,
    before,
  );
  expect(result).toMatchObject({
    spentTokens: 0,
    refundedTokens: 9,
    balance: 81,
  });
  expect(
    await game.purchase(
      person.id,
      { placeId: target.id, action: 'boost' },
      key,
      before,
    ),
  ).toEqual(result);
  expect(
    (await game.currentInfluence(person.id, before)).places.find(
      (place) => place.placeId === target.id,
    ),
  ).toMatchObject({ yourBoosts: 0, yourReductions: 1 });
  await game.refundInfluence(person.id, body, crypto.randomUUID(), before);
});

it('nets pre-existing mixed positions with original-price refunds before applying an adjustment', async () => {
  const window = await game.currentInfluence(person.id, before);
  const marketId = marketIds[0]!;
  const body = { localDate: window.window.localDate, placeId: other.id };
  const baseWeight = (await game.listPlaces()).find(
    (place) => place.id === other.id,
  )!.logWeight;
  for (let index = 0; index < 2; index++)
    await game.changeInfluence(
      person.id,
      { ...body, action: 'reduce', change: 1 },
      crypto.randomUUID(),
      before,
    );
  // Reproduce a valid mixed position saved by the previous version.
  const [debit] = await database.db
    .insert(tokenLedger)
    .values({
      participantId: person.id,
      delta: -4,
      kind: 'boost',
      idempotencyKey: crypto.randomUUID(),
      requestHash: 'legacy-test-fixture',
      placeId: other.id,
      influenceMarketId: marketId,
      createdAt: before,
    })
    .returning();
  await database.db.insert(influenceLots).values({
    participantId: person.id,
    marketId,
    placeId: other.id,
    action: 'boost',
    tokenCost: 4,
    logMultiplier: Math.log(1.25),
    purchaseLedgerId: debit!.id,
    createdAt: before,
  });
  const weighted = (await game.listPlaces()).find(
    (place) => place.id === other.id,
  )!;
  await database.db
    .update(places)
    .set({ logWeight: weighted.logWeight + Math.log(1.25) })
    .where(eq(places.id, other.id));
  const key = crypto.randomUUID();
  const result = await game.changeInfluence(
    person.id,
    { ...body, action: 'boost', change: 1 },
    key,
    before,
  );
  expect(result).toMatchObject({ balance: 90, tokenDelta: 22 });
  expect(result.place.logWeight).toBeCloseTo(baseWeight);
  expect(
    (await game.currentInfluence(person.id, before)).places.find(
      (place) => place.placeId === other.id,
    ),
  ).toMatchObject({ yourBoosts: 0, yourReductions: 0 });
  expect(
    await game.changeInfluence(
      person.id,
      { ...body, action: 'boost', change: 1 },
      key,
      cutoff,
    ),
  ).toEqual(result);
});

it('sets a direct positive weight after refunding pending influence and leaves other weights unchanged', async () => {
  const otherWeight = (await game.listPlaces()).find(
    (place) => place.id === other.id,
  )!.logWeight;
  const changed = await game.setPlaceWeight({
    placeId: target.id,
    weight: 3.25,
  });
  expect(changed.logWeight).toBeCloseTo(Math.log(3.25));
  expect((await game.wallet(teammate.id)).balance).toBe(50);
  expect(
    (await game.listPlaces()).find((place) => place.id === other.id)!.logWeight,
  ).toBe(otherWeight);
  for (const weight of [0, -1, Infinity, NaN])
    await expect(
      game.setPlaceWeight({ placeId: target.id, weight }),
    ).rejects.toMatchObject({ code: 'INVALID_WEIGHT' });
});

it('freezes configured spin duration on each new draw and preserves legacy timing', async () => {
  const preferences = await game.getPreferences();
  await game.setPreferences({ ...preferences, wheelSpinSeconds: 42 });
  expect((await game.getPreferences()).wheelSpinSeconds).toBe(42);
  const first = (await game.drawIfDue(new Date('2301-01-02T13:00:00Z')))!;
  drawIds.push(first.id);
  expect(first.animation!.durationMs).toBe(42000);
  await game.setPreferences({ ...preferences, wheelSpinSeconds: 8 });
  const second = (await game.drawIfDue(new Date('2301-01-03T13:00:00Z')))!;
  drawIds.push(second.id);
  expect(second.animation!.durationMs).toBe(8000);
  expect(await game.drawIfDue(new Date('2301-01-02T13:00:00Z'))).toEqual(first);
  await database.db
    .update(draws)
    .set({ spinDurationMs: null })
    .where(eq(draws.id, second.id));
  const legacy = await game.drawIfDue(new Date('2301-01-03T13:00:00Z'));
  await game.setPreferences({ ...preferences, wheelSpinSeconds: 60 });
  expect(await game.drawIfDue(new Date('2301-01-03T13:00:00Z'))).toEqual(
    legacy,
  );
  for (const wheelSpinSeconds of [4, 61, 5.5])
    await expect(
      game.setPreferences({ ...preferences, wheelSpinSeconds }),
    ).rejects.toMatchObject({ code: 'INVALID_PREFERENCES' });
});
