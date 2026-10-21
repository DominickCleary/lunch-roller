import './env';
import { afterAll, expect, it } from 'vitest';
import { eq, inArray, or } from 'drizzle-orm';
import { createDatabase } from './index';
import { GameError, GameService } from './operations';
import {
  attendance,
  draws,
  notificationOutbox,
  participants,
  places,
  pushSubscriptions,
  tokenLedger,
} from './schema';

const database = createDatabase();
const service = new GameService(database);
const suffix = crypto.randomUUID();
const participantIds: string[] = [];
const placeIds: string[] = [];
const subscriptionIds: string[] = [];
const drawIds: string[] = [];
let drawSequence = 0;

async function createParticipant(label: string) {
  const person = await service.saveParticipant({
    name: `remove-${label}-${suffix}`,
  });
  participantIds.push(person.id);
  return person;
}

async function createPlace(label: string, addedBy?: string) {
  const [place] = await database.db
    .insert(places)
    .values({ name: `remove-place-${label}-${suffix}`, addedBy })
    .returning();
  placeIds.push(place!.id);
  return place!;
}

async function createDraw(placeId: string) {
  drawSequence += 1;
  const day = String(drawSequence).padStart(2, '0');
  const [draw] = await database.db
    .insert(draws)
    .values({
      localDate: `2099-02-${day}`,
      timezone: 'UTC',
      placeId,
      placeName: `Removal history ${day}`,
      snapshot: [
        {
          placeId,
          name: `Removal history ${day}`,
          logWeight: 0,
          probability: 1,
        },
      ],
      sample: 0.5,
      drawnAt: new Date(`2099-02-${day}T11:00:00.000Z`),
    })
    .returning();
  drawIds.push(draw!.id);
  return draw!;
}

async function addLedger(participantId: string, attendanceId?: string) {
  await database.db.insert(tokenLedger).values({
    participantId,
    delta: 10,
    kind: attendanceId ? 'attendance' : 'correction',
    idempotencyKey: `remove-${crypto.randomUUID()}`,
    requestHash: 'integration-fixture',
    attendanceId,
    reason: attendanceId ? null : 'fixture',
  });
}

async function cleanup() {
  if (drawIds.length && subscriptionIds.length)
    await database.db
      .delete(notificationOutbox)
      .where(
        or(
          inArray(notificationOutbox.drawId, drawIds),
          inArray(notificationOutbox.subscriptionId, subscriptionIds),
        ),
      );
  else if (drawIds.length)
    await database.db
      .delete(notificationOutbox)
      .where(inArray(notificationOutbox.drawId, drawIds));
  else if (subscriptionIds.length)
    await database.db
      .delete(notificationOutbox)
      .where(inArray(notificationOutbox.subscriptionId, subscriptionIds));
  if (participantIds.length) {
    await database.db
      .delete(tokenLedger)
      .where(inArray(tokenLedger.participantId, participantIds));
    await database.db
      .delete(attendance)
      .where(inArray(attendance.participantId, participantIds));
  }
  if (drawIds.length)
    await database.db.delete(draws).where(inArray(draws.id, drawIds));
  if (subscriptionIds.length)
    await database.db
      .delete(pushSubscriptions)
      .where(inArray(pushSubscriptions.id, subscriptionIds));
  if (placeIds.length)
    await database.db.delete(places).where(inArray(places.id, placeIds));
  if (participantIds.length)
    await database.db
      .delete(participants)
      .where(inArray(participants.id, participantIds));
}

afterAll(async () => {
  await cleanup();
  await database.close();
});

it('physically deletes an unused participant and reports an unknown ID', async () => {
  const unused = await createParticipant('unused');
  expect(await service.removeParticipant(unused.id)).toEqual({
    participantId: unused.id,
    action: 'deleted',
  });
  await expect(service.selectParticipant(unused.id)).rejects.toMatchObject({
    status: 404,
    code: 'PARTICIPANT_NOT_FOUND',
  });

  const unknownId = crypto.randomUUID();
  await expect(service.removeParticipant(unknownId)).rejects.toMatchObject({
    status: 404,
    code: 'PARTICIPANT_NOT_FOUND',
  });
});

it('archives for every history reference, including inactive subscriptions', async () => {
  const place = await createPlace('references');
  const draw = await createDraw(place.id);
  const attendancePerson = await createParticipant('attendance');
  const ledgerPerson = await createParticipant('ledger');
  const placePerson = await createParticipant('place');
  const subscriptionPerson = await createParticipant('subscription');

  const [checkin] = await database.db
    .insert(attendance)
    .values({ participantId: attendancePerson.id, drawId: draw.id })
    .returning();
  expect(checkin).toBeDefined();
  await addLedger(ledgerPerson.id);
  await createPlace('added-by', placePerson.id);
  const subscription = await service.subscribe(subscriptionPerson.id, {
    endpoint: `https://fcm.googleapis.com/fcm/send/remove-${suffix}`,
    keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) },
  });
  subscriptionIds.push(subscription.id);
  await service.unsubscribe(subscriptionPerson.id, subscription.id);

  for (const person of [
    attendancePerson,
    ledgerPerson,
    placePerson,
    subscriptionPerson,
  ]) {
    expect(await service.removeParticipant(person.id)).toEqual({
      participantId: person.id,
      action: 'archived',
    });
    await expect(service.selectParticipant(person.id)).rejects.toMatchObject({
      status: 403,
      code: 'PARTICIPANT_INACTIVE',
    });
  }
});

it('preserves history and retires subscriptions and pending notification leases', async () => {
  const person = await createParticipant('outbox');
  const place = await createPlace('outbox');
  const draw = await createDraw(place.id);
  const subscription = await service.subscribe(person.id, {
    endpoint: `https://fcm.googleapis.com/fcm/send/remove-outbox-${suffix}`,
    keys: { p256dh: 'C'.repeat(87), auth: 'D'.repeat(22) },
  });
  subscriptionIds.push(subscription.id);
  const [checkin] = await database.db
    .insert(attendance)
    .values({ participantId: person.id, drawId: draw.id })
    .returning();
  await addLedger(person.id, checkin!.id);
  const [job] = await database.db
    .insert(notificationOutbox)
    .values({
      eventKey: `fixture:${draw.id}`,
      drawId: draw.id,
      subscriptionId: subscription.id,
      payload: { title: 'fixture', body: 'fixture', drawId: draw.id },
      lockedUntil: new Date('2099-02-28T12:00:00.000Z'),
      leaseToken: crypto.randomUUID(),
    })
    .returning();

  const beforeLedger = await database.db
    .select()
    .from(tokenLedger)
    .where(eq(tokenLedger.participantId, person.id));
  const beforeAttendance = await database.db
    .select()
    .from(attendance)
    .where(eq(attendance.participantId, person.id));
  const beforeDraw = await database.db
    .select()
    .from(draws)
    .where(eq(draws.id, draw.id));

  expect(await service.removeParticipant(person.id)).toEqual({
    participantId: person.id,
    action: 'archived',
  });
  expect(await service.removeParticipant(person.id)).toEqual({
    participantId: person.id,
    action: 'archived',
  });

  const [retiredSubscription] = await database.db
    .select({ active: pushSubscriptions.active })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.id, subscription.id));
  const [retiredJob] = await database.db
    .select()
    .from(notificationOutbox)
    .where(eq(notificationOutbox.id, job!.id));
  expect(retiredSubscription?.active).toBe(false);
  expect(retiredJob).toMatchObject({
    sentAt: expect.any(Date),
    lockedUntil: null,
    leaseToken: null,
    lastError: 'participant-inactive',
  });
  expect(
    await database.db
      .select()
      .from(tokenLedger)
      .where(eq(tokenLedger.participantId, person.id)),
  ).toEqual(beforeLedger);
  expect(
    await database.db
      .select()
      .from(attendance)
      .where(eq(attendance.participantId, person.id)),
  ).toEqual(beforeAttendance);
  expect(
    await database.db.select().from(draws).where(eq(draws.id, draw.id)),
  ).toEqual(beforeDraw);
});

it('serializes removal against an attendance reward without breaking references', async () => {
  const person = await createParticipant('race');
  const place = await createPlace('race');
  const draw = await createDraw(place.id);
  const instant = new Date(`${draw.localDate}T12:00:00.000Z`);

  const [removal, reward] = await Promise.allSettled([
    service.removeParticipant(person.id),
    service.attend(
      person.id,
      { drawId: draw.id },
      crypto.randomUUID(),
      instant,
    ),
  ]);
  expect(removal.status).toBe('fulfilled');
  if (removal.status !== 'fulfilled') throw removal.reason;
  if (removal.value.action === 'deleted') {
    expect(reward.status).toBe('rejected');
    if (reward.status !== 'rejected')
      throw new Error('Expected reward rejection');
    expect(reward.reason).toBeInstanceOf(GameError);
    expect((reward.reason as GameError).status).toBe(404);
  } else {
    expect(reward.status).toBe('fulfilled');
    expect(
      await database.db
        .select({ id: attendance.id })
        .from(attendance)
        .where(eq(attendance.participantId, person.id)),
    ).toHaveLength(1);
  }
});
