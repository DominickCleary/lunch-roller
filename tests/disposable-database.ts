// Tests must explicitly opt into a disposable URL. Never fall back to .env DATABASE_URL.
const url = process.env.TEST_DATABASE_URL
if (!url)
	throw new Error(
		'TEST_DATABASE_URL must identify a migrated, seeded disposable PostgreSQL database.',
	)
const parsed = new URL(url)
if (!['postgres:', 'postgresql:'].includes(parsed.protocol))
	throw new Error('TEST_DATABASE_URL must be PostgreSQL.')
process.env.DATABASE_URL = url
