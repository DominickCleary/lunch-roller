import { afterAll, beforeAll, expect, it } from 'vitest';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { createDatabase } from './index';
import { GameService } from './operations';
import {
  attendance,
  draws,
  notificationOutbox,
  participants,
  places,
  settings,
  tokenLedger,
} from './schema';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl)
  throw new Error(
    'Set TEST_DATABASE_URL to a disposable migrated and seeded database before running integration tests.',
  );

const database = createDatabase(testDatabaseUrl);
const service = new GameService(database);
const suffix = crypto.randomUUID();
const participantIds: string[] = [];
const placeIds: string[] = [];
const drawIds: string[] = [];
let originalSchedule: Awaited<ReturnType<GameService['getSchedule']>>;
let originalWeights = new Map<string, number>();

beforeAll(async () => {
  originalSchedule = await service.getSchedule();
  const person = await service.saveParticipant({
    name: `wheel-display-${suffix}`,
  });
  participantIds.push(person.id);
  const place = await service.savePlace({
    name: `wheel-display-${suffix}`,
  });
  placeIds.push(place.id);
  const comparisonPlace = await service.savePlace({
    name: `wheel-display-other-${suffix}`,
  });
  placeIds.push(comparisonPlace.id);
  originalWeights = new Map(
    (await service.listPlaces()).map((entry) => [entry.id, entry.logWeight]),
  );
});

afterAll(async () => {
  try {
    if (originalSchedule)
      await database.db
        .update(settings)
        .set({
          timezone: originalSchedule.timezone,
          spinTime: originalSchedule.time,
          weekdays: originalSchedule.weekdays,
        })
        .where(eq(settings.id, 1));
    for (const [id, logWeight] of originalWeights)
      await database.db
        .update(places)
        .set({ logWeight })
        .where(eq(places.id, id));

    if (drawIds.length)
      await database.db
        .update(notificationOutbox)
        .set({
          sentAt: new Date(),
          lockedUntil: null,
          leaseToken: null,
          lastError: 'wheel-display-test-cleanup',
        })
        .where(
          and(
            inArray(notificationOutbox.drawId, drawIds),
            isNull(notificationOutbox.sentAt),
          ),
        );
    if (participantIds.length) {
      await database.db
        .delete(tokenLedger)
        .where(inArray(tokenLedger.participantId, participantIds));
      await database.db
        .delete(attendance)
        .where(inArray(attendance.participantId, participantIds));
    }
    if (drawIds.length) {
      await database.db
        .delete(notificationOutbox)
        .where(inArray(notificationOutbox.drawId, drawIds));
      await database.db.delete(draws).where(inArray(draws.id, drawIds));
    }
    if (placeIds.length)
      await database.db.delete(places).where(inArray(places.id, placeIds));
    if (participantIds.length)
      await database.db
        .delete(participants)
        .where(inArray(participants.id, participantIds));
  } finally {
    await database.close();
  }
});

it('switches from the saved snapshot to mutable upcoming odds after the cutoff', async () => {
  await service.setSchedule({
    timezone: 'UTC',
    time: '00:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  const drawTime = new Date('2188-03-02T12:00:00.000Z');
  const draw = await service.drawIfDue(drawTime);
  expect(draw).not.toBeNull();
  if (!draw) throw new Error('Expected a committed draw for the fixture date.');
  drawIds.push(draw.id);

  const beforeCutoff = await service.today(new Date('2188-03-02T14:59:59Z'));
  expect(beforeCutoff.wheel).toEqual({
    mode: 'result',
    localDate: '2188-03-02',
  });
  expect(beforeCutoff.result?.snapshot).toEqual(draw.snapshot);

  const cutoff = new Date('2188-03-02T15:00:00Z');
  const atCutoff = await service.today(cutoff);
  expect(atCutoff.wheel).toEqual({ mode: 'upcoming', localDate: '2188-03-03' });
  expect(atCutoff.result?.snapshot).toEqual(draw.snapshot);
  const savedWinnerProbability = draw.snapshot.find(
    (option) => option.placeId === draw.placeId,
  )!.probability;
  const liveWinnerProbability = atCutoff.odds.find(
    (option) => option.placeId === draw.placeId,
  )!.probability;
  expect(liveWinnerProbability).not.toBeCloseTo(savedWinnerProbability, 10);

  const placeId = placeIds[0]!;
  const oddsBefore = atCutoff.odds.find(
    (option) => option.placeId === placeId,
  )!;
  await service.correctTokens(
    {
      participantId: participantIds[0]!,
      delta: 5,
      reason: 'wheel display integration fixture',
    },
    `wheel-display-grant-${suffix}`,
  );
  await service.purchase(
    participantIds[0]!,
    { placeId, action: 'boost' },
    `wheel-display-boost-${suffix}`,
  );

  const afterBoost = await service.today(cutoff);
  const oddsAfter = afterBoost.odds.find(
    (option) => option.placeId === placeId,
  )!;
  expect(oddsAfter.probability).toBeGreaterThan(oddsBefore.probability);
  expect(afterBoost.wheel).toEqual(atCutoff.wheel);
  expect(afterBoost.result?.snapshot).toEqual(draw.snapshot);
});
