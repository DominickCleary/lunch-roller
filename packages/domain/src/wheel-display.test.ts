import { describe, expect, it } from 'vitest';
import { wheelDisplay } from './index';

const weekdays = [1, 2, 3, 4, 5];

describe('wheelDisplay', () => {
  it('keeps the saved result through 14:59:59 and rolls at 15:00 local time', () => {
    const schedule = { timezone: 'Europe/Dublin', weekdays };

    expect(
      wheelDisplay(new Date('2026-01-12T14:59:59Z'), schedule, true),
    ).toEqual({ mode: 'result', localDate: '2026-01-12' });
    expect(
      wheelDisplay(new Date('2026-01-12T15:00:00Z'), schedule, true),
    ).toEqual({ mode: 'upcoming', localDate: '2026-01-13' });
  });

  it('applies the cutoff in both standard and summer time', () => {
    const schedule = { timezone: 'Europe/Dublin', weekdays };

    expect(
      wheelDisplay(new Date('2026-07-13T13:59:59Z'), schedule, true),
    ).toEqual({ mode: 'result', localDate: '2026-07-13' });
    expect(
      wheelDisplay(new Date('2026-07-13T14:00:00Z'), schedule, true),
    ).toEqual({ mode: 'upcoming', localDate: '2026-07-14' });
  });

  it.each([
    ['winter weekend', '2026-10-25T12:00:00Z', '2026-10-26'],
    // Dublin has moved to summer time before this Sunday morning.
    ['spring DST weekend', '2026-03-29T12:00:00Z', '2026-03-30'],
  ])('finds Monday across a %s', (_label, instant, expected) => {
    expect(
      wheelDisplay(
        new Date(instant),
        {
          timezone: 'Europe/Dublin',
          weekdays,
        },
        false,
      ),
    ).toEqual({ mode: 'upcoming', localDate: expected });
  });

  it('keeps an undrawn scheduled day visible after 15:00 and overnight', () => {
    const weekdays = [1, 3, 5];

    expect(
      wheelDisplay(
        new Date('2026-04-08T15:30:00Z'),
        { timezone: 'UTC', weekdays },
        false,
      ),
    ).toEqual({ mode: 'upcoming', localDate: '2026-04-08' });
    expect(
      wheelDisplay(
        new Date('2026-04-09T02:00:00Z'),
        { timezone: 'UTC', weekdays },
        false,
      ),
    ).toEqual({ mode: 'upcoming', localDate: '2026-04-10' });
  });

  it('skips unconfigured weekdays and crosses month and year boundaries', () => {
    expect(
      wheelDisplay(
        new Date('2026-12-31T16:00:00Z'),
        { timezone: 'UTC', weekdays: [1] },
        false,
      ),
    ).toEqual({ mode: 'upcoming', localDate: '2027-01-04' });

    expect(
      wheelDisplay(
        new Date('2026-01-30T16:00:00Z'),
        { timezone: 'UTC', weekdays: [1] },
        true,
      ),
    ).toEqual({ mode: 'upcoming', localDate: '2026-02-02' });
  });

  it('chooses the next scheduled date strictly after a saved result', () => {
    expect(
      wheelDisplay(
        new Date('2026-04-08T15:30:00Z'),
        { timezone: 'UTC', weekdays: [1, 3, 5] },
        true,
      ),
    ).toEqual({ mode: 'upcoming', localDate: '2026-04-10' });
  });

  it('moves the wheel preview past a one-time skipped roll', () => {
    expect(
      wheelDisplay(
        new Date('2026-04-08T10:00:00Z'),
        { timezone: 'UTC', weekdays: [1, 3, 5] },
        false,
        '15:00',
        '2026-04-08',
      ),
    ).toEqual({ mode: 'upcoming', localDate: '2026-04-10' });
  });
});
