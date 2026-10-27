import { createECDH, randomBytes, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { createDatabase, GameService } from '../../packages/db/src/index'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!testDatabaseUrl) {
  throw new Error(
    'Set TEST_DATABASE_URL to a disposable migrated and seeded database before running E2E tests.',
  )
}

const appOrigin = new URL(process.env.APP_ORIGIN ?? 'http://localhost:3000')
  .origin
const fixturePrefix = `LR-PUSH-${randomUUID().slice(0, 8)}`
const database = createDatabase(testDatabaseUrl)
const game = new GameService(database)
let subscriptionParticipantId = ''
let browserParticipantId = ''
let browserParticipantName = ''
let originalSchedule: Awaited<ReturnType<GameService['getSchedule']>>

function generatedPublicKey() {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  return ecdh.getPublicKey().toString('base64url')
}

const keys = {
  p256dh: generatedPublicKey(),
  auth: randomBytes(16).toString('base64url'),
}

test.beforeAll(async () => {
  originalSchedule = await game.getSchedule()
  await game.setSchedule({
    timezone: 'UTC',
    time: '23:59',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  })
  const subscriber = await game.saveParticipant({
    name: `${fixturePrefix} Subscriber`,
  })
  const browserMember = await game.saveParticipant({
    name: `${fixturePrefix} Browser Member`,
  })
  subscriptionParticipantId = subscriber.id
  browserParticipantId = browserMember.id
  browserParticipantName = browserMember.name

  await game.correctTokens(
    {
      participantId: subscriptionParticipantId,
      delta: 70,
      reason: `${fixturePrefix} API balance`,
    },
    randomUUID(),
  )
  await game.correctTokens(
    {
      participantId: browserParticipantId,
      delta: 50,
      reason: `${fixturePrefix} browser balance`,
    },
    randomUUID(),
  )
})

test.afterAll(async () => {
  try {
    const participants = await game.listParticipants(true)
    for (const participant of participants) {
      if (participant.name.startsWith(fixturePrefix)) {
        await game.saveParticipant({ active: false }, participant.id)
      }
    }
    const places = await game.listPlaces(true)
    for (const place of places) {
      if (place.name.startsWith(fixturePrefix)) {
        await game.savePlace({ active: false }, place.id)
      }
    }
    if (originalSchedule) await game.setSchedule(originalSchedule)
  } finally {
    await database.close()
  }
})

test('push subscription writes enforce origins, input shape, ownership, and lifecycle', async ({
  request,
}) => {
  const subscription = {
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
    keys,
  }
  const crossOrigin = await request.post('/api/v1/push-subscriptions', {
    data: subscription,
    headers: {
      Origin: 'https://attacker.example',
      'X-Participant-Id': subscriptionParticipantId,
    },
  })
  expect(crossOrigin.status()).toBe(403)

  const invalidInternalEndpoint = await request.post(
    '/api/v1/push-subscriptions',
    {
      data: {
        ...subscription,
        endpoint: 'https://127.0.0.1/latest/metadata',
      },
      headers: {
        Origin: appOrigin,
        'X-Participant-Id': subscriptionParticipantId,
      },
    },
  )
  expect(invalidInternalEndpoint.status()).toBe(400)

  const created = await request.post('/api/v1/push-subscriptions', {
    data: subscription,
    headers: {
      Origin: appOrigin,
      'X-Participant-Id': subscriptionParticipantId,
    },
  })
  expect(created.status()).toBe(201)
  const { id } = (await created.json()) as { id: string }
  expect(id).toMatch(/^[0-9a-f-]{36}$/i)

  const wrongOwner = await request.delete(`/api/v1/push-subscriptions/${id}`, {
    headers: {
      Origin: appOrigin,
      'X-Participant-Id': browserParticipantId,
    },
  })
  expect(wrongOwner.status()).toBe(404)

  const removed = await request.delete(`/api/v1/push-subscriptions/${id}`, {
    headers: {
      Origin: appOrigin,
      'X-Participant-Id': subscriptionParticipantId,
    },
  })
  expect(removed.status()).toBe(204)
  expect(await removed.text()).toBe('')

  const repeatedRemoval = await request.delete(
    `/api/v1/push-subscriptions/${id}`,
    {
      headers: {
        Origin: appOrigin,
        'X-Participant-Id': subscriptionParticipantId,
      },
    },
  )
  expect(repeatedRemoval.status()).toBe(204)
})

test('place creation replays once and rejects a changed request body', async ({
  request,
}) => {
  const key = randomUUID()
  const name = `${fixturePrefix} Idempotent Place`
  const headers = {
    Origin: appOrigin,
    'X-Participant-Id': subscriptionParticipantId,
    'Idempotency-Key': key,
  }
  const before = await game.wallet(subscriptionParticipantId)
  const first = await request.post('/api/v1/places', {
    data: { name },
    headers,
  })
  expect(first.status()).toBe(201)
  const firstBody = await first.json()

  const replay = await request.post('/api/v1/places', {
    data: { name },
    headers,
  })
  expect(replay.status()).toBe(200)
  expect(await replay.json()).toEqual(firstBody)

  const changedBody = await request.post('/api/v1/places', {
    data: { name: `${name} Changed` },
    headers,
  })
  expect(changedBody.status()).toBe(409)

  const after = await game.wallet(subscriptionParticipantId)
  expect(after.balance).toBe(before.balance - 20)
  expect(
    after.ledger.filter(
      (entry) => entry.kind === 'add-place' && entry.delta === -20,
    ),
  ).toHaveLength(1)
})

test('permission is requested only on opt-in and core member actions remain available after denial', async ({
  page,
}) => {
  const publicKey = generatedPublicKey()
  expect(publicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/)
  await page.route('**/api/v1/push-config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ publicKey }),
    })
  })
  await page.addInitScript(() => {
    const target = window as unknown as { permissionPromptCalls: number }
    target.permissionPromptCalls = 0
    Object.defineProperty(Notification, 'requestPermission', {
      configurable: true,
      value: async () => {
        target.permissionPromptCalls++
        return 'denied'
      },
    })
  })

  await page.goto(appOrigin)
  await page.getByLabel('Your name').selectOption({
    label: browserParticipantName,
  })
  await page.getByRole('button', { name: 'Enter lunch wheel' }).click()
  await expect(page.locator('.member-status')).toContainText(
    browserParticipantName,
  )
  await expect(
    page.getByRole('button', { name: 'Get lunch and token alerts' }),
  ).toBeEnabled()
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { permissionPromptCalls: number })
          .permissionPromptCalls,
    ),
  ).toBe(0)

  await page.getByRole('button', { name: 'Get lunch and token alerts' }).click()
  await expect(
    page.getByText(
      'Notifications were not enabled. You can still play without them.',
    ),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { permissionPromptCalls: number })
          .permissionPromptCalls,
    ),
  ).toBe(1)

  await page
    .getByRole('button', { name: /^Boost / })
    .first()
    .click()
  await expect(page.getByText('Boost staged for the next draw.')).toBeVisible()
  await page
    .getByLabel('Have a new spot in mind?')
    .fill(`${fixturePrefix} Browser Place`)
  await page.getByRole('button', { name: 'Add place' }).click()
  await expect(
    page.getByText('Restaurant added or restored for 20 tokens.'),
  ).toBeVisible()

  const wallet = await game.wallet(browserParticipantId)
  expect(wallet.balance).toBe(25)
})
