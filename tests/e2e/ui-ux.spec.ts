import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { createDatabase, GameService } from '../../packages/db/src/index'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!testDatabaseUrl)
  throw new Error('A disposable TEST_DATABASE_URL is required.')
const database = createDatabase(testDatabaseUrl)
const game = new GameService(database)
const suffix = randomUUID().slice(0, 8)
const memberName = `UX member ${suffix}`
const recipientName = `UX recipient ${suffix}`
let memberId = ''
let recipientId = ''

test.beforeAll(async () => {
  memberId = (await game.saveParticipant({ name: memberName })).id
  recipientId = (await game.saveParticipant({ name: recipientName })).id
  await game.correctTokens(
    { participantId: memberId, delta: 25, reason: 'UI review fixture' },
    randomUUID(),
  )
})

test.afterAll(async () => {
  try {
    await database.client`DELETE FROM token_ledger WHERE participant_id IN (${memberId}::uuid, ${recipientId}::uuid)`
    await database.client`DELETE FROM participants WHERE id IN (${memberId}::uuid, ${recipientId}::uuid)`
  } finally {
    await database.close()
  }
})

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(
    (id) => localStorage.setItem('lunch-roller.participant-id', id),
    memberId,
  )
})

test('navigation stays readable across screen sizes, supports keyboard tabs and explains identity', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('.member-status')).toContainText(memberName)
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const header = page.locator('.topbar')
    const controls = [
      header.locator('.brand'),
      header.getByRole('navigation'),
      header.getByRole('button', { name: 'Change name', exact: true }),
      header.getByRole('button', { name: 'Admin', exact: true }),
      header.getByRole('button', { name: 'Help', exact: true }),
    ]
    const bounds = await Promise.all(
      controls.map((control) => control.boundingBox()),
    )
    for (const box of bounds) {
      if (!box) throw new Error('Header control must be visible.')
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
    }
    for (let left = 0; left < bounds.length; left++) {
      for (let right = left + 1; right < bounds.length; right++) {
        const a = bounds[left]
        const b = bounds[right]
        if (!a || !b) throw new Error('Header controls must be visible.')
        const overlap =
          Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) &&
          Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y)
        expect(overlap, `header controls overlap at ${width}px`).toBe(false)
      }
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
  }
  const wheelTab = page.getByRole('tab', { name: 'The wheel', exact: true })
  await wheelTab.focus()
  await page.keyboard.press('ArrowRight')
  await expect(
    page.getByRole('tab', { name: 'Activity', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('End')
  await expect(
    page.getByRole('tab', { name: 'Token standings', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('tabpanel', { name: 'Token standings', exact: true }),
  ).toBeFocused()
  await page.getByRole('button', { name: 'Change name', exact: true }).click()
  await expect(page.getByTestId('name-picker')).toContainText(
    'This browser remembers your choice',
  )
  await page.getByLabel('Your name', { exact: true }).selectOption(memberId)
  await page.getByRole('button', { name: 'Enter lunch wheel' }).click()
  await page.getByRole('button', { name: 'Dismiss message' }).click()
  await expect(page.locator('.announcement')).toBeEmpty()
  await page.reload()
  await expect(page.locator('.member-status')).toContainText(memberName)
  await page.getByRole('button', { name: 'Admin', exact: true }).click()
  await expect(page.getByLabel('Administrator password')).toBeFocused()
  await page
    .getByLabel('Administrator password')
    .fill(process.env.ADMIN_PASSWORD ?? 'integration-only-password')
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await page
    .getByRole('navigation', { name: 'Admin sections' })
    .getByRole('link', { name: 'Tokens and odds' })
    .click()
  await expect(page.getByTestId('admin-economy')).toBeFocused()
  await expect(page.getByTestId('admin-economy')).toBeInViewport()
})

test('trade confirmation blocks background interaction and preserves the review after failure', async ({
  page,
}) => {
  await page.goto('/')
  const transfer = page.locator('.token-transfer')
  await transfer.getByText('Trade tokens', { exact: true }).click()
  await transfer
    .getByLabel('Recipient', { exact: true })
    .selectOption(recipientId)
  await transfer.getByLabel('Tokens to trade').fill('7')
  await transfer.getByRole('button', { name: 'Review trade' }).click()
  const dialog = page.getByRole('dialog', { name: 'Confirm trade' })
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate((element) => element.matches(':modal'))).toBe(
    true,
  )
  await expect(dialog.getByRole('button', { name: 'Edit trade' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Edit trade' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(transfer.getByLabel('Recipient', { exact: true })).toBeFocused()
  await transfer.getByRole('button', { name: 'Review trade' }).click()
  await page.route('**/api/v1/transfers', (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          code: 'UNAVAILABLE',
          message: 'Trade unavailable. Please retry.',
        },
      },
    }),
  )
  await dialog
    .getByRole('button', { name: 'Confirm trade', exact: true })
    .click()
  await expect(dialog.getByRole('alert')).toContainText(
    'The trade could not be confirmed. Please try again.',
  )
  await expect(dialog).toBeVisible()
  expect((await game.wallet(memberId)).balance).toBe(25)
  await page.unroute('**/api/v1/transfers')
  await dialog
    .getByRole('button', { name: 'Confirm trade', exact: true })
    .click()
  await expect(dialog).toBeHidden()
  await expect(transfer.getByRole('status')).toContainText(
    `Traded 7 tokens to ${recipientName}.`,
  )
  await page.reload()
  await expect(page.locator('.balance')).toContainText('18')
  expect((await game.wallet(recipientId)).balance).toBe(7)
})

for (const oldWalletFails of [false, true]) {
  test(`ignores a previous name's delayed wallet ${oldWalletFails ? 'error' : 'snapshot'}`, async ({
    page,
    request,
  }) => {
    const recipientWallet = await request.get('/api/v1/wallet', {
      headers: { 'X-Participant-Id': recipientId },
    })
    const expectedBalance = (await recipientWallet.json()).balance as number
    await page.goto('/')
    await expect(page.locator('.member-status')).toContainText(memberName)
    const captured = Promise.withResolvers<void>()
    const releaseOld = Promise.withResolvers<void>()
    const releaseLater = Promise.withResolvers<void>()
    let heldOldWallet = false
    let blockLaterWallets = false
    try {
      await page.route('**/api/v1/wallet', async (route) => {
        if (
          !heldOldWallet &&
          route.request().headers()['x-participant-id'] === memberId
        ) {
          heldOldWallet = true
          const response = await route.fetch()
          captured.resolve()
          await releaseOld.promise
          if (oldWalletFails) {
            await route.fulfill({
              status: 403,
              headers: { 'x-test-delayed-wallet': 'true' },
              json: {
                error: {
                  code: 'PARTICIPANT_INACTIVE',
                  message: 'This participant is inactive.',
                },
              },
            })
          } else {
            await route.fulfill({
              response,
              headers: {
                ...response.headers(),
                'x-test-delayed-wallet': 'true',
              },
            })
          }
        } else {
          if (blockLaterWallets) await releaseLater.promise
          await route.continue()
        }
      })
      await page.evaluate(() =>
        document.dispatchEvent(new Event('visibilitychange')),
      )
      await captured.promise
      await page
        .getByRole('button', { name: 'Change name', exact: true })
        .click()
      await page
        .getByLabel('Your name', { exact: true })
        .selectOption(recipientId)
      await page.getByRole('button', { name: 'Enter lunch wheel' }).click()
      await expect(page.locator('.member-status')).toContainText(recipientName)
      await expect(page.locator('.balance')).toContainText(
        String(expectedBalance),
      )
      blockLaterWallets = true
      const oldResponse = page.waitForResponse(
        (response) => response.headers()['x-test-delayed-wallet'] === 'true',
      )
      releaseOld.resolve()
      await (await oldResponse).finished()
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      )
      await expect(page.locator('.member-status')).toContainText(recipientName)
      await expect(page.locator('.balance')).toContainText(
        String(expectedBalance),
      )
      await expect(page.getByTestId('name-picker')).toBeHidden()
      expect(
        await page.evaluate(() =>
          localStorage.getItem('lunch-roller.participant-id'),
        ),
      ).toBe(recipientId)
    } finally {
      releaseOld.resolve()
      releaseLater.resolve()
      await page.unrouteAll({ behavior: 'wait' })
    }
  })
}
