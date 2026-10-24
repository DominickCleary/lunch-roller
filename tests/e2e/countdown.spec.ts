import type { TodayResponse } from '@lunch/contracts'
import { expect, test } from '@playwright/test'
import { scheduledInstant } from '../../packages/domain/src/index'

test('shows the active countdown in the sidebar and switches at the saved cutoff', async ({
	page,
	request,
}) => {
	const base = (await (
		await request.get('/api/v1/today')
	).json()) as TodayResponse
	const roster = await (await request.get('/api/v1/participants')).json()
	const participantId = roster.participants[0].id as string
	const headers = { 'X-Participant-Id': participantId }
	const bets = await (
		await request.get('/api/v1/bets/current', { headers })
	).json()
	const influence = await (
		await request.get('/api/v1/influence/current', { headers })
	).json()
	const localDate = base.wheel.localDate
	const drawAt = scheduledInstant(
		localDate,
		base.schedule.time,
		base.schedule.timezone,
	).getTime()
	const cutoffAt = drawAt - 10 * 60_000
	const initialServerTime = cutoffAt - 60_000

	await page.clock.install({ time: new Date(initialServerTime) })
	await page.clock.pauseAt(new Date(initialServerTime))
	await page.addInitScript(
		(id) => localStorage.setItem('lunch-roller.participant-id', id),
		participantId,
	)
	await page.route('**/api/v1/today', async (route) => {
		const elapsed = await page.evaluate(() => performance.now())
		return route.fulfill({
			json: {
				...base,
				serverTime: new Date(initialServerTime + elapsed).toISOString(),
				preferences: { ...base.preferences, bettingCloseMinutes: 10 },
				status: 'pending',
				result: null,
				wheel: { mode: 'upcoming', localDate },
			} satisfies TodayResponse,
		})
	})
	for (const [path, body] of [
		['bets/current', bets],
		['influence/current', influence],
	] as const) {
		await page.route(`**/api/v1/${path}`, (route) =>
			route.fulfill({
				json: {
					...body,
					window: {
						...body.window,
						localDate,
						timezone: base.schedule.timezone,
						drawTime: base.schedule.time,
						cutoffMinutes: 10,
						cutoffAt: new Date(cutoffAt).toISOString(),
						cutoffLocalDate: localDate,
						cutoffLocalTime: '11:20',
						open: true,
					},
				},
			}),
		)
	}

	await page.goto('/')
	const cutoff = page.getByTestId('bet-cutoff-countdown')
	const spin = page.getByTestId('spin-countdown')
	await expect(page.getByTestId('countdown-banner')).toBeVisible()
	const bannerBounds = await page.getByTestId('countdown-banner').boundingBox()
	const wheelBounds = await page.locator('.hero').boundingBox()
	expect(bannerBounds).not.toBeNull()
	expect(wheelBounds).not.toBeNull()
	expect(bannerBounds!.x).toBeGreaterThan(
		wheelBounds!.x + wheelBounds!.width - 1,
	)
	await expect(cutoff).toHaveText('00:01:00')
	await expect(spin).toHaveCount(0)
	await expect(page.getByText('BETS CLOSE IN')).toBeVisible()

	await page.clock.fastForward(2_000)
	await expect(cutoff).toHaveText('00:00:58')
	await expect(spin).toHaveCount(0)

	await page.clock.fastForward(58_000)
	await expect(cutoff).toHaveCount(0)
	await expect(spin).toHaveText('00:10:00')
	await expect(page.getByText('SPIN STARTS IN')).toBeVisible()

	await page.setViewportSize({ width: 375, height: 812 })
	await expect(page.getByTestId('countdown-banner')).toBeVisible()
	const hasHorizontalOverflow = await page.evaluate(
		() => document.documentElement.scrollWidth > window.innerWidth,
	)
	expect(hasHorizontalOverflow).toBe(false)
})
