import './env'
import { tokenOverviewResponse } from '@lunch/contracts'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, expect, it } from 'vitest'
import { createDatabase, GameService } from './index'
import {
  bets,
  bettingMarkets,
  influenceLots,
  participants,
  places,
  tokenLedger,
} from './schema'

const database = createDatabase()
const game = new GameService(database)
const personIds: string[] = []
const marketIds: string[] = []
const placeIds: string[] = []

afterAll(async () => {
  try {
    if (personIds.length) {
      await database.db
        .delete(influenceLots)
        .where(inArray(influenceLots.participantId, personIds))
      await database.db
        .delete(tokenLedger)
        .where(inArray(tokenLedger.participantId, personIds))
      await database.db
        .delete(bets)
        .where(inArray(bets.participantId, personIds))
    }
    if (marketIds.length)
      await database.db
        .delete(bettingMarkets)
        .where(inArray(bettingMarkets.id, marketIds))
    if (placeIds.length)
      await database.db.delete(places).where(inArray(places.id, placeIds))
    if (personIds.length)
      await database.db
        .delete(participants)
        .where(inArray(participants.id, personIds))
  } finally {
    await database.close()
  }
})

it('ranks total tokens with ties and counts only outstanding commitments without multiplying ledger sums', async () => {
  const suffix = crypto.randomUUID()
  const people = await database.db
    .insert(participants)
    .values([
      { name: `Alpha-${suffix}` },
      { name: `Bravo-${suffix}` },
      { name: `Charlie-${suffix}` },
      { name: `Zero-${suffix}` },
      { name: `Archived-${suffix}`, active: false },
    ])
    .returning()
  personIds.push(...people.map((row) => row.id))
  const [alpha, bravo, charlie, zero, archived] = people
  const [place] = await database.db
    .insert(places)
    .values({ name: `overview-${suffix}` })
    .returning()
  placeIds.push(place!.id)
  const markets = await database.db
    .insert(bettingMarkets)
    .values(
      [
        { localDate: '2298-01-02', status: 'open' as const },
        { localDate: '2298-01-03', status: 'settled' as const },
        { localDate: '2298-01-04', status: 'void' as const },
      ].map((row) => ({
        ...row,
        timezone: 'UTC',
        scheduledTime: '11:30',
        cutoffMinutes: 5,
      })),
    )
    .returning()
  marketIds.push(...markets.map((row) => row.id))
  const [open, settled, voided] = markets
  const append = async (
    participantId: string,
    delta: number,
    kind: typeof tokenLedger.$inferInsert.kind,
    extra: Partial<typeof tokenLedger.$inferInsert> = {},
  ) => {
    const [row] = await database.db
      .insert(tokenLedger)
      .values({
        participantId,
        delta,
        kind,
        reason: 'Disposable token overview fixture',
        idempotencyKey: crypto.randomUUID(),
        requestHash: 'token-overview-fixture',
        ...extra,
      })
      .returning()
    return row!
  }
  for (const [person, amount] of [
    [alpha!, 130],
    [bravo!, 100],
    [charlie!, 80],
    [archived!, 1000],
  ] as const)
    await append(person.id, amount, 'correction')
  const [bet] = await database.db
    .insert(bets)
    .values({
      participantId: alpha!.id,
      marketId: open!.id,
      localDate: open!.localDate,
      placeId: place!.id,
      placeName: place!.name,
      stake: 20,
    })
    .returning()
  await append(alpha!.id, -20, 'bet-stake', {
    betId: bet!.id,
    placeId: place!.id,
  })
  const lots = []
  for (const [market, cost, action, withdrawn] of [
    [open!, 7, 'boost', false],
    [open!, 3, 'reduce', false],
    [settled!, 30, 'boost', false],
    [open!, 11, 'boost', true],
    [voided!, 19, 'reduce', true],
  ] as const) {
    const debit = await append(alpha!.id, -cost, action, {
      influenceMarketId: market.id,
      placeId: place!.id,
    })
    const [lot] = await database.db
      .insert(influenceLots)
      .values({
        participantId: alpha!.id,
        placeId: place!.id,
        marketId: market.id,
        action,
        tokenCost: cost,
        logMultiplier: Math.log(action === 'boost' ? 1.25 : 0.8),
        purchaseLedgerId: debit.id,
        withdrawnAt: withdrawn ? new Date() : null,
      })
      .returning()
    lots.push(lot!)
    if (withdrawn)
      await append(
        alpha!.id,
        cost,
        action === 'boost' ? 'boost-refund' : 'reduce-refund',
        { influenceMarketId: market.id, placeId: place!.id },
      )
  }
  const read = async (at = '2298-01-02T11:00:00Z') =>
    tokenOverviewResponse.parse(
      await game.tokenOverview(alpha!.id, new Date(at)),
    )
  const overview = await read()
  expect(
    overview.rows.find((row) => row.participantId === alpha!.id),
  ).toMatchObject({ balance: 70, totalBalance: 100, rank: 1 })
  expect(
    overview.rows.find((row) => row.participantId === bravo!.id),
  ).toMatchObject({ balance: 100, totalBalance: 100, rank: 1 })
  expect(
    overview.rows.find((row) => row.participantId === charlie!.id),
  ).toMatchObject({ balance: 80, totalBalance: 80, rank: 3 })
  expect(
    overview.rows.find((row) => row.participantId === zero!.id),
  ).toMatchObject({ balance: 0, totalBalance: 0 })
  expect(overview.rows.some((row) => row.participantId === archived!.id)).toBe(
    false,
  )
  expect(overview.rows.slice(0, 2).map((row) => row.participantId)).toEqual([
    alpha!.id,
    bravo!.id,
  ])
  expect((await read('2298-01-02T11:26:00Z')).rows).toEqual(overview.rows)

  // Refunding reservations changes availability, not the total or shared rank.
  await database.db
    .update(bets)
    .set({ status: 'cancelled' })
    .where(eq(bets.id, bet!.id))
  await append(alpha!.id, 20, 'bet-release', { betId: bet!.id })
  await database.db
    .update(influenceLots)
    .set({ withdrawnAt: new Date() })
    .where(eq(influenceLots.id, lots[0]!.id))
  await append(alpha!.id, 7, 'boost-refund', { influenceMarketId: open!.id })
  expect(
    (await read()).rows.find((row) => row.participantId === alpha!.id),
  ).toMatchObject({ balance: 97, totalBalance: 100, rank: 1 })
  // Committing the remaining reduction consumes its reserved cost permanently.
  await database.db
    .update(bettingMarkets)
    .set({ status: 'settled' })
    .where(eq(bettingMarkets.id, open!.id))
  expect(
    (await read()).rows.find((row) => row.participantId === alpha!.id),
  ).toMatchObject({ balance: 97, totalBalance: 97, rank: 2 })
})

it('shows same-day check-in rewards and bet payouts in local-day token gains', async () => {
  const [person] = await database.db
    .insert(participants)
    .values({ name: `Today-${crypto.randomUUID()}` })
    .returning()
  personIds.push(person!.id)
  const now = new Date('2298-01-02T11:00:00.000Z')
  for (const [delta, kind, minutesAgo] of [
    [10, 'attendance', 55],
    [100, 'bet-payout', 45],
    [-5, 'bet-stake', 35],
    [1000, 'attendance', 26 * 60],
  ] as const) {
    await database.db.insert(tokenLedger).values({
      participantId: person!.id,
      delta,
      kind,
      reason: 'Today standings fixture',
      idempotencyKey: crypto.randomUUID(),
      requestHash: crypto.randomUUID(),
      createdAt: new Date(now.getTime() - minutesAgo * 60_000),
    })
  }
  const overview = tokenOverviewResponse.parse(
    await game.tokenOverview(person!.id, now),
  )
  expect(
    overview.rows.find((row) => row.participantId === person!.id),
  ).toMatchObject({
    balance: 1105,
    todayDelta: 105,
  })
})
