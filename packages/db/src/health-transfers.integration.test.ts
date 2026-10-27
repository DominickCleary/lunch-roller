import './env'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, expect, it } from 'vitest'
import { createDatabase } from './index'
import { GameService, isReplay } from './operations'
import {
  attendance,
  bettingMarkets,
  draws,
  notificationOutbox,
  participants,
  places,
  pushSubscriptions,
  settings,
  tokenLedger,
} from './schema'

const database = createDatabase()
const game = new GameService(database)
const suffix = crypto.randomUUID()
const originalPlaces = await database.db.select().from(places)
const [originalSettings] = await database.db.select().from(settings)
const sender = await game.saveParticipant({ name: `sender-${suffix}` })
const recipient = await game.saveParticipant({ name: `recipient-${suffix}` })
const inactive = await game.saveParticipant({ name: `inactive-${suffix}` })
await game.saveParticipant({ active: false }, inactive.id)
const people = [sender.id, recipient.id, inactive.id]
const createdPlaces: string[] = []
const drawIds: string[] = []
const subscriptionIds: string[] = []

async function fund(amount: number) {
  for (const [participantId, target] of [
    [sender.id, amount],
    [recipient.id, 0],
  ] as const) {
    if ((await game.wallet(participantId)).balance !== target)
      await game.setTokenBalance(
        {
          participantId,
          balance: target,
          reason: 'Disposable transfer fixture',
        },
        crypto.randomUUID(),
      )
  }
}

afterAll(async () => {
  if (subscriptionIds.length) {
    await database.db
      .delete(notificationOutbox)
      .where(inArray(notificationOutbox.subscriptionId, subscriptionIds))
    await database.db
      .delete(pushSubscriptions)
      .where(inArray(pushSubscriptions.id, subscriptionIds))
  }
  await database.db
    .delete(tokenLedger)
    .where(inArray(tokenLedger.participantId, people))
  if (drawIds.length) {
    await database.db
      .delete(notificationOutbox)
      .where(inArray(notificationOutbox.drawId, drawIds))
    await database.db
      .delete(attendance)
      .where(inArray(attendance.drawId, drawIds))
    await database.db
      .delete(bettingMarkets)
      .where(inArray(bettingMarkets.drawId, drawIds))
    await database.db.delete(draws).where(inArray(draws.id, drawIds))
  }
  if (createdPlaces.length)
    await database.db.delete(places).where(inArray(places.id, createdPlaces))
  await database.db.delete(participants).where(inArray(participants.id, people))
  for (const place of originalPlaces)
    await database.db
      .update(places)
      .set({
        active: place.active,
        logWeight: place.logWeight,
        healthLevel: place.healthLevel,
      })
      .where(eq(places.id, place.id))
  await database.db
    .update(settings)
    .set(originalSettings!)
    .where(eq(settings.id, 1))
  await database.close()
})

it('atomically transfers tokens once, preserving totals and both wallet histories', async () => {
  await fund(100)
  const senderSubscription = await game.subscribe(sender.id, {
    endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}-sender`,
    keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) },
  })
  const recipientSubscription = await game.subscribe(recipient.id, {
    endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}-recipient`,
    keys: { p256dh: 'C'.repeat(87), auth: 'D'.repeat(22) },
  })
  subscriptionIds.push(senderSubscription.id, recipientSubscription.id)
  const key = crypto.randomUUID()
  const body = { recipientId: recipient.id, amount: 30 }
  const results = await Promise.all(
    Array.from({ length: 6 }, () => game.transferTokens(sender.id, body, key)),
  )
  expect(
    results.every((result) => result.transferId === results[0]!.transferId),
  ).toBe(true)
  expect(results.filter(isReplay)).toHaveLength(5)
  const sent = await game.wallet(sender.id)
  const received = await game.wallet(recipient.id)
  expect([sent.balance, received.balance]).toEqual([70, 30])
  const debit = sent.ledger.filter(
    (entry) => entry.transferId === results[0]!.transferId,
  )
  const credit = received.ledger.filter(
    (entry) => entry.transferId === results[0]!.transferId,
  )
  expect(debit).toHaveLength(1)
  expect(credit).toHaveLength(1)
  expect(debit[0]).toMatchObject({
    kind: 'transfer-sent',
    delta: -30,
    counterpartyId: recipient.id,
    reason: `Sent to ${recipient.name}`,
  })
  expect(credit[0]).toMatchObject({
    kind: 'transfer-received',
    delta: 30,
    counterpartyId: sender.id,
    reason: `Received from ${sender.name}`,
  })
  const transferNotifications = await database.db
    .select()
    .from(notificationOutbox)
    .where(
      eq(notificationOutbox.eventKey, `transfer:${results[0]!.transferId}`),
    )
  expect(transferNotifications).toHaveLength(1)
  expect(transferNotifications[0]).toMatchObject({
    subscriptionId: recipientSubscription.id,
    drawId: null,
    payload: {
      title: 'Tokens received',
      body: `${sender.name} sent you 30 tokens.`,
      tag: `lunch-transfer-${results[0]!.transferId}`,
    },
  })
  expect(transferNotifications[0]?.subscriptionId).not.toBe(
    senderSubscription.id,
  )
  await expect(
    game.transferTokens(sender.id, { ...body, amount: 31 }, key),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' })
  await game.saveParticipant({ active: false }, recipient.id)
  expect((await game.transferTokens(sender.id, body, key)).transferId).toBe(
    results[0]!.transferId,
  )
  await game.saveParticipant({ active: true }, recipient.id)
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: originalSettings!.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const activity = await game.dailyActivity(sender.id, date)
  expect(
    activity.entries.filter(
      (entry) => entry.transferId === results[0]!.transferId,
    ),
  ).toHaveLength(2)
})

it('serializes competing transfers and spending without creating tokens or overdrafts', async () => {
  await fund(10)
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, () =>
      game.transferTokens(
        sender.id,
        { recipientId: recipient.id, amount: 7 },
        crypto.randomUUID(),
      ),
    ),
  )
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1)
  expect([
    (await game.wallet(sender.id)).balance,
    (await game.wallet(recipient.id)).balance,
  ]).toEqual([3, 7])
  await expect(
    game.addPlace(
      sender.id,
      { name: `cannot-afford-${suffix}` },
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: 'INSUFFICIENT_TOKENS' })
})

it('shares the spending lock with place purchases', async () => {
  const { addPlaceCost } = await game.getEconomy()
  await fund(addPlaceCost)
  const results = await Promise.allSettled([
    game.transferTokens(
      sender.id,
      { recipientId: recipient.id, amount: addPlaceCost },
      crypto.randomUUID(),
    ),
    game.addPlace(
      sender.id,
      { name: `race-place-${suffix}`, healthLevel: 'healthy' },
      crypto.randomUUID(),
    ),
  ])
  if (results[1]!.status === 'fulfilled')
    createdPlaces.push(
      (results[1]!.value as { place: { id: string } }).place.id,
    )
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1)
  expect((await game.wallet(sender.id)).balance).toBe(0)
  expect((await game.wallet(recipient.id)).balance).toBe(
    results[0]!.status === 'fulfilled' ? addPlaceCost : 0,
  )
})

it('rejects self transfers, invalid amounts, inactive and missing recipients without moving tokens', async () => {
  await fund(10)
  for (const amount of [0, -1, 0.5, 2147483648])
    await expect(
      game.transferTokens(
        sender.id,
        { recipientId: recipient.id, amount },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSFER' })
  await expect(
    game.transferTokens(
      sender.id,
      { recipientId: sender.id, amount: 1 },
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: 'SELF_TRANSFER' })
  await expect(
    game.transferTokens(
      sender.id,
      { recipientId: inactive.id, amount: 1 },
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: 'PARTICIPANT_INACTIVE' })
  await expect(
    game.transferTokens(
      sender.id,
      { recipientId: crypto.randomUUID(), amount: 1 },
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: 'PARTICIPANT_NOT_FOUND' })
  await expect(
    game.transferTokens(
      inactive.id,
      { recipientId: recipient.id, amount: 1 },
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: 'PARTICIPANT_INACTIVE' })
  expect([
    (await game.wallet(sender.id)).balance,
    (await game.wallet(recipient.id)).balance,
  ]).toEqual([10, 0])
})

it('does not enqueue a token notification for a check-in reward', async () => {
  const subscription = await game.subscribe(recipient.id, {
    endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}-checkin`,
    keys: { p256dh: 'G'.repeat(87), auth: 'H'.repeat(22) },
  })
  subscriptionIds.push(subscription.id)
  const place = await game.savePlace({ name: `checkin-${suffix}` })
  createdPlaces.push(place.id)
  const now = new Date('2299-02-03T12:00:00.000Z')
  await game.setSchedule({
    timezone: 'UTC',
    time: '11:30',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  })
  const draw = (await game.drawIfDue(now))!
  drawIds.push(draw.id)
  const before = await database.db
    .select({ id: notificationOutbox.id })
    .from(notificationOutbox)
    .where(eq(notificationOutbox.subscriptionId, subscription.id))
  await game.attend(
    recipient.id,
    { drawId: draw.id },
    crypto.randomUUID(),
    new Date(now.getTime() + 60_000),
  )
  const after = await database.db
    .select({ id: notificationOutbox.id })
    .from(notificationOutbox)
    .where(eq(notificationOutbox.subscriptionId, subscription.id))
  expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id))
})

it('snapshots health ratings and applies the permanent health bonus once, after draw selection', async () => {
  await database.db.update(places).set({ active: false })
  const treat = await game.savePlace({
    name: `treat-${suffix}`,
    healthLevel: 'treat',
  })
  const healthy = await game.savePlace({
    name: `healthy-${suffix}`,
    healthLevel: 'healthy',
  })
  const balanced = await game.savePlace({ name: `balanced-${suffix}` })
  createdPlaces.push(treat.id, healthy.id, balanced.id)
  expect(balanced.healthLevel).toBe('balanced')
  await database.db
    .update(places)
    .set({ logWeight: -1000 })
    .where(inArray(places.id, [healthy.id, balanced.id]))
  await database.db
    .update(places)
    .set({ logWeight: 0 })
    .where(eq(places.id, treat.id))
  await game.setSchedule({
    timezone: 'UTC',
    time: '11:30',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  })
  await game.setHealthRule({ enabled: true, multiplier: 1.25 })
  const now = new Date('2299-01-02T12:00:00Z')
  const results = await Promise.all(
    Array.from({ length: 5 }, () => game.drawIfDue(now)),
  )
  const draw = results[0]!
  drawIds.push(draw.id)
  expect(results.every((result) => result!.id === draw.id)).toBe(true)
  expect(draw.placeId).toBe(treat.id)
  expect(
    draw.snapshot.find((entry) => entry.placeId === healthy.id),
  ).toMatchObject({ healthLevel: 'healthy', logWeight: -1000 })
  expect(draw.healthBonus).toMatchObject({
    multiplier: 1.25,
    places: [{ placeId: healthy.id, name: healthy.name }],
  })
  const after = await game.listPlaces()
  expect(after.find((entry) => entry.id === healthy.id)!.logWeight).toBeCloseTo(
    -1000 + Math.log(1.25),
  )
  expect(after.find((entry) => entry.id === treat.id)!.logWeight).toBeCloseTo(
    -Math.LN2,
  )
  expect(after.find((entry) => entry.id === balanced.id)!.logWeight).toBe(-1000)
  await game.savePlace(
    { healthLevel: 'balanced', name: `renamed-${suffix}` },
    healthy.id,
  )
  await game.setHealthRule({ enabled: false, multiplier: 2 })
  expect(await game.drawIfDue(now)).toEqual(draw)
  const activity = await game.dailyActivity(sender.id, '2299-01-02')
  expect(activity.healthBonuses).toMatchObject([
    {
      drawId: draw.id,
      bonus: { multiplier: 1.25, places: [{ name: healthy.name }] },
    },
  ])
  const second = (await game.drawIfDue(new Date('2299-01-03T12:00:00Z')))!
  drawIds.push(second.id)
  expect(second.healthBonus).toBeNull()
  expect(
    (await game.listPlaces()).find((entry) => entry.id === healthy.id)!
      .logWeight,
  ).toBeCloseTo(-1000 + Math.log(1.25))
  await expect(
    game.savePlace({ healthLevel: 'invalid' as 'healthy' }, healthy.id),
  ).rejects.toMatchObject({ code: 'INVALID_HEALTH_LEVEL' })
})
