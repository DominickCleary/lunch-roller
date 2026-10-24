import './env'
import { afterAll, expect, it } from 'vitest'
import { startGameStateListener } from './events'
import { createDatabase } from './index'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!testDatabaseUrl) {
	throw new Error(
		'Set TEST_DATABASE_URL to a disposable database before running integration tests.',
	)
}

const database = createDatabase(testDatabaseUrl)
afterAll(() => database.close())

it('notifies only after commit and coalesces changes in one transaction', async () => {
	const originalDatabaseUrl = process.env.DATABASE_URL
	process.env.DATABASE_URL = testDatabaseUrl
	let notificationCount = 0
	let resolveNotification!: () => void
	let notification = new Promise<void>((resolve) => {
		resolveNotification = resolve
	})
	let listener: Awaited<ReturnType<typeof startGameStateListener>> | undefined
	const name = `event-test-${crypto.randomUUID()}`
	try {
		listener = await startGameStateListener(() => {
			notificationCount += 1
			resolveNotification()
		})
		await database.client
			.begin(async (tx) => {
				await tx`insert into participants (name) values (${name})`
				throw new Error('ROLLBACK_TEST')
			})
			.catch((error: unknown) => {
				if (!(error instanceof Error) || error.message !== 'ROLLBACK_TEST')
					throw error
			})
		await new Promise((resolve) => setTimeout(resolve, 150))
		expect(notificationCount).toBe(0)

		await database.client.begin(async (tx) => {
			await tx`insert into participants (name) values (${name})`
			await tx`update participants set name = ${name} where name = ${name}`
		})
		await Promise.race([
			notification,
			new Promise((_, reject) =>
				setTimeout(
					() => reject(new Error('Timed out waiting for notification')),
					3_000,
				),
			),
		])
		await new Promise((resolve) => setTimeout(resolve, 100))
		expect(notificationCount).toBe(1)
	} finally {
		await listener?.close()
		await database.client`delete from participants where name = ${name}`
		if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
		else process.env.DATABASE_URL = originalDatabaseUrl
	}
})
