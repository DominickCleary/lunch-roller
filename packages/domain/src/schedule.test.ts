import { describe, expect, it } from 'vitest';
import { evaluateSchedule, localClock } from './index.js';

describe('localClock', () => {
  it('returns a local date, ISO weekday, and minute in the requested timezone', () => {
    expect(localClock(new Date('2026-10-20T10:30:00Z'), 'Europe/Dublin')).toEqual({
      localDate: '2026-10-20',
      weekday: 2,
      time: '11:30',
    });
  });

  it('uses ISO Sunday numbering', () => {
    expect(localClock(new Date('2026-10-25T11:00:00Z'), 'Europe/Dublin')).toEqual({
      localDate: '2026-10-25',
      weekday: 7,
      time: '11:00',
    });
  });

  it('rejects invalid dates and timezones', () => {
    expect(() => localClock(new Date(Number.NaN), 'Europe/Dublin')).toThrow();
    expect(() => localClock(new Date(), 'Mars/Olympus')).toThrow();
  });
});

describe('evaluateSchedule', () => {
  const weekdays = [1, 2, 3, 4, 5];
  const schedule = { timezone: 'Europe/Dublin', time: '11:30', weekdays };

  it('is not due before the configured local time and due at or after it', () => {
    expect(evaluateSchedule(new Date('2026-10-20T10:29:00Z'), schedule)).toEqual({
      localDate: '2026-10-20',
      due: false,
      scheduled: true,
    });
    expect(evaluateSchedule(new Date('2026-10-20T10:30:00Z'), schedule).due).toBe(true);
    expect(evaluateSchedule(new Date('2026-10-20T12:00:00Z'), schedule).due).toBe(true);
  });

  it('skips weekends and respects edited weekdays and timezone', () => {
    expect(evaluateSchedule(new Date('2026-10-25T12:00:00Z'), schedule)).toEqual({
      localDate: '2026-10-25',
      due: false,
      scheduled: false,
    });
    expect(
      evaluateSchedule(new Date('2026-10-25T10:00:00Z'), {
        timezone: 'America/New_York',
        time: '06:00',
        weekdays: [7],
      }),
    ).toEqual({ localDate: '2026-10-25', due: true, scheduled: true });
  });

  it('treats a skipped spring-forward time as due at the first later local time', () => {
    // Dublin jumps from 00:59 to 02:00 on this date.
    expect(
      evaluateSchedule(new Date('2026-03-29T01:00:00Z'), {
        timezone: 'Europe/Dublin',
        time: '01:30',
        weekdays: [7],
      }),
    ).toEqual({ localDate: '2026-03-29', due: true, scheduled: true });
  });

  it('recognizes the repeated autumn local time on both occurrences', () => {
    const autumnSchedule = {
      timezone: 'Europe/Dublin',
      time: '01:30',
      weekdays: [7],
    };
    expect(evaluateSchedule(new Date('2026-10-25T00:30:00Z'), autumnSchedule).due).toBe(true);
    expect(evaluateSchedule(new Date('2026-10-25T01:30:00Z'), autumnSchedule).due).toBe(true);
  });
});
