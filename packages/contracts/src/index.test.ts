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
