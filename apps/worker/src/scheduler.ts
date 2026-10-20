export type NotificationJob = {
  id: string;
  leaseToken: string;
  attempts: number;
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  payload: { title: string; body: string; drawId: string };
};

export type WorkerGameOperations = {
  drawIfDue(now?: Date): Promise<unknown>;
  claimNotifications(now?: Date, limit?: number): Promise<NotificationJob[]>;
  finishNotification(
    id: string,
    leaseToken: string,
    outcome: 'sent' | 'retry' | 'gone',
    now?: Date,
  ): Promise<unknown>;
};

type PushSubscription = NotificationJob['subscription'];
type PushPayload = NotificationJob['payload'] & { tag: string };
type Log = (event: string, fields?: Record<string, unknown>) => void;

export function configurePush(
  vapid: { publicKey?: string; privateKey?: string; subject?: string },
  setDetails: (subject: string, publicKey: string, privateKey: string) => void,
  log: Log,
): boolean {
  if (!vapid.publicKey || !vapid.privateKey || !vapid.subject) return false;
  try {
    setDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    return true;
  } catch {
    log('vapid_configuration_invalid');
    return false;
  }
}

function statusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error))
    return undefined;
  const value = error.statusCode;
  return typeof value === 'number' ? value : undefined;
}

/** Run one bounded, sequential scheduling tick. The push batch is concurrent and capped at 10. */
export async function runTick(options: {
  game: WorkerGameOperations;
  checkDatabase: () => Promise<void>;
  pushConfigured: boolean;
  sendNotification: (
    subscription: PushSubscription,
    payload: string,
    timeoutMs: number,
  ) => Promise<unknown>;
  log: Log;
  now?: Date;
}): Promise<boolean> {
  const now = options.now ?? new Date();
  try {
    await options.checkDatabase();
  } catch {
    // Do not expose connection credentials or details in worker logs.
    return false;
  }

  try {
    // Let the shared transaction resolve its live clock after acquiring the game lock.
    await options.game.drawIfDue(options.now);
  } catch {
    options.log('draw_attempt_failed');
  }

  if (!options.pushConfigured) return true;

  let jobs: NotificationJob[];
  try {
    jobs = await options.game.claimNotifications(now, 10);
  } catch {
    options.log('notification_claim_failed');
    return true;
  }

  await Promise.all(
    jobs.map(async (job) => {
      let outcome: 'sent' | 'retry' | 'gone' = 'sent';
      const payload: PushPayload = {
        ...job.payload,
        tag: `lunch-draw-${job.payload.drawId}`,
      };
      try {
        await options.sendNotification(
          job.subscription,
          JSON.stringify(payload),
          10_000,
        );
      } catch (error) {
        outcome =
          statusCode(error) === 404 || statusCode(error) === 410
            ? 'gone'
            : 'retry';
        options.log('notification_delivery_failed', { outcome });
      }
      try {
        await options.game.finishNotification(job.id, job.leaseToken, outcome);
      } catch {
        // The shared service's lease expiry makes failed completions recoverable.
        options.log('notification_completion_failed');
      }
    }),
  );

  return true;
}
