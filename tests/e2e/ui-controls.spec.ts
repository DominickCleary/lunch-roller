import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  createDatabase,
  GameService,
  schema,
} from '../../packages/db/src/index'

const database = createDatabase(process.env.TEST_DATABASE_URL!)
const game = new GameService(database)
const suffix = randomUUID().slice(0, 8)
const placeName = `UI controls ${suffix}`
const personName = `UI controls person ${suffix}`
let personId = ''
let placeId = ''
let originalPreferences: Awaited<ReturnType<GameService['getPreferences']>>
let originalWeights: (typeof schema.places.$inferSelect)[]
test.beforeAll(async () => {
  originalPreferences = await game.getPreferences()
  originalWeights = await database.db.select().from(schema.places)
  personId = (await game.saveParticipant({ name: personName })).id
  placeId = (await game.savePlace({ name: placeName, healthLevel: 'healthy' }))
    .id
})
test.afterAll(async () => {
  try {
    await game.setPreferences(originalPreferences)
    for (const place of originalWeights)
      await database.client`UPDATE places SET log_weight = ${place.logWeight} WHERE id = ${place.id}::uuid`
    await database.client`DELETE FROM places WHERE id = ${placeId}::uuid`
    await database.client`DELETE FROM participants WHERE id = ${personId}::uuid`
  } finally {
    await database.close()
  }
})
test('unifies place management, odds and direct weights; persists spin duration and reviews mobile controls', async ({
  page,
  request,
}) => {
  await page.addLocatorHandler(
    page.getByRole('button', { name: 'Praise the Wheel', exact: true }),
    async (button) => {
      await button.click()
    },
  )
  await page.emulateMedia({ colorScheme: 'light' })
  await page.addInitScript(
    (id) => localStorage.setItem('lunch-roller.participant-id', id),
    personId,
  )
  await page.goto('/')
  const spot = page.locator('.odds-row').filter({ hasText: placeName })
  await expect(spot.locator('.health-badge')).toHaveCSS(
    'color',
    'rgb(45, 106, 79)',
  )
  await expect(spot.locator('.influence-position-buttons button')).toHaveCount(
    3,
  )
  await expect(spot.locator('.influence-net-value')).toHaveText('0')
  await expect(spot).not.toContainText('Staged')
  await expect(spot).not.toContainText('editable until')
  expect((await spot.boundingBox())!.height).toBeLessThanOrEqual(48)
  expect(
    (
      await request.put('/api/v1/admin/place-weights', {
        headers: {
          Origin: process.env.APP_ORIGIN ?? 'http://localhost:3000',
        },
        data: { placeId, weight: 4 },
      })
    ).status(),
  ).toBe(401)
  await page.locator('.top-actions').getByText('Admin', { exact: true }).click()
  await page
    .getByLabel('Administrator password')
    .fill(process.env.ADMIN_PASSWORD ?? 'integration-only-password')
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  const combined = page.getByTestId('admin-restaurant-odds')
  await expect(
    combined.getByRole('heading', { name: 'Places and odds' }),
  ).toBeVisible()
  const row = combined.getByRole('row').filter({ hasText: placeName })
  await row.getByLabel(`${placeName} weight`, { exact: true }).fill('3.25')
  await row.getByRole('button', { name: 'Save weight' }).click()
  await expect(
    page.getByText('Restaurant weight saved.', { exact: true }),
  ).toBeVisible()
  expect(
    (await game.listPlaces()).find((place) => place.id === placeId)!.logWeight,
  ).toBeCloseTo(Math.log(3.25))
  await row.getByLabel(`${placeName} percentage`, { exact: true }).fill('20')
  await combined.getByRole('button', { name: 'Save percentages' }).click()
  await expect(
    page.getByText('Restaurant odds saved.', { exact: true }),
  ).toBeVisible()
  expect(
    (await game.listRestaurantOdds()).places.find(
      (place) => place.placeId === placeId,
    )!.percent,
  ).toBeCloseTo(20)
  await page.getByRole('button', { name: 'Odds', exact: true }).click()
  await expect(
    page.getByText(
      'Approximate net winnings per token staked. Bets settle using the final draw chances.',
    ),
  ).toBeVisible()
  await expect(spot.locator(':scope > strong')).toHaveText('4/1')
  await expect(spot.locator(':scope > strong')).toHaveAttribute(
    'title',
    /20.*% chance/,
  )
  await row
    .getByLabel(`Health level for ${placeName}`, { exact: true })
    .selectOption('treat')
  await expect(spot.locator('.health-badge')).toHaveCSS(
    'color',
    'rgb(158, 62, 53)',
  )
  const preferences = page.getByTestId('admin-preferences')
  await preferences.getByLabel('Wheel spin duration (seconds)').fill('7')
  await preferences.getByRole('button', { name: 'Save preferences' }).click()
  await expect(
    page.getByText(
      'Wheel, check-in, betting and eligibility preferences saved.',
      {
        exact: true,
      },
    ),
  ).toBeVisible()
  expect((await game.getPreferences()).wheelSpinSeconds).toBe(7)
  await page.reload()
  await page.locator('.top-actions').getByText('Admin', { exact: true }).click()
  await page
    .getByLabel('Administrator password')
    .fill(process.env.ADMIN_PASSWORD ?? 'integration-only-password')
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(
    preferences.getByLabel('Wheel spin duration (seconds)'),
  ).toHaveValue('7')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({
    path: '/tmp/lunch-ui-controls-desktop.png',
    fullPage: true,
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: '/tmp/lunch-ui-controls-mobile.png',
    fullPage: true,
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  const boostControl = spot.getByRole('button', {
    name: `Boost ${placeName}`,
    exact: true,
  })
  const boostBounds = await boostControl.boundingBox()
  expect(boostBounds!.height).toBeGreaterThanOrEqual(44)
  expect(boostBounds!.width).toBeGreaterThanOrEqual(44)
  await expect(spot.locator('.health-badge')).toBeVisible()
  const add = await page
    .locator('.add-place')
    .getByRole('button', { name: 'Add place' })
    .boundingBox()
  const health = await page.getByLabel('New spot health level').boundingBox()
  expect(Math.abs(add!.y - health!.y)).toBeLessThan(5)
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(spot.locator('.health-badge')).toHaveCSS(
    'color',
    'rgb(233, 148, 131)',
  )
})

test('explains the Overgoated award, handles ties and keeps it clear of restaurant controls', async ({
  page,
  request,
}) => {
  const drawIds: string[] = []
  let tiedPlaceId = ''
  let drawDay = 1
  const tiedPlaceName = `The Neighbourhood Lunch Club and Very Good Sandwich Kitchen ${suffix}`
  const initial = await game.today()
  const leaderCount = Math.max(
    2,
    ...initial.restaurantCheckIns.map((entry) => entry.count + 1),
  )
  async function recordCheckIns(id: string, name: string) {
    for (let index = 0; index < leaderCount; index++) {
      const drawId = randomUUID()
      const localDate = new Date(Date.UTC(1901, 0, drawDay++))
        .toISOString()
        .slice(0, 10)
      drawIds.push(drawId)
      await database.db.insert(schema.draws).values({
        id: drawId,
        localDate,
        timezone: 'UTC',
        placeId: id,
        placeName: name,
        sample: 0.5,
        snapshot: [{ placeId: id, name, logWeight: 0, probability: 1 }],
        drawnAt: new Date(`${localDate}T11:30:00Z`),
      })
      await database.db.insert(schema.attendance).values({
        participantId: personId,
        drawId,
        createdAt: new Date(`${localDate}T12:00:00Z`),
      })
    }
  }
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.addInitScript(
      (id) => localStorage.setItem('lunch-roller.participant-id', id),
      personId,
    )
    await page.goto('/')
    const spot = page.locator('.odds-row').filter({ hasText: placeName })
    await expect(spot.locator('.restaurant-checkin-award')).toHaveCount(0)
    await recordCheckIns(placeId, placeName)
    await page.reload()
    const award = spot.locator('.restaurant-checkin-award')
    await expect(award.locator('.restaurant-checkin-award-label')).toHaveText(
      'Overgoated',
    )
    await expect(award).toContainText(
      `${leaderCount} check-ins · all-time leader`,
    )
    await expect(spot).toHaveCSS('outline-style', 'none')
    const today = await request.get('/api/v1/today')
    expect((await today.json()).restaurantCheckIns).toContainEqual({
      placeId,
      count: leaderCount,
    })

    tiedPlaceId = (await game.savePlace({ name: tiedPlaceName })).id
    await recordCheckIns(tiedPlaceId, tiedPlaceName)
    await page.reload()
    await expect(award).toContainText('joint all-time leader')
    const tiedSpot = page
      .locator('.odds-row')
      .filter({ hasText: tiedPlaceName })
    await expect(tiedSpot.locator('.restaurant-checkin-award')).toContainText(
      'joint all-time leader',
    )
    await expect(page.locator('.restaurant-checkin-award')).toHaveCount(2)

    // Persistence above uses real attendance. Stress the layout separately
    // with large formatted totals instead of creating millions of fixtures.
    await page.route('**/api/v1/today', async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      await route.fulfill({
        response,
        json: {
          ...body,
          restaurantCheckIns: [
            { placeId, count: 1234567 },
            { placeId: tiedPlaceId, count: 1234567 },
          ],
        },
      })
    })
    await page.reload()
    await expect(award).toContainText(
      '1,234,567 check-ins · joint all-time leader',
    )

    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 })
        for (const row of [spot, tiedSpot]) {
          const marker = row.locator('.restaurant-checkin-award')
          await marker.scrollIntoViewIfNeeded()
          const markerBox = await marker.boundingBox()
          const rowBox = await row.boundingBox()
          const controlsBox = await row
            .locator('.influence-position-buttons')
            .boundingBox()
          const nameBox = await row.locator('.odds-name').boundingBox()
          if (!markerBox || !rowBox || !controlsBox || !nameBox)
            throw new Error('Restaurant and award must be visible.')
          expect(markerBox.x).toBeCloseTo(nameBox.x, 0)
          expect(markerBox.x + markerBox.width).toBeLessThanOrEqual(
            rowBox.x + rowBox.width + 1,
          )
          expect(markerBox.y).toBeGreaterThanOrEqual(
            controlsBox.y + controlsBox.height + 3,
          )
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true)
        await page.locator('.odds-panel').screenshot({
          path: `/tmp/lunch-checkin-award-${colorScheme}-${width}.png`,
        })
      }
    }
    await page.unrouteAll({ behavior: 'wait' })
    // Removing the historical fixture removes the award after a fresh read.
    await database.client`DELETE FROM attendance WHERE draw_id IN ${database.client(drawIds)}`
    await page.reload()
    await expect(spot.locator('.restaurant-checkin-award')).toHaveCount(0)
    await expect(tiedSpot.locator('.restaurant-checkin-award')).toHaveCount(0)
  } finally {
    await page.unrouteAll({ behavior: 'wait' })
    if (drawIds.length) {
      await database.client`DELETE FROM attendance WHERE draw_id IN ${database.client(drawIds)}`
      await database.client`DELETE FROM draws WHERE id IN ${database.client(drawIds)}`
    }
    if (tiedPlaceId)
      await database.client`DELETE FROM places WHERE id = ${tiedPlaceId}::uuid`
  }
})
