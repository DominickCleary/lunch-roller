import './env'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, expect, it } from 'vitest'
import { createDatabase } from './index'
import { GameService } from './operations'
import {
  bettingMarkets,
  draws,
  notificationOutbox,
  places,
  settings,
} from './schema'

const database = createDatabase()
const game = new GameService(database)
const [originalSettings] = await database.db.select().from(settings)
const originalEconomy = await game.getEconomy()
const originalPlaces = await database.db.select().from(places)
const suffix = crypto.randomUUID()
const names = [
  `chance-a-${suffix}`,
  `chance-b-${suffix}`,
  `chance-c-${suffix}`,
  `chance-rare-${suffix}`,
]
const fixturePlaceIds: string[] = []
const drawIds: string[] = []

afterAll(async () => {
  try {
    if (originalSettings)
      await database.db
        .update(settings)
        .set(originalSettings)
        .where(eq(settings.id, 1))
    for (const place of originalPlaces)
      await database.db
        .update(places)
        .set({ active: place.active, logWeight: place.logWeight })
        .where(eq(places.id, place.id))
    if (drawIds.length) {
      await database.db
        .delete(notificationOutbox)
        .where(inArray(notificationOutbox.drawId, drawIds))
      await database.db
        .delete(bettingMarkets)
        .where(inArray(bettingMarkets.drawId, drawIds))
      await database.db.delete(draws).where(inArray(draws.id, drawIds))
    }
    if (fixturePlaceIds.length)
      await database.db
        .delete(places)
        .where(inArray(places.id, fixturePlaceIds))
  } finally {
    await database.close()
  }
})

it('archives low-chance places and a low-chance winner after preserving settlement snapshots', async () => {
  await game.setSchedule({
    timezone: 'UTC',
    time: '00:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  })
  await database.db.update(places).set({ active: false })
  for (const name of names) {
    const place = await game.savePlace({ name })
    fixturePlaceIds.push(place.id)
  }
  const rarePlaceId = fixturePlaceIds.at(-1)
  if (!rarePlaceId) throw new Error('Expected the rare-place fixture.')
  await database.db
    .update(places)
    .set({ logWeight: 0 })
    .where(inArray(places.id, fixturePlaceIds.slice(0, 3)))
  await database.db
    .update(places)
    .set({ logWeight: -1000 })
    .where(eq(places.id, rarePlaceId))

  await game.setEconomy({
    ...originalEconomy,
    winnerMultiplier: 0.5,
    autoRemoveBelowChancePercent: 1,
    removeWinnerBelowChancePercent: 0,
  })
  const first = await game.drawIfDue(new Date('2304-01-02T12:00:00.000Z'))
  if (!first) throw new Error('Expected the automatic threshold draw.')
  drawIds.push(first.id)
  expect(first.snapshot.map((place) => place.placeId)).toEqual(
    expect.arrayContaining(fixturePlaceIds),
  )
  expect(
    first.snapshot.find((place) => place.placeId === rarePlaceId),
  ).toMatchObject({
    probability: 0,
  })
  let savedPlaces = await game.listPlaces(true)
  expect(savedPlaces.find((place) => place.id === rarePlaceId)).toMatchObject({
    active: false,
  })
  expect(
    savedPlaces
      .filter((place) => fixturePlaceIds.slice(0, 3).includes(place.id))
      .every((place) => place.active),
  ).toBe(true)

  await game.setEconomy({
    ...originalEconomy,
    winnerMultiplier: 0.5,
    autoRemoveBelowChancePercent: 0,
    removeWinnerBelowChancePercent: 40,
  })
  const second = await game.drawIfDue(new Date('2304-01-03T12:00:00.000Z'))
  if (!second) throw new Error('Expected the winner threshold draw.')
  drawIds.push(second.id)
  expect(second.snapshot.map((place) => place.placeId)).toEqual(
    expect.arrayContaining(fixturePlaceIds.slice(0, 3)),
  )
  savedPlaces = await game.listPlaces(true)
  expect(
    savedPlaces.find((place) => place.id === second.placeId),
  ).toMatchObject({ active: false })
  expect(
    second.snapshot.find((place) => place.placeId === second.placeId),
  ).toBeDefined()
  expect(
    (await game.today(new Date('2304-01-03T13:00:00.000Z'))).wheel,
  ).toEqual({ mode: 'result', localDate: '2304-01-03' })
})

it('persists chance reductions, removes exhausted winners and never applies decay twice', async () => {
  await game.setSchedule({
    timezone: 'UTC',
    time: '00:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  })
  for (const [day, points, expected] of [
    [1, 10, 0.125],
    [2, 20, 0.05],
    [3, 30, 0],
  ] as const) {
    await database.db
      .update(places)
      .set({ active: true, logWeight: 0 })
      .where(inArray(places.id, fixturePlaceIds))
    await game.setEconomy({
      ...originalEconomy,
      winnerMultiplier: 0.5,
      winnerChanceReductionPoints: points,
      autoRemoveBelowChancePercent: 0,
      removeWinnerBelowChancePercent: 0,
    })
    const instant = new Date(`2304-02-0${day}T12:00:00.000Z`)
    const draw = await game.drawIfDue(instant)
    if (!draw) throw new Error('Expected the chance-reduction draw.')
    drawIds.push(draw.id)
    expect(
      draw.snapshot.find((place) => place.placeId === draw.placeId)
        ?.probability,
    ).toBeCloseTo(0.25, 10)
    const after = await game.today(instant)
    const winner = after.odds.find((place) => place.placeId === draw.placeId)
    if (expected) expect(winner?.probability).toBeCloseTo(expected, 10)
    else {
      expect(winner).toBeUndefined()
      expect(
        (await game.listPlaces(true)).find((place) => place.id === draw.placeId)
          ?.active,
      ).toBe(false)
    }
    expect((await game.drawIfDue(instant))?.id).toBe(draw.id)
    expect((await game.today(instant)).odds).toEqual(after.odds)
  }
})
