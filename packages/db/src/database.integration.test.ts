import './env';
import { afterAll, expect, it } from 'vitest';
import { createDatabase } from './index';
import {
  attendance,
  draws,
  participants,
  places,
  settings,
  tokenLedger,
} from './schema';
import { sql } from 'drizzle-orm';

// Requires a disposable database migrated and seeded by the integration job.
const database = createDatabase();
afterAll(() => database.close());
it('has a seeded weekday schedule and equal-weight seed options', async () => {
  const rows = await database.db.select().from(settings);
  expect(rows[0]).toMatchObject({
    timezone: 'Europe/Dublin',
    spinTime: '11:30',
    weekdays: [1, 2, 3, 4, 5],
  });
  const options = await database.db.select().from(places);
  expect(options).toHaveLength(3);
  expect(options.every((place) => place.logWeight === 0)).toBe(true);
  expect(await database.db.select().from(participants)).toHaveLength(2);
});
it('enforces duplicate names, finite weights, daily draws, attendance, and ledger keys', async () => {
  // Each deliberate SQL failure uses a savepoint to preserve the outer rollback transaction.
  await database.db
    .transaction(async (tx) => {
      const [person] = await tx
        .insert(participants)
        .values({ name: `test-${crypto.randomUUID()}` })
        .returning();
      const [place] = await tx
        .insert(places)
        .values({ name: `test-${crypto.randomUUID()}` })
        .returning();
      const attempt = (fn: Parameters<typeof tx.transaction>[0]) =>
        tx.transaction(fn);
      await expect(
        attempt((nested) =>
          nested
            .insert(places)
            .values({ name: ` ${place!.name.toUpperCase()} ` }),
        ),
      ).rejects.toThrow();
      await expect(
        attempt((nested) =>
          nested
            .insert(places)
            .values({ name: 'bad weight', logWeight: Infinity }),
        ),
      ).rejects.toThrow();
      const drawValues = {
        localDate: '2099-01-01',
        timezone: 'Europe/Dublin',
        placeId: place!.id,
        placeName: place!.name,
        snapshot: [],
        sample: 0.5,
      };
      const [draw] = await tx.insert(draws).values(drawValues).returning();
      await expect(
        attempt((nested) => nested.insert(draws).values(drawValues)),
      ).rejects.toThrow();
      const attendanceValues = { participantId: person!.id, drawId: draw!.id };
      const [checkin] = await tx
        .insert(attendance)
        .values(attendanceValues)
        .returning();
      await expect(
        attempt((nested) => nested.insert(attendance).values(attendanceValues)),
      ).rejects.toThrow();
      const ledgerValues = {
        participantId: person!.id,
        attendanceId: checkin!.id,
        delta: 10,
        kind: 'attendance' as const,
        idempotencyKey: 'test',
        requestHash: 'hash',
      };
      await tx.insert(tokenLedger).values(ledgerValues);
      await expect(
        attempt((nested) => nested.insert(tokenLedger).values(ledgerValues)),
      ).rejects.toThrow();
      const [balance] = await tx
        .select({ total: sql<number>`sum(${tokenLedger.delta})::int` })
        .from(tokenLedger)
        .where(sql`${tokenLedger.participantId} = ${person!.id}`);
      expect(balance!.total).toBe(10);
      // Force rollback without swallowing an unexpected assertion failure.
      throw new Error('ROLLBACK_TEST');
    })
    .catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== 'ROLLBACK_TEST')
        throw error;
    });
});
