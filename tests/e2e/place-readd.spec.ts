import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { createDatabase, GameService } from '../../packages/db/src/index'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!testDatabaseUrl)
  throw new Error('Set TEST_DATABASE_URL to a disposable migrated database.')
const origin = new URL(process.env.APP_ORIGIN ?? 'http://localhost:3000').origin
const suffix = randomUUID().slice(0, 8)
const participantName = `LR-READD-${suffix}`
const archivedName = `LR-READD-${suffix} Archived Cafe`
const activeName = `LR-READD-${suffix} Active Cafe`
const database = createDatabase(testDatabaseUrl)
const game = new GameService(database)
let participantId = ''
let inactiveParticipantId = ''
let archivedPlaceId = ''
let activePlaceId = ''

test.beforeAll(async () => {
  participantId = (await game.saveParticipant({ name: participantName })).id
  inactiveParticipantId = (
    await game.saveParticipant({ name: `${participantName} Inactive` })
  ).id
  await game.saveParticipant({ active: false }, inactiveParticipantId)
  await game.correctTokens(
    { participantId, delta: 100, reason: 'Re-add browser fixture' },
    randomUUID(),
  )
  archivedPlaceId = (
    await game.savePlace({ name: archivedName, healthLevel: 'healthy' })
  ).id
  activePlaceId = (await game.savePlace({ name: activeName })).id
  await game.savePlace({ active: false }, archivedPlaceId)
})

test.afterAll(async () => {
  try {
    if (participantId) {
      await database.client`
        DELETE FROM token_ledger WHERE participant_id = ${participantId}::uuid
      `
    }
    const placeIds = [archivedPlaceId, activePlaceId].filter(Boolean)
    if (placeIds.length) {
      await database.client`
        DELETE FROM places WHERE id = ANY(${placeIds}::uuid[])
      `
    }
    const participantIds = [participantId, inactiveParticipantId].filter(
      Boolean,
    )
    if (participantIds.length) {
      await database.client`
        DELETE FROM participants WHERE id = ANY(${participantIds}::uuid[])
      `
    }
  } finally {
    await database.close()
  }
})

test('searches archived places and restores the same place through the paid add flow', async ({
  page,
  request,
}) => {
  const missingIdentity = await request.get('/api/v1/places/archived')
  expect(missingIdentity.status()).toBe(401)
  const inactiveIdentity = await request.get('/api/v1/places/archived', {
    headers: { 'X-Participant-Id': inactiveParticipantId },
  })
  expect(inactiveIdentity.status()).toBe(403)
  const headers = { 'X-Participant-Id': participantId }
  const response = await request.get('/api/v1/places/archived', { headers })
  expect(response.ok()).toBe(true)
  const listed = (await response.json()).places as Array<{
    id: string
    name: string
    active: boolean
  }>
  expect(
    listed.some((place) => place.id === archivedPlaceId && !place.active),
  ).toBe(true)
  expect(listed.some((place) => place.id === activePlaceId)).toBe(false)

  await page.goto(origin)
  await page.evaluate(
    (id) => localStorage.setItem('lunch-roller.participant-id', id),
    participantId,
  )
  await page.reload()
  const input = page.getByLabel('Add or restore a lunch place')
  let archivedSearches = 0
  await page.route('**/api/v1/places/archived', async (route) => {
    archivedSearches += 1
    if (archivedSearches === 1) {
      await route.fulfill({ status: 500, body: 'temporary failure' })
      return
    }
    await route.continue()
  })
  await input.fill('archived cafe')
  await expect(
    page.locator('.archived-place-search [role="status"]'),
  ).toContainText('Could not search removed places.')
  await expect(input).toHaveValue('archived cafe')
  await expect(input).toBeEnabled()
  await page.getByRole('button', { name: 'Retry search' }).click()
  const restoreOption = page.getByRole('button', {
    name: `Restore ${archivedName} · 20 tokens`,
  })
  await expect(restoreOption).toBeVisible()
  await restoreOption.focus()
  await page.keyboard.press('Enter')
  await expect(input).toHaveValue(archivedName)
  await page.getByRole('button', { name: 'Restore place' }).click()
  await expect(
    page.locator('.odds-row').filter({ hasText: archivedName }),
  ).toBeVisible()

  const activeBalance = await game.wallet(participantId)
  expect(activeBalance.balance).toBe(80)
  const duplicate = await request.post('/api/v1/places', {
    data: { name: activeName, healthLevel: 'balanced' },
    headers: {
      Origin: origin,
      'X-Participant-Id': participantId,
      'Idempotency-Key': randomUUID(),
    },
  })
  expect(duplicate.status()).toBe(409)
  expect((await game.wallet(participantId)).balance).toBe(activeBalance.balance)
  const restored = (await game.listPlaces(true)).find(
    (place) => place.id === archivedPlaceId,
  )
  expect(restored).toMatchObject({
    id: archivedPlaceId,
    name: archivedName,
    active: true,
    healthLevel: 'healthy',
  })

  await page.reload()
  await expect(
    page.locator('.odds-row').filter({ hasText: archivedName }),
  ).toBeVisible()
  const afterReload = await game.listPlaces(true)
  expect(
    afterReload.filter((place) => place.id === archivedPlaceId),
  ).toHaveLength(1)
})
