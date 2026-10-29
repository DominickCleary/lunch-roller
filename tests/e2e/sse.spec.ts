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
const memberName = `LR-SSE-${suffix} Member`
const placeName = `LR-SSE-${suffix} Place`
let memberId = ''
let placeId = ''
let originalSettings: typeof schema.settings.$inferSelect | undefined

test.beforeAll(async () => {
  ;[originalSettings] = await database.db.select().from(schema.settings)
  const member = await game.saveParticipant({ name: memberName })
  const place = await game.savePlace({ name: placeName })
  memberId = member.id
  placeId = place.id
  await game.completeSetup()
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
  await game.correctTokens(
    {
      participantId: memberId,
      delta: 100,
      reason: 'fund browser SSE test',
    },
    randomUUID(),
  )
})

test.afterAll(async () => {
  try {
    if (memberId) {
      await database.client`DELETE FROM influence_lots WHERE participant_id = ${memberId}::uuid`
      await database.client`DELETE FROM token_ledger WHERE participant_id = ${memberId}::uuid`
      await database.client`DELETE FROM attendance WHERE participant_id = ${memberId}::uuid`
      await database.client`DELETE FROM participants WHERE id = ${memberId}::uuid`
    }
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

test('shared changes refresh another page over SSE and reconnect recovers a missed change', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.addInitScript((id) => {
    localStorage.setItem('lunch-roller.participant-id', id)
  }, memberId)
  const otherPage = await page.context().newPage()
  await otherPage.addInitScript((id) => {
    localStorage.setItem('lunch-roller.participant-id', id)
  }, memberId)
  const eventStreamReady = otherPage.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/events') && response.status() === 200,
  )
  await page.goto(appOrigin)
  await otherPage.goto(appOrigin)
  await eventStreamReady
  for (const currentPage of [page, otherPage]) {
    await expect(currentPage.locator('.member-status')).toContainText(
      memberName,
    )
    await expect(currentPage.locator('.balance')).toContainText('100')
  }

  const row = page.locator('.odds-row').filter({ hasText: placeName })
  const otherRow = otherPage.locator('.odds-row').filter({ hasText: placeName })
  const chanceLabel = otherRow.locator('strong[title*=" chance."]')
  const initialChance = await chanceLabel.getAttribute('title')
  const betForm = otherPage.locator('.bet-form')
  await betForm.getByLabel('Lunch place').selectOption(placeId)
  await betForm.getByLabel('Stake').fill('17')
  await row.getByRole('button', { name: `Boost ${placeName}` }).click()
  await expect(page.locator('.balance')).toContainText('95')
  await expect(otherPage.locator('.balance')).toContainText('95', {
    timeout: 10_000,
  })
  await expect
    .poll(() => chanceLabel.getAttribute('title'), {
      timeout: 10_000,
    })
    .not.toBe(initialChance)
  await expect(betForm.getByLabel('Lunch place')).toHaveValue(placeId)
  await expect(betForm.getByLabel('Stake')).toHaveValue('17')
  await expect(otherPage.locator('.member-status')).toContainText(memberName)
  expect(
    await otherPage.evaluate(() =>
      localStorage.getItem('lunch-roller.participant-id'),
    ),
  ).toBe(memberId)

  // Refund, then reload the other page with its stream blocked to simulate a
  // missed notification. Reconnection must fetch the persisted second change.
  await row
    .getByRole('button', { name: `Refund tokens for ${placeName}` })
    .click()
  await expect(page.locator('.balance')).toContainText('100')
  await expect(otherPage.locator('.balance')).toContainText('100', {
    timeout: 10_000,
  })
  await expect
    .poll(() => chanceLabel.getAttribute('title'), {
      timeout: 10_000,
    })
    .toBe(initialChance)
  await expect(betForm.getByLabel('Lunch place')).toHaveValue(placeId)
  await expect(betForm.getByLabel('Stake')).toHaveValue('17')

  // A listener startup failure returns an SSE response that ends after retry.
  // EventSource must reconnect even though the HTTP response succeeded.
  await otherPage.route('**/api/v1/events', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'retry: 3000\n\n',
    }),
  )
  const blockedStreamRequest = otherPage.waitForRequest((request) =>
    request.url().endsWith('/api/v1/events'),
  )
  await otherPage.reload()
  await blockedStreamRequest
  await expect(otherPage.locator('.balance')).toContainText('100')
  await row.getByRole('button', { name: `Boost ${placeName}` }).click()
  await expect(page.locator('.balance')).toContainText('95')
  await expect(otherPage.locator('.balance')).toContainText('100')

  await otherPage.unroute('**/api/v1/events')
  await expect(otherPage.locator('.balance')).toContainText('95', {
    timeout: 10_000,
  })
  await expect(otherPage.locator('.member-status')).toContainText(memberName)
  expect(
    await otherPage.evaluate(() =>
      localStorage.getItem('lunch-roller.participant-id'),
    ),
  ).toBe(memberId)
  await otherPage.close()
})
