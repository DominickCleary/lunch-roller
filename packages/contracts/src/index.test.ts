import { expect, it } from 'vitest';
import {
  createPlace,
  wheelAnimation,
  refundInfluenceRequest,
  setPlaceWeightRequest,
  updatePlace,
  healthRuleSettings,
  transferRequest,
  defaultSchedule,
  schedule,
  pushSubscription,
  participantRemoval,
  economySettings,
  defaultEconomySettings,
  defaultGamePreferences,
  gamePreferences,
  setBetRequest,
  walletResponse,
  dailyActivityQuery,
  dailyActivityResponse,
  changeInfluenceRequest,
  currentInfluenceResponse,
} from './index';

it('accepts optional live bet quotes and rejects invalid probabilities and returns', () => {
  const quote = dailyActivityResponse.shape.bets.element;
  const id = 'ca982f50-f7c6-4eb3-8572-28fa01106ed7';
  const base = {
    id,
    participantId: id,
    participantName: 'Alex',
    placeId: id,
    placeName: 'Sushi',
    localDate: '2026-10-21',
    stake: 12,
    status: 'open',
    probability: null,
    payout: null,
    updatedAt: '2026-10-21T10:00:00Z',
    settledAt: null,
  };
  expect(quote.safeParse(base).success).toBe(true);
  expect(
    quote.parse({ ...base, currentProbability: 0.25, estimatedWinPayout: 48 }),
  ).toMatchObject({ currentProbability: 0.25, estimatedWinPayout: 48 });
  expect(
    quote.safeParse({
      ...base,
      currentProbability: null,
      estimatedWinPayout: null,
    }).success,
  ).toBe(true);
  for (const currentProbability of [-0.1, 1.1, NaN, Infinity])
    expect(quote.safeParse({ ...base, currentProbability }).success).toBe(
      false,
    );
  for (const estimatedWinPayout of [-1, 1.5, 2147483648, Infinity])
    expect(quote.safeParse({ ...base, estimatedWinPayout }).success).toBe(
      false,
    );
});

it('limits influence edits to a unit of either direction on an explicit draw date', () => {
  const base = {
    localDate: '2026-10-21',
    placeId: 'ca982f50-f7c6-4eb3-8572-28fa01106ed7',
    action: 'boost',
  };
  for (const change of [-1, 1])
    expect(changeInfluenceRequest.safeParse({ ...base, change }).success).toBe(
      true,
    );
  for (const change of [0, 0.5, -2, 2, Infinity])
    expect(changeInfluenceRequest.safeParse({ ...base, change }).success).toBe(
      false,
    );
  expect(
    changeInfluenceRequest.safeParse({
      ...base,
      localDate: '2026-02-30',
      change: 1,
    }).success,
  ).toBe(false);
  expect(
    currentInfluenceResponse.safeParse({ window: {}, places: [] }).success,
  ).toBe(false);
});

it('accepts enriched activity while supplying defaults for saved wallet receipts', () => {
  const entry = {
    id: 'ca982f50-f7c6-4eb3-8572-28fa01106ed7',
    delta: -5,
    kind: 'boost',
    reason: null,
    createdAt: '2026-10-21T10:00:00.000Z',
  };
  const legacy = walletResponse.parse({ balance: 5, ledger: [entry] });
  expect(legacy.bets).toEqual([]);
  expect(legacy.ledger[0]).toMatchObject({
    placeId: null,
    placeName: null,
    betId: null,
    betLocalDate: null,
  });
  expect(
    dailyActivityResponse.parse({
      localDate: '2026-10-21',
      timezone: 'Europe/Dublin',
      entries: [
        {
          ...entry,
          participantId: entry.id,
          participantName: 'Alex',
          placeId: entry.id,
          placeName: 'Sushi',
        },
      ],
      bets: [],
    }).entries[0]?.placeName,
  ).toBe('Sushi');
  expect(dailyActivityQuery.parse({})).toEqual({});
  expect(dailyActivityQuery.parse({ scope: 'draw' })).toEqual({
    scope: 'draw',
  });
  expect(dailyActivityQuery.parse({ scope: 'day' })).toEqual({ scope: 'day' });
  expect(dailyActivityQuery.safeParse({ scope: 'invalid' }).success).toBe(
    false,
  );
  expect(dailyActivityQuery.safeParse({ date: '2026-02-30' }).success).toBe(
    false,
  );
  expect(dailyActivityQuery.safeParse({ date: '2026-10-21' }).success).toBe(
    true,
  );
});

it('validates betting stake and configurable close minutes', () => {
  expect(defaultGamePreferences.bettingCloseMinutes).toBe(5);
  expect(
    gamePreferences.safeParse({
      ...defaultGamePreferences,
      bettingCloseMinutes: 0,
    }).success,
  ).toBe(true);
  expect(
    gamePreferences.safeParse({
      ...defaultGamePreferences,
      bettingCloseMinutes: 1440,
    }).success,
  ).toBe(true);
  for (const value of [-1, 1.5, 1441])
    expect(
      gamePreferences.safeParse({
        ...defaultGamePreferences,
        bettingCloseMinutes: value,
      }).success,
    ).toBe(false);
  const placeId = 'ca982f50-f7c6-4eb3-8572-28fa01106ed7';
  expect(
    setBetRequest.safeParse({ localDate: '2199-10-21', placeId, stake: 1 })
      .success,
  ).toBe(true);
  expect(
    setBetRequest.safeParse({ localDate: '2199-10-21', placeId, stake: 0 })
      .success,
  ).toBe(false);
});
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

it('validates three health levels and bounded bonus settings', () => {
  expect(createPlace.parse({ name: 'New spot' }).healthLevel).toBe('balanced');
  for (const healthLevel of ['treat', 'balanced', 'healthy']) {
    expect(
      createPlace.safeParse({ name: 'New spot', healthLevel }).success,
    ).toBe(true);
    expect(updatePlace.safeParse({ healthLevel }).success).toBe(true);
  }
  expect(
    createPlace.safeParse({ name: 'New spot', healthLevel: 'unknown' }).success,
  ).toBe(false);
  for (const multiplier of [1, 0, 101, Infinity])
    expect(
      healthRuleSettings.safeParse({ enabled: true, multiplier }).success,
    ).toBe(false);
});
it('requires a recipient UUID and positive whole-token transfer amount', () => {
  const recipientId = crypto.randomUUID();
  expect(transferRequest.parse({ recipientId, amount: 25 })).toEqual({
    recipientId,
    amount: 25,
  });
  for (const amount of [0, -1, 0.5, 2147483648, NaN, Infinity])
    expect(transferRequest.safeParse({ recipientId, amount }).success).toBe(
      false,
    );
  expect(
    transferRequest.safeParse({ recipientId: 'nobody', amount: 1 }).success,
  ).toBe(false);
});

it('validates a versioned, bounded wheel animation plan', () => {
  const plan = {
    version: 1,
    rotation: 89.7,
    turns: 10,
    durationMs: 19000,
    startsAt: '2026-10-21T11:30:03.000Z',
  };
  expect(wheelAnimation.parse(plan)).toEqual(plan);
  for (const patch of [
    { version: 2 },
    { rotation: 360 },
    { rotation: -1 },
    { durationMs: Infinity },
    { turns: 0 },
    { startsAt: 'invalid' },
  ])
    expect(wheelAnimation.safeParse({ ...plan, ...patch }).success).toBe(false);
});

it('validates configurable spin time and direct weight/refund requests', () => {
  for (const wheelSpinSeconds of [5, 20, 60])
    expect(
      gamePreferences.safeParse({ ...defaultGamePreferences, wheelSpinSeconds })
        .success,
    ).toBe(true);
  for (const wheelSpinSeconds of [4, 61, 7.5])
    expect(
      gamePreferences.safeParse({ ...defaultGamePreferences, wheelSpinSeconds })
        .success,
    ).toBe(false);
  const placeId = crypto.randomUUID();
  expect(
    refundInfluenceRequest.safeParse({ placeId, localDate: '2026-10-21' })
      .success,
  ).toBe(true);
  expect(
    setPlaceWeightRequest.safeParse({ placeId, weight: 0.1 }).success,
  ).toBe(true);
  for (const weight of [0, -1, NaN, Infinity])
    expect(setPlaceWeightRequest.safeParse({ placeId, weight }).success).toBe(
      false,
    );
});
