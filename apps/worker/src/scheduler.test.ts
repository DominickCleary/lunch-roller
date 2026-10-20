import { describe, expect, it, vi } from 'vitest';
import {
  configurePush,
  runTick,
  type NotificationJob,
  type WorkerGameOperations,
} from './scheduler.js';

function job(id: string): NotificationJob {
  return {
    id,
    leaseToken: `lease-${id}`,
    attempts: 1,
    subscription: {
      endpoint: `https://push.example/${id}`,
      keys: { p256dh: 'public-key', auth: 'auth-key' },
    },
    payload: {
      title: 'Lunch result',
      body: 'A place was selected.',
      drawId: `draw-${id}`,
    },
  };
}

function game(
  overrides: Partial<WorkerGameOperations> = {},
): WorkerGameOperations {
  return {
    drawIfDue: vi.fn(async () => null),
    claimNotifications: vi.fn(async () => []),
    finishNotification: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('runTick', () => {
  it('runs scheduling without claiming notifications when VAPID is incomplete', async () => {
    const service = game();
    const sendNotification = vi.fn(async () => undefined);
    const result = await runTick({
      game: service,
      checkDatabase: async () => undefined,
      pushConfigured: false,
      sendNotification,
      log: vi.fn(),
      now: new Date('2026-10-20T10:30:00Z'),
    });

    expect(result).toBe(true);
    expect(service.drawIfDue).toHaveBeenCalledOnce();
    expect(service.claimNotifications).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('maps expired subscriptions to gone and other delivery failures to retry', async () => {
    const jobs = [job('one'), job('two'), job('three')];
    const finishNotification = vi.fn(async () => undefined);
    const service = game({
      claimNotifications: vi.fn(async () => jobs),
      finishNotification,
    });
    const sent: Array<{ payload: string; timeoutMs: number }> = [];
    const result = await runTick({
      game: service,
      checkDatabase: async () => undefined,
      pushConfigured: true,
      sendNotification: async (_subscription, payload, timeoutMs) => {
        sent.push({ payload, timeoutMs });
        if (payload.includes('draw-one'))
          throw Object.assign(new Error(), { statusCode: 410 });
        if (payload.includes('draw-two'))
          throw Object.assign(new Error(), { statusCode: 503 });
      },
      log: vi.fn(),
      now: new Date('2026-10-20T10:30:00Z'),
    });

    expect(result).toBe(true);
    expect(service.claimNotifications).toHaveBeenCalledWith(
      new Date('2026-10-20T10:30:00Z'),
      10,
    );
    expect(finishNotification).toHaveBeenCalledTimes(3);
    expect(finishNotification).toHaveBeenCalledWith('one', 'lease-one', 'gone');
    expect(finishNotification).toHaveBeenCalledWith(
      'two',
      'lease-two',
      'retry',
    );
    expect(finishNotification).toHaveBeenCalledWith(
      'three',
      'lease-three',
      'sent',
    );
    expect(sent).toHaveLength(3);
    for (const delivery of sent) {
      expect(delivery.timeoutMs).toBe(10_000);
      expect(JSON.parse(delivery.payload).tag).toMatch(/^lunch-draw-draw-/);
    }
  });

  it('does not draw or claim jobs when database readiness fails', async () => {
    const service = game();
    const result = await runTick({
      game: service,
      checkDatabase: async () => {
        throw new Error('Database unavailable');
      },
      pushConfigured: true,
      sendNotification: vi.fn(async () => undefined),
      log: vi.fn(),
    });

    expect(result).toBe(false);
    expect(service.drawIfDue).not.toHaveBeenCalled();
    expect(service.claimNotifications).not.toHaveBeenCalled();
  });

  it('continues the tick when a scheduled draw fails', async () => {
    const service = game({
      drawIfDue: vi.fn(async () => {
        throw new Error('draw failed');
      }),
    });
    const log = vi.fn();
    await expect(
      runTick({
        game: service,
        checkDatabase: async () => undefined,
        pushConfigured: true,
        sendNotification: vi.fn(async () => undefined),
        log,
      }),
    ).resolves.toBe(true);
    expect(service.claimNotifications).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('draw_attempt_failed');
  });

  it('leaves a failed completion recoverable through its lease and does not leak errors', async () => {
    const service = game({
      claimNotifications: vi.fn(async () => [job('endpoint')]),
      finishNotification: vi.fn(async () => {
        throw new Error('database secret detail');
      }),
    });
    const log = vi.fn();
    await expect(
      runTick({
        game: service,
        checkDatabase: async () => undefined,
        pushConfigured: true,
        sendNotification: vi.fn(async () => undefined),
        log,
      }),
    ).resolves.toBe(true);
    expect(service.finishNotification).toHaveBeenCalledWith(
      'endpoint',
      'lease-endpoint',
      'sent',
    );
    expect(log).toHaveBeenCalledWith('notification_completion_failed');
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      'database secret detail',
    );
  });

  it('disables invalid VAPID settings and logs only a safe event', () => {
    const log = vi.fn();
    const enabled = configurePush(
      {
        publicKey: 'private-public-value',
        privateKey: 'secret',
        subject: 'invalid',
      },
      () => {
        throw new Error('secret-bearing validation detail');
      },
      log,
    );
    expect(enabled).toBe(false);
    expect(log).toHaveBeenCalledWith('vapid_configuration_invalid');
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
  });
});
