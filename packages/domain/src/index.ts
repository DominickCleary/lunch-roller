export const RULES = Object.freeze({
  attendanceReward: 10,
  influenceCost: 5,
  addPlaceCost: 20,
  removePlaceCost: 40,
});
export type WeightedPlace = Readonly<{ id: string; logWeight: number }>;
export type Influence = 'boost' | 'reduce';

export type LocalClock = Readonly<{
  localDate: string;
  weekday: number;
  time: string;
}>;

/** Read the local calendar clock for an explicit instant and IANA timezone. */
export function localClock(now: Date, timezone: string): LocalClock {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid date');

  const parts = new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  const hour = part('hour');
  const minute = part('minute');
  const weekday = part('weekday');
  if (!year || !month || !day || !hour || !minute || !weekday)
    throw new Error('Unable to read local clock');

  const isoWeekday = weekday === 'Sun' ? 7 : weekdayIndex(weekday);
  return {
    localDate: `${year}-${month}-${day}`,
    weekday: isoWeekday,
    time: `${hour}:${minute}`,
  };
}

function weekdayIndex(weekday: string): number {
  const index = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  if (index < 0) throw new Error('Unable to read local weekday');
  return index + 1;
}

export function evaluateSchedule(
  now: Date,
  schedule: { timezone: string; time: string; weekdays: number[] },
): { localDate: string; due: boolean; scheduled: boolean } {
  const clock = localClock(now, schedule.timezone);
  const scheduled = schedule.weekdays.includes(clock.weekday);
  return {
    localDate: clock.localDate,
    due: scheduled && clock.time >= schedule.time,
    scheduled,
  };
}

/** Decide which draw the wheel presents, using the workplace's calendar clock. */
export function wheelDisplay(
  now: Date,
  schedule: { timezone: string; weekdays: number[] },
  hasTodayResult: boolean,
  switchTime = '15:00',
): { mode: 'result' | 'upcoming'; localDate: string } {
  const clock = localClock(now, schedule.timezone);
  if (hasTodayResult && clock.time < switchTime)
    return { mode: 'result', localDate: clock.localDate };

  // Keep an undrawn scheduled day visible, including delayed or late-time draws.
  const firstOffset = hasTodayResult ? 1 : 0;
  const [year, month, day] = clock.localDate.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  for (let offset = firstOffset; offset <= 7; offset++) {
    const weekday = ((clock.weekday - 1 + offset) % 7) + 1;
    if (!schedule.weekdays.includes(weekday)) continue;
    // UTC is used only for calendar arithmetic, never to advance a zoned instant by 24h.
    const date = new Date(Date.UTC(year, month - 1, day + offset));
    return { mode: 'upcoming', localDate: date.toISOString().slice(0, 10) };
  }
  throw new Error('Schedule needs at least one valid weekday');
}

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Weight must be finite');
  return value;
}

function logMean(weights: readonly number[]): number {
  if (weights.length === 0) return 0;
  const max = Math.max(...weights.map(finite));
  return (
    max +
    Math.log(weights.reduce((sum, weight) => sum + Math.exp(weight - max), 0)) -
    Math.log(weights.length)
  );
}

export function probabilities(
  places: readonly WeightedPlace[],
): { id: string; probability: number }[] {
  if (places.length === 0) return [];
  if (new Set(places.map((place) => place.id)).size !== places.length)
    throw new Error('Duplicate place ID');
  const max = Math.max(...places.map((place) => finite(place.logWeight)));
  const relative = places.map((place) => Math.exp(place.logWeight - max));
  const total = relative.reduce((sum, weight) => sum + weight, 0);
  return places.map((place, index) => ({
    id: place.id,
    probability: relative[index]! / total,
  }));
}

/** Supply a uniform sample in [0, 1), from server-side crypto in production. */
export function selectPlace(
  places: readonly WeightedPlace[],
  sample: number,
): string | null {
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
    throw new Error('Sample must be in [0, 1)');
  const odds = probabilities(places);
  let cumulative = 0;
  let lastPositive: string | null = null;
  for (const place of odds) {
    if (place.probability <= 0) continue;
    lastPositive = place.id;
    cumulative += place.probability;
    if (sample < cumulative) return place.id;
  }
  return lastPositive;
}

export function halveWeight(logWeight: number): number {
  return finite(logWeight) - Math.LN2;
}

export function influenceWeight(
  logWeight: number,
  action: Influence,
  multipliers = { boostMultiplier: 1.25, reduceMultiplier: 0.8 },
): number {
  if (action !== 'boost' && action !== 'reduce')
    throw new Error('Unknown influence action');
  const multiplier =
    action === 'boost'
      ? multipliers.boostMultiplier
      : multipliers.reduceMultiplier;
  if (
    !Number.isFinite(multiplier) ||
    (action === 'boost'
      ? multiplier <= 1 || multiplier > 100
      : multiplier < 0.01 || multiplier >= 1)
  )
    throw new Error('Invalid influence multiplier');
  return finite(finite(logWeight) + Math.log(multiplier));
}

export function newPlaceLogWeight(
  places: readonly WeightedPlace[],
  multiplier = 1,
): number {
  if (!Number.isFinite(multiplier) || multiplier < 0.01 || multiplier > 100)
    throw new Error('Invalid new-place multiplier');
  return logMean(places.map((place) => place.logWeight)) + Math.log(multiplier);
}

export function spendTokens(
  balance: number,
  action: Influence | 'add-place' | 'remove-place',
  prices: {
    addPlaceCost: number;
    boostCost: number;
    reduceCost: number;
    removePlaceCost?: number;
  } = {
    addPlaceCost: RULES.addPlaceCost,
    boostCost: RULES.influenceCost,
    reduceCost: RULES.influenceCost,
    removePlaceCost: RULES.removePlaceCost,
  },
): number {
  if (!Number.isSafeInteger(balance) || balance < 0)
    throw new Error('Invalid token balance');
  if (!['boost', 'reduce', 'add-place', 'remove-place'].includes(action))
    throw new Error('Unknown purchase');
  const cost =
    action === 'add-place'
      ? prices.addPlaceCost
      : action === 'remove-place'
        ? (prices.removePlaceCost ?? RULES.removePlaceCost)
        : action === 'boost'
          ? prices.boostCost
          : prices.reduceCost;
  if (!Number.isSafeInteger(cost) || cost < 1 || cost > 2147483647)
    throw new Error('Invalid token cost');
  if (balance < cost) throw new Error('Insufficient tokens');
  return balance - cost;
}
