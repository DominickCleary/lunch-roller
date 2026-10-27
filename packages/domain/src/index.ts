export const RULES = Object.freeze({
  attendanceReward: 10,
  influenceCost: 5,
  addPlaceCost: 20,
  removePlaceCost: 40,
})
export type WeightedPlace = Readonly<{ id: string; logWeight: number }>
export type Influence = 'boost' | 'reduce'

export type LocalClock = Readonly<{
  localDate: string
  weekday: number
  time: string
}>

/** Read the local calendar clock for an explicit instant and IANA timezone. */
export function localClock(now: Date, timezone: string): LocalClock {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid date')

  const parts = new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value
  const year = part('year')
  const month = part('month')
  const day = part('day')
  const hour = part('hour')
  const minute = part('minute')
  const weekday = part('weekday')
  if (!year || !month || !day || !hour || !minute || !weekday)
    throw new Error('Unable to read local clock')

  const isoWeekday = weekday === 'Sun' ? 7 : weekdayIndex(weekday)
  return {
    localDate: `${year}-${month}-${day}`,
    weekday: isoWeekday,
    time: `${hour}:${minute}`,
  }
}

function weekdayIndex(weekday: string): number {
  const index = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
  if (index < 0) throw new Error('Unable to read local weekday')
  return index + 1
}

export function evaluateSchedule(
  now: Date,
  schedule: { timezone: string; time: string; weekdays: number[] },
): { localDate: string; due: boolean; scheduled: boolean } {
  const clock = localClock(now, schedule.timezone)
  const scheduled = schedule.weekdays.includes(clock.weekday)
  return {
    localDate: clock.localDate,
    due: scheduled && clock.time >= schedule.time,
    scheduled,
  }
}

/** Decide which draw the wheel presents, using the workplace's calendar clock. */
export function wheelDisplay(
  now: Date,
  schedule: { timezone: string; weekdays: number[] },
  hasTodayResult: boolean,
  skippedDate?: string | null,
): { mode: 'upcoming'; localDate: string } {
  const clock = localClock(now, schedule.timezone)
  // Keep an undrawn scheduled day visible, including delayed or late-time draws.
  const firstOffset = hasTodayResult ? 1 : 0
  const [year, month, day] = clock.localDate.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  for (let offset = firstOffset; offset <= 14; offset++) {
    const weekday = ((clock.weekday - 1 + offset) % 7) + 1
    if (!schedule.weekdays.includes(weekday)) continue
    // UTC is used only for calendar arithmetic, never to advance a zoned instant by 24h.
    const date = new Date(Date.UTC(year, month - 1, day + offset))
    const localDate = date.toISOString().slice(0, 10)
    if (localDate !== skippedDate) return { mode: 'upcoming', localDate }
  }
  throw new Error('Schedule needs at least one valid weekday')
}

/** Pick today's scheduled date until its draw exists; otherwise the next scheduled calendar date. */
export function nextBettingDate(
  now: Date,
  schedule: { timezone: string; weekdays: number[] },
  hasTodayDraw: boolean,
  skippedDate?: string | null,
): string {
  const clock = localClock(now, schedule.timezone)
  if (
    !hasTodayDraw &&
    schedule.weekdays.includes(clock.weekday) &&
    clock.localDate !== skippedDate
  )
    return clock.localDate
  const [year, month, day] = clock.localDate.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  for (let offset = 1; offset <= 14; offset++) {
    const weekday = ((clock.weekday - 1 + offset) % 7) + 1
    if (!schedule.weekdays.includes(weekday)) continue
    const localDate = new Date(Date.UTC(year, month - 1, day + offset))
      .toISOString()
      .slice(0, 10)
    if (localDate !== skippedDate) return localDate
  }
  throw new Error('Schedule needs at least one valid weekday')
}

function localMinuteAsUtc(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value
  const [year, month, day, hour, minute] = [
    'year',
    'month',
    'day',
    'hour',
    'minute',
  ].map((type) => Number(get(type as Intl.DateTimeFormatPartTypes)))
  if (
    [year, month, day, hour, minute].some((value) => !Number.isInteger(value))
  )
    throw new Error('Unable to resolve scheduled local time')
  return Date.UTC(year!, month! - 1, day!, hour!, minute!)
}

/** Resolve the first instant at which the schedule's local comparison becomes due. */
export function scheduledInstant(
  localDate: string,
  time: string,
  timezone: string,
): Date {
  const [year, month, day] = localDate.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  const [hour, minute] = time.split(':').map(Number) as [number, number]
  const naive = Date.UTC(year, month - 1, day, hour, minute)
  const offsets = new Set<number>()
  for (const offsetHours of [-36, -12, 0, 12, 36]) {
    const sample = new Date(naive + offsetHours * 60 * 60_000)
    const sampleMinute = Math.floor(sample.getTime() / 60_000) * 60_000
    offsets.add((localMinuteAsUtc(sample, timezone) - sampleMinute) / 60_000)
  }
  const candidates = [...offsets].map(
    (offset) => new Date(naive - offset * 60_000),
  )
  const exact = candidates.filter((candidate) => {
    const clock = localClock(candidate, timezone)
    return clock.localDate === localDate && clock.time === time
  })
  if (exact.length)
    return new Date(Math.min(...exact.map((candidate) => candidate.getTime())))

  // During a spring-forward gap, use the first later local minute as the draw does.
  const from =
    Math.min(...candidates.map((candidate) => candidate.getTime())) -
    3 * 60 * 60_000
  const to =
    Math.max(...candidates.map((candidate) => candidate.getTime())) +
    3 * 60 * 60_000
  for (let instant = from; instant <= to; instant += 60_000) {
    const clock = localClock(new Date(instant), timezone)
    if (clock.localDate === localDate && clock.time >= time)
      return new Date(instant)
  }
  throw new Error('Scheduled local date does not exist in this timezone')
}

/** Subtract real elapsed minutes from the scheduled instant, then show its local clock. */
export function bettingCutoff(
  localDate: string,
  scheduledTime: string,
  minutes: number,
  timezone = 'UTC',
): { localDate: string; time: string } {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440)
    throw new Error('Invalid betting cutoff')
  const cutoff = new Date(
    scheduledInstant(localDate, scheduledTime, timezone).getTime() -
      minutes * 60_000,
  )
  const clock = localClock(cutoff, timezone)
  return { localDate: clock.localDate, time: clock.time }
}

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Weight must be finite')
  return value
}

function logMean(weights: readonly number[]): number {
  if (weights.length === 0) return 0
  const max = Math.max(...weights.map(finite))
  return (
    max +
    Math.log(weights.reduce((sum, weight) => sum + Math.exp(weight - max), 0)) -
    Math.log(weights.length)
  )
}

export function probabilities(
  places: readonly WeightedPlace[],
): { id: string; probability: number }[] {
  if (places.length === 0) return []
  if (new Set(places.map((place) => place.id)).size !== places.length)
    throw new Error('Duplicate place ID')
  const max = Math.max(...places.map((place) => finite(place.logWeight)))
  const relative = places.map((place) => Math.exp(place.logWeight - max))
  const total = relative.reduce((sum, weight) => sum + weight, 0)
  return places.map((place, index) => ({
    id: place.id,
    probability: relative[index]! / total,
  }))
}

/** Supply a uniform sample in [0, 1), from server-side crypto in production. */
export function selectPlace(
  places: readonly WeightedPlace[],
  sample: number,
): string | null {
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
    throw new Error('Sample must be in [0, 1)')
  const odds = probabilities(places)
  let cumulative = 0
  let lastPositive: string | null = null
  for (const place of odds) {
    if (place.probability <= 0) continue
    lastPositive = place.id
    cumulative += place.probability
    if (sample < cumulative) return place.id
  }
  return lastPositive
}

export function halveWeight(logWeight: number): number {
  return finite(logWeight) - Math.LN2
}

export function influenceWeight(
  logWeight: number,
  action: Influence,
  multipliers = { boostMultiplier: 1.25, reduceMultiplier: 0.8 },
): number {
  if (action !== 'boost' && action !== 'reduce')
    throw new Error('Unknown influence action')
  const multiplier =
    action === 'boost'
      ? multipliers.boostMultiplier
      : multipliers.reduceMultiplier
  if (
    !Number.isFinite(multiplier) ||
    (action === 'boost'
      ? multiplier <= 1 || multiplier > 100
      : multiplier < 0.01 || multiplier >= 1)
  )
    throw new Error('Invalid influence multiplier')
  return finite(finite(logWeight) + Math.log(multiplier))
}

export function newPlaceLogWeight(
  places: readonly WeightedPlace[],
  multiplier = 1,
): number {
  if (!Number.isFinite(multiplier) || multiplier < 0.01 || multiplier > 100)
    throw new Error('Invalid new-place multiplier')
  return logMean(places.map((place) => place.logWeight)) + Math.log(multiplier)
}

export function spendTokens(
  balance: number,
  action: Influence | 'add-place' | 'remove-place',
  prices: {
    addPlaceCost: number
    boostCost: number
    reduceCost: number
    removePlaceCost?: number
  } = {
    addPlaceCost: RULES.addPlaceCost,
    boostCost: RULES.influenceCost,
    reduceCost: RULES.influenceCost,
    removePlaceCost: RULES.removePlaceCost,
  },
): number {
  if (!Number.isSafeInteger(balance) || balance < 0)
    throw new Error('Invalid token balance')
  if (!['boost', 'reduce', 'add-place', 'remove-place'].includes(action))
    throw new Error('Unknown purchase')
  const cost =
    action === 'add-place'
      ? prices.addPlaceCost
      : action === 'remove-place'
        ? (prices.removePlaceCost ?? RULES.removePlaceCost)
        : action === 'boost'
          ? prices.boostCost
          : prices.reduceCost
  if (!Number.isSafeInteger(cost) || cost < 1 || cost > 2147483647)
    throw new Error('Invalid token cost')
  if (balance < cost) throw new Error('Insufficient tokens')
  return balance - cost
}

/** Apply permanent post-draw changes without changing the saved selection odds. */
export function postDrawWeights<
  T extends WeightedPlace & { healthLevel: 'treat' | 'balanced' | 'healthy' },
>(
  places: readonly T[],
  winnerId: string,
  healthRule: { enabled: boolean; multiplier: number },
): T[] {
  const winner = places.find((place) => place.id === winnerId)
  if (!winner) throw new Error('Winner must be an active place.')
  if (
    !Number.isFinite(healthRule.multiplier) ||
    healthRule.multiplier <= 1 ||
    healthRule.multiplier > 100
  )
    throw new Error('Invalid health bonus multiplier.')
  return places.map((place) => ({
    ...place,
    logWeight: finite(
      place.id === winnerId
        ? halveWeight(place.logWeight)
        : healthRule.enabled &&
            winner.healthLevel === 'treat' &&
            place.healthLevel === 'healthy'
          ? place.logWeight + Math.log(healthRule.multiplier)
          : place.logWeight,
    ),
  }))
}

/** Point inside the committed winner using the same saved sample that selected it.
 * The pointer is at 3 o'clock (90 degrees in a CSS conic gradient).
 */
export function wheelLandingRotation(
  snapshot: readonly { placeId: string; probability: number }[],
  winnerId: string,
  sample: number,
): number {
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
    throw new Error('Sample must be in [0, 1)')
  let before = 0
  const total = snapshot.reduce((sum, place) => sum + place.probability, 0)
  if (
    !Number.isFinite(total) ||
    total <= 0 ||
    snapshot.some(
      (place) => !Number.isFinite(place.probability) || place.probability < 0,
    )
  )
    throw new Error('Invalid wheel snapshot.')
  for (const place of snapshot) {
    if (place.placeId === winnerId) {
      if (place.probability <= 0)
        throw new Error('Winner needs a positive segment.')
      const start = (before / total) * 360
      const width = (place.probability / total) * 360
      // Avoid an exact stroke/boundary landing while retaining convincing near misses.
      const inset = Math.min(0.3, width * 0.02)
      const offset = Math.max(
        inset,
        Math.min(
          width - inset,
          ((sample - before) / place.probability) * width,
        ),
      )
      const angle = start + offset
      return (((90 - angle) % 360) + 360) % 360
    }
    before += place.probability
  }
  throw new Error('Winner must be in the saved snapshot.')
}
