import { expect, it } from 'vitest';
import {
  createPlace,
  defaultSchedule,
  schedule,
  pushSubscription,
  participantRemoval,
  economySettings,
  defaultEconomySettings,
} from './index';
it('validates the complete token economy and directional weight multipliers', () => {
  expect(economySettings.parse(defaultEconomySettings)).toEqual(
    defaultEconomySettings,
  );
  expect(
    economySettings.parse({
      ...defaultEconomySettings,
      attendanceReward: 2147483647,
      boostMultiplier: 100,
      reduceMultiplier: 0.01,
    }),
  ).toBeTruthy();
  for (const field of [
    'attendanceReward',
    'addPlaceCost',
    'removePlaceCost',
    'boostCost',
    'reduceCost',
  ]) {
    for (const value of [0, -1, 1.5, 2147483648, Infinity, NaN])
      expect(
        economySettings.safeParse({ ...defaultEconomySettings, [field]: value })
          .success,
      ).toBe(false);
  }
  for (const [field, values] of [
    ['boostMultiplier', [0, 1, 101, Infinity, NaN]],
    ['reduceMultiplier', [0, 0.001, 1, Infinity, NaN]],
    ['newPlaceMultiplier', [0, 0.001, 101, Infinity, NaN]],
  ] as const)
    for (const value of values)
      expect(
        economySettings.safeParse({ ...defaultEconomySettings, [field]: value })
          .success,
      ).toBe(false);
  expect(economySettings.safeParse({ attendanceReward: 10 }).success).toBe(
    false,
  );
});
it('distinguishes permanent participant deletion from history-preserving archival', () => {
  const participantId = 'ca982f50-f7c6-4eb3-8572-28fa01106ed7';
  for (const action of ['deleted', 'archived'])
    expect(
      participantRemoval.safeParse({ participantId, action }).success,
    ).toBe(true);
  expect(
    participantRemoval.safeParse({ participantId, action: 'erased-history' })
      .success,
  ).toBe(false);
  expect(
    participantRemoval.safeParse({
      participantId: 'not-a-uuid',
      action: 'deleted',
    }).success,
  ).toBe(false);
});
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
