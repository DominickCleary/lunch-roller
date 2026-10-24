import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { createDatabase, GameService } from '../../packages/db/src/index'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!testDatabaseUrl) {
	throw new Error(
		'Set TEST_DATABASE_URL to a disposable migrated and seeded database before running E2E tests.',
	)
}

const appOrigin = new URL(process.env.APP_ORIGIN ?? 'http://localhost:3000')
	.origin
const adminPassword = process.env.ADMIN_PASSWORD ?? 'integration-only-password'
const fixturePrefix = `LR-REMOVE-${randomUUID().slice(0, 8)}`
const database = createDatabase(testDatabaseUrl)
const game = new GameService(database)
const unusedName = `${fixturePrefix} Unused`
const browserUsedName = `${fixturePrefix} Browser Used`
const apiUsedName = `${fixturePrefix} API Used`
const historyReason = `${fixturePrefix} funded history`
let unusedId = ''
let browserUsedId = ''
let apiUsedId = ''

function validOrigin() {
	return { Origin: appOrigin }
}

function participantLedger(participantId: string) {
	return database.client`
    select delta, reason
    from token_ledger
    where participant_id = ${participantId}
  `
}

async function signIn(page: import('@playwright/test').Page) {
	const password = page.getByLabel('Administrator password')
	if (!(await password.isVisible())) {
		await page
			.locator('.top-actions')
			.getByText('Admin', { exact: true })
			.click()
	}
	await password.fill(adminPassword)
	await page.getByRole('button', { name: 'Unlock' }).click()
	await expect(page.getByText('Administrator tools unlocked.')).toBeVisible()
}

test.beforeAll(async () => {
	const unused = await game.saveParticipant({ name: unusedName })
	const browserUsed = await game.saveParticipant({ name: browserUsedName })
	const apiUsed = await game.saveParticipant({ name: apiUsedName })
	unusedId = unused.id
	browserUsedId = browserUsed.id
	apiUsedId = apiUsed.id

	await game.correctTokens(
		{ participantId: browserUsedId, delta: 11, reason: historyReason },
		randomUUID(),
	)
	await game.correctTokens(
		{
			participantId: apiUsedId,
			delta: 7,
			reason: `${fixturePrefix} API history`,
		},
		randomUUID(),
	)
})

test.afterAll(async () => {
	try {
		const participants = await game.listParticipants(true)
		for (const participant of participants) {
			if (participant.name.startsWith(fixturePrefix)) {
				await game.saveParticipant({ active: false }, participant.id)
			}
		}
	} finally {
		await database.close()
	}
})

test('participant removal enforces admin, origin, UUID, and history rules', async ({
	request,
}) => {
	const unauthenticated = await request.delete(
		`/api/v1/admin/participants/${apiUsedId}`,
		{ headers: validOrigin() },
	)
	expect(unauthenticated.status()).toBe(401)

	const login = await request.post('/api/v1/admin/session', {
		data: { password: adminPassword },
		headers: validOrigin(),
	})
	expect(login.status()).toBe(204)
	const cookie = /lunch-roller-admin=[^;]+/.exec(
		login.headers()['set-cookie'] ?? '',
	)?.[0]
	expect(cookie).toBeTruthy()
	const adminHeaders = { ...validOrigin(), Cookie: cookie! }

	const missingOrigin = await request.delete(
		`/api/v1/admin/participants/${apiUsedId}`,
		{ headers: { Cookie: cookie! } },
	)
	expect(missingOrigin.status()).toBe(403)

	const wrongOrigin = await request.delete(
		`/api/v1/admin/participants/${apiUsedId}`,
		{
			headers: { Cookie: cookie!, Origin: 'https://attacker.example' },
		},
	)
	expect(wrongOrigin.status()).toBe(403)

	const invalidId = await request.delete(
		'/api/v1/admin/participants/not-a-uuid',
		{
			headers: adminHeaders,
		},
	)
	expect(invalidId.status()).toBe(400)

	const missing = await request.delete(
		`/api/v1/admin/participants/${randomUUID()}`,
		{ headers: adminHeaders },
	)
	expect(missing.status()).toBe(404)

	const removed = await request.delete(
		`/api/v1/admin/participants/${apiUsedId}`,
		{ headers: adminHeaders },
	)
	expect(removed.status()).toBe(200)
	expect(await removed.json()).toEqual({
		participantId: apiUsedId,
		action: 'archived',
	})

	const apiLedger = await participantLedger(apiUsedId)
	expect(apiLedger).toHaveLength(1)
	expect(apiLedger[0]).toMatchObject({
		delta: 7,
		reason: `${fixturePrefix} API history`,
	})

	const repeated = await request.delete(
		`/api/v1/admin/participants/${apiUsedId}`,
		{ headers: adminHeaders },
	)
	expect(repeated.status()).toBe(200)
	expect(await repeated.json()).toEqual({
		participantId: apiUsedId,
		action: 'archived',
	})
})

test('admin removal can be cancelled, deletes unused profiles, and archives used profiles', async ({
	page,
}) => {
	await page.goto(appOrigin)
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(
		'Gambling about lunch',
	)
	await signIn(page)

	const peopleCard = page
		.locator('.admin-tool-card')
		.filter({ has: page.getByRole('heading', { name: 'People' }) })
	const unusedRow = peopleCard.getByRole('row').filter({ hasText: unusedName })
	await expect(unusedRow).toBeVisible()
	await peopleCard.getByRole('button', { name: `Remove ${unusedName}` }).click()

	const dialog = page.getByRole('alertdialog')
	await expect(
		dialog.getByRole('heading', { name: 'Remove person?' }),
	).toBeVisible()
	await expect(dialog).toContainText(unusedName)
	await expect(dialog).toContainText(/delete|archiv/i)
	await dialog.getByRole('button', { name: 'Cancel' }).click()
	await expect(dialog).toBeHidden()
	await expect(unusedRow).toBeVisible()
	expect(
		(await game.listParticipants(true)).some((item) => item.id === unusedId),
	).toBe(true)

	await peopleCard.getByRole('button', { name: `Remove ${unusedName}` }).click()
	await page
		.getByRole('alertdialog')
		.getByRole('button', { name: 'Remove person', exact: true })
		.click()
	await expect(
		page.getByText(`${unusedName} was permanently deleted.`),
	).toBeVisible()
	await expect(unusedRow).toHaveCount(0)
	expect(
		(await game.listParticipants(true)).some((item) => item.id === unusedId),
	).toBe(false)

	const usedRow = peopleCard
		.getByRole('row')
		.filter({ hasText: browserUsedName })
	await expect(usedRow).toBeVisible()
	await peopleCard
		.getByRole('button', { name: `Remove ${browserUsedName}` })
		.click()
	const usedDialog = page.getByRole('alertdialog')
	await expect(
		usedDialog.getByRole('heading', { name: 'Remove person?' }),
	).toBeVisible()
	await expect(usedDialog).toContainText(browserUsedName)
	await expect(usedDialog).toContainText(/delete|archiv/i)
	await usedDialog
		.getByRole('button', { name: 'Remove person', exact: true })
		.click()
	await expect(
		page.getByText(`${browserUsedName} was archived; history was preserved.`),
	).toBeVisible()

	const archived = (await game.listParticipants(true)).find(
		(participant) => participant.id === browserUsedId,
	)
	expect(archived?.active).toBe(false)
	const browserLedger = await participantLedger(browserUsedId)
	expect(browserLedger).toHaveLength(1)
	expect(browserLedger[0]).toMatchObject({ delta: 11, reason: historyReason })
})
