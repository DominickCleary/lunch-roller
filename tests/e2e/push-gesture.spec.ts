import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createDatabase, GameService } from '../../packages/db/src/index';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl)
  throw new Error(
    'Set TEST_DATABASE_URL to a disposable migrated and seeded database before running E2E tests.',
  );

const appOrigin = process.env.APP_ORIGIN ?? 'http://localhost:3000';
const fixturePrefix = `LR-PUSH-GESTURE-${randomUUID().slice(0, 8)}`;
const database = createDatabase(testDatabaseUrl);
const game = new GameService(database);
let participantId = '';

test.beforeAll(async () => {
  participantId = (
    await game.saveParticipant({ name: `${fixturePrefix} Member` })
  ).id;
});

test.afterAll(async () => {
  try {
    if (participantId)
      await database.client`delete from participants where id = ${participantId}::uuid`;
  } finally {
    await database.close();
  }
});

test('requests push permission synchronously from the opt-in click', async ({
  page,
}) => {
  await page.addInitScript((id) => {
    localStorage.setItem('lunch-roller.participant-id', id);
    const events: string[] = [];
    let resolveWorker!: (registration: unknown) => void;
    const registration = {
      pushManager: {
        getSubscription: async () => null,
        subscribe: async () => ({
          toJSON: () => ({
            endpoint: 'https://fcm.googleapis.com/fcm/send/mock-endpoint',
            keys: {
              p256dh: `B${'A'.repeat(86)}`,
              auth: 'A'.repeat(22),
            },
          }),
        }),
      },
    };
    const ready = new Promise<typeof registration>((resolve) => {
      resolveWorker = resolve;
    });
    const serviceWorker = {
      register: async () => registration,
      ready,
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: serviceWorker,
    });
    Object.defineProperty(window, '__pushGestureEvents', {
      configurable: true,
      value: events,
    });
    Object.defineProperty(window, '__resolvePushWorker', {
      configurable: true,
      value: () => resolveWorker(registration),
    });
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest('[data-testid="push-opt-in"]')
        ) {
          events.length = 0;
          events.push('click');
        }
      },
      true,
    );
    const mockNotification = class {};
    Object.defineProperty(mockNotification, 'permission', {
      value: 'default',
      configurable: true,
    });
    Object.defineProperty(mockNotification, 'requestPermission', {
      configurable: true,
      value: () => {
        events.push('permission');
        return Promise.resolve('granted');
      },
    });
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: mockNotification,
    });
  }, participantId);
  await page.route('**/api/v1/push-config', async (route) =>
    route.fulfill({ json: { publicKey: `B${'A'.repeat(86)}` } }),
  );
  await page.route('**/api/v1/push-subscriptions', async (route) =>
    route.fulfill({ status: 201, json: { id: randomUUID() } }),
  );
  await page.goto(appOrigin);
  const optIn = page.getByTestId('push-opt-in');
  await expect(optIn).toBeVisible();
  await optIn.click();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __pushGestureEvents: string[] })
            .__pushGestureEvents,
      ),
    )
    .toContain('permission');
  const events = await page.evaluate(
    () =>
      (window as Window & { __pushGestureEvents: string[] })
        .__pushGestureEvents,
  );
  expect(events[0]).toBe('click');
  expect(events[1]).toBe('permission');

  await page.evaluate(() =>
    (
      window as Window & {
        __resolvePushWorker: () => void;
      }
    ).__resolvePushWorker(),
  );
  await expect(
    page.getByText('Lunch and token alerts enabled for this browser.'),
  ).toBeVisible();
});
