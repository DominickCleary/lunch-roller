import './env'
import assert from 'node:assert/strict'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, expect, it } from 'vitest'
import { createDatabase } from './index'
import { GameService } from './operations'
import {
  betRequests,
  bets,
  bettingMarkets,
  draws,
  influenceLots,
  notificationOutbox,
  participants,
  places,
  settings,
  tokenLedger,
} from './schema'

const database = createDatabase()
const game = new GameService(database)
const [originalSettings] = await database.db
  .select()
  .from(settings)
  .where(eq(settings.id, 1))
const originalPlaces = await database.db.select().from(places)
const owner = await game.saveParticipant({
  name: `bet-limit-owner-${crypto.randomUUID()}`,
})
const other = await game.saveParticipant({
  name: `bet-limit-other-${crypto.randomUUID()}`,
})
const firstPlace = await game.savePlace({
  name: `bet-limit-first-${crypto.randomUUID()}`,
})
const secondPlace = await game.savePlace({
  name: `bet-limit-second-${crypto.randomUUID()}`,
})
const participantIds = [owner.id, other.id]
const placeIds = [firstPlace.id, secondPlace.id]
const marketIds: string[] = []
const drawIds: string[] = []

afterAll(async () => {
  try {
    await database.db
      .delete(influenceLots)
      .where(inArray(influenceLots.participantId, participantIds))
    await database.db
      .delete(tokenLedger)
      .where(inArray(tokenLedger.participantId, participantIds))
    await database.db
      .delete(betRequests)
      .where(inArray(betRequests.participantId, participantIds))
    await database.db
      .delete(bets)
      .where(inArray(bets.participantId, participantIds))
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
    await database.db.delete(places).where(inArray(places.id, placeIds))
    await database.db
      .delete(participants)
      .where(inArray(participants.id, participantIds))
    for (const place of originalPlaces)
      await database.db
        .update(places)
        .set({ active: place.active, logWeight: place.logWeight })
        .where(eq(places.id, place.id))
    if (originalSettings)
      await database.db
        .update(settings)
        .set(originalSettings)
        .where(eq(settings.id, 1))
  } finally {
    await database.close()
  }
})

it('enforces a per-person bet cap while supporting independent edits and settlement', async () => {
  await game.setSchedule({
    timezone: 'UTC',
    time: '13:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  })
  await game.setPreferences({
    ...(await game.getPreferences()),
    bettingCloseMinutes: 5,
    maxBetsPerPlayer: 1,
  })
  await database.db.update(places).set({ active: false })
  await database.db
    .update(places)
    .set({ active: true })
    .where(inArray(places.id, placeIds))
  for (const participantId of participantIds)
    await game.correctTokens(
      { participantId, delta: 100, reason: 'Fund bet limit test' },
      crypto.randomUUID(),
    )

  const bettingAt = new Date('2301-10-20T12:00:00.000Z')
  const current = await game.currentBets(owner.id, bettingAt)
  expect(current.maxBetsPerPlayer).toBe(1)
  expect(current.bets).toEqual([])
  const initialMarkets = await database.db
    .select({ id: bettingMarkets.id })
    .from(bettingMarkets)
    .where(eq(bettingMarkets.localDate, current.window.localDate))
  marketIds.push(...initialMarkets.map(({ id }) => id))

  // With one open bet, the legacy request continues to edit that bet.
  const first = await game.setBet(
    owner.id,
    { localDate: current.window.localDate, placeId: firstPlace.id, stake: 10 },
    crypto.randomUUID(),
    bettingAt,
  )
  assert(first.bet)
  const updated = await game.setBet(
    owner.id,
    { localDate: current.window.localDate, placeId: secondPlace.id, stake: 12 },
    crypto.randomUUID(),
    bettingAt,
  )
  assert(updated.bet)
  expect(updated.bet.id).toBe(first.bet.id)
  expect(updated.bet.placeId).toBe(secondPlace.id)

  await game.setPreferences({
    ...(await game.getPreferences()),
    maxBetsPerPlayer: 2,
  })
  const createKey = crypto.randomUUID()
  const competingKey = crypto.randomUUID()
  const concurrent = await Promise.allSettled([
    game.setBet(
      owner.id,
      {
        localDate: current.window.localDate,
        placeId: firstPlace.id,
        stake: 7,
        create: true,
      },
      createKey,
      bettingAt,
    ),
    game.setBet(
      owner.id,
      {
        localDate: current.window.localDate,
        placeId: firstPlace.id,
        stake: 7,
        create: true,
      },
      competingKey,
      bettingAt,
    ),
  ])
  const success = concurrent.filter(
    (
      item,
    ): item is PromiseFulfilledResult<
      Awaited<ReturnType<typeof game.setBet>>
    > => item.status === 'fulfilled',
  )
  const failure = concurrent.filter(
    (item): item is PromiseRejectedResult => item.status === 'rejected',
  )
  expect(success).toHaveLength(1)
  expect(failure).toHaveLength(1)
  expect(failure[0]!.reason).toMatchObject({ code: 'BET_LIMIT_REACHED' })
  const second = success[0]!.value
  assert(second.bet)
  const replayKey =
    concurrent[0]?.status === 'fulfilled' ? createKey : competingKey
  expect(second.bet.id).not.toBe(first.bet.id)
  expect(
    await game.setBet(
      owner.id,
      {
        localDate: current.window.localDate,
        placeId: firstPlace.id,
        stake: 7,
        create: true,
      },
      replayKey,
      bettingAt,
    ),
  ).toEqual(second)

  const open = await game.currentBets(owner.id, bettingAt)
  expect(open.bets).toHaveLength(2)
  expect(open.bets.map(({ id }) => id)).toEqual(
    expect.arrayContaining([first.bet.id, second.bet.id]),
  )
  expect(open.bet?.id).toBe(open.bets[0]?.id)
  expect(open.maxBetsPerPlayer).toBe(2)
  await expect(
    game.setBet(
      owner.id,
      {
        localDate: current.window.localDate,
        placeId: firstPlace.id,
        stake: 1,
        create: true,
      },
      crypto.randomUUID(),
      bettingAt,
    ),
  ).rejects.toMatchObject({ code: 'BET_LIMIT_REACHED' })
  await expect(
    game.setBet(
      owner.id,
      { localDate: current.window.localDate, placeId: firstPlace.id, stake: 1 },
      crypto.randomUUID(),
      bettingAt,
    ),
  ).rejects.toMatchObject({ code: 'BET_ID_REQUIRED' })
  await expect(
    game.setBet(
      other.id,
      {
        localDate: current.window.localDate,
        placeId: firstPlace.id,
        stake: 1,
        betId: first.bet.id,
      },
      crypto.randomUUID(),
      bettingAt,
    ),
  ).rejects.toMatchObject({ code: 'BET_NOT_FOUND' })

  // Existing bets remain editable after the administrator lowers the cap.
  await game.setPreferences({
    ...(await game.getPreferences()),
    maxBetsPerPlayer: 1,
  })
  const edited = await game.setBet(
    owner.id,
    {
      localDate: current.window.localDate,
      placeId: firstPlace.id,
      stake: 11,
      betId: first.bet.id,
    },
    crypto.randomUUID(),
    bettingAt,
  )
  assert(edited.bet)
  expect(edited.bet.id).toBe(first.bet.id)
  await expect(
    game.cancelBet(
      owner.id,
      { localDate: current.window.localDate },
      crypto.randomUUID(),
      bettingAt,
    ),
  ).rejects.toMatchObject({ code: 'BET_ID_REQUIRED' })
  await game.cancelBet(
    owner.id,
    { localDate: current.window.localDate, betId: first.bet.id },
    crypto.randomUUID(),
    bettingAt,
  )
  expect(
    (await game.currentBets(owner.id, bettingAt)).bets.map(({ id }) => id),
  ).toEqual([second.bet.id])
  await game.setPreferences({
    ...(await game.getPreferences()),
    maxBetsPerPlayer: 2,
  })
  const third = await game.setBet(
    owner.id,
    {
      localDate: current.window.localDate,
      placeId: firstPlace.id,
      stake: 4,
      create: true,
    },
    crypto.randomUUID(),
    bettingAt,
  )
  assert(third.bet)

  await expect(
    game.setBet(
      owner.id,
      {
        localDate: current.window.localDate,
        placeId: firstPlace.id,
        stake: 1,
        betId: first.bet.id,
      },
      crypto.randomUUID(),
      new Date('2301-10-20T12:56:00.000Z'),
    ),
  ).rejects.toMatchObject({ code: 'BETTING_CLOSED' })

  assert(third.bet)
  const result = await game.drawIfDue(new Date('2301-10-20T13:00:00.000Z'))
  expect(result).not.toBeNull()
  drawIds.push(result!.id)
  const settledIds = [second.bet.id, third.bet.id]
  const settledBets = (await game.wallet(owner.id)).bets.filter((bet) =>
    settledIds.includes(bet.id),
  )
  expect(settledBets).toHaveLength(2)
  assert(result)
  for (const bet of settledBets) {
    const probability = result.snapshot.find(
      (place) => place.placeId === bet.placeId,
    )!.probability
    expect(bet.probability).toBe(probability)
    expect(bet.payout).toBe(
      bet.placeId === result.placeId
        ? Math.min(2147483647, Math.floor(bet.stake / probability))
        : 0,
    )
  }
  expect(settledBets.every((bet) => ['won', 'lost'].includes(bet.status))).toBe(
    true,
  )
})
