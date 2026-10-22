import { describe, expect, it } from 'vitest';
import { wheelDisplay } from './index.js';

describe('wheel display preference', () => {
  const weekdays = [1, 2, 3, 4, 5];

  it('always uses the next scheduled spin after a completed draw', () => {
    const schedule = { timezone: 'Europe/Dublin', weekdays };
    expect(
      wheelDisplay(new Date('2026-10-20T20:58:00Z'), schedule, true),
    ).toEqual({ mode: 'upcoming', localDate: '2026-10-21' });
    expect(
      wheelDisplay(new Date('2026-10-20T21:00:00Z'), schedule, true),
    ).toEqual({ mode: 'upcoming', localDate: '2026-10-21' });
    expect(
      wheelDisplay(new Date('2026-10-20T21:01:00Z'), schedule, true),
    ).toEqual({ mode: 'upcoming', localDate: '2026-10-21' });
  });

  it('supports midnight and the last minute of the day in the configured timezone', () => {
    const schedule = { timezone: 'America/New_York', weekdays };
    expect(
      wheelDisplay(new Date('2026-10-20T04:00:00Z'), schedule, true),
    ).toEqual({ mode: 'upcoming', localDate: '2026-10-21' });
    expect(
      wheelDisplay(new Date('2026-10-20T03:58:00Z'), schedule, true),
    ).toEqual({ mode: 'upcoming', localDate: '2026-10-20' });
    expect(
      wheelDisplay(new Date('2026-10-20T03:59:00Z'), schedule, true),
    ).toEqual({ mode: 'upcoming', localDate: '2026-10-20' });
  });

  it('preserves pending draws and weekends', () => {
    const schedule = { timezone: 'Europe/Dublin', weekdays };
    expect(
      wheelDisplay(new Date('2026-10-20T15:00:00Z'), schedule, true),
    ).toEqual({ mode: 'upcoming', localDate: '2026-10-21' });
    expect(
      wheelDisplay(new Date('2026-10-20T22:00:00Z'), schedule, false),
    ).toEqual({ mode: 'upcoming', localDate: '2026-10-20' });
    expect(
      wheelDisplay(new Date('2026-10-23T15:00:00Z'), schedule, true),
    ).toEqual({ mode: 'upcoming', localDate: '2026-10-26' });
  });
});
