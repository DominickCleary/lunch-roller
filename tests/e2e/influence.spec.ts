import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  createDatabase,
  GameService,
  schema,
} from '../../packages/db/src/index'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!testDatabaseUrl)
  throw new Error(
    'Set TEST_DATABASE_URL to a disposable migrated and seeded database before running E2E tests.',
  )

const appOrigin = new URL(process.env.APP_ORIGIN ?? 'http://localhost:3000')
  .origin
const database = createDatabase(testDatabaseUrl)
const game = new GameService(database)
const suffix = randomUUID().slice(0, 8)
const memberName = `LR-INFLUENCE-${suffix} Member`
const placeName = `LR-INFLUENCE-${suffix} Place`
let memberId = ''
let placeId = ''
const marketIds: string[] = []
let originalSettings: typeof schema.settings.$inferSelect | undefined
let originalEconomy: Awaited<ReturnType<typeof game.getEconomy>> | undefined
let originalPlaceWeights: { placeId: string; weight: number }[] = []

test.beforeAll(async () => {
  ;[originalSettings] = await database.db.select().from(schema.settings)
  originalEconomy = await game.getEconomy()
  const member = await game.saveParticipant({ name: memberName })
  const place = await game.savePlace({ name: placeName })
  memberId = member.id
  placeId = place.id
  originalPlaceWeights = (
    await database.db
      .select({
        placeId: schema.places.id,
        weight: schema.places.logWeight,
        active: schema.places.active,
      })
      .from(schema.places)
  )
    .filter((place) => place.active)
    .map(({ placeId: originalPlaceId, weight }) => ({
      placeId: originalPlaceId,
      weight,
    }))
  await database.client`UPDATE settings SET setup_completed = true WHERE id = 1`
  await game.setSchedule({
    timezone: 'UTC',
    time: '23:59',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  })
  await game.setPreferences({
    wheelSwitchTime: originalSettings?.wheelSwitchTime ?? '15:00',
    checkInPledge: originalSettings?.checkInPledge ?? 'I followed the wheel',
    bettingCloseMinutes: 0,
  })
  const liveMarket = await game.currentInfluence(memberId, new Date())
  const marketRows =
    await database.client`SELECT id FROM betting_markets WHERE local_date = ${liveMarket.window.localDate} AND status = 'open'`
  marketIds.push(...marketRows.map((market) => market.id))
  await game.correctTokens(
    {
      participantId: memberId,
      delta: 100,
      reason: 'fund browser influence test',
    },
    randomUUID(),
  )
})

test.afterAll(async () => {
  try {
    if (originalEconomy) await game.setEconomy(originalEconomy)
    for (const place of originalPlaceWeights) {
      try {
        await game.setPlaceWeight({
          placeId: place.placeId,
          weight: Math.exp(place.weight),
        })
      } catch {
        // The fixture place may already have been removed by test cleanup.
      }
    }
    if (memberId) {
      await database.client`DELETE FROM influence_lots WHERE participant_id = ${memberId}::uuid`
      await database.client`DELETE FROM token_ledger WHERE participant_id = ${memberId}::uuid`
      await database.client`DELETE FROM participants WHERE id = ${memberId}::uuid`
    }
    if (marketIds.length)
      await database.client`DELETE FROM betting_markets WHERE id IN ${database.client(marketIds)}`
    if (placeId)
      await database.client`DELETE FROM places WHERE id = ${placeId}::uuid`
    if (originalSettings)
      await database.client`UPDATE settings SET
        timezone = ${originalSettings.timezone}, spin_time = ${originalSettings.spinTime},
        weekdays = ${`{${originalSettings.weekdays.join(',')}}`}::integer[],
        wheel_switch_time = ${originalSettings.wheelSwitchTime},
        check_in_pledge = ${originalSettings.checkInPledge},
        betting_close_minutes = ${originalSettings.bettingCloseMinutes},
        setup_completed = ${originalSettings.setupCompleted}
        WHERE id = 1`
  } finally {
    await database.close()
  }
})

test('holds restaurant order for two seconds after changing influence', async ({
  page,
}) => {
  if (!originalEconomy) throw new Error('Missing economy fixture')
  for (const place of originalPlaceWeights) {
    await game.setPlaceWeight({
      placeId: place.placeId,
      weight: place.placeId === placeId ? 1 : 10,
    })
  }
  await game.setEconomy({ ...originalEconomy, boostMultiplier: 100 })

  try {
    const browserTime = Date.now()
    await page.clock.install({ time: new Date(browserTime) })
    await page.clock.pauseAt(new Date(browserTime + 1000))
    await page.addInitScript((id) => {
      localStorage.setItem('lunch-roller.participant-id', id)
    }, memberId)
    await page.goto(appOrigin)

    const row = page.locator('.odds-row').filter({ hasText: placeName })
    await expect(row).toBeVisible()
    const getOrder = () =>
      page
        .locator('.odds-row')
        .evaluateAll((rows) =>
          rows.map((row) =>
            row.querySelector('.odds-name')?.textContent?.trim(),
          ),
        )
    const getExpectedOrder = () =>
      page.locator('.odds-row').evaluateAll((rows) =>
        rows
          .map((row) => ({
            name: row.querySelector('.odds-name')?.textContent?.trim(),
            chance: Number.parseFloat(
              row.querySelector(':scope > strong')?.getAttribute('title') ?? '',
            ),
          }))
          .sort((left, right) => right.chance - left.chance)
          .map((row) => row.name),
      )
    const initialOrder = await getOrder()
    expect(initialOrder[initialOrder.length - 1]).toBe(placeName)
    const getChance = async () =>
      Number(
        ((await row.locator(':scope > strong').textContent()) ?? '').replace(
          '%',
          '',
        ),
      )
    const initialChance = await getChance()
    await row.getByRole('button', { name: `Boost ${placeName}` }).click()
    await expect(row.locator('.influence-net-value')).toHaveText('+1')
    await expect.poll(getChance).toBeGreaterThan(initialChance)
    await expect.poll(getOrder).toEqual(initialOrder)

    // Network and assertion time must not consume the two-second hold.
    await page.clock.runFor(1999)
    expect(await getOrder()).toEqual(initialOrder)
    const expectedOrder = await getExpectedOrder()
    expect(expectedOrder).not.toEqual(initialOrder)
    await page.clock.runFor(1)
    await expect.poll(getOrder).toEqual(expectedOrder)

    await page
      .locator('.odds-row')
      .filter({ hasText: placeName })
      .getByRole('button', { name: `Refund tokens for ${placeName}` })
      .click()
    await expect(
      page
        .locator('.odds-row')
        .filter({ hasText: placeName })
        .locator('.influence-net-value'),
    ).toHaveText('0')
  } finally {
    await game.setEconomy(originalEconomy)
    for (const place of originalPlaceWeights) {
      await game.setPlaceWeight({
        placeId: place.placeId,
        weight: Math.exp(place.weight),
      })
    }
  }
})

test('edits persisted influence from the odds list without changing selected identity', async ({
  page,
  request,
}) => {
  await page.addLocatorHandler(
    page.getByRole('button', { name: 'Praise the Wheel', exact: true }),
    async (button) => {
      await button.click()
    },
  )
  await page.addInitScript((id) => {
    localStorage.setItem('lunch-roller.participant-id', id)
  }, memberId)
  await page.goto(appOrigin)
  await expect(page.locator('.member-status')).toContainText(memberName)
  await expect(page.locator('.balance')).toContainText('100')

  const row = page.locator('.odds-row').filter({ hasText: placeName })
  await expect(row).toBeVisible()
  await expect(
    row.getByRole('button', { name: `Boost ${placeName}` }),
  ).toHaveAttribute('title', `Boost ${placeName} for 5 tokens`)
  await expect(row.getByRole('tooltip')).toHaveCount(0)
  await row.getByRole('button', { name: `Boost ${placeName}` }).click()
  await expect(row.locator('.influence-net-value')).toHaveText('+1')
  await expect(
    row.getByRole('button', { name: `Reduce ${placeName}` }),
  ).toHaveAttribute('title', `Refund boost on ${placeName}`)
  await expect(
    row.getByRole('button', { name: `Refund tokens for ${placeName}` }),
  ).toHaveAttribute('title', 'Refund tokens')
  await expect(
    row.getByRole('button', { name: `Refund tokens for ${placeName}` }),
  ).toBeVisible()
  await expect(page.locator('.balance')).toContainText('95')

  const walletAfterBoost = await request.get('/api/v1/wallet', {
    headers: { 'X-Participant-Id': memberId },
  })
  expect(walletAfterBoost.status()).toBe(200)
  expect(await walletAfterBoost.json()).toMatchObject({ balance: 95 })

  await row
    .getByRole('button', { name: `Refund tokens for ${placeName}` })
    .click()
  await expect(row.locator('.influence-net-value')).toHaveText('0')
  await expect(page.locator('.balance')).toContainText('100')
  const walletAfterUndo = await request.get('/api/v1/wallet', {
    headers: { 'X-Participant-Id': memberId },
  })
  expect(walletAfterUndo.status()).toBe(200)
  expect(await walletAfterUndo.json()).toMatchObject({ balance: 100 })
  await row.getByRole('button', { name: `Reduce ${placeName}` }).click()
  await expect(row.locator('.influence-net-value')).toHaveText('−1')
  await row.getByRole('button', { name: `Reduce ${placeName}` }).click()
  await expect(row.locator('.influence-net-value')).toHaveText('−2')
  await expect(page.locator('.balance')).toContainText('90')
  await row.getByRole('button', { name: `Boost ${placeName}` }).click()
  await expect(row.locator('.influence-net-value')).toHaveText('−1')

  await expect(page.locator('.balance')).toContainText('95')
  await row
    .getByRole('button', { name: `Refund tokens for ${placeName}` })
    .click()
  await expect(row.locator('.influence-net-value')).toHaveText('0')
  await expect(page.locator('.balance')).toContainText('100')
  for (let count = 0; count < 7; count += 1) {
    await row.getByRole('button', { name: `Boost ${placeName}` }).click()
  }
  const combinedBoost = page
    .locator('.token-activity-panel .ledger-row')
    .filter({ hasText: placeName })
    .filter({ hasText: 'Boosted' })
  await expect(combinedBoost.filter({ hasText: '-35 tokens' })).toHaveCount(1)
  await row
    .getByRole('button', { name: `Refund tokens for ${placeName}` })
    .click()
  await expect(row.locator('.influence-net-value')).toHaveText('0')
  await expect(page.locator('.balance')).toContainText('100')

  await row.getByRole('button', { name: `Boost ${placeName}` }).click()
  await expect(row.locator('.influence-net-value')).toHaveText('+1')
  await expect(page.locator('.balance')).toContainText('95')
  await page.route('**/api/v1/influence/current', async (route) => {
    const response = await route.fetch()
    const body = (await response.json()) as {
      window: Record<string, unknown>
      places: unknown[]
    }
    await route.fulfill({
      response,
      json: {
        ...body,
        window: {
          ...body.window,
          open: false,
          cutoffAt: '2000-01-01T00:00:00.000Z',
        },
      },
    })
  })
  await page.route('**/api/v1/bets/current', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    await route.fulfill({
      response,
      json: {
        ...body,
        window: {
          ...body.window,
          open: true,
          cutoffAt: new Date(Date.now() + 750).toISOString(),
        },
      },
    })
  })
  await page.reload()
  await expect(page.locator('.member-status')).toContainText(memberName)
  const lockedRow = page.locator('.odds-row').filter({ hasText: placeName })
  await expect(
    lockedRow.getByRole('group', { name: `Your position on ${placeName}` }),
  ).toHaveAttribute('title', 'Locked')
  await expect(
    lockedRow.getByRole('button', { name: `Boost ${placeName}` }),
  ).toBeDisabled()
  await expect(
    lockedRow.getByRole('button', { name: `Reduce ${placeName}` }),
  ).toBeDisabled()
  await expect(
    lockedRow.getByRole('button', { name: `Refund tokens for ${placeName}` }),
  ).toBeDisabled()
  await expect(
    lockedRow.getByRole('button', { name: new RegExp(`Banish ${placeName}`) }),
  ).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Add place' })).toBeEnabled()
  await expect(lockedRow.locator('.influence-net-value')).toHaveText('+1')
  await expect(page.locator('.balance')).toContainText('95')
  await expect(page.getByText(/^Betting for .* is closed\.$/)).toBeVisible()

  await page.emulateMedia({ colorScheme: 'light' })
  if ((await page.locator('html').getAttribute('data-theme')) === 'dark')
    await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.screenshot({
    path: 'test-results/influence-light-desktop.png',
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: 'test-results/influence-dark-mobile.png',
    fullPage: true,
  })
  await expect(page.locator('.member-status')).toContainText(memberName)
  expect(
    await page.evaluate(() =>
      localStorage.getItem('lunch-roller.participant-id'),
    ),
  ).toBe(memberId)
})

test('shows legacy current-spin boosts and reductions without making them refundable', async ({
  page,
  request,
}) => {
  const before = await game.currentInfluence(memberId)
  if (
    !before.places.some(
      (entry) =>
        entry.placeId === placeId &&
        entry.yourBoosts + entry.yourReductions > 0,
    )
  )
    await game.changeInfluence(
      memberId,
      {
        localDate: before.window.localDate,
        placeId,
        action: 'boost',
        change: 1,
      },
      randomUUID(),
    )
  const original = (await game.currentInfluence(memberId)).places.find(
    (entry) => entry.placeId === placeId,
  )!
  await database.db.insert(schema.tokenLedger).values(
    ['boost', 'boost', 'reduce'].map((kind) => ({
      participantId: memberId,
      placeId,
      kind: kind as 'boost' | 'reduce',
      delta: -5,
      idempotencyKey: randomUUID(),
      requestHash: 'historical-sidebar-fixture',
      createdAt: new Date(),
    })),
  )
  await page.addInitScript(
    (id) => localStorage.setItem('lunch-roller.participant-id', id),
    memberId,
  )
  await page.goto(appOrigin)
  const row = page.locator('.odds-row').filter({ hasText: placeName })
  await expect(
    row.getByLabel(`${original.boosts + 2} boosts`, { exact: true }),
  ).toBeVisible()
  await expect(
    row.getByLabel(`${original.reductions + 1} reductions`, { exact: true }),
  ).toBeVisible()
  await expect(row.locator('.team-count')).toHaveAttribute(
    'title',
    /2 historical boosts and 1 historical reductions/,
  )
  await page.reload()
  await expect(
    row.getByLabel(`${original.boosts + 2} boosts`, { exact: true }),
  ).toBeVisible()
  await row
    .getByRole('button', { name: `Refund tokens for ${placeName}` })
    .click()
  await expect(row.locator('.influence-net-value')).toHaveText('0')
  await expect(row.getByLabel('2 boosts', { exact: true })).toBeVisible()
  await expect(row.getByLabel('1 reductions', { exact: true })).toBeVisible()
  await expect(
    row.getByRole('button', { name: `Refund tokens for ${placeName}` }),
  ).toBeDisabled()
  const response = await request.get('/api/v1/influence/current', {
    headers: { 'X-Participant-Id': memberId },
  })
  expect(
    (await response.json()).places.find(
      (entry: { placeId: string }) => entry.placeId === placeId,
    ),
  ).toMatchObject({
    boosts: 2,
    reductions: 1,
    historicalBoosts: 2,
    historicalReductions: 1,
    yourBoosts: 0,
    yourReductions: 0,
  })
})
