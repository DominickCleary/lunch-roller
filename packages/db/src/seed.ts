import './env'
import { createDatabase } from './index'
import { settings } from './schema'

const database = createDatabase()
try {
  await database.db.transaction(async (tx) => {
    await tx.insert(settings).values({ id: 1 }).onConflictDoNothing()
    // Runtime initialization creates only the settings singleton. Admin setup
    // is responsible for configuring people and places.
  })
  console.log('Settings initialized (existing game preserved)')
} finally {
  await database.close()
}
