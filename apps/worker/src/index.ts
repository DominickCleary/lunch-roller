import '@lunch/db/env'
import { rm, writeFile } from 'node:fs/promises'
import { createDatabase, GameService } from '@lunch/db'
import webPush from 'web-push'
import { configurePush, runTick } from './scheduler.js'

const intervalMs = 30_000
const heartbeatFile = process.env.WORKER_HEARTBEAT_FILE
const vapid = {
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY,
  subject: process.env.VAPID_SUBJECT,
}
const database = createDatabase()
const game = new GameService(database)
let stopping = false
let timer: ReturnType<typeof setTimeout> | undefined
let wake: (() => void) | undefined
const log = (event: string, fields: Record<string, unknown> = {}) =>
  console.log(
    JSON.stringify({
      service: 'worker',
      event,
      time: new Date().toISOString(),
      ...fields,
    }),
  )

const pushConfigured = configurePush(
  vapid,
  (subject, publicKey, privateKey) =>
    webPush.setVapidDetails(subject, publicKey, privateKey),
  log,
)

function stop(signal: string) {
  if (stopping) return
  stopping = true
  log('shutdown_requested', { signal })
  clearTimeout(timer)
  wake?.()
}
process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))

async function tick() {
  const ready = await runTick({
    game,
    checkDatabase: async () => {
      await database.client`select id from settings where id = 1`.then(
        (rows) => {
          if (rows.length !== 1) throw new Error('Database not seeded')
        },
      )
    },
    pushConfigured,
    sendNotification: async (subscription, payload, timeoutMs) =>
      webPush.sendNotification(subscription, payload, { timeout: timeoutMs }),
    log,
  })

  log('heartbeat', {
    database: ready ? 'ok' : 'unavailable',
    schedulerImplemented: true,
  })
  if (heartbeatFile) {
    if (ready) await writeFile(heartbeatFile, String(Date.now()))
    else await rm(heartbeatFile, { force: true })
  }
}

log('started', {
  intervalMs,
  mode: 'scheduler',
  schedulerImplemented: true,
  pushConfigured,
})
try {
  while (!stopping) {
    await tick()
    if (stopping) break
    await new Promise<void>((resolve) => {
      wake = resolve
      timer = setTimeout(resolve, intervalMs)
    })
    wake = undefined
  }
} finally {
  if (heartbeatFile) await rm(heartbeatFile, { force: true })
  await database.close()
  log('stopped')
}
