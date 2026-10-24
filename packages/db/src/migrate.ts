import './env'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createDatabase } from './index'

const database = createDatabase()
try {
	await migrate(database.db, {
		migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
	})
	console.log('Database migrations complete')
} finally {
	await database.close()
}
