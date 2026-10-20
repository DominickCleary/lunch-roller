import { describe, expect, it } from 'vitest';
import {
  halveWeight,
  influenceWeight,
  newPlaceLogWeight,
  probabilities,
  RULES,
  selectPlace,
  spendTokens,
} from './index';

const places = [
  { id: 'a', logWeight: Math.log(1) },
  { id: 'b', logWeight: Math.log(3) },
];
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
