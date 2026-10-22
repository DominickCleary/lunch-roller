import { expect, it } from 'vitest';
import { countdownState, formatCountdown } from './countdown';
import type { BettingWindow } from '@lunch/contracts';

const window: BettingWindow = {
  localDate: '2026-10-23',
  timezone: 'Europe/Dublin',
  drawTime: '11:30',
  cutoffMinutes: 10,
  cutoffLocalDate: '2026-10-23',
  cutoffLocalTime: '11:20',
  cutoffAt: '2026-10-23T10:20:00.000Z',
  open: true,
};

it('counts down to the saved cutoff and scheduled spin', () => {
  const state = countdownState({
    now: Date.parse('2026-10-23T10:19:59.100Z'),
    localDate: '2026-10-23',
    drawTime: '11:30',
    timezone: 'Europe/Dublin',
    window,
    fallbackCutoffMinutes: 10,
  });
  expect(state.cutoffSeconds).toBe(1);
  expect(state.drawSeconds).toBe(601);
  expect(state.bettingClosed).toBe(false);
  expect(state.drawDue).toBe(false);
});

it('keeps a saved cutoff when preferences or client time differ', () => {
  const state = countdownState({
    now: Date.parse('2026-10-23T10:20:00.000Z'),
    localDate: '2026-10-23',
    drawTime: '11:30',
    timezone: 'Europe/Dublin',
    window: { ...window, cutoffMinutes: 30 },
    fallbackCutoffMinutes: 5,
  });
  expect(state.cutoffAt).toBe(Date.parse(window.cutoffAt!));
  expect(state.bettingClosed).toBe(true);
});

it('handles the due state and formats long and short countdowns', () => {
  const state = countdownState({
    now: Date.parse('2026-10-23T10:31:00.000Z'),
    localDate: '2026-10-23',
    drawTime: '11:30',
    timezone: 'Europe/Dublin',
    window,
    fallbackCutoffMinutes: 10,
  });
  expect(state.drawDue).toBe(true);
  expect(state.drawSeconds).toBe(0);
  expect(formatCountdown(3661)).toBe('01:01:01');
  expect(formatCountdown(176461)).toBe('2d 01:01:01');
});

it('computes a fallback cutoff from the saved market window when cutoffAt is absent', () => {
  const state = countdownState({
    now: Date.parse('2026-10-23T10:19:00.000Z'),
    localDate: '2026-10-23',
    drawTime: '11:30',
    timezone: 'Europe/Dublin',
    window: { ...window, cutoffAt: undefined, cutoffMinutes: 10 },
    fallbackCutoffMinutes: 5,
  });
  expect(state.cutoffAt).toBe(Date.parse('2026-10-23T10:20:00.000Z'));
});

it('uses configured cutoff while the matching market is loading after rollover', () => {
  const args = {
    now: Date.parse('2026-10-26T11:10:00.000Z'),
    localDate: '2026-10-26',
    drawTime: '11:30',
    timezone: 'Europe/Dublin',
    fallbackCutoffMinutes: 10,
  };
  for (const market of [null, window]) {
    const state = countdownState({ ...args, window: market });
    expect(state.cutoffAt).toBe(Date.parse('2026-10-26T11:20:00.000Z'));
    expect(state.cutoffSeconds).toBe(600);
    expect(state.drawSeconds).toBe(1200);
  }
});

it('resolves DST transition times with the server scheduling rules', () => {
  const state = countdownState({
    now: Date.parse('2026-03-29T00:45:00.000Z'),
    localDate: '2026-03-29',
    drawTime: '01:30',
    timezone: 'Europe/Dublin',
    fallbackCutoffMinutes: 10,
    window: null,
  });
  expect(state.drawAt).toBe(Date.parse('2026-03-29T01:00:00.000Z'));
  expect(state.cutoffAt).toBe(Date.parse('2026-03-29T00:50:00.000Z'));
});

it('keeps both timers on the saved market schedule during settings refresh', () => {
  const state = countdownState({
    now: Date.parse('2026-10-23T10:10:00.000Z'),
    localDate: window.localDate,
    drawTime: '15:00',
    timezone: 'UTC',
    fallbackCutoffMinutes: 5,
    window,
  });
  expect(state.drawAt).toBe(Date.parse('2026-10-23T10:30:00.000Z'));
  expect(state.cutoffSeconds).toBe(600);
  expect(state.drawSeconds).toBe(1200);
});
