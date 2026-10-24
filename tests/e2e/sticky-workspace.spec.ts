import { expect, test } from '@playwright/test'

const adminPassword = process.env.ADMIN_PASSWORD ?? 'integration-only-password'

test.beforeEach(async ({ page, request }) => {
	const response = await request.get('/api/v1/participants')
	const { participants } = await response.json()
	await page.addInitScript(
		(id) => localStorage.setItem('lunch-roller.participant-id', id),
		participants[0].id,
	)
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.addLocatorHandler(
		page.getByRole('button', { name: 'Praise the Wheel', exact: true }),
		async (button) => {
			await button.click()
		},
	)
})

test('desktop sidebar scroll stays separate from the wheel and page footer', async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 760 })
	await page.goto('/')

	const sidebar = page.locator('.play-grid')
	const wheel = page.locator('.wheel-wrap')
	const footer = page.locator('.footer')
	const header = page.locator('.topbar')

	await expect(wheel).toBeVisible()
	await expect
		.poll(() =>
			sidebar.evaluate(
				(element) => element.scrollHeight > element.clientHeight,
			),
		)
		.toBe(true)
	await expect(header).toHaveCSS('position', 'static')
	await expect(sidebar.locator('.footer, .admin-disclosure')).toHaveCount(0)

	const wheelBefore = await wheel.boundingBox()
	const footerBefore = await footer.boundingBox()
	const initialPageScroll = await page.evaluate(() => window.scrollY)
	expect(footerBefore!.y + footerBefore!.height).toBeLessThanOrEqual(760)

	await sidebar.hover()
	await page.mouse.wheel(0, 5000)
	await expect
		.poll(() => sidebar.evaluate((element) => element.scrollTop))
		.toBeGreaterThan(0)
	await expect
		.poll(() =>
			sidebar.evaluate(
				(element) =>
					element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
			),
		)
		.toBe(true)

	const sidebarMetrics = await sidebar.evaluate((element) => {
		const rect = element.getBoundingClientRect()
		const style = getComputedStyle(element)
		const lastPlaceControls = element.querySelector(
			'.odds-row:last-child .influence-position-buttons',
		)
		const controlsRect = lastPlaceControls?.getBoundingClientRect()
		const clientRight = rect.left + element.clientLeft + element.clientWidth
		return {
			clientRight,
			controlsRight: controlsRect?.right ?? null,
			paddingRight: Number.parseFloat(style.paddingRight),
		}
	})
	expect(sidebarMetrics.paddingRight).toBeGreaterThanOrEqual(12)
	expect(sidebarMetrics.controlsRight).not.toBeNull()
	expect(
		sidebarMetrics.clientRight - sidebarMetrics.controlsRight!,
	).toBeGreaterThanOrEqual(8)

	const lastControl = sidebar
		.locator(
			'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary',
		)
		.last()
	await lastControl.focus()
	await expect(lastControl).toBeFocused()
	await expect
		.poll(() => page.evaluate(() => window.scrollY))
		.toBe(initialPageScroll)

	const wheelAtBottom = await wheel.boundingBox()
	const footerAtBottom = await footer.boundingBox()
	for (let attempt = 0; attempt < 3; attempt += 1) {
		await page.mouse.wheel(0, 900)
	}
	await expect
		.poll(() => page.evaluate(() => window.scrollY))
		.toBe(initialPageScroll)
	expect((await wheel.boundingBox())!.y).toBeCloseTo(wheelAtBottom!.y, 0)
	expect((await footer.boundingBox())!.y).toBeCloseTo(footerAtBottom!.y, 0)
	expect((await wheel.boundingBox())!.y).toBeCloseTo(wheelBefore!.y, 0)
	expect((await footer.boundingBox())!.y).toBeCloseTo(footerBefore!.y, 0)

	await page.screenshot({ path: 'test-results/sticky-sidebar-desktop.png' })
})

test('desktop activity and admin scroll independently without moving the wheel or sidebar', async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 760 })
	await page.goto('/')

	const activityTab = page.getByRole('tab', { name: 'Activity' })
	await activityTab.click()
	const activity = page.getByRole('tabpanel', { name: 'Activity' })
	await expect(
		activity.getByRole('heading', { name: /Activity for spin dated/ }),
	).toBeVisible()
	await expect(activity.locator('.activity-summary')).toBeVisible()

	const scrollHostSelector = await activity.evaluate((panel) => {
		let current: HTMLElement | null = panel
		while (current) {
			const style = getComputedStyle(current)
			if (
				current.scrollHeight > current.clientHeight + 1 &&
				['auto', 'scroll'].includes(style.overflowY)
			)
				return current.id
					? `#${current.id}`
					: `.${Array.from(current.classList).join('.')}`
			current = current.parentElement
		}
		return null
	})
	expect(scrollHostSelector).not.toBeNull()
	const scrollHost = page.locator(scrollHostSelector!)

	const pageScrollBeforeActivity = await page.evaluate(() => window.scrollY)
	await activity.hover()
	await page.mouse.wheel(0, 1500)
	await expect
		.poll(() => scrollHost!.evaluate((element) => element.scrollTop))
		.toBeGreaterThan(0)
	await expect
		.poll(() => page.evaluate(() => window.scrollY))
		.toBe(pageScrollBeforeActivity)

	await page.getByRole('tab', { name: 'Wheel' }).click()
	const sidebar = page.locator('.play-grid')
	await sidebar.evaluate((element) => {
		element.scrollTop = Math.min(
			120,
			element.scrollHeight - element.clientHeight,
		)
	})
	const sidebarScrollBeforeAdmin = await sidebar.evaluate(
		(element) => element.scrollTop,
	)
	let pageScrollBeforeAdmin = await page.evaluate(() => window.scrollY)
	const wheelBeforeAdmin = await page.locator('.wheel-wrap').boundingBox()
	await page.getByRole('button', { name: 'Admin', exact: true }).click()
	await expect(page.locator('.admin-disclosure')).toHaveAttribute('open', '')
	await expect(page.getByLabel('Administrator password')).toBeVisible()
	await expect
		.poll(() => page.evaluate(() => window.scrollY))
		.toBe(pageScrollBeforeAdmin)
	await expect
		.poll(() => sidebar.evaluate((element) => element.scrollTop))
		.toBe(sidebarScrollBeforeAdmin)
	await expect(page.locator('.wheel-wrap')).toBeVisible()
	await expect(page.locator('.topbar')).toHaveCSS('position', 'static')
	await page.getByLabel('Administrator password').fill(adminPassword)
	await page.getByRole('button', { name: 'Unlock', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'People' })).toBeVisible()
	pageScrollBeforeAdmin = await page.evaluate(() => window.scrollY)
	const admin = page.locator('.admin-disclosure')
	await expect
		.poll(() =>
			admin.evaluate((element) => element.scrollHeight > element.clientHeight),
		)
		.toBe(true)
	await admin.hover()
	pageScrollBeforeAdmin = await page.evaluate(() => window.scrollY)
	await page.mouse.wheel(0, 900)
	await expect
		.poll(() => admin.evaluate((element) => element.scrollTop))
		.toBeGreaterThan(0)
	expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBeforeAdmin)
	expect(await sidebar.evaluate((element) => element.scrollTop)).toBe(
		sidebarScrollBeforeAdmin,
	)
	expect((await page.locator('.wheel-wrap').boundingBox())!.y).toBeLessThan(
		wheelBeforeAdmin!.y + wheelBeforeAdmin!.height,
	)

	const oddsToggle = page.locator('.odds-format-toggle')
	await oddsToggle.getByRole('button', { name: 'Odds', exact: true }).click()
	await expect(
		oddsToggle.getByRole('button', { name: 'Odds', exact: true }),
	).toHaveAttribute('aria-pressed', 'true')
})

test('mobile scrolls the document with a compact sticky wheel and accessible controls', async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto('/')

	const wheel = page.locator('.wheel-wrap')
	const hero = page.locator('.hero-wheel')
	const header = page.locator('.topbar')
	await expect(wheel).toBeVisible()
	await expect(header).toHaveCSS('position', 'static')

	await page.evaluate(() => window.scrollTo(0, 450))
	await expect
		.poll(() => page.evaluate(() => window.scrollY))
		.toBeGreaterThan(0)
	await expect
		.poll(() =>
			header.evaluate((element) => element.getBoundingClientRect().bottom),
		)
		.toBeLessThanOrEqual(0)
	await expect
		.poll(() => hero.evaluate((element) => element.getBoundingClientRect().top))
		.toBeCloseTo(0, 0)
	const wheelBounds = await wheel.boundingBox()
	expect(wheelBounds!.y).toBeGreaterThanOrEqual(0)
	expect(wheelBounds!.y + wheelBounds!.height).toBeLessThanOrEqual(844)

	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true)

	await page.getByRole('button', { name: 'Odds', exact: true }).click()
	await expect(
		page.getByRole('button', { name: 'Odds', exact: true }),
	).toHaveAttribute('aria-pressed', 'true')
	await page.getByText('Team token activity', { exact: true }).click()
	await expect(page.getByLabel('View activity for')).toBeVisible()

	await page.getByRole('tab', { name: 'Wheel' }).click()
	await page.evaluate(() => window.scrollTo(0, 0))
	let pageScrollBeforeAdmin = await page.evaluate(() => window.scrollY)
	await page.getByRole('button', { name: 'Admin', exact: true }).click()
	await expect(page.locator('.admin-disclosure')).toHaveAttribute('open', '')
	expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBeforeAdmin)
	await expect(wheel).toBeVisible()
	await page.getByLabel('Administrator password').fill(adminPassword)
	await page.getByRole('button', { name: 'Unlock', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'People' })).toBeVisible()
	pageScrollBeforeAdmin = await page.evaluate(() => window.scrollY)
	const admin = page.locator('.admin-disclosure')
	await expect
		.poll(() =>
			admin.evaluate((element) => element.scrollHeight > element.clientHeight),
		)
		.toBe(true)
	await admin.hover()
	pageScrollBeforeAdmin = await page.evaluate(() => window.scrollY)
	await page.mouse.wheel(0, 700)
	await expect
		.poll(() => admin.evaluate((element) => element.scrollTop))
		.toBeGreaterThan(0)
	expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBeforeAdmin)

	await page.getByRole('tab', { name: 'Activity' }).click()
	await expect(
		page.getByRole('heading', { name: /Activity for spin dated/ }),
	).toBeVisible()
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true)
	await page.screenshot({ path: 'test-results/sticky-wheel-mobile.png' })
})
