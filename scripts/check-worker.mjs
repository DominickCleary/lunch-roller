import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const withPush = process.argv.includes('--push-config')
const workerRequire = createRequire(
  new URL('../apps/worker/package.json', import.meta.url),
)
const keys = withPush ? workerRequire('web-push').generateVAPIDKeys() : null
const workerEnv = keys
  ? {
      ...process.env,
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      VAPID_SUBJECT: 'mailto:integration@example.com',
    }
  : process.env

// POSIX signal semantics are exercised in CI; Windows terminal Ctrl+C is manual.
const child = spawn(
  process.execPath,
  ['--import', 'tsx', 'apps/worker/src/index.ts'],
  { stdio: ['ignore', 'pipe', 'pipe'], env: workerEnv },
)
let stdout = ''
let stderr = ''
let signalled = false
child.stdout.on('data', (chunk) => {
  stdout += chunk
  if (!signalled && stdout.includes('"database":"ok"')) {
    signalled = true
    child.kill('SIGTERM')
  }
})
child.stderr.on('data', (chunk) => {
  stderr += chunk
})
const timeout = setTimeout(() => {
  child.kill('SIGKILL')
}, 15000)
child.on('error', (error) => {
  clearTimeout(timeout)
  throw error
})
child.on('exit', (code) => {
  clearTimeout(timeout)
  assert.equal(code, 0, stderr || stdout)
  assert.match(stdout, /"event":"started"/)
  assert.match(stdout, /"database":"ok"/)
  assert.match(stdout, /"event":"shutdown_requested"/)
  assert.match(stdout, /"event":"stopped"/)
  if (withPush) assert.match(stdout, /"pushConfigured":true/)
  console.log(
    `Worker startup, database heartbeat, and graceful shutdown verified${withPush ? ' with valid VAPID configuration' : ''}`,
  )
})
