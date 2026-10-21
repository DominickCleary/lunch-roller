import './env';
import { afterAll, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { createDatabase } from './index';
import { GameService } from './operations';
import { probabilities } from '@lunch/domain';
import {
  bettingMarkets,
  bets,
  participants,
  places,
  settings,
  tokenLedger,
  influenceLots,
} from './schema';

const database = createDatabase();
const service = new GameService(database);
const influenceAt = new Date('2199-10-20T12:00:00.000Z');
const [originalSettings] = await database.db
  .select()
  .from(settings)
  .where(eq(settings.id, 1));
const suffix = crypto.randomUUID();
const activePerson = await service.saveParticipant({
  name: `activity-${suffix}`,
});
const archivedPerson = await service.saveParticipant({
  name: `activity-archived-${suffix}`,
});
const firstPlace = await service.savePlace({
  name: `activity-first-${suffix}`,
});
const secondPlace = await service.savePlace({
  name: `activity-second-${suffix}`,
});
const addedPlaceIds: string[] = [];
const marketIds: string[] = [];
const betIds: string[] = [];

it('quotes open bets at live odds, refreshes changed weights and caps estimated returns', async () => {
  await service.savePlace({ active: true }, secondPlace.id);
  const [market] = await database.db
    .insert(bettingMarkets)
    .values({
      localDate: '2200-01-02',
      timezone: 'UTC',
      scheduledTime: '12:00',
      cutoffMinutes: 5,
    })
    .returning();
  marketIds.push(market!.id);
  const [bet] = await database.db
    .insert(bets)
    .values({
      marketId: market!.id,
      localDate: market!.localDate,
      participantId: activePerson.id,
      placeId: secondPlace.id,
      placeName: secondPlace.name,
      stake: 12,
      status: 'open',
    })
    .returning();
  betIds.push(bet!.id);
  const quote = async () =>
    (await service.dailyActivity(activePerson.id, market!.localDate)).bets.find(
      (row) => row.id === bet!.id,
    )!;
  const expectedProbability = async () =>
    probabilities(await service.listPlaces()).find(
      (row) => row.id === secondPlace.id,
    )!.probability;
  const before = await quote();
  expect(before.currentProbability).toBeCloseTo(await expectedProbability());
  expect(before.estimatedWinPayout).toBe(
    Math.floor(12 / before.currentProbability!),
  );
  await service.setPlaceWeight({ placeId: secondPlace.id, weight: 10 });
  const changed = await quote();
  expect(changed.currentProbability).toBeCloseTo(await expectedProbability());
  expect(changed.currentProbability).not.toBeCloseTo(
    before.currentProbability!,
  );
  expect(changed.estimatedWinPayout).toBe(
    Math.floor(12 / changed.currentProbability!),
  );
  await database.db
    .update(places)
    .set({ logWeight: -100 })
    .where(eq(places.id, secondPlace.id));
  expect((await quote()).estimatedWinPayout).toBe(2147483647);
  await database.db
    .update(places)
    .set({ logWeight: -10000 })
    .where(eq(places.id, secondPlace.id));
  expect(await quote()).toMatchObject({
    currentProbability: 0,
    estimatedWinPayout: null,
  });
  await database.db
    .update(bets)
    .set({ status: 'lost', probability: 0.25, payout: 0 })
    .where(eq(bets.id, bet!.id));
  expect(await quote()).toMatchObject({
    probability: 0.25,
    currentProbability: null,
    estimatedWinPayout: null,
    payout: 0,
  });
  await database.db
    .update(places)
    .set({ logWeight: secondPlace.logWeight })
    .where(eq(places.id, secondPlace.id));
});

afterAll(async () => {
  try {
    await database.db
      .delete(influenceLots)
      .where(
        inArray(influenceLots.participantId, [
          activePerson.id,
          archivedPerson.id,
        ]),
      );
    await database.db
      .delete(tokenLedger)
      .where(
        inArray(tokenLedger.participantId, [
          activePerson.id,
          archivedPerson.id,
        ]),
      );
    if (betIds.length)
      await database.db.delete(bets).where(inArray(bets.id, betIds));
    if (marketIds.length)
      await database.db
        .delete(bettingMarkets)
        .where(inArray(bettingMarkets.id, marketIds));
    await database.db
      .delete(places)
      .where(
        inArray(places.id, [firstPlace.id, secondPlace.id, ...addedPlaceIds]),
      );
    await database.db
      .delete(participants)
      .where(inArray(participants.id, [activePerson.id, archivedPerson.id]));
    if (originalSettings)
      await database.db
        .update(settings)
        .set({
          timezone: originalSettings.timezone,
          spinTime: originalSettings.spinTime,
          weekdays: originalSettings.weekdays,
          setupCompleted: originalSettings.setupCompleted,
        })
        .where(eq(settings.id, 1));
  } finally {
    await database.close();
  }
});

it('shows original token targets and a timezone-scoped team activity snapshot', async () => {
  await database.db
    .update(settings)
    .set({
      timezone: 'America/New_York',
      spinTime: '11:30',
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      setupCompleted: true,
    })
    .where(eq(settings.id, 1));
  await database.db
    .update(participants)
    .set({ active: false })
    .where(eq(participants.id, archivedPerson.id));

  await service.correctTokens(
    {
      participantId: activePerson.id,
      delta: 100,
      reason: 'activity test funds',
    },
    crypto.randomUUID(),
  );
  await service.purchase(
    activePerson.id,
    { placeId: firstPlace.id, action: 'boost' },
    crypto.randomUUID(),
    influenceAt,
  );
  await service.purchase(
    activePerson.id,
    { placeId: secondPlace.id, action: 'reduce' },
    crypto.randomUUID(),
    influenceAt,
  );
  await service.purchase(
    activePerson.id,
    { placeId: secondPlace.id, action: 'remove' },
    crypto.randomUUID(),
    influenceAt,
  );
  const added = await service.addPlace(
    activePerson.id,
    { name: `activity-added-${suffix}` },
    crypto.randomUUID(),
  );
  addedPlaceIds.push(added.place.id);

  const marketA = await database.db
    .insert(bettingMarkets)
    .values({
      localDate: '2199-10-21',
      timezone: 'America/New_York',
      scheduledTime: '12:00',
      cutoffMinutes: 5,
      status: 'settled',
    })
    .returning();
  const marketB = await database.db
    .insert(bettingMarkets)
    .values({
      localDate: '2199-10-21',
      timezone: 'America/New_York',
      scheduledTime: '12:00',
      cutoffMinutes: 5,
      status: 'void',
    })
    .returning();
  marketIds.push(marketA[0]!.id, marketB[0]!.id);
  const betA = await database.db
    .insert(bets)
    .values({
      marketId: marketA[0]!.id,
      localDate: '2199-10-21',
      participantId: activePerson.id,
      placeId: secondPlace.id,
      placeName: secondPlace.name,
      stake: 8,
      status: 'cancelled',
      payout: 0,
    })
    .returning();
  const betB = await database.db
    .insert(bets)
    .values({
      marketId: marketB[0]!.id,
      localDate: '2199-10-21',
      participantId: archivedPerson.id,
      placeId: firstPlace.id,
      placeName: firstPlace.name,
      stake: 12,
      status: 'refunded',
      payout: 0,
    })
    .returning();
  betIds.push(betA[0]!.id, betB[0]!.id);

  // The target is frozen on each ledger row. The bet itself now points at a
  // different place, modelling an edit that moved its current target.
  const betLedger = await database.db
    .insert(tokenLedger)
    .values({
      participantId: activePerson.id,
      delta: -8,
      kind: 'bet-stake',
      idempotencyKey: `activity-ledger-${suffix}-bet`,
      requestHash: 'activity-bet',
      placeId: firstPlace.id,
      betId: betA[0]!.id,
      reason: 'Tokens reserved for lunch bet',
      createdAt: new Date('2199-10-21T04:00:00.000Z'),
    })
    .returning();
  const archivedLedger = await database.db
    .insert(tokenLedger)
    .values({
      participantId: archivedPerson.id,
      delta: 4,
      kind: 'attendance',
      idempotencyKey: `activity-ledger-${suffix}-archived`,
      requestHash: 'activity-archived',
      createdAt: new Date('2199-10-21T05:00:00.000Z'),
    })
    .returning();
  const priorDateLedger = await database.db
    .insert(tokenLedger)
    .values({
      participantId: activePerson.id,
      delta: 3,
      kind: 'attendance',
      idempotencyKey: `activity-ledger-${suffix}-prior`,
      requestHash: 'activity-prior',
      createdAt: new Date('2199-10-21T03:59:59.000Z'),
    })
    .returning();
  const correctionInput = {
    participantId: activePerson.id,
    delta: 1,
    reason: 'correction response shape',
  };
  const correctionKey = crypto.randomUUID();
  const correctedWallet = await service.correctTokens(
    correctionInput,
    correctionKey,
  );
  expect(correctedWallet.bets.map((bet) => bet.id)).toContain(betA[0]!.id);
  expect(await service.correctTokens(correctionInput, correctionKey)).toEqual(
    correctedWallet,
  );

  const beforeLedgerCount = await database.db
    .select({ count: sql<number>`count(*)::int` })
    .from(tokenLedger);
  const beforeBetCount = await database.db
    .select({ count: sql<number>`count(*)::int` })
    .from(bets);

  const wallet = await service.wallet(activePerson.id);
  expect(wallet.ledger.find((row) => row.kind === 'boost')).toMatchObject({
    placeId: firstPlace.id,
    placeName: firstPlace.name,
  });
  expect(wallet.ledger.find((row) => row.kind === 'reduce')).toMatchObject({
    placeId: secondPlace.id,
    placeName: secondPlace.name,
  });
  expect(
    wallet.ledger.find((row) => row.kind === 'remove-place'),
  ).toMatchObject({
    placeId: secondPlace.id,
    placeName: secondPlace.name,
  });
  expect(wallet.ledger.find((row) => row.kind === 'add-place')).toMatchObject({
    placeId: added.place.id,
    placeName: added.place.name,
  });
  expect(
    wallet.ledger.find((row) => row.id === betLedger[0]!.id),
  ).toMatchObject({
    placeId: firstPlace.id,
    placeName: firstPlace.name,
    betId: betA[0]!.id,
    betLocalDate: '2199-10-21',
  });
  expect(
    wallet.bets.map((bet) => [bet.id, bet.status, bet.placeName]),
  ).toContainEqual([betA[0]!.id, 'cancelled', secondPlace.name]);

  const activity = await service.dailyActivity(
    activePerson.id,
    '2199-10-21',
    new Date('2199-10-21T16:00:00.000Z'),
  );
  expect(activity).toMatchObject({
    localDate: '2199-10-21',
    timezone: 'America/New_York',
  });
  expect(activity.entries.map((entry) => entry.id)).toContain(betLedger[0]!.id);
  expect(activity.entries.map((entry) => entry.id)).toContain(
    archivedLedger[0]!.id,
  );
  expect(activity.entries.map((entry) => entry.id)).not.toContain(
    priorDateLedger[0]!.id,
  );
  expect(
    activity.entries.find((entry) => entry.id === betLedger[0]!.id),
  ).toMatchObject({
    placeId: firstPlace.id,
    placeName: firstPlace.name,
    betLocalDate: '2199-10-21',
    participantId: activePerson.id,
  });
  expect(activity.bets.map((bet) => [bet.id, bet.status])).toEqual(
    expect.arrayContaining([
      [betA[0]!.id, 'cancelled'],
      [betB[0]!.id, 'refunded'],
    ]),
  );
  expect(
    activity.bets.find((bet) => bet.id === betB[0]!.id)?.participantName,
  ).toBe(archivedPerson.name);

  const defaultDay = await service.dailyActivity(
    activePerson.id,
    undefined,
    new Date('2199-10-21T04:30:00.000Z'),
  );
  expect(defaultDay.localDate).toBe('2199-10-21');
  expect(
    await database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(tokenLedger),
  ).toEqual(beforeLedgerCount);
  expect(
    await database.db.select({ count: sql<number>`count(*)::int` }).from(bets),
  ).toEqual(beforeBetCount);

  await expect(
    service.dailyActivity(crypto.randomUUID(), '2199-10-21'),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    service.dailyActivity(archivedPerson.id, '2199-10-21'),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.dailyActivity(activePerson.id, '2199-02-30'),
  ).rejects.toMatchObject({ status: 400 });

  const repeatedHour = await database.db
    .insert(tokenLedger)
    .values([
      {
        participantId: activePerson.id,
        delta: 2,
        kind: 'attendance',
        idempotencyKey: `activity-ledger-${suffix}-dst-a`,
        requestHash: 'activity-dst-a',
        createdAt: new Date('2026-11-01T05:30:00.000Z'),
      },
      {
        participantId: activePerson.id,
        delta: 3,
        kind: 'attendance',
        idempotencyKey: `activity-ledger-${suffix}-dst-b`,
        requestHash: 'activity-dst-b',
        createdAt: new Date('2026-11-01T06:30:00.000Z'),
      },
    ])
    .returning();
  const fallBackDay = await service.dailyActivity(
    activePerson.id,
    '2026-11-01',
  );
  expect(fallBackDay.entries.map((entry) => entry.id)).toEqual(
    expect.arrayContaining(repeatedHour.map((entry) => entry.id)),
  );
});
