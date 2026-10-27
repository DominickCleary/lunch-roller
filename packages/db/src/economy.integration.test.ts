import './env'
import { defaultEconomySettings } from '@lunch/contracts'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, expect, it } from 'vitest'
import { createDatabase } from './index'
import { GameService } from './operations'
import {
  attendance,
  draws,
  influenceLots,
  notificationOutbox,
  participants,
  places,
  settings,
  tokenLedger,
} from './schema'

const database = createDatabase()
const service = new GameService(database)
let influenceAt = new Date('2199-10-20T08:00:00.000Z')
const originalSchedule = await service.getSchedule()
const originalEconomy = await service.getEconomy()
const originalWeights = new Map(
  (await service.listPlaces(true)).map((place) => [place.id, place.logWeight]),
)
const suffix = crypto.randomUUID()
const member = await service.saveParticipant({ name: `economy-${suffix}` })
const unfundedMember = await service.saveParticipant({
  name: `economy-unfunded-${suffix}`,
})
const seedPlace = await service.savePlace({ name: `economy-place-${suffix}` })
const participantIds = [member.id, unfundedMember.id]
const ownedPlaceIds = [seedPlace.id]
const drawIds: string[] = []

function remember<T extends { id: string } | null>(draw: T): T {
  if (draw) drawIds.push(draw.id)
  return draw
}

afterAll(async () => {
  try {
    await service.setEconomy(originalEconomy)
    await database.db
      .update(settings)
      .set({
        timezone: originalSchedule.timezone,
        spinTime: originalSchedule.time,
        weekdays: originalSchedule.weekdays,
      })
      .where(eq(settings.id, 1))
    if (participantIds.length) {
      await database.db
        .delete(influenceLots)
        .where(inArray(influenceLots.participantId, participantIds))
      await database.db
        .delete(tokenLedger)
        .where(inArray(tokenLedger.participantId, participantIds))
    }
    if (participantIds.length)
      await database.db
        .delete(attendance)
        .where(inArray(attendance.participantId, participantIds))
    if (drawIds.length)
      await database.db
        .delete(notificationOutbox)
        .where(inArray(notificationOutbox.drawId, drawIds))
    if (drawIds.length)
      await database.db.delete(draws).where(inArray(draws.id, drawIds))
    if (ownedPlaceIds.length)
      await database.db.delete(places).where(inArray(places.id, ownedPlaceIds))
    if (participantIds.length)
      await database.db
        .delete(participants)
        .where(inArray(participants.id, participantIds))
    for (const [id, logWeight] of originalWeights)
      await database.db
        .update(places)
        .set({ logWeight })
        .where(eq(places.id, id))
  } finally {
    await database.close()
  }
})

it('uses configured rewards and prices, replays original responses, and preserves draw snapshots', async () => {
  const schedule = {
    timezone: 'UTC',
    time: '00:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  }
  await service.setSchedule(schedule)
  const economy = {
    attendanceReward: 13,
    addPlaceCost: 7,
    removePlaceCost: 12,
    boostCost: 3,
    reduceCost: 4,
    boostMultiplier: 1.7,
    reduceMultiplier: 0.6,
    newPlaceMultiplier: 1.5,
  }
  expect(await service.setEconomy(economy)).toEqual(economy)

  const drawAt = new Date(Date.now() + 1_000 * 24 * 60 * 60 * 1000)
  const draw = remember(await service.drawIfDue(drawAt))
  influenceAt = drawAt
  expect(draw).not.toBeNull()
  const historicalSnapshot = structuredClone(draw!.snapshot)

  await service.correctTokens(
    { participantId: member.id, delta: 100, reason: 'fund economy test' },
    crypto.randomUUID(),
  )
  const placeBefore = (await service.listPlaces()).find(
    (place) => place.id === seedPlace.id,
  )!
  const boostKey = crypto.randomUUID()
  const boosted = await service.purchase(
    member.id,
    { placeId: seedPlace.id, action: 'boost' },
    boostKey,
    influenceAt,
  )
  expect(boosted.spentTokens).toBe(economy.boostCost)
  expect(boosted.place.logWeight).toBeCloseTo(
    placeBefore.logWeight + Math.log(economy.boostMultiplier),
  )

  const cancelled = await service.purchase(
    member.id,
    { placeId: seedPlace.id, action: 'reduce' },
    crypto.randomUUID(),
    influenceAt,
  )
  expect(cancelled).toMatchObject({
    spentTokens: 0,
    refundedTokens: economy.boostCost,
  })
  expect(cancelled.place.logWeight).toBeCloseTo(placeBefore.logWeight)
  const reducedBefore = placeBefore.logWeight
  const reduced = await service.purchase(
    member.id,
    { placeId: seedPlace.id, action: 'reduce' },
    crypto.randomUUID(),
    influenceAt,
  )
  expect(reduced.spentTokens).toBe(economy.reduceCost)
  expect(reduced.place.logWeight).toBeCloseTo(
    reducedBefore + Math.log(economy.reduceMultiplier),
  )

  const weightsBeforeAdd = (await service.listPlaces()).map(
    (place) => place.logWeight,
  )
  const addKey = crypto.randomUUID()
  const added = await service.addPlace(
    member.id,
    { name: `economy-added-${suffix}` },
    addKey,
  )
  ownedPlaceIds.push(added.place.id)
  expect(added.spentTokens).toBe(economy.addPlaceCost)
  expect(added.place.logWeight).toBeCloseTo(
    Math.log(
      weightsBeforeAdd.reduce((sum, weight) => sum + Math.exp(weight), 0) /
        weightsBeforeAdd.length,
    ) + Math.log(economy.newPlaceMultiplier),
  )

  const removed = await service.purchase(
    member.id,
    { placeId: added.place.id, action: 'remove' },
    crypto.randomUUID(),
    influenceAt,
  )
  expect(removed.spentTokens).toBe(economy.removePlaceCost)
  expect(removed.place.active).toBe(false)
  const weightsBeforeRestore = (await service.listPlaces()).map(
    (place) => place.logWeight,
  )
  const restored = await service.addPlace(
    member.id,
    { name: added.place.name },
    crypto.randomUUID(),
  )
  expect(restored.place.id).toBe(added.place.id)
  expect(restored.place.active).toBe(true)
  expect(restored.spentTokens).toBe(economy.addPlaceCost)
  expect(restored.place.logWeight).toBeCloseTo(
    Math.log(
      weightsBeforeRestore.reduce((sum, weight) => sum + Math.exp(weight), 0) /
        weightsBeforeRestore.length,
    ) + Math.log(economy.newPlaceMultiplier),
  )

  const attendanceKey = crypto.randomUUID()
  const firstReward = await service.attend(
    member.id,
    { drawId: draw!.id },
    attendanceKey,
    drawAt,
  )
  expect(firstReward.awardedTokens).toBe(economy.attendanceReward)

  const changedEconomy = {
    ...economy,
    attendanceReward: 17,
    addPlaceCost: 11,
    boostCost: 8,
    reduceCost: 9,
    boostMultiplier: 2.2,
    reduceMultiplier: 0.4,
    removePlaceCost: 18,
    newPlaceMultiplier: 2,
  }
  await service.setEconomy(changedEconomy)
  const replayedPurchase = await service.purchase(
    member.id,
    { placeId: seedPlace.id, action: 'boost' },
    boostKey,
    influenceAt,
  )
  const replayedReward = await service.attend(
    member.id,
    { drawId: draw!.id },
    attendanceKey,
    drawAt,
  )
  expect(replayedPurchase).toEqual(boosted)
  expect(replayedReward).toEqual(firstReward)
  expect(
    await service.addPlace(member.id, { name: added.place.name }, addKey),
  ).toEqual(added)
  await expect(
    service.attend(
      member.id,
      { drawId: draw!.id },
      crypto.randomUUID(),
      drawAt,
    ),
  ).rejects.toMatchObject({ code: 'ALREADY_ATTENDED' })
  const afterEdit = await service.purchase(
    member.id,
    { placeId: seedPlace.id, action: 'reduce' },
    crypto.randomUUID(),
    influenceAt,
  )
  expect(afterEdit.spentTokens).toBe(changedEconomy.reduceCost)
  expect(afterEdit.place.logWeight).toBeCloseTo(
    reduced.place.logWeight + Math.log(changedEconomy.reduceMultiplier),
  )
  expect(await service.today(drawAt)).toMatchObject({
    result: { id: draw!.id, snapshot: historicalSnapshot },
  })

  const wallet = await service.wallet(member.id)
  expect(wallet.balance).toBe(100 - 4 - 7 - 12 - 7 + 13 - 9)
  expect(
    wallet.ledger.filter((entry) => entry.kind === 'attendance'),
  ).toHaveLength(1)
  const purchaseRows = await database.db
    .select()
    .from(tokenLedger)
    .where(
      and(
        eq(tokenLedger.participantId, member.id),
        eq(tokenLedger.idempotencyKey, boostKey),
      ),
    )
  expect(purchaseRows).toHaveLength(1)
})

it('rejects an invalid economy atomically and rolls insufficient purchases back', async () => {
  const before = await service.getEconomy()
  await expect(
    service.setEconomy({ ...before, boostCost: 0 }),
  ).rejects.toMatchObject({ status: 400, code: 'INVALID_ECONOMY' })
  expect(await service.getEconomy()).toEqual(before)

  const walletBefore = await service.wallet(unfundedMember.id)
  await expect(
    service.purchase(
      unfundedMember.id,
      { placeId: seedPlace.id, action: 'boost' },
      crypto.randomUUID(),
      influenceAt,
    ),
  ).rejects.toMatchObject({ code: 'INSUFFICIENT_TOKENS' })
  expect(await service.wallet(unfundedMember.id)).toEqual(walletBefore)
  expect(
    await database.db
      .select()
      .from(tokenLedger)
      .where(eq(tokenLedger.participantId, unfundedMember.id)),
  ).toHaveLength(walletBefore.ledger.length)
  expect(defaultEconomySettings).toMatchObject({
    attendanceReward: 10,
    addPlaceCost: 20,
    boostCost: 5,
    reduceCost: 5,
  })
})
