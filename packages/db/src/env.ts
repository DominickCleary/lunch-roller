import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

// Resolve the repo .env independently of each workspace command's working directory.
config({
	path: fileURLToPath(new URL('../../../.env', import.meta.url)),
	quiet: true,
})
