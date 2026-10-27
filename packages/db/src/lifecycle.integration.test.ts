import './env'
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { createDatabase } from './index'
import { GameService } from './operations'
import {
  attendance,
  draws,
  influenceLots,
  notificationOutbox,
  participants,
  places,
  pushSubscriptions,
  settings,
  tokenLedger,
} from './schema'

const database = createDatabase()
const service = new GameService(database)
const influenceAt = new Date('2199-10-20T08:00:00.000Z')
const originalSchedule = await service.getSchedule()
const originalPlaces = await service.listPlaces(true)
const participant = await service.saveParticipant({
  name: `lifecycle-person-${crypto.randomUUID()}`,
})
const secondParticipant = await service.saveParticipant({
  name: `lifecycle-second-${crypto.randomUUID()}`,
})
const suffix = crypto.randomUUID()
const testParticipantIds = [participant.id, secondParticipant.id]
const testPlaceIds: string[] = []
const testDrawIds = new Set<string>()

function rememberDraw<T extends { id: string } | null>(draw: T): T {
  if (draw) testDrawIds.add(draw.id)
  return draw
}

function serviceEndpoint(label: string): string {
  return `https://fcm.googleapis.com/fcm/send/lifecycle-${suffix}-${label}`
}

async function createPlace(name: string) {
  const place = await service.savePlace({ name })
  testPlaceIds.push(place.id)
  return place
}

async function setDailyUtcSchedule(time = '00:00') {
  await service.setSchedule({
    timezone: 'UTC',
    time,
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  })
}

afterEach(async () => {
  const ids = [...testDrawIds]
  if (ids.length)
    await database.db
      .update(notificationOutbox)
      .set({
        sentAt: new Date(),
        lockedUntil: null,
        leaseToken: null,
        lastError: 'lifecycle-test-cleanup',
      })
      .where(
        and(
          inArray(notificationOutbox.drawId, ids),
          isNull(notificationOutbox.sentAt),
        ),
      )
})

afterAll(async () => {
  await database.db
    .update(settings)
    .set({
      timezone: originalSchedule.timezone,
      spinTime: originalSchedule.time,
      weekdays: originalSchedule.weekdays,
    })
    .where(eq(settings.id, 1))
  for (const original of originalPlaces)
    await database.db
      .update(places)
      .set({
        name: original.name,
        active: original.active,
        logWeight: original.logWeight,
      })
      .where(eq(places.id, original.id))

  const ids = [...testDrawIds]
  if (ids.length)
    await database.db
      .delete(notificationOutbox)
      .where(inArray(notificationOutbox.drawId, ids))
  await database.db
    .delete(influenceLots)
    .where(inArray(influenceLots.participantId, testParticipantIds))
  await database.db
    .delete(tokenLedger)
    .where(inArray(tokenLedger.participantId, testParticipantIds))
  await database.db
    .delete(attendance)
    .where(inArray(attendance.participantId, testParticipantIds))
  if (ids.length) await database.db.delete(draws).where(inArray(draws.id, ids))
  await database.db
    .delete(pushSubscriptions)
    .where(inArray(pushSubscriptions.participantId, testParticipantIds))
  if (testPlaceIds.length)
    await database.db.delete(places).where(inArray(places.id, testPlaceIds))
  await database.db
    .delete(participants)
    .where(inArray(participants.id, testParticipantIds))
  await database.close()
})

it('rejects attendance before the committed draw time', async () => {
  await setDailyUtcSchedule()
  const now = new Date('2088-08-09T12:00:00.000Z')
  const draw = rememberDraw(await service.drawIfDue(now))
  expect(draw).not.toBeNull()
  await expect(
    service.attend(
      participant.id,
      { drawId: draw!.id },
      crypto.randomUUID(),
      new Date('2088-08-09T11:59:59.999Z'),
    ),
  ).rejects.toMatchObject({ code: 'ATTENDANCE_CLOSED' })
  expect((await service.wallet(participant.id)).balance).toBe(0)
})

it('rejects changed-body key reuse, blank additions, and overdraft corrections without writes', async () => {
  await setDailyUtcSchedule('11:30')
  const target = (await service.listPlaces())[0]!
  const fundKey = crypto.randomUUID()
  await service.correctTokens(
    { participantId: participant.id, delta: 10, reason: 'lifecycle funding' },
    fundKey,
  )
  const key = crypto.randomUUID()
  await service.purchase(
    participant.id,
    { placeId: target.id, action: 'boost' },
    key,
    influenceAt,
  )
  const afterPurchase = await service.wallet(participant.id)
  await expect(
    service.purchase(
      participant.id,
      { placeId: target.id, action: 'reduce' },
      key,
      influenceAt,
    ),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' })
  await expect(
    service.addPlace(participant.id, { name: '   ' }, crypto.randomUUID()),
  ).rejects.toMatchObject({ code: 'INVALID_NAME' })
  await expect(
    service.correctTokens(
      { participantId: participant.id, delta: -100, reason: 'too much debit' },
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: 'INSUFFICIENT_TOKENS' })
  expect(await service.wallet(participant.id)).toEqual(afterPurchase)
})

it('keeps an archived name inactive when a conflicting active name blocks restoration', async () => {
  const archived = await createPlace(`archived-${suffix}`)
  await service.savePlace({ active: false }, archived.id)
  const conflict = await createPlace(`  ARCHIVED-${suffix.toUpperCase()}  `)
  await expect(
    service.savePlace({ active: true }, archived.id),
  ).rejects.toMatchObject({ code: 'DUPLICATE_NAME' })
  const all = await service.listPlaces(true)
  expect(all.find((entry) => entry.id === archived.id)).toMatchObject({
    name: `archived-${suffix}`,
    active: false,
  })
  expect(all.find((entry) => entry.id === conflict.id)?.active).toBe(true)
})

it('keeps the date result after schedule edits and only catches up today', async () => {
  await setDailyUtcSchedule('11:30')
  const now = new Date('2088-08-10T12:00:00.000Z')
  const first = rememberDraw(await service.drawIfDue(now))
  expect(first).not.toBeNull()

  const weekday = now.getUTCDay() === 0 ? 7 : now.getUTCDay()
  const otherWeekday = weekday === 7 ? 6 : weekday + 1
  await service.setSchedule({
    timezone: 'Europe/Dublin',
    time: '23:00',
    weekdays: [otherWeekday],
  })
  expect((await service.today(now)).result).toEqual(first)
  expect(await service.drawIfDue(now)).toBeNull()
  await setDailyUtcSchedule('11:30')

  const overdue = new Date('2088-08-13T12:00:00.000Z')
  const todayDraw = rememberDraw(await service.drawIfDue(overdue))
  expect(todayDraw).not.toBeNull()
  const dateRows = await database.db
    .select({ localDate: draws.localDate })
    .from(draws)
    .where(
      and(
        gte(draws.localDate, '2088-08-11'),
        lte(draws.localDate, '2088-08-13'),
      ),
    )
  expect(dateRows.map((row) => row.localDate)).toEqual(['2088-08-13'])
})

it('checks subscription ownership and participant archiving cancels pending jobs', async () => {
  const subscription = await service.subscribe(participant.id, {
    endpoint: serviceEndpoint('owner'),
    keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) },
  })
  await expect(
    service.unsubscribe(secondParticipant.id, subscription.id),
  ).rejects.toMatchObject({ code: 'SUBSCRIPTION_NOT_FOUND' })
  const remainsActive = await database.db
    .select({ active: pushSubscriptions.active })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.id, subscription.id))
  expect(remainsActive[0]?.active).toBe(true)

  await setDailyUtcSchedule()
  const draw = rememberDraw(
    await service.drawIfDue(new Date('2088-08-14T12:00:00.000Z')),
  )
  expect(draw).not.toBeNull()
  await service.saveParticipant({ active: false }, participant.id)
  await expect(service.wallet(participant.id)).rejects.toMatchObject({
    code: 'PARTICIPANT_INACTIVE',
  })
  const canceled = await database.db
    .select({
      sentAt: notificationOutbox.sentAt,
      lastError: notificationOutbox.lastError,
    })
    .from(notificationOutbox)
    .where(
      and(
        eq(notificationOutbox.drawId, draw!.id),
        eq(notificationOutbox.subscriptionId, subscription.id),
      ),
    )
  expect(canceled[0]).toMatchObject({ lastError: 'participant-inactive' })
  expect(canceled[0]?.sentAt).toBeInstanceOf(Date)
})

it('ignores stale lease completion after a job is reclaimed', async () => {
  await service.subscribe(secondParticipant.id, {
    endpoint: serviceEndpoint('stale-lease'),
    keys: { p256dh: 'C'.repeat(87), auth: 'D'.repeat(22) },
  })
  await setDailyUtcSchedule()
  const start = new Date('2088-08-15T12:00:00.000Z')
  const draw = rememberDraw(await service.drawIfDue(start))
  expect(draw).not.toBeNull()

  const firstBatch = await service.claimNotifications(start, 20)
  const first = firstBatch.find(
    (job) => job.subscription.endpoint === serviceEndpoint('stale-lease'),
  )
  expect(first).toBeDefined()
  const secondBatch = await service.claimNotifications(
    new Date(start.getTime() + 61_000),
    20,
  )
  const second = secondBatch.find((job) => job.id === first!.id)
  expect(second).toBeDefined()
  expect(second?.leaseToken).not.toBe(first?.leaseToken)

  await service.finishNotification(
    first!.id,
    first!.leaseToken,
    'sent',
    new Date(start.getTime() + 62_000),
  )
  await service.finishNotification(
    second!.id,
    second!.leaseToken,
    'retry',
    new Date(start.getTime() + 63_000),
  )
  const thirdBatch = await service.claimNotifications(
    new Date(start.getTime() + 94_000),
    20,
  )
  expect(
    thirdBatch.find(
      (job) => job.subscription.endpoint === serviceEndpoint('stale-lease'),
    ),
  ).toMatchObject({ id: first!.id, attempts: 3 })
})

it('evaluates live draw and attendance dates after waiting across local midnight', async () => {
  await setDailyUtcSchedule()
  const before = new Date('2088-08-16T23:59:59.000Z')
  const after = new Date('2088-08-17T00:00:01.000Z')
  const priorDraw = rememberDraw(await service.drawIfDue(before))
  expect(priorDraw).not.toBeNull()

  let release!: () => void
  let acquired!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const ready = new Promise<void>((resolve) => {
    acquired = resolve
  })
  const lock = database.db.transaction(async (tx) => {
    await tx.select().from(settings).where(eq(settings.id, 1)).for('update')
    acquired()
    await released
  })
  await ready
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    vi.setSystemTime(before)
    const pendingDraw = service.drawIfDue()
    const pendingAttendance = service.attend(
      secondParticipant.id,
      { drawId: priorDraw!.id },
      crypto.randomUUID(),
    )
    const attendanceOutcome = pendingAttendance.then(
      () => 'awarded',
      (error: unknown) => (error as { code: string }).code,
    )
    vi.setSystemTime(after)
    release()
    await lock
    const nextDraw = rememberDraw(await pendingDraw)
    expect(nextDraw?.localDate).toBe('2088-08-17')
    expect(await attendanceOutcome).toBe('ATTENDANCE_CLOSED')
  } finally {
    release()
    await lock
    vi.useRealTimers()
  }
})
