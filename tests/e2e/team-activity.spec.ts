import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { createDatabase, GameService } from '../../packages/db/src/index'

const database = createDatabase(process.env.TEST_DATABASE_URL!)
const game = new GameService(database)
const prefix = `LR-ACTIVITY-${randomUUID().slice(0, 8)}`
let viewerId = ''
let fundedId = ''
let emptyId = ''
const viewerName = `${prefix} Viewer`
const fundedName = `${prefix} Funded`
const emptyName = `${prefix} Empty`

test.beforeAll(async () => {
  viewerId = (await game.saveParticipant({ name: viewerName })).id
  fundedId = (await game.saveParticipant({ name: fundedName })).id
  emptyId = (await game.saveParticipant({ name: emptyName })).id
  await game.correctTokens(
    { participantId: viewerId, delta: 11, reason: 'Viewer balance' },
    randomUUID(),
  )
  for (const [index, delta] of [3, 4, 5, 6, 7, -2].entries())
    await game.correctTokens(
      { participantId: fundedId, delta, reason: `Team fixture ${index}` },
      randomUUID(),
    )
})

test.afterAll(async () => {
  try {
    const ids = [viewerId, fundedId, emptyId].filter(Boolean)
    if (ids.length) {
      await database.client`DELETE FROM token_ledger WHERE participant_id IN ${database.client(ids)}`
      await database.client`DELETE FROM participants WHERE id IN ${database.client(ids)}`
    }
  } finally {
    await database.close()
  }
})

test('views team balances and history without changing identity or wallets', async ({
  page,
}) => {
  const viewerBefore = await game.wallet(viewerId)
  const fundedBefore = await game.wallet(fundedId)
  await page.route('**/api/v1/wallet', async (route) => {
    if (route.request().headers()['x-participant-id'] !== fundedId)
      return route.continue()
    const response = await route.fetch()
    const wallet = (await response.json()) as Record<string, unknown>
    const ledger = wallet.ledger as Array<Record<string, unknown>>
    // A UI fixture for a same-stake place-only edit: the wallet exposes the
    // final selected restaurant, while no extra stake delta is created.
    ledger[1] = {
      ...ledger[1],
      kind: 'boost',
      reason: 'Boosted the wheel before lunch',
      placeId: '00000000-0000-4000-8000-000000000011',
      placeName: 'Cafe North',
    }
    wallet.bets = [
      {
        id: '00000000-0000-4000-8000-000000000099',
        localDate: '2026-10-22',
        placeId: '00000000-0000-4000-8000-000000000012',
        placeName: 'Cafe South',
        stake: 7,
        status: 'open',
        payout: null,
        probability: 0.5,
        updatedAt: new Date().toISOString(),
        settledAt: null,
      },
    ]
    await route.fulfill({ response, json: wallet })
  })
  await page.goto('/')
  await page.getByLabel('Your name').selectOption({ label: viewerName })
  await page.getByRole('button', { name: 'Enter lunch wheel' }).click()
  await expect(page.locator('.member-status')).toContainText(viewerName)
  const mutations: string[] = []
  const reads: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET') mutations.push(request.url())
    if (request.url().endsWith('/api/v1/wallet'))
      reads.push(request.headers()['x-participant-id'] ?? '')
  })
  await page.getByText('Team token activity', { exact: true }).click()
  const picker = page.getByLabel('View activity for')
  await expect(picker.locator('option')).not.toContainText([viewerName])
  await picker.selectOption(fundedId)
  const activity = page.getByRole('region', {
    name: `${fundedName}'s token activity`,
  })
  await expect(activity.locator('.team-balance')).toHaveText('23 tokens')
  await expect(activity.locator('.team-activity-entry')).toHaveCount(5)
  await page.getByRole('button', { name: 'Show all activity' }).click()
  await expect(activity.locator('.team-activity-entry')).toHaveCount(6)
  await expect(activity).toContainText('-2 tokens')
  await expect(activity).toContainText('Admin correction')
  await expect(activity).toContainText('Team fixture 0')
  await expect(activity).toContainText('Boosted')
  await expect(activity).toContainText('Cafe North')
  await expect(
    activity.getByRole('region', { name: 'Restaurant bets' }),
  ).toContainText('Cafe South')
  await expect(
    activity.getByRole('region', { name: 'Restaurant bets' }),
  ).toContainText('7 tokens staked')
  await expect(
    activity.getByRole('region', { name: 'Restaurant bets' }),
  ).toContainText('Open')
  await expect(activity.locator('time').first()).toHaveAttribute(
    'datetime',
    /T.*Z$/,
  )
  await expect(page.locator('.member-status')).toContainText(viewerName)
  await expect(page.locator('.balance')).toContainText('11')
  expect(
    await page.evaluate(() =>
      localStorage.getItem('lunch-roller.participant-id'),
    ),
  ).toBe(viewerId)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: 'test-results/team-activity-dark-mobile.png',
    fullPage: true,
  })
  await picker.selectOption(emptyId)
  const empty = page.getByRole('region', {
    name: `${emptyName}'s token activity`,
  })
  await expect(empty).toContainText('No token activity yet.')
  await expect(empty.locator('.team-balance')).toHaveText('0 tokens')
  await expect(activity).toHaveCount(0)
  expect(reads).toContain(fundedId)
  expect(reads).toContain(emptyId)
  expect(mutations).toEqual([])
  expect(await game.wallet(viewerId)).toEqual(viewerBefore)
  expect(await game.wallet(fundedId)).toEqual(fundedBefore)
})

test('handles failed reads, retry and stale selection without switching identity', async ({
  page,
}) => {
  await page.addLocatorHandler(
    page.getByRole('button', { name: 'Praise the Wheel', exact: true }),
    async (button) => {
      await button.click()
    },
  )
  await page.addInitScript(
    (id) => localStorage.setItem('lunch-roller.participant-id', id),
    viewerId,
  )
  let fail = true
  let release: (() => void) | undefined
  let delay = false
  await page.route('**/api/v1/wallet', async (route) => {
    if (route.request().headers()['x-participant-id'] !== fundedId)
      return route.continue()
    if (fail)
      return route.fulfill({
        status: 503,
        json: { error: { message: 'Unavailable' } },
      })
    if (delay)
      await new Promise<void>((resolve) => {
        release = resolve
      })
    try {
      await route.continue()
    } catch {
      /* Request can be cancelled by changing target. */
    }
  })
  await page.goto('/')
  await page.getByText('Team token activity', { exact: true }).click()
  const picker = page.getByLabel('View activity for')
  await picker.selectOption(fundedId)
  await expect(page.locator('.team-activity').getByRole('alert')).toContainText(
    'Could not load token activity',
  )
  fail = false
  await page.getByRole('button', { name: 'Retry activity' }).click()
  await expect(page.locator('.team-balance')).toHaveText('23 tokens')
  await picker.selectOption(emptyId)
  await expect(page.locator('.team-balance')).toHaveText('0 tokens')
  delay = true
  await picker.selectOption(fundedId)
  await expect(page.getByText('Loading token activity…')).toBeVisible()
  await expect.poll(() => Boolean(release)).toBe(true)
  await picker.selectOption(emptyId)
  release?.()
  await expect(page.locator('.team-balance')).toHaveText('0 tokens')
  await expect(
    page.getByRole('region', { name: `${fundedName}'s token activity` }),
  ).toHaveCount(0)
  await page.getByText('Team token activity', { exact: true }).click()
  await expect(picker).toHaveCount(0)
  expect(
    await page.evaluate(() =>
      localStorage.getItem('lunch-roller.participant-id'),
    ),
  ).toBe(viewerId)
})
