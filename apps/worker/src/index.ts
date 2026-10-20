import '@lunch/db/env';
import { writeFile, rm } from 'node:fs/promises';
import { checkDatabase } from '@lunch/db';

const intervalMs = 30_000;
const heartbeatFile = process.env.WORKER_HEARTBEAT_FILE;
let stopping = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let wake: (() => void) | undefined;
const log = (event: string, fields: Record<string, unknown> = {}) =>
  console.log(
    JSON.stringify({
      service: 'worker',
      event,
      time: new Date().toISOString(),
      ...fields,
    }),
  );

function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  log('shutdown_requested', { signal });
  clearTimeout(timer);
  wake?.();
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

log('started', {
  intervalMs,
  mode: 'health-only',
  schedulerImplemented: false,
});
while (!stopping) {
  let ready = false;
  try {
    ready = await checkDatabase();
  } catch {
    /* Log safe state rather than connection credentials. */
  }
  log('heartbeat', {
    database: ready ? 'ok' : 'unavailable',
    schedulerImplemented: false,
  });
  if (heartbeatFile) {
    if (ready) await writeFile(heartbeatFile, String(Date.now()));
    else await rm(heartbeatFile, { force: true });
  }
  if (stopping) break;
  await new Promise<void>((resolve) => {
    wake = resolve;
    timer = setTimeout(resolve, intervalMs);
  });
  wake = undefined;
}
if (heartbeatFile) await rm(heartbeatFile, { force: true });
log('stopped');
