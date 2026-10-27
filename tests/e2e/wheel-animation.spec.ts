import type { TodayResponse } from '@lunch/contracts'
import { expect, type Page, test } from '@playwright/test'

const epoch = Date.parse('2026-10-21T11:30:05.000Z')
const winnerId = '00000000-0000-4000-8000-000000000071'
const otherId = '00000000-0000-4000-8000-000000000072'
const plan = {
  version: 1 as const,
  rotation: 89.7,
  turns: 10,
  durationMs: 20000,
  startsAt: new Date(epoch - 1000).toISOString(),
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

async function prepare(
  page: Page,
  base: TodayResponse,
  participantId: string,
  wallSkew: number,
  lateBy = 0,
) {
  const localTime = epoch + wallSkew
  await page.clock.install({ time: new Date(localTime) })
  await page.clock.pauseAt(new Date(localTime + 1000))
  const initialPerformance = await page.evaluate(() => performance.now())
  let lastServerTime = epoch + lateBy
  await page.addInitScript(
    (id) => localStorage.setItem('lunch-roller.participant-id', id),
    participantId,
  )
  await page.route('**/api/v1/today', async (route) => {
    const elapsed =
      (await page.evaluate(() => performance.now())) - initialPerformance
    lastServerTime = Math.max(lastServerTime, epoch + lateBy + elapsed)
    await route.fulfill({
      json: {
        ...base,
        serverTime: new Date(lastServerTime).toISOString(),
        localDate: '2026-10-21',
        wheel: { mode: 'upcoming', localDate: '2026-10-22' },
        status: 'drawn',
        result: {
          id: '00000000-0000-4000-8000-000000000073',
          localDate: '2026-10-21',
          placeId: winnerId,
          placeName: 'Border winner',
          timezone: 'UTC',
          drawnAt: new Date(epoch - 4000).toISOString(),
          animation: plan,
          snapshot: [
            {
              placeId: winnerId,
              name: 'Border winner',
              probability: 0.5,
              logWeight: 0,
            },
            {
              placeId: otherId,
              name: 'Close runner-up',
              probability: 0.5,
              logWeight: 0,
            },
          ],
        },
      } satisfies TodayResponse,
    })
  })
  await page.goto('/')
  await expect(page.getByTestId('lunch-wheel')).toBeVisible()
  await page.clock.runFor(100)
}
const angle = (page: Page) =>
  page
    .getByTestId('lunch-wheel')
    .evaluate((element) => Number.parseFloat(element.style.transform.slice(7)))
const palette = ['#ba7868', '#cbb36f']
async function expectPointerColor(page: Page, rotation: number) {
  const sourceAngle = (((90 - (rotation % 360)) % 360) + 360) % 360
  const expected = palette[sourceAngle < 180 ? 0 : 1]
  const rgb = expected
    .slice(1)
    .match(/.{2}/g)!
    .map((part) => Number.parseInt(part, 16))
    .join(', ')
  await expect(page.locator('.pointer')).toHaveCSS('color', `rgb(${rgb})`)
}

test('shares the live phase across skewed clocks, late entry and reload, then replays the same near-border finish', async ({
  browser,
  request,
}) => {
  const base = (await (
    await request.get('/api/v1/today')
  ).json()) as TodayResponse
  const { participants } = await (
    await request.get('/api/v1/participants')
  ).json()
  const participantId = participants[0].id as string
  const walletBefore = await (
    await request.get('/api/v1/wallet', {
      headers: { 'X-Participant-Id': participantId },
    })
  ).json()
  const first = await browser.newPage({
    baseURL: process.env.APP_ORIGIN ?? 'http://localhost:3000',
  })
  const second = await browser.newPage({
    baseURL: process.env.APP_ORIGIN ?? 'http://localhost:3000',
  })
  try {
    await prepare(first, base, participantId, 3600000)
    await expect(first.getByTestId('lunch-wheel')).toHaveAttribute(
      'data-spin-phase',
      'live',
    )
    await expect(first.getByTestId('wheel-target')).not.toContainText(
      'Border winner',
    )
    await expect(first.getByTestId('today-result')).toHaveCount(0)
    await first.clock.fastForward(6000)
    await prepare(second, base, participantId, -7200000, 6000)
    await expect(second.getByTestId('lunch-wheel')).toHaveAttribute(
      'data-spin-phase',
      'live',
    )
    expect(Math.abs((await angle(first)) - (await angle(second)))).toBeLessThan(
      6,
    )
    expect(await angle(first)).toBeGreaterThan(2000)
    await expectPointerColor(first, await angle(first))
    await second.reload()
    await expect(second.getByTestId('lunch-wheel')).toBeVisible()
    await second.clock.runFor(100)
    await expect(second.getByTestId('lunch-wheel')).toHaveAttribute(
      'data-spin-phase',
      'live',
    )
    expect(await angle(second)).toBeGreaterThan(2000)
    await first.clock.fastForward(25000)
    await second.clock.fastForward(25000)
    for (const page of [first, second]) {
      await expect(page.getByTestId('lunch-wheel')).toHaveAttribute(
        'data-spin-phase',
        'settled',
      )
      expect(await angle(page)).toBeCloseTo(plan.rotation, 4)
      await expectPointerColor(page, plan.rotation)
      const celebration = page.getByRole('dialog', {
        name: 'The Wheel has spoken',
      })
      await expect(celebration).toBeVisible()
      await expect(celebration).toContainText('Border winner')
      await celebration
        .getByRole('button', { name: 'Praise the Wheel' })
        .click()
      await expect(page.getByTestId('wheel-target')).toContainText(
        'Scheduled for',
      )
      await expect(page.getByTestId('today-result')).toHaveCount(0)
      await page.getByRole('button', { name: "Replay today's result" }).click()
      await page.clock.runFor(100)
      await expect(page.getByTestId('lunch-wheel')).toHaveAttribute(
        'data-spin-phase',
        'replay',
      )
      // Canonical replay starts from zero, not from this browser's previous orientation.
      expect(await angle(page)).toBeLessThan(100)
      await expectPointerColor(page, await angle(page))
      await page.clock.fastForward(25000)
      expect(await angle(page)).toBeCloseTo(plan.rotation, 4)
      await expectPointerColor(page, plan.rotation)
      await expect(celebration).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(celebration).toHaveCount(0)
    }
    const walletAfter = await (
      await request.get('/api/v1/wallet', {
        headers: { 'X-Participant-Id': participantId },
      })
    ).json()
    expect(walletAfter).toEqual(walletBefore)
  } finally {
    await first.close()
    await second.close()
  }
})

test('reduced motion skips rotation and finishes on the same saved point', async ({
  page,
  request,
}) => {
  const base = (await (
    await request.get('/api/v1/today')
  ).json()) as TodayResponse
  const { participants } = await (
    await request.get('/api/v1/participants')
  ).json()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await prepare(page, base, participants[0].id, 3600000)
  await expect(page.getByTestId('lunch-wheel')).toHaveAttribute(
    'data-spin-phase',
    'settled',
  )
  expect(await angle(page)).toBeCloseTo(plan.rotation, 4)
  await expectPointerColor(page, plan.rotation)
  const celebration = page.getByRole('dialog', {
    name: 'The Wheel has spoken',
  })
  await expect(celebration).toBeVisible()
  await expect(page.locator('.winner-confetti')).toBeHidden()
  await celebration.getByRole('button', { name: 'Praise the Wheel' }).click()
  await page.getByRole('button', { name: "Replay today's result" }).click()
  await page.clock.runFor(100)
  expect(await angle(page)).toBeCloseTo(plan.rotation, 4)
  await expectPointerColor(page, plan.rotation)
  await page.clock.fastForward(1500)
  await expect(page.getByTestId('lunch-wheel')).toHaveAttribute(
    'data-spin-phase',
    'settled',
  )
})

test('keeps narrow slice names visible as their odds shrink on desktop and mobile', async ({
  page,
  request,
}) => {
  const base = (await (
    await request.get('/api/v1/today')
  ).json()) as TodayResponse
  const { participants } = await (
    await request.get('/api/v1/participants')
  ).json()
  const places = base.odds.slice(0, 3)
  expect(places).toHaveLength(3)
  let probabilities = [0.5, 0.46, 0.04]
  await page.addInitScript(
    (id) => localStorage.setItem('lunch-roller.participant-id', id),
    participants[0].id,
  )
  await page.route('**/api/v1/today', (route) =>
    route.fulfill({
      json: {
        ...base,
        status: 'pending',
        result: null,
        odds: places.map((place, index) => ({
          ...place,
          probability: probabilities[index],
        })),
      },
    }),
  )
  await page.goto('/')
  const labels = page.getByTestId('lunch-wheel').locator('.wheel-label')
  await expect(labels).toHaveCount(3)
  const narrowLabel = labels.nth(2)
  await expect(narrowLabel).toBeVisible()
  await expect(narrowLabel).toHaveAttribute('title', places[2]!.name)

  probabilities = [0.949999, 0.05, 0.000001]
  await page.reload()
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 })
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await expect(labels).toHaveCount(3)
      await expect(narrowLabel).toBeVisible()
      await expect(narrowLabel).not.toBeEmpty()
      expect(
        await narrowLabel.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).fontSize),
        ),
      ).toBeGreaterThanOrEqual(10)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    }
  }
})
