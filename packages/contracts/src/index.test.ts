import { expect, it } from 'vitest';
import {
  createPlace,
  defaultSchedule,
  schedule,
  pushSubscription,
} from './index';
it('trims place names and rejects blank names', () => {
  expect(createPlace.parse({ name: '  Sushi  ' }).name).toBe('Sushi');
  expect(createPlace.safeParse({ name: '  ' }).success).toBe(false);
});
it('validates schedule and push boundaries', () => {
  expect(schedule.safeParse(defaultSchedule).success).toBe(true);
  expect(
    schedule.safeParse({ ...defaultSchedule, timezone: 'not/a-zone' }).success,
  ).toBe(false);
  expect(
    schedule.safeParse({ ...defaultSchedule, time: '25:00' }).success,
  ).toBe(false);
  expect(
    schedule.safeParse({ ...defaultSchedule, weekdays: [1, 1] }).success,
  ).toBe(false);
  expect(
    pushSubscription.safeParse({
      endpoint: 'http://example.com',
      keys: { p256dh: 'a', auth: 'b' },
    }).success,
  ).toBe(false);
});
it('accepts browser push services and rejects internal or credentialed targets', () => {
  const keys = { p256dh: `B${'a'.repeat(86)}`, auth: 'a'.repeat(22) };
  for (const endpoint of [
    'https://fcm.googleapis.com/fcm/send/token',
    'https://updates.push.services.mozilla.com/wpush/v2/token',
    'https://web.push.apple.com/token',
    'https://wns.notify.windows.com/token',
  ]) {
    expect(pushSubscription.safeParse({ endpoint, keys }).success).toBe(true);
  }
  for (const endpoint of [
    'https://127.0.0.1/private',
    'https://example.com/private',
    'https://fcm.googleapis.com.attacker.com/',
    'https://user:password@fcm.googleapis.com/',
    'https://fcm.googleapis.com:444/',
  ]) {
    expect(pushSubscription.safeParse({ endpoint, keys }).success).toBe(false);
  }
});
