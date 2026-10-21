import { describe, expect, it } from 'vitest';
import {
  halveWeight,
  postDrawWeights,
  wheelLandingRotation,
  influenceWeight,
  newPlaceLogWeight,
  probabilities,
  RULES,
  selectPlace,
  spendTokens,
  nextBettingDate,
  bettingCutoff,
} from './index';

it('uses scheduled local dates and computes betting cutoffs across midnight', () => {
  const schedule = { timezone: 'Europe/Dublin', weekdays: [1, 2, 3, 4, 5] };
  expect(
    nextBettingDate(new Date('2026-10-21T08:00:00Z'), schedule, false),
  ).toBe('2026-10-21');
  expect(
    nextBettingDate(new Date('2026-10-21T08:00:00Z'), schedule, true),
  ).toBe('2026-10-22');
  expect(bettingCutoff('2026-10-21', '11:30', 5)).toEqual({
    localDate: '2026-10-21',
    time: '11:25',
  });
  expect(bettingCutoff('2026-10-21', '00:02', 5)).toEqual({
    localDate: '2026-10-20',
    time: '23:57',
  });
  expect(bettingCutoff('2026-03-29', '01:30', 5, 'Europe/Dublin')).toEqual({
    localDate: '2026-03-29',
    time: '00:55',
  });
  expect(bettingCutoff('2026-10-25', '01:30', 5, 'Europe/Dublin')).toEqual({
    localDate: '2026-10-25',
    time: '01:25',
  });
});

it('moves the next betting date past a one-time skipped roll', () => {
  const schedule = { timezone: 'UTC', weekdays: [1, 2, 3, 4, 5, 6, 7] };
  expect(
    nextBettingDate(
      new Date('2026-10-21T08:00:00Z'),
      schedule,
      false,
      '2026-10-21',
    ),
  ).toBe('2026-10-22');
  expect(
    nextBettingDate(
      new Date('2026-10-21T08:00:00Z'),
      schedule,
      false,
      '2026-10-23',
    ),
  ).toBe('2026-10-21');
});

const places = [
  { id: 'a', logWeight: Math.log(1) },
  { id: 'b', logWeight: Math.log(3) },
];
it('uses configured prices and relative weight changes without changing winner decay', () => {
  const prices = { addPlaceCost: 30, boostCost: 7, reduceCost: 3 };
  expect(spendTokens(30, 'add-place', prices)).toBe(0);
  expect(spendTokens(10, 'boost', prices)).toBe(3);
  expect(spendTokens(10, 'reduce', prices)).toBe(7);
  expect(() => spendTokens(6, 'boost', prices)).toThrow('Insufficient');
  const multipliers = { boostMultiplier: 2, reduceMultiplier: 0.25 };
  expect(influenceWeight(-10000, 'boost', multipliers)).toBeCloseTo(
    -10000 + Math.log(2),
  );
  expect(influenceWeight(-10000, 'reduce', multipliers)).toBeCloseTo(
    -10000 + Math.log(0.25),
  );
  expect(() =>
    influenceWeight(0, 'boost', { ...multipliers, boostMultiplier: Infinity }),
  ).toThrow();
  expect(() =>
    influenceWeight(0, 'reduce', { ...multipliers, reduceMultiplier: 1 }),
  ).toThrow();
  expect(halveWeight(0)).toBe(-Math.LN2);
});
describe('weighted wheel', () => {
  it('selects proportionally at interval boundaries', () => {
    expect(probabilities(places)[0]!.probability).toBeCloseTo(0.25);
    expect(probabilities(places)[1]!.probability).toBeCloseTo(0.75);
    expect(selectPlace(places, 0)).toBe('a');
    expect(selectPlace(places, 0.249999)).toBe('a');
    expect(selectPlace(places, 0.25)).toBe('b');
    expect(selectPlace(places, 0.999999)).toBe('b');
  });
  it('handles no options and a single option', () => {
    expect(selectPlace([], 0.5)).toBeNull();
    expect(selectPlace([places[0]!], 0.99)).toBe('a');
  });
  it('preserves odds at extremely small absolute weights', () => {
    const tiny = places.map((p) => ({ ...p, logWeight: p.logWeight - 10000 }));
    expect(probabilities(tiny)[0]!.probability).toBeCloseTo(0.25);
    expect(Number.isFinite(newPlaceLogWeight(tiny))).toBe(true);
  });
  it('does not select a numerically zero-probability entry', () => {
    expect(
      selectPlace(
        [
          { id: 'tiny', logWeight: -10000 },
          { id: 'large', logWeight: 0 },
        ],
        0,
      ),
    ).toBe('large');
  });
  it('rejects invalid weights, samples, and duplicate IDs', () => {
    expect(() => probabilities([{ id: 'x', logWeight: NaN }])).toThrow();
    expect(() => probabilities([places[0]!, places[0]!])).toThrow();
    for (const value of [-1, 1, NaN, Infinity])
      expect(() => selectPlace(places, value)).toThrow();
  });
  it('halves only the selected weight without resetting others', () => {
    expect(Math.exp(halveWeight(Math.log(8)))).toBeCloseTo(4);
    expect(Math.exp(halveWeight(halveWeight(Math.log(8))))).toBeCloseTo(2);
  });
  it('uses the arithmetic mean for new places', () => {
    expect(Math.exp(newPlaceLogWeight(places))).toBeCloseTo(2);
    expect(newPlaceLogWeight([])).toBe(0);
  });
});
describe('economy', () => {
  it('applies both influence multipliers', () => {
    expect(Math.exp(influenceWeight(Math.log(4), 'boost'))).toBeCloseTo(5);
    expect(Math.exp(influenceWeight(Math.log(4), 'reduce'))).toBeCloseTo(3.2);
  });
  it('charges fixed prices and permits spending the exact balance', () => {
    expect(spendTokens(10, 'boost')).toBe(5);
    expect(spendTokens(5, 'reduce')).toBe(0);
    expect(spendTokens(20, 'add-place')).toBe(0);
    expect(RULES.attendanceReward).toBe(10);
  });
  it('rejects insufficient or invalid balances', () => {
    expect(() => spendTokens(4, 'boost')).toThrow('Insufficient');
    expect(() => spendTokens(19, 'add-place')).toThrow('Insufficient');
    for (const balance of [-1, 1.5, NaN])
      expect(() => spendTokens(balance, 'boost')).toThrow();
  });
});

it('permanently boosts healthy alternatives only after a Treat win, preserving relative extreme weights', () => {
  const options = [
    { id: 't', logWeight: -10000, healthLevel: 'treat' as const },
    { id: 'b', logWeight: -10000, healthLevel: 'balanced' as const },
    { id: 'h', logWeight: -10000, healthLevel: 'healthy' as const },
  ];
  const rule = { enabled: true, multiplier: 1.25 };
  const next = postDrawWeights(options, 't', rule);
  expect(next[0]!.logWeight).toBeCloseTo(-10000 - Math.LN2);
  expect(next[1]!.logWeight).toBe(-10000);
  expect(next[2]!.logWeight).toBeCloseTo(-10000 + Math.log(1.25));
  expect(probabilities(next).map((entry) => entry.probability)).toEqual([
    expect.closeTo(0.5 / 2.75),
    expect.closeTo(1 / 2.75),
    expect.closeTo(1.25 / 2.75),
  ]);
  expect(options[0]!.logWeight).toBe(-10000);
  for (const winner of ['b', 'h']) {
    const result = postDrawWeights(options, winner, rule);
    expect(result.find((entry) => entry.id === 't')!.logWeight).toBe(-10000);
    expect(result.find((entry) => entry.id === winner)!.logWeight).toBeCloseTo(
      -10000 - Math.LN2,
    );
  }
  expect(
    postDrawWeights(options, 't', { ...rule, enabled: false })[2]!.logWeight,
  ).toBe(-10000);
  expect(() => postDrawWeights(options, 'missing', rule)).toThrow();
  for (const multiplier of [1, 0, 101, Infinity, NaN])
    expect(() =>
      postDrawWeights(options, 't', { enabled: true, multiplier }),
    ).toThrow();
});

it('lands within the saved winning slice with varied offsets and a safe inset at exact boundaries', () => {
  const weights = [
    { id: 'a', logWeight: Math.log(2) },
    { id: 'b', logWeight: Math.log(3) },
    { id: 'c', logWeight: Math.log(5) },
  ];
  const snapshot = probabilities(weights).map((place) => ({
    placeId: place.id,
    probability: place.probability,
  }));
  const landed = new Set<number>();
  for (let index = 0; index < 1000; index++) {
    const sample = index / 1000;
    const winner = selectPlace(weights, sample)!;
    const rotation = wheelLandingRotation(snapshot, winner, sample);
    const angle = (((90 - rotation) % 360) + 360) % 360;
    const winnerIndex = snapshot.findIndex((place) => place.placeId === winner);
    const start = snapshot
      .slice(0, winnerIndex)
      .reduce((sum, place) => sum + place.probability * 360, 0);
    expect(angle).toBeGreaterThan(start);
    expect(angle).toBeLessThan(
      start + snapshot[winnerIndex]!.probability * 360,
    );
    landed.add(rotation);
  }
  expect(landed.size).toBeGreaterThan(900);
  const boundary = wheelLandingRotation(snapshot, 'a', 0);
  expect((90 - boundary + 360) % 360).toBeCloseTo(0.3);
  expect(() => wheelLandingRotation(snapshot, 'missing', 0.2)).toThrow();
  expect(() => wheelLandingRotation(snapshot, 'a', 1)).toThrow();
  expect(() =>
    wheelLandingRotation([{ placeId: 'a', probability: 0 }], 'a', 0),
  ).toThrow();
});
