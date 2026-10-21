import { expect, it } from 'vitest';
import { calendarDateLabel } from './date-label';

it('shows weekday and date without a year, including across DST boundaries', () => {
  expect(calendarDateLabel('2026-10-21')).toBe('Wednesday, 21 October');
  expect(calendarDateLabel('2026-10-25')).toBe('Sunday, 25 October');
  expect(calendarDateLabel('2027-01-01')).toBe('Friday, 1 January');
});
