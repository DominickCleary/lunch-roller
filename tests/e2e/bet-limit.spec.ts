import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { createDatabase, GameService } from '../../packages/db/src/index'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!testDatabaseUrl)
  throw new Error(
    'Set TEST_DATABASE_URL to a disposable migrated and seeded database before running E2E tests.',
  )

const origin = new URL(process.env.APP_ORIGIN ?? 'http://localhost:3000').origin
const adminPassword = process.env.ADMIN_PASSWORD ?? 'integration-only-password'
const suffix = randomUUID().slice(0, 8)
const memberName = `LR-BET-LIMIT-${suffix} Member`
const otherName = `LR-BET-LIMIT-${suffix} Other`
const firstPlaceName = `LR-BET-LIMIT-${suffix} First Place`
const secondPlaceName = `LR-BET-LIMIT-${suffix} Second Place`
const database = createDatabase(testDatabaseUrl)
const game = new GameService(database)
let originalSchedule: Awaited<ReturnType<GameService['getSchedule']>>
let originalPreferences: Awaited<ReturnType<GameService['getPreferences']>>
let originalWeights = new Map<string, number>()
let memberId = ''
let otherId = ''
let firstPlaceId = ''
let secondPlaceId = ''
let marketId = ''
let preexistingMarketIds = new Set<string>()

function mutationHeaders() {
  return { Origin: origin, 'Idempotency-Key': randomUUID() }
}

async function signIn(page: import('@playwright/test').Page) {
  const password = page.getByLabel('Administrator password')
  if (!(await password.isVisible()))
    await page
      .locator('.top-actions')
      .getByText('Admin', { exact: true })
      .click()
  await password.fill(adminPassword)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByText('Administrator tools unlocked.')).toBeVisible()
}

test.beforeAll(async () => {
  const existingMarkets = await database.client`SELECT id FROM betting_markets`
  preexistingMarketIds = new Set(existingMarkets.map((row) => row.id as string))
  originalSchedule = await game.getSchedule()
  originalPreferences = await game.getPreferences()
  originalWeights = new Map(
    (await game.listPlaces(true)).map((place) => [place.id, place.logWeight]),
  )
  await game.setSchedule({
    timezone: 'UTC',
    time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(11, 16),
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  })
  await game.setPreferences({
    ...originalPreferences,
    bettingCloseMinutes: 0,
    maxBetsPerPlayer: 1,
  })
  memberId = (await game.saveParticipant({ name: memberName })).id
  otherId = (await game.saveParticipant({ name: otherName })).id
  await game.correctTokens(
    {
      participantId: memberId,
      delta: 200,
      reason: 'Bet limit browser fixture',
    },
    randomUUID(),
  )
  await game.correctTokens(
    { participantId: otherId, delta: 200, reason: 'Bet limit browser fixture' },
    randomUUID(),
  )
  firstPlaceId = (await game.savePlace({ name: firstPlaceName })).id
  secondPlaceId = (await game.savePlace({ name: secondPlaceName })).id
  const bets = await game.currentBets(memberId)
  if (!bets.window.open) throw new Error('Bet limit fixture market is closed.')
  const [market] = await database.client`
    SELECT id FROM betting_markets WHERE local_date = ${bets.window.localDate} AND status = 'open'
  `
  marketId = market?.id ?? ''
})

test.afterAll(async () => {
  try {
    for (const participantId of [memberId, otherId].filter(Boolean)) {
      await database.client`
        DELETE FROM bet_requests WHERE participant_id = ${participantId}::uuid
      `
      await database.client`
        DELETE FROM token_ledger WHERE participant_id = ${participantId}::uuid
      `
      await database.client`
        DELETE FROM bets WHERE participant_id = ${participantId}::uuid
      `
    }
    if (marketId && !preexistingMarketIds.has(marketId)) {
      await database.client`
        DELETE FROM betting_markets
        WHERE id = ${marketId}::uuid
          AND NOT EXISTS (SELECT 1 FROM bets WHERE market_id = ${marketId}::uuid)
      `
    }
    for (const placeId of [firstPlaceId, secondPlaceId].filter(Boolean))
      await database.client`DELETE FROM places WHERE id = ${placeId}::uuid`
    for (const participantId of [memberId, otherId].filter(Boolean))
      await database.client`DELETE FROM participants WHERE id = ${participantId}::uuid`
    for (const [id, logWeight] of originalWeights)
      await database.client`UPDATE places SET log_weight = ${logWeight} WHERE id = ${id}::uuid`
    if (originalPreferences) await game.setPreferences(originalPreferences)
    if (originalSchedule) await game.setSchedule(originalSchedule)
  } finally {
    await database.close()
  }
})

test('admin-configured bet limits support multiple independent bets and preserve existing bets when lowered', async ({
  page,
  request,
}) => {
  await page.route('**/api/v1/events', (route) => route.abort())
  await page.goto(origin)
  await signIn(page)
  const preferences = page.getByTestId('admin-preferences')
  const limitInput = preferences.getByLabel('Maximum bets per player per draw')
  await limitInput.fill('2')
  await preferences.getByRole('button', { name: 'Save preferences' }).click()
  await expect(
    page.getByText(
      'Wheel, check-in, betting and eligibility preferences saved.',
    ),
  ).toBeVisible()
  await page.reload()
  await signIn(page)
  await expect(
    page
      .getByTestId('admin-preferences')
      .getByLabel('Maximum bets per player per draw'),
  ).toHaveValue('2')

  const adminLogin = await request.post('/api/v1/admin/session', {
    data: { password: adminPassword },
    headers: { Origin: origin },
  })
  expect(adminLogin.status()).toBe(204)
  const adminCookie = /lunch-roller-admin=[^;]+/.exec(
    adminLogin.headers()['set-cookie'] ?? '',
  )?.[0]
  if (!adminCookie) throw new Error('Admin login did not set a session cookie.')
  const savedPreferences = await request.get('/api/v1/admin/preferences', {
    headers: { Cookie: adminCookie },
  })
  expect(savedPreferences.status()).toBe(200)
  const savedBody = await savedPreferences.json()
  expect(savedBody.maxBetsPerPlayer).toBe(2)
  for (const maxBetsPerPlayer of [0, 101]) {
    const invalid = await request.put('/api/v1/admin/preferences', {
      data: { ...savedBody, maxBetsPerPlayer },
      headers: { Cookie: adminCookie, Origin: origin },
    })
    expect(invalid.status()).toBe(400)
  }
  const unauthorizedPreferences = await request.put(
    '/api/v1/admin/preferences',
    {
      data: savedBody,
      headers: { Origin: origin, Cookie: '', 'X-Participant-Id': memberId },
    },
  )
  expect(unauthorizedPreferences.status()).toBe(401)

  await page.evaluate(
    (id) => localStorage.setItem('lunch-roller.participant-id', id),
    memberId,
  )
  await page.reload()
  const card = page.getByRole('region', { name: 'Bet on lunch' })
  await expect(card).toBeVisible()
  await card.getByLabel('Lunch place').selectOption(firstPlaceId)
  await card.getByLabel('Stake').fill('10')
  let lostCreateResponses = 0
  await page.route('**/api/v1/bets/current', async (route) => {
    if (route.request().method() === 'PUT' && lostCreateResponses === 0) {
      lostCreateResponses += 1
      await route.fetch()
      await route.abort('failed')
      return
    }
    await route.continue()
  })
  await card.getByRole('button', { name: 'Place bet' }).click()
  await expect(card.getByRole('alert')).toBeVisible()
  await card.getByRole('button', { name: 'Place bet' }).click()
  await expect(card.locator('.bet-message[role="status"]')).toContainText(
    'Your bet is saved.',
  )
  await page.unroute('**/api/v1/bets/current')
  expect(
    (
      await request
        .get('/api/v1/bets/current', {
          headers: { 'X-Participant-Id': memberId },
        })
        .then((response) => response.json())
    ).bets,
  ).toHaveLength(1)
  expect((await game.wallet(memberId)).balance).toBe(190)

  await card.getByLabel('Lunch place').selectOption(secondPlaceId)
  await card.getByLabel('Stake').fill('15')
  await card.getByRole('button', { name: 'Place bet' }).click()
  await expect(card.locator('.bet-message[role="status"]')).toContainText(
    'Your bet is saved.',
  )
  await expect(card.locator('.current-bets-list')).toContainText('10 tokens on')
  await expect(card.locator('.current-bets-list')).toContainText('15 tokens on')

  const memberHeaders = { 'X-Participant-Id': memberId }
  const current = await request.get('/api/v1/bets/current', {
    headers: memberHeaders,
  })
  expect(current.ok()).toBe(true)
  const currentBody = await current.json()
  expect(currentBody.maxBetsPerPlayer).toBe(2)
  const originalBets = currentBody.bets as Array<{
    id: string
    placeId: string
    stake: number
  }>
  expect(originalBets).toHaveLength(2)
  const firstBet = originalBets.find((bet) => bet.placeId === firstPlaceId)
  const secondBet = originalBets.find((bet) => bet.placeId === secondPlaceId)
  if (!firstBet || !secondBet)
    throw new Error('The browser did not create both fixture bets.')
  const balanceBeforeThird = await game.wallet(memberId)
  const third = await request.put('/api/v1/bets/current', {
    data: {
      localDate: currentBody.window.localDate,
      placeId: firstPlaceId,
      stake: 5,
      create: true,
    },
    headers: { ...memberHeaders, ...mutationHeaders() },
  })
  expect(third.status()).toBe(409)
  expect((await third.json()).error.code).toBe('BET_LIMIT_REACHED')
  expect((await game.wallet(memberId)).balance).toBe(balanceBeforeThird.balance)

  const otherHeaders = { 'X-Participant-Id': otherId }
  const otherBalance = await game.wallet(otherId)
  const otherEdit = await request.put('/api/v1/bets/current', {
    data: {
      localDate: currentBody.window.localDate,
      placeId: secondPlaceId,
      stake: 9,
      betId: firstBet.id,
    },
    headers: { ...otherHeaders, ...mutationHeaders() },
  })
  expect(otherEdit.status()).toBe(404)
  const otherCancel = await request.delete('/api/v1/bets/current', {
    data: { localDate: currentBody.window.localDate, betId: firstBet.id },
    headers: { ...otherHeaders, ...mutationHeaders() },
  })
  expect(otherCancel.status()).toBe(404)
  expect((await game.wallet(otherId)).balance).toBe(otherBalance.balance)

  await page.reload()
  await expect(card.locator('.current-bets-list')).toContainText('10 tokens on')
  await expect(card.locator('.current-bets-list')).toContainText('15 tokens on')

  await card
    .getByRole('button', { name: `Edit bet on ${firstPlaceName}` })
    .click()
  await card.getByLabel('Stake').fill('12')
  await card.getByRole('button', { name: 'Update bet' }).click()
  await expect(card.locator('.current-bets-list')).toContainText('12 tokens on')
  const savedFirstBet = await request.get('/api/v1/bets/current', {
    headers: memberHeaders,
  })
  const savedFirst = (
    (await savedFirstBet.json()).bets as Array<{
      id: string
      stake: number
    }>
  ).find((bet) => bet.id === firstBet.id)
  expect(savedFirst?.stake).toBe(12)

  const lowerLimit = await request.put('/api/v1/admin/preferences', {
    data: { ...savedBody, maxBetsPerPlayer: 1 },
    headers: { Cookie: adminCookie, Origin: origin },
  })
  expect(lowerLimit.status()).toBe(200)
  await page.reload()
  await expect(card.locator('.current-bets-list')).toContainText('12 tokens on')
  await expect(card.locator('.current-bets-list')).toContainText('15 tokens on')

  const remaining = await request.get('/api/v1/bets/current', {
    headers: memberHeaders,
  })
  const remainingBody = await remaining.json()
  const beforeEditAtLowerCap = await game.wallet(memberId)
  const allowedEdit = await request.put('/api/v1/bets/current', {
    data: {
      localDate: remainingBody.window.localDate,
      placeId: firstPlaceId,
      stake: 13,
      betId: firstBet.id,
    },
    headers: { ...memberHeaders, ...mutationHeaders() },
  })
  expect(allowedEdit.ok()).toBe(true)
  expect((await game.wallet(memberId)).balance).toBe(
    beforeEditAtLowerCap.balance - 1,
  )

  const beforeCancel = await game.wallet(memberId)
  const cancel = await request.delete('/api/v1/bets/current', {
    data: { localDate: remainingBody.window.localDate, betId: secondBet.id },
    headers: { ...memberHeaders, ...mutationHeaders() },
  })
  expect(cancel.ok()).toBe(true)
  expect((await game.wallet(memberId)).balance).toBe(beforeCancel.balance + 15)
  const finalBets = await request.get('/api/v1/bets/current', {
    headers: memberHeaders,
  })
  expect((await finalBets.json()).bets).toMatchObject([
    { id: firstBet.id, stake: 13, placeId: firstPlaceId },
  ])

  await database.client`
    UPDATE betting_markets SET cutoff_minutes = 1440 WHERE id = ${marketId}::uuid
  `
  const cutoffEdit = await request.put('/api/v1/bets/current', {
    data: {
      localDate: remainingBody.window.localDate,
      placeId: firstPlaceId,
      stake: 14,
      betId: firstBet.id,
    },
    headers: { ...memberHeaders, ...mutationHeaders() },
  })
  expect(cutoffEdit.status()).toBe(409)
  expect((await cutoffEdit.json()).error.code).toBe('BETTING_CLOSED')
  const beforeCutoffCancel = await game.wallet(memberId)
  const cutoffCancel = await request.delete('/api/v1/bets/current', {
    data: { localDate: remainingBody.window.localDate, betId: firstBet.id },
    headers: { ...memberHeaders, ...mutationHeaders() },
  })
  expect(cutoffCancel.status()).toBe(409)
  expect((await game.wallet(memberId)).balance).toBe(beforeCutoffCancel.balance)
})
