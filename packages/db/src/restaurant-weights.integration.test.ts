import './env'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, expect, it } from 'vitest'
import { createDatabase } from './index'
import { GameService } from './operations'
import { places } from './schema'

const database = createDatabase()
const service = new GameService(database)
const original = await database.db.select().from(places)
await database.db.update(places).set({ active: false })
const fixtures = await Promise.all(
  ['first', 'second', 'third'].map((name) =>
    service.savePlace({ name: `weight-scale-${name}-${crypto.randomUUID()}` }),
  ),
)

afterAll(async () => {
  try {
    await database.db.delete(places).where(
      inArray(
        places.id,
        fixtures.map((p) => p.id),
      ),
    )
    for (const place of original)
      await database.db
        .update(places)
        .set({ active: place.active })
        .where(eq(places.id, place.id))
  } finally {
    await database.close()
  }
})

it.each([0, -10000, 10000])(
  'preserves the total weight through repeated odds edits at log scale %s',
  async (scale) => {
    for (const [index, place] of fixtures.entries())
      await database.db
        .update(places)
        .set({ logWeight: scale + Math.log(index === 2 ? 0.5 : 1) })
        .where(eq(places.id, place.id))

    const save = async (percentages: number[]) =>
      service.setRestaurantOdds({
        places: fixtures.map((place, index) => ({
          placeId: place.id,
          percent: percentages[index]!,
        })),
      })
    const expectWeights = async (weights: number[]) => {
      const stored = await service.listPlaces()
      for (const [index, fixture] of fixtures.entries())
        expect(
          stored.find((place) => place.id === fixture.id)!.logWeight,
        ).toBeCloseTo(scale + Math.log(weights[index]!), 8)
    }

    await save([40, 40, 20])
    await expectWeights([1, 1, 0.5])
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await save([50, 30, 20])
      await expectWeights([1.25, 0.75, 0.5])
      for (const [index, fixture] of fixtures.entries())
        expect(
          result.places.find((place) => place.placeId === fixture.id)!.percent,
        ).toBeCloseTo([50, 30, 20][index]!, 7)
    }
  },
)
