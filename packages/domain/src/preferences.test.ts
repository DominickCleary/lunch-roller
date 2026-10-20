import { describe, expect, it } from 'vitest';
import { wheelDisplay } from './index.js';

describe('wheel display preference', () => {
  const weekdays = [1, 2, 3, 4, 5];

  it('uses the configured cutoff immediately before, at, and after the local minute', () => {
    const schedule = { timezone: 'Europe/Dublin', weekdays };
    expect(
      wheelDisplay(new Date('2026-10-20T20:58:00Z'), schedule, true, '22:00'),
    ).toEqual({ mode: 'result', localDate: '2026-10-20' });
    expect(
      wheelDisplay(new Date('2026-10-20T21:00:00Z'), schedule, true, '22:00'),
    ).toEqual({ mode: 'upcoming', localDate: '2026-10-21' });
    expect(
      wheelDisplay(new Date('2026-10-20T21:01:00Z'), schedule, true, '22:00'),
    ).toEqual({ mode: 'upcoming', localDate: '2026-10-21' });
  });

  it('supports midnight and the last minute of the day in the configured timezone', () => {
    const schedule = { timezone: 'America/New_York', weekdays };
    expect(
      wheelDisplay(new Date('2026-10-20T04:00:00Z'), schedule, true, '00:00'),
    ).toEqual({ mode: 'upcoming', localDate: '2026-10-21' });
    expect(
      wheelDisplay(new Date('2026-10-20T03:58:00Z'), schedule, true, '23:59'),
    ).toEqual({ mode: 'result', localDate: '2026-10-19' });
    expect(
      wheelDisplay(new Date('2026-10-20T03:59:00Z'), schedule, true, '23:59'),
    ).toEqual({ mode: 'upcoming', localDate: '2026-10-20' });
  });

  it('preserves pending draws, weekends, and the default cutoff', () => {
    const schedule = { timezone: 'Europe/Dublin', weekdays };
    expect(
      wheelDisplay(new Date('2026-10-20T15:00:00Z'), schedule, true),
    ).toEqual({ mode: 'upcoming', localDate: '2026-10-21' });
    expect(
      wheelDisplay(new Date('2026-10-20T22:00:00Z'), schedule, false, '22:00'),
    ).toEqual({ mode: 'upcoming', localDate: '2026-10-20' });
    expect(
      wheelDisplay(new Date('2026-10-23T15:00:00Z'), schedule, true, '15:00'),
    ).toEqual({ mode: 'upcoming', localDate: '2026-10-26' });
  });
});
