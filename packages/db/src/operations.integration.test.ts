import './env';
import { afterAll, afterEach, expect, it } from 'vitest';
import { createDatabase } from './index';
import { GameError, GameService } from './operations';
import {
  attendance,
  draws,
  notificationOutbox,
  participants,
  places,
  pushSubscriptions,
  settings,
  tokenLedger,
  influenceLots,
} from './schema';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

// Uses only unique records in the disposable integration database.
const database = createDatabase();
const service = new GameService(database);
const influenceAt = new Date('2199-10-20T08:00:00.000Z');
const originalSchedule = await service.getSchedule();
const suffix = crypto.randomUUID();
const person = await service.saveParticipant({ name: `ops-person-${suffix}` });
const other = await service.saveParticipant({ name: `ops-other-${suffix}` });
const place = await service.savePlace({ name: `ops-place-${suffix}` });
const originalWeights = new Map(
  (await service.listPlaces()).map((entry) => [entry.id, entry.logWeight]),
);
const testPlaceIds = [place.id];
const testParticipantIds = [person.id, other.id];
const testDrawIds = new Set<string>();
function rememberDraw<T extends { id: string } | null>(draw: T): T {
  if (draw) testDrawIds.add(draw.id);
  return draw;
}

afterEach(async () => {
  const drawIds = [...testDrawIds];
  if (drawIds.length)
    await database.db
      .update(notificationOutbox)
      .set({
        sentAt: new Date(),
        lockedUntil: null,
        leaseToken: null,
        lastError: 'integration-test-cleanup',
      })
      .where(
        and(
          inArray(notificationOutbox.drawId, drawIds),
          isNull(notificationOutbox.sentAt),
        ),
      );
});

afterAll(async () => {
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
  const drawIds = [...testDrawIds];
  if (drawIds.length)
    await database.db
      .delete(notificationOutbox)
      .where(inArray(notificationOutbox.drawId, drawIds));
  await database.db
    .delete(influenceLots)
    .where(inArray(influenceLots.participantId, testParticipantIds));
  await database.db
    .delete(tokenLedger)
    .where(inArray(tokenLedger.participantId, testParticipantIds));
  await database.db
    .delete(attendance)
    .where(inArray(attendance.participantId, testParticipantIds));
  if (drawIds.length)
    await database.db.delete(draws).where(inArray(draws.id, drawIds));
  await database.db
    .delete(pushSubscriptions)
    .where(inArray(pushSubscriptions.participantId, testParticipantIds));
  await database.db.delete(places).where(inArray(places.id, testPlaceIds));
  await database.db
    .delete(participants)
    .where(inArray(participants.id, testParticipantIds));
  await database.close();
});

it('serializes a due draw, snapshots odds, decays once, and makes outbox rows atomically', async () => {
  await service.subscribe(person.id, {
    endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}`,
    keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) },
  });
  await service.setSchedule({
    timezone: 'UTC',
    time: '11:30',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  const now = new Date('2099-03-02T12:00:00.000Z');
  const before = (await service.listPlaces()).find(
    (entry) => entry.id === place.id,
  )!;
  const results = await Promise.all(
    Array.from({ length: 8 }, async () =>
      rememberDraw(await service.drawIfDue(now)),
    ),
  );
  expect(results.every((result) => result?.id === results[0]?.id)).toBe(true);
  const draw = results[0]!;
  expect(draw.snapshot.some((entry) => entry.placeId === place.id)).toBe(true);
  expect(
    draw.snapshot.reduce((sum, entry) => sum + entry.probability, 0),
  ).toBeCloseTo(1);
  const winnerBefore = draw.snapshot.find(
    (entry) => entry.placeId === draw.placeId,
  )!.logWeight;
  expect(
    (await service.listPlaces()).find((entry) => entry.id === draw.placeId)!
      .logWeight,
  ).toBeCloseTo(winnerBefore - Math.LN2);
  expect(
    await database.db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.drawId, draw.id)),
  ).toHaveLength(1);
  const winner = (await service.listPlaces(true)).find(
    (entry) => entry.id === draw.placeId,
  )!;
  await service.savePlace(
    { name: `${winner.name} renamed`, active: false },
    winner.id,
  );
  const unchanged = rememberDraw(await service.drawIfDue(now));
  expect(unchanged).toMatchObject({
    placeId: draw.placeId,
    placeName: winner.name,
    snapshot: draw.snapshot,
  });
  await service.savePlace({ name: winner.name, active: true }, winner.id);
  expect(await service.drawIfDue(new Date('2099-03-03T10:00:00Z'))).toBeNull();
  expect(
    rememberDraw(await service.drawIfDue(new Date('2099-03-03T12:00:00Z'))),
  ).not.toBeNull();
  expect(before.logWeight).toBe(0);
});

it('shows no-options without a draw and retries successfully after an option is added', async () => {
  await service.setSchedule({
    timezone: 'UTC',
    time: '11:30',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  const active = await service.listPlaces();
  for (const option of active)
    await service.savePlace({ active: false }, option.id);
  const now = new Date('2099-03-07T12:00:00Z');
  expect((await service.today(now)).status).toBe('no-options');
  expect(await service.drawIfDue(now)).toBeNull();
  const created = await service.savePlace({ name: `retry-option-${suffix}` });
  testPlaceIds.push(created.id);
  const draw = rememberDraw(await service.drawIfDue(now));
  expect(draw?.snapshot).toHaveLength(1);
  for (const option of active)
    await service.savePlace({ active: true }, option.id);
});

it('rolls back draw, decay, and outbox writes when outbox persistence fails', async () => {
  await service.setSchedule({
    timezone: 'UTC',
    time: '11:30',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  const now = new Date('2099-03-09T12:00:00Z');
  const weightsBefore = new Map(
    (await service.listPlaces()).map((option) => [option.id, option.logWeight]),
  );
  await database.db.execute(sql`
    create or replace function lunch_test_fail_outbox() returns trigger
    language plpgsql as $$ begin raise exception 'test outbox failure'; end $$
  `);
  try {
    await database.db.execute(sql`
      create trigger lunch_test_fail_outbox before insert on notification_outbox
      for each row execute function lunch_test_fail_outbox()
    `);
    await expect(service.drawIfDue(now)).rejects.toThrow();
    expect(
      await database.db
        .select()
        .from(draws)
        .where(eq(draws.localDate, '2099-03-09')),
    ).toHaveLength(0);
    const weightsAfter = new Map(
      (await service.listPlaces()).map((option) => [
        option.id,
        option.logWeight,
      ]),
    );
    expect(weightsAfter).toEqual(weightsBefore);
  } finally {
    await database.db.execute(
      sql`drop trigger if exists lunch_test_fail_outbox on notification_outbox`,
    );
    await database.db.execute(
      sql`drop function if exists lunch_test_fail_outbox()`,
    );
  }
});

it('uses the draw timezone for attendance and preserves exact idempotent responses', async () => {
  await service.setSchedule({
    timezone: 'Europe/Dublin',
    time: '00:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  const now = new Date('2099-03-04T12:00:00.000Z');
  const draw = rememberDraw(await service.drawIfDue(now));
  expect(draw).not.toBeNull();
  await service.setSchedule({
    timezone: 'Pacific/Auckland',
    time: '00:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  const key = crypto.randomUUID();
  const first = await service.attend(
    person.id,
    { drawId: draw!.id },
    key,
    new Date('2099-03-04T23:30:00.000Z'),
  );
  await service.correctTokens(
    { participantId: person.id, delta: 3, reason: 'test adjustment' },
    crypto.randomUUID(),
  );
  expect(
    await service.attend(
      person.id,
      { drawId: draw!.id },
      key,
      new Date('2099-03-04T23:30:00.000Z'),
    ),
  ).toEqual(first);
  expect((await service.wallet(person.id)).balance).toBe(first.balance + 3);
  await expect(
    service.attend(person.id, { drawId: draw!.id }, crypto.randomUUID(), now),
  ).rejects.toMatchObject({ code: 'ALREADY_ATTENDED' });
  await expect(
    service.attend(
      person.id,
      { drawId: draw!.id },
      crypto.randomUUID(),
      new Date('2099-03-05T00:01:00.000Z'),
    ),
  ).rejects.toMatchObject({ code: 'ATTENDANCE_CLOSED' });
});

it('prevents concurrent overdrafts and rolls duplicate-place failures back without charging', async () => {
  await service.setSchedule({
    timezone: 'UTC',
    time: '11:30',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  await service.correctTokens(
    { participantId: other.id, delta: 9, reason: 'fund concurrent test' },
    crypto.randomUUID(),
  );
  const purchases = await Promise.allSettled(
    Array.from({ length: 3 }, () =>
      service.purchase(
        other.id,
        { placeId: place.id, action: 'boost' },
        crypto.randomUUID(),
        influenceAt,
      ),
    ),
  );
  expect(
    purchases.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
  expect((await service.wallet(other.id)).balance).toBe(4);

  const before = await service.wallet(person.id);
  await service.correctTokens(
    { participantId: person.id, delta: 20, reason: 'fund duplicate-name test' },
    crypto.randomUUID(),
  );
  const funded = await service.wallet(person.id);
  await expect(
    service.addPlace(
      person.id,
      { name: place.name.toUpperCase() },
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: 'DUPLICATE_NAME' });
  expect(await service.wallet(person.id)).toEqual(funded);
  expect(before.balance).toBeLessThan(funded.balance);
});

it('charges concurrent replays once and returns the original response', async () => {
  await service.correctTokens(
    { participantId: other.id, delta: 10, reason: 'fund replay test' },
    crypto.randomUUID(),
  );
  const key = crypto.randomUUID();
  const request = { placeId: place.id, action: 'reduce' as const };
  const results = await Promise.all([
    service.purchase(other.id, request, key, influenceAt),
    service.purchase(other.id, request, key, influenceAt),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect((await service.wallet(other.id)).balance).toBe(9);
});

it('replays only the same normalized operation and rejects cross-route key reuse', async () => {
  const key = crypto.randomUUID();
  const first = await service.correctTokens(
    { participantId: person.id, delta: 2, reason: '  same reason  ' },
    key,
  );
  expect(
    await service.correctTokens(
      { participantId: person.id, delta: 2, reason: 'same reason' },
      key,
    ),
  ).toEqual(first);
  await expect(
    service.addPlace(person.id, { name: `different-${suffix}` }, key),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });
  const entries = await database.db
    .select()
    .from(tokenLedger)
    .where(eq(tokenLedger.participantId, person.id));
  expect(entries.filter((entry) => entry.idempotencyKey === key)).toHaveLength(
    1,
  );
});

it('leases notifications once, retries with bounded delay, and ignores stale lease completions', async () => {
  await service.setSchedule({
    timezone: 'UTC',
    time: '00:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  const draw = rememberDraw(
    await service.drawIfDue(new Date('2099-03-06T12:00:00Z')),
  );
  expect(draw).not.toBeNull();
  const start = new Date('2099-03-06T12:00:00Z');
  const [job] = await service.claimNotifications(start, 20);
  expect(job).toBeDefined();
  expect(await service.claimNotifications(start, 20)).toEqual([]);
  await service.finishNotification(job!.id, crypto.randomUUID(), 'sent', start);
  await service.finishNotification(job!.id, job!.leaseToken, 'retry', start);
  const [retried] = await service.claimNotifications(
    new Date(start.getTime() + 16_000),
    20,
  );
  expect(retried?.id).toBe(job!.id);
  expect(retried?.attempts).toBe(2);
  await service.finishNotification(
    retried!.id,
    retried!.leaseToken,
    'gone',
    start,
  );
  expect(
    await service.claimNotifications(new Date(start.getTime() + 100_000), 20),
  ).toEqual([]);
});

it('terminalizes an expired fifth lease instead of stranding it', async () => {
  await service.subscribe(other.id, {
    endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}-fifth`,
    keys: { p256dh: 'C'.repeat(87), auth: 'D'.repeat(22) },
  });
  await service.setSchedule({
    timezone: 'UTC',
    time: '00:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  const start = new Date('2099-03-08T12:00:00Z');
  rememberDraw(await service.drawIfDue(start));
  let fifth:
    Awaited<ReturnType<GameService['claimNotifications']>>[number] | undefined;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const jobs = await service.claimNotifications(
      new Date(start.getTime() + attempt * 61_000),
      20,
    );
    fifth = jobs.find((job) =>
      job.subscription.endpoint.endsWith(`${suffix}-fifth`),
    );
    expect(fifth).toBeDefined();
    expect(fifth!.attempts).toBe(attempt + 1);
  }
  expect(
    await service.claimNotifications(
      new Date(start.getTime() + 5 * 61_000),
      20,
    ),
  ).toEqual([]);
  expect(fifth?.attempts).toBe(5);
});

it('returns safe service errors for inactive identity', async () => {
  const inactive = await service.saveParticipant({
    name: `ops-inactive-${suffix}`,
  });
  testParticipantIds.push(inactive.id);
  await service.saveParticipant({ active: false }, inactive.id);
  await expect(service.selectParticipant(inactive.id)).rejects.toBeInstanceOf(
    GameError,
  );
  await expect(
    service.wallet('00000000-0000-0000-0000-000000000000'),
  ).rejects.toMatchObject({ code: 'PARTICIPANT_NOT_FOUND' });
});
