import './disposable-database'
import { createDatabase, GameService, schema } from '../packages/db/src/index'

// Explicit test fixtures only. Runtime initialization never creates sample data.
export async function prepareGameFixtures() {
  const database = createDatabase(process.env.TEST_DATABASE_URL!)
  try {
    const game = new GameService(database)
    const [original] = await database.db.select().from(schema.settings)
    if (!original)
      throw new Error('Migrate and initialize the disposable database first.')
    const people = await database.db
      .insert(schema.participants)
      .values([{ name: 'Alex' }, { name: 'Sam' }])
      .onConflictDoNothing()
      .returning()
    const places = await database.db
      .insert(schema.places)
      .values([
        { name: 'Sandwich Bar' },
        { name: 'Noodle House' },
        { name: 'Pizza Place' },
      ])
      .onConflictDoNothing()
      .returning()
    await game.completeSetup()
    return {
      people: people.map((row) => row.id),
      places: places.map((row) => row.id),
      original,
    }
  } finally {
    await database.close()
  }
}
