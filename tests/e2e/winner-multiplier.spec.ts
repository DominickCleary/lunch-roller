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
const fixtureName = `LR-WIN-${randomUUID().slice(0, 8)} Place`
const database = createDatabase(testDatabaseUrl)
const game = new GameService(database)
let originalEconomy: Awaited<ReturnType<GameService['getEconomy']>>
let originalSchedule: Awaited<ReturnType<GameService['getSchedule']>>
let fixturePlaceId = ''
let fixtureParticipantId = ''
let fixtureDrawId = ''

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
  originalEconomy = await game.getEconomy()
  originalSchedule = await game.getSchedule()
  const place = await game.savePlace({ name: fixtureName })
  fixturePlaceId = place.id
  const member = await game.saveParticipant({
    name: `LR-WIN-${randomUUID().slice(0, 8)} Member`,
  })
  fixtureParticipantId = member.id
})

test.afterAll(async () => {
  try {
    if (fixturePlaceId)
      await game
        .savePlace({ active: false }, fixturePlaceId)
        .catch(() => undefined)
    if (fixtureDrawId) {
      await database.client`delete from notification_outbox where draw_id = ${fixtureDrawId}::uuid`
      await database.client`delete from draws where id = ${fixtureDrawId}::uuid`
    }
    if (fixturePlaceId)
      await database.client`delete from places where id = ${fixturePlaceId}::uuid`
    if (fixtureParticipantId)
      await database.client`delete from participants where id = ${fixtureParticipantId}::uuid`
    if (originalEconomy) await game.setEconomy(originalEconomy)
    if (originalSchedule) await game.setSchedule(originalSchedule)
  } finally {
    await database.close()
  }
})

test('admin can remove a winning place with zero multiplier and history remains', async ({
  page,
  request,
}) => {
  await page.route('**/api/v1/events', (route) => route.abort())
  await page.addInitScript(
    (id) => localStorage.setItem('lunch-roller.participant-id', id),
    fixtureParticipantId,
  )
  await page.goto(origin)
  await signIn(page)

  const card = page.getByTestId('admin-economy')
  const multiplier = card.getByLabel('After-win weight multiplier')
  await multiplier.fill('0')
  await card.getByRole('button', { name: 'Save token settings' }).click()
  await expect(
    page.getByText('Token settings saved.', { exact: true }),
  ).toBeVisible()
  expect((await game.getEconomy()).winnerMultiplier).toBe(0)

  await multiplier.fill('1.1')
  await expect(multiplier).toHaveAttribute('max', '1')
  expect(
    await multiplier.evaluate(
      (input: HTMLInputElement) => input.validity.rangeOverflow,
    ),
  ).toBe(true)
  await card.getByRole('button', { name: 'Save token settings' }).click()
  expect((await game.getEconomy()).winnerMultiplier).toBe(0)
  const invalid = await page.request.put('/api/v1/admin/economy', {
    data: { ...originalEconomy, winnerMultiplier: 1.1 },
    headers: { Origin: origin },
  })
  expect(invalid.status()).toBe(400)
  expect((await game.getEconomy()).winnerMultiplier).toBe(0)

  await page.reload()
  await signIn(page)
  await expect(
    page.getByTestId('admin-economy').getByLabel('After-win weight multiplier'),
  ).toHaveValue('0')
  await page.getByRole('button', { name: 'Lock admin tools' }).click()
  // Restoring a member selection after verifying persisted admin settings
  // exercises the ordinary browser view before the draw changes its odds.
  await page.evaluate(
    (id) => localStorage.setItem('lunch-roller.participant-id', id),
    fixtureParticipantId,
  )
  await page.reload()
  await expect(page.locator('.wheel')).toBeVisible()
  const unauthorized = await request.put('/api/v1/admin/economy', {
    data: { ...originalEconomy, winnerMultiplier: 0 },
    headers: { Origin: origin, 'X-Participant-Id': fixtureParticipantId },
  })
  expect(unauthorized.status()).toBe(401)
  await expect(
    page.locator('.odds-row').filter({ hasText: fixtureName }),
  ).toBeVisible()

  const drawDate = new Date('2303-11-02T12:00:00.000Z')
  await game.setSchedule({
    ...originalSchedule,
    timezone: 'UTC',
    time: '00:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  })
  await game.setPlaceWeight({ placeId: fixturePlaceId, weight: 1e200 })
  const draw = await game.drawIfDue(drawDate)
  fixtureDrawId = draw?.id ?? ''
  expect(draw?.placeId).toBe(fixturePlaceId)
  const savedPlaces = await game.listPlaces(true)
  expect(
    savedPlaces.find((place) => place.id === fixturePlaceId),
  ).toMatchObject({
    active: false,
    name: fixtureName,
  })
  expect(draw?.snapshot.some((place) => place.placeId === fixturePlaceId)).toBe(
    true,
  )
  await page.reload()
  await expect(
    page.locator('.odds-row').filter({ hasText: fixtureName }),
  ).toHaveCount(0)
  const today = await request.get('/api/v1/today')
  expect(today.ok()).toBe(true)
  expect(
    (await today.json()).odds.some(
      (place: { placeId: string }) => place.placeId === fixturePlaceId,
    ),
  ).toBe(false)
})
