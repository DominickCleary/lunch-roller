import './env'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, expect, it } from 'vitest'
import { createDatabase, GameService } from './index'
import { participants, places, settings } from './schema'

const database = createDatabase()
const service = new GameService(database)
const originalPeople = await database.db.select().from(participants)
const originalPlaces = await database.db.select().from(places)
const [originalSettings] = await database.db
	.select({ setupCompleted: settings.setupCompleted })
	.from(settings)
	.where(eq(settings.id, 1))
const createdPeople: string[] = []
const createdPlaces: string[] = []

afterAll(async () => {
	if (createdPlaces.length)
		await database.db.delete(places).where(inArray(places.id, createdPlaces))
	if (createdPeople.length)
		await database.db
			.delete(participants)
			.where(inArray(participants.id, createdPeople))
	await database.db.delete(places)
	await database.db.delete(participants)
	if (originalPeople.length)
		await database.db.insert(participants).values(originalPeople)
	if (originalPlaces.length)
		await database.db.insert(places).values(originalPlaces)
	if (originalSettings)
		await database.db
			.update(settings)
			.set({ setupCompleted: originalSettings.setupCompleted })
			.where(eq(settings.id, 1))
	await database.close()
})

it('starts empty, blocks member activity, and completes setup once active options exist', async () => {
	await database.db.delete(places)
	await database.db.delete(participants)
	await database.db
		.update(settings)
		.set({ setupCompleted: false })
		.where(eq(settings.id, 1))

	const runSeed = () =>
		promisify(execFile)(
			process.execPath,
			['--import', 'tsx', 'packages/db/src/seed.ts'],
			{
				cwd: new URL('../../../', import.meta.url),
				env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
				timeout: 10_000,
			},
		)
	await runSeed()
	await runSeed()

	expect(await service.getSetupStatus()).toEqual({
		completed: false,
		participantCount: 0,
		placeCount: 0,
	})
	expect(
		await service.drawIfDue(new Date('2088-08-09T12:00:00.000Z')),
	).toBeNull()
	expect(await service.claimNotifications()).toEqual([])
	await expect(
		service.selectParticipant(crypto.randomUUID()),
	).rejects.toMatchObject({
		status: 403,
		code: 'SETUP_REQUIRED',
	})
	await expect(service.completeSetup()).rejects.toMatchObject({
		status: 409,
		code: 'SETUP_INCOMPLETE',
	})

	const inactivePerson = await service.saveParticipant({
		name: 'Archived setup person',
	})
	createdPeople.push(inactivePerson.id)
	await service.saveParticipant({ active: false }, inactivePerson.id)
	const inactivePlace = await service.savePlace({
		name: 'Archived setup place',
	})
	createdPlaces.push(inactivePlace.id)
	await service.savePlace({ active: false }, inactivePlace.id)

	expect(await service.getSetupStatus()).toEqual({
		completed: false,
		participantCount: 0,
		placeCount: 0,
	})
	await expect(service.completeSetup()).rejects.toMatchObject({
		status: 409,
		code: 'SETUP_INCOMPLETE',
	})

	const person = await service.saveParticipant({ name: 'Setup test person' })
	createdPeople.push(person.id)
	const place = await service.savePlace({ name: 'Setup test place' })
	createdPlaces.push(place.id)

	expect(await service.getSetupStatus()).toEqual({
		completed: false,
		participantCount: 1,
		placeCount: 1,
	})
	// Partial configuration must not allow a worker to draw before the admin finishes.
	expect(
		await service.drawIfDue(new Date('2099-03-02T12:00:00.000Z')),
	).toBeNull()
	await expect(service.wallet(person.id)).rejects.toMatchObject({
		status: 403,
		code: 'SETUP_REQUIRED',
	})
	await expect(
		service.purchase(
			person.id,
			{ placeId: place.id, action: 'boost' },
			crypto.randomUUID(),
		),
	).rejects.toMatchObject({ status: 403, code: 'SETUP_REQUIRED' })

	const completed = await Promise.all([
		service.completeSetup(),
		service.completeSetup(),
	])
	expect(completed).toEqual([
		{ completed: true, participantCount: 1, placeCount: 1 },
		{ completed: true, participantCount: 1, placeCount: 1 },
	])
	expect(await service.getSetupStatus()).toEqual(completed[0])
	expect(await service.selectParticipant(person.id)).toEqual(person)
})
