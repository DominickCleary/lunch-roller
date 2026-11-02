import './env'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, expect, it } from 'vitest'
import { createDatabase } from './index'
import { GameService } from './operations'
import {
  betRequests,
  bets,
  bettingMarkets,
  draws,
  notificationOutbox,
  participants,
  places,
  settings,
  tokenLedger,
} from './schema'

const database = createDatabase()
const game = new GameService(database)
const [originalSettings] = await database.db.select().from(settings)
const originalPlaces = await database.db.select().from(places)
const originalEconomy = await game.getEconomy()
const person = await game.saveParticipant({
  name: `winner-multiplier-${crypto.randomUUID()}`,
})
const place = await game.savePlace({
  name: `winner-place-${crypto.randomUUID()}`,
})
const drawIds: string[] = []
const marketIds: string[] = []

afterAll(async () => {
  try {
    await database.db
      .delete(tokenLedger)
      .where(eq(tokenLedger.participantId, person.id))
    await database.db
      .delete(betRequests)
      .where(eq(betRequests.participantId, person.id))
    await database.db.delete(bets).where(eq(bets.participantId, person.id))
    if (marketIds.length)
      await database.db
        .delete(bettingMarkets)
        .where(inArray(bettingMarkets.id, marketIds))
    if (drawIds.length) {
      await database.db
        .delete(notificationOutbox)
        .where(inArray(notificationOutbox.drawId, drawIds))
      await database.db.delete(draws).where(inArray(draws.id, drawIds))
    }
    await database.db.delete(places).where(eq(places.id, place.id))
    await database.db.delete(participants).where(eq(participants.id, person.id))
    for (const original of originalPlaces)
      await database.db
        .update(places)
        .set({ active: original.active, logWeight: original.logWeight })
        .where(eq(places.id, original.id))
    await database.db
      .update(settings)
      .set(originalSettings!)
      .where(eq(settings.id, 1))
  } finally {
    await database.close()
  }
})

it('archives a zero-multiplier winner after saving and settling the draw once', async () => {
  await game.setSchedule({
    timezone: 'UTC',
    time: '12:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  })
  await game.setPreferences({
    ...(await game.getPreferences()),
    bettingCloseMinutes: 0,
  })
  expect((await game.getEconomy()).winnerMultiplier).toBe(0.5)
  await game.setEconomy({ ...originalEconomy, winnerMultiplier: 0 })
  await database.db.update(places).set({ active: false })
  await database.db
    .update(places)
    .set({ active: true })
    .where(eq(places.id, place.id))

  const betAt = new Date('2302-01-02T11:00:00.000Z')
  await game.correctTokens(
    { participantId: person.id, delta: 25, reason: 'Fund winner test bet' },
    crypto.randomUUID(),
  )
  const market = await game.currentBets(person.id, betAt)
  const bet = await game.setBet(
    person.id,
    { placeId: place.id, stake: 5, localDate: market.window.localDate },
    crypto.randomUUID(),
    betAt,
  )
  const storedMarket = await database.db
    .select()
    .from(bettingMarkets)
    .where(eq(bettingMarkets.localDate, market.window.localDate))
  marketIds.push(...storedMarket.map(({ id }) => id))
  const drawnAt = new Date('2302-01-02T12:00:00.000Z')
  const result = (await game.drawIfDue(drawnAt))!
  drawIds.push(result.id)
  expect(result.placeId).toBe(place.id)
  expect(result.snapshot).toHaveLength(1)
  expect(result.snapshot[0]).toMatchObject({
    placeId: place.id,
    probability: 1,
    name: place.name,
  })
  expect((await game.wallet(person.id)).bets).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: bet.bet!.id, status: 'won', payout: 5 }),
    ]),
  )
  expect((await game.wallet(person.id)).balance).toBe(25)
  expect(
    (await game.listPlaces(true)).find(({ id }) => id === place.id)?.active,
  ).toBe(false)
  expect(await game.drawIfDue(drawnAt)).toEqual(result)
  expect(
    (await game.listPlaces(true)).filter(({ id }) => id === place.id),
  ).toHaveLength(1)
  expect(await game.drawIfDue(new Date('2302-01-03T12:00:00.000Z'))).toBeNull()

  const balanceBeforeReadd = (await game.wallet(person.id)).balance
  const readded = await game.addPlace(
    person.id,
    { name: place.name },
    crypto.randomUUID(),
    new Date('2302-01-03T10:00:00.000Z'),
  )
  expect(readded.place.id).toBe(place.id)
  expect(readded.spentTokens).toBe(originalEconomy.addPlaceCost)
  expect(readded.balance).toBe(
    balanceBeforeReadd - originalEconomy.addPlaceCost,
  )
  expect(
    (await game.listPlaces()).find(({ id }) => id === place.id)?.active,
  ).toBe(true)
})

it('keeps a winner active when the multiplier is one', async () => {
  await game.setEconomy({ ...originalEconomy, winnerMultiplier: 1 })
  await database.db.update(places).set({ active: false })
  await database.db
    .update(places)
    .set({ active: true })
    .where(eq(places.id, place.id))
  const nextDay = new Date('2302-01-03T12:00:00.000Z')
  const result = (await game.drawIfDue(nextDay))!
  drawIds.push(result.id)
  expect(result.placeId).toBe(place.id)
  expect((await game.listPlaces()).some(({ id }) => id === place.id)).toBe(true)
})
