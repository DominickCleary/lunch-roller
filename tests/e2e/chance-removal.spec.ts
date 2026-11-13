import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { createDatabase, GameService } from '../../packages/db/src/index'
import { places, settings } from '../../packages/db/src/schema'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!testDatabaseUrl)
  throw new Error(
    'Set TEST_DATABASE_URL to a disposable migrated and seeded database before running E2E tests.',
  )

const origin = new URL(process.env.APP_ORIGIN ?? 'http://localhost:3000').origin
const adminPassword = process.env.ADMIN_PASSWORD ?? 'integration-only-password'
const suffix = randomUUID().slice(0, 8)
const names = [
  `LR-CHANCE-A-${suffix}`,
  `LR-CHANCE-B-${suffix}`,
  `LR-CHANCE-C-${suffix}`,
  `LR-CHANCE-RARE-${suffix}`,
]
const database = createDatabase(testDatabaseUrl)
const game = new GameService(database)
const fixturePlaceIds: string[] = []
const drawIds: string[] = []
let originalSettings: typeof settings.$inferSelect
let originalEconomy: Awaited<ReturnType<GameService['getEconomy']>>
let originalPlaceState: Array<{
  id: string
  active: boolean
  logWeight: number
}>

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

async function saveTokenSettings(page: import('@playwright/test').Page) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/economy') &&
        response.request().method() === 'PUT',
    ),
    page
      .getByTestId('admin-economy')
      .getByRole('button', { name: 'Save token settings' })
      .click(),
  ])
  expect(response.ok()).toBe(true)
}

test.beforeAll(async () => {
  const [row] = await database.db.select().from(settings)
  if (!row) throw new Error('Settings row missing from test database.')
  originalSettings = row
  originalEconomy = await game.getEconomy()
  originalPlaceState = (await database.db.select().from(places)).map(
    ({ id, active, logWeight }) => ({ id, active, logWeight }),
  )

  await game.setSchedule({
    timezone: 'UTC',
    time: '00:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  })
  await database.db.update(places).set({ active: false })
  for (const name of names) {
    const place = await game.savePlace({ name })
    fixturePlaceIds.push(place.id)
  }
  const rarePlaceId = fixturePlaceIds.at(-1)
  if (!rarePlaceId) throw new Error('Expected the rare-place fixture.')
  await database.client`
    UPDATE places SET log_weight = 0
    WHERE id IN ${database.client(fixturePlaceIds.slice(0, 3))}
  `
  await database.client`
    UPDATE places SET log_weight = -1000 WHERE id = ${rarePlaceId}::uuid
  `
})

test.afterAll(async () => {
  try {
    if (drawIds.length) {
      await database.client`
        DELETE FROM notification_outbox
        WHERE draw_id IN ${database.client(drawIds)}
      `
      await database.client`
        DELETE FROM betting_markets
        WHERE draw_id IN ${database.client(drawIds)}
      `
      await database.client`
        DELETE FROM draws WHERE id IN ${database.client(drawIds)}
      `
    }
    if (fixturePlaceIds.length)
      await database.client`
        DELETE FROM places WHERE id IN ${database.client(fixturePlaceIds)}
      `
    for (const item of originalPlaceState ?? [])
      await database.client`
        UPDATE places
        SET active = ${item.active}, log_weight = ${item.logWeight}
        WHERE id = ${item.id}::uuid
      `
    if (originalEconomy) await game.setEconomy(originalEconomy)
    if (originalSettings)
      await database.client`
        UPDATE settings
        SET timezone = ${originalSettings.timezone},
            spin_time = ${originalSettings.spinTime},
            weekdays = ${`{${originalSettings.weekdays.join(',')}}`}::integer[]
        WHERE id = 1
      `
  } finally {
    await database.close()
  }
})

test('admin chance thresholds persist and archive qualifying places after draws', async ({
  page,
}) => {
  await page.route('**/api/v1/events', (route) => route.abort())
  await page.goto(origin)
  await signIn(page)

  const card = page.getByTestId('admin-economy')
  const autoThreshold = card.getByLabel('Auto-remove places below chance (%)')
  const winnerThreshold = card.getByLabel(
    'Remove winner after spin below chance (%)',
  )
  await autoThreshold.fill('1')
  await winnerThreshold.fill('0')
  await saveTokenSettings(page)
  await expect(
    page.getByText('Token settings saved.', { exact: true }),
  ).toBeVisible()
  expect(await game.getEconomy()).toMatchObject({
    autoRemoveBelowChancePercent: 1,
    removeWinnerBelowChancePercent: 0,
  })

  await page.reload()
  await signIn(page)
  const reloadedCard = page.getByTestId('admin-economy')
  await expect(
    reloadedCard.getByLabel('Auto-remove places below chance (%)'),
  ).toHaveValue('1')
  await expect(
    reloadedCard.getByLabel('Remove winner after spin below chance (%)'),
  ).toHaveValue('0')

  const firstDraw = await game.drawIfDue(new Date('2304-01-02T12:00:00.000Z'))
  if (!firstDraw) throw new Error('Expected the first chance-removal draw.')
  drawIds.push(firstDraw.id)
  const rarePlaceId = fixturePlaceIds.at(-1)
  if (!rarePlaceId) throw new Error('Expected the rare-place fixture.')
  expect(firstDraw.snapshot.map((place) => place.placeId)).toEqual(
    expect.arrayContaining(fixturePlaceIds),
  )
  const afterGeneralRule = await game.listPlaces(true)
  expect(
    afterGeneralRule.find((place) => place.id === rarePlaceId),
  ).toMatchObject({ active: false })
  expect(
    afterGeneralRule.filter((place) =>
      fixturePlaceIds.slice(0, 3).includes(place.id),
    ),
  ).toHaveLength(3)
  expect(
    afterGeneralRule
      .filter((place) => fixturePlaceIds.slice(0, 3).includes(place.id))
      .every((place) => place.active),
  ).toBe(true)

  await winnerThreshold.fill('40')
  await autoThreshold.fill('0')
  await saveTokenSettings(page)
  await expect(
    page.getByText('Token settings saved.', { exact: true }),
  ).toBeVisible()
  expect(await game.getEconomy()).toMatchObject({
    autoRemoveBelowChancePercent: 0,
    removeWinnerBelowChancePercent: 40,
  })

  const secondDraw = await game.drawIfDue(new Date('2304-01-03T12:00:00.000Z'))
  if (!secondDraw) throw new Error('Expected the winner-threshold draw.')
  drawIds.push(secondDraw.id)
  expect(secondDraw.snapshot.map((place) => place.placeId)).toEqual(
    expect.arrayContaining(fixturePlaceIds.slice(0, 3)),
  )
  expect(
    (await game.listPlaces(true)).find(
      (place) => place.id === secondDraw.placeId,
    ),
  ).toMatchObject({ active: false })
  // The optional minimum changes chance decay, independently of removal thresholds.
  await autoThreshold.fill('0')
  await winnerThreshold.fill('0')
  await reloadedCard.getByLabel('After-win weight multiplier').fill('0.5')
  const minimum = reloadedCard.getByLabel(
    'Minimum after-win reduction (percentage points)',
  )
  await minimum.fill('10')
  await saveTokenSettings(page)
  await expect(
    page.getByText('Token settings saved.', { exact: true }),
  ).toBeVisible()
  await page.reload()
  await signIn(page)
  await expect(minimum).toHaveValue('10')
  expect((await game.getEconomy()).winnerChanceReductionPoints).toBe(10)
  for (const [day, points, expected] of [
    [4, 10, 0.125],
    [5, 20, 0.05],
    [6, 30, 0],
  ] as const) {
    await minimum.fill(String(points))
    await saveTokenSettings(page)
    await expect(
      page.getByText('Token settings saved.', { exact: true }),
    ).toBeVisible()
    await database.client`UPDATE places SET active = true, log_weight = 0 WHERE id IN ${database.client(fixturePlaceIds)}`
    const instant = new Date(`2304-01-0${day}T12:00:00.000Z`)
    const draw = await game.drawIfDue(instant)
    if (!draw) throw new Error('Expected the minimum-reduction draw.')
    drawIds.push(draw.id)
    expect(
      draw.snapshot.find((place) => place.placeId === draw.placeId)
        ?.probability,
    ).toBeCloseTo(0.25, 10)
    const winner = (await game.today(instant)).odds.find(
      (place) => place.placeId === draw.placeId,
    )
    if (expected) expect(winner?.probability).toBeCloseTo(expected, 10)
    else expect(winner).toBeUndefined()
  }
  await minimum.fill('0')
  await saveTokenSettings(page)
  await expect(
    page.getByText('Token settings saved.', { exact: true }),
  ).toBeVisible()
  expect((await game.getEconomy()).winnerChanceReductionPoints).toBe(0)
})
