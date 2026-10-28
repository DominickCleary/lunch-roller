import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'

const container = `lunch-roller-e2e-${process.pid}-${randomUUID().slice(0, 8)}`
const databaseUser = 'lunch_e2e'
const databasePassword = randomUUID()
const databaseName = 'lunch_e2e'
let containerStarted = false
let interrupted = false

if (process.versions.node.split('.')[0] !== '24') {
  console.error('The local E2E runner requires Node 24.')
  process.exit(1)
}

process.once('SIGINT', () => {
  interrupted = true
  process.exitCode = 130
})
process.once('SIGTERM', () => {
  interrupted = true
  process.exitCode = 143
})

function checkInterrupted() {
  if (interrupted) throw new Error('Local E2E run interrupted.')
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32' && command === 'pnpm',
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(
      `${command} exited with status ${result.status ?? 'unknown'}`,
    )
  checkInterrupted()
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(
      `${command} failed: ${result.stderr?.trim() || result.stdout?.trim()}`,
    )
  return result.stdout.trim()
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Could not reserve an available localhost port.'))
        return
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })
}

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

try {
  run('pnpm', ['build'])
  containerStarted = true
  run('docker', [
    'run',
    '--detach',
    '--rm',
    '--name',
    container,
    '--env',
    `POSTGRES_USER=${databaseUser}`,
    '--env',
    `POSTGRES_PASSWORD=${databasePassword}`,
    '--env',
    `POSTGRES_DB=${databaseName}`,
    '--publish',
    '127.0.0.1::5432',
    'postgres:17.6-bookworm',
  ])

  let mappedPort
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const mapping = capture('docker', ['port', container, '5432/tcp'])
      mappedPort = Number(mapping.slice(mapping.lastIndexOf(':') + 1))
      if (Number.isInteger(mappedPort) && mappedPort > 0) break
    } catch {
      // The container can take a moment to start and publish its port.
    }
    await sleep(500)
    checkInterrupted()
  }
  if (!mappedPort)
    throw new Error('PostgreSQL did not publish a localhost port.')

  let ready = false
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync(
      'docker',
      ['exec', container, 'pg_isready', '-U', databaseUser, '-d', databaseName],
      { stdio: 'ignore' },
    )
    if (result.status === 0) {
      ready = true
      break
    }
    await sleep(1000)
    checkInterrupted()
  }
  if (!ready) throw new Error('Temporary PostgreSQL did not become ready.')

  const databaseUrl = `postgres://${databaseUser}:${databasePassword}@127.0.0.1:${mappedPort}/${databaseName}`
  const databaseEnv = { ...process.env, DATABASE_URL: databaseUrl }
  run('pnpm', ['db:migrate'], databaseEnv)
  run('pnpm', ['db:seed'], databaseEnv)

  const appPort = await availablePort()
  const appOrigin = `http://127.0.0.1:${appPort}`
  const testEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
    APP_ORIGIN: appOrigin,
  }
  run('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], testEnv)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  if (containerStarted) {
    const result = spawnSync('docker', ['rm', '--force', container], {
      stdio: 'inherit',
    })
    if (result.status !== 0 && process.exitCode === undefined)
      process.exitCode = result.status ?? 1
  }
}
