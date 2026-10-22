import { z } from 'zod';

export const id = z.uuid();
export const name = z.string().trim().min(1).max(100);
export const participantSelection = z.object({ participantId: id });
export const participant = z.object({ id, name, active: z.boolean() });
export const participantRemoval = z.object({
  participantId: id,
  action: z.enum(['deleted', 'archived']),
});
export type ParticipantRemoval = z.infer<typeof participantRemoval>;
export const setupStatus = z.object({
  completed: z.boolean(),
  participantCount: z.number().int().nonnegative(),
  placeCount: z.number().int().nonnegative(),
});
export type SetupStatus = z.infer<typeof setupStatus>;
export const gamePreferences = z.object({
  postDrawDelayMinutes: z.number().int().min(0).max(1440).default(0),
  wheelSpinSeconds: z.number().int().min(5).max(60).default(20),
  wheelSwitchTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  checkInPledge: z.string().trim().min(1).max(500),
  bettingCloseMinutes: z.number().int().min(0).max(1440),
});
export type GamePreferences = z.infer<typeof gamePreferences>;
export type GamePreferencesInput = z.input<typeof gamePreferences>;
export const defaultGamePreferences: GamePreferences = {
  postDrawDelayMinutes: 0,
  wheelSpinSeconds: 20,
  wheelSwitchTime: '15:00',
  checkInPledge: 'I pledge that I actually obeyed the wheel',
  bettingCloseMinutes: 5,
};
const tokenAmount = z.number().int().min(1).max(2147483647);
export const economySettings = z.object({
  attendanceReward: tokenAmount,
  addPlaceCost: tokenAmount,
  boostCost: tokenAmount,
  reduceCost: tokenAmount,
  removePlaceCost: tokenAmount,
  boostMultiplier: z.number().finite().gt(1).max(100),
  reduceMultiplier: z.number().finite().min(0.01).lt(1),
  newPlaceMultiplier: z.number().finite().min(0.01).max(100),
});
export type EconomySettings = z.infer<typeof economySettings>;
export const defaultEconomySettings: EconomySettings = {
  attendanceReward: 10,
  addPlaceCost: 20,
  boostCost: 5,
  reduceCost: 5,
  removePlaceCost: 40,
  boostMultiplier: 1.25,
  reduceMultiplier: 0.8,
  newPlaceMultiplier: 1,
};
export const attendanceStatus = z.object({
  drawId: id.nullable(),
  checkedIn: z.boolean(),
  open: z.boolean(),
});
export type AttendanceStatus = z.infer<typeof attendanceStatus>;
export const healthLevel = z.enum(['treat', 'balanced', 'healthy']);
export type HealthLevel = z.infer<typeof healthLevel>;
export const healthRuleSettings = z.object({
  enabled: z.boolean(),
  multiplier: z.number().finite().gt(1).max(100),
});
export type HealthRuleSettings = z.infer<typeof healthRuleSettings>;
export const defaultHealthRuleSettings: HealthRuleSettings = {
  enabled: true,
  multiplier: 1.25,
};
export const healthBonus = z.object({
  multiplier: z.number().finite().gt(1).max(100),
  places: z.array(
    z.object({
      placeId: id,
      name,
      probabilityBefore: z.number().min(0).max(1),
      probabilityAfter: z.number().min(0).max(1),
    }),
  ),
});
export type HealthBonus = z.infer<typeof healthBonus>;
export const transferRequest = z.object({
  recipientId: id,
  amount: tokenAmount,
});
export const transferResponse = z.object({
  transferId: id,
  recipientId: id,
  recipientName: name,
  amount: tokenAmount,
  balance: z.number().int().nonnegative(),
});
export type TransferRequest = z.infer<typeof transferRequest>;
export type TransferResponse = z.infer<typeof transferResponse>;
export const place = z.object({
  id,
  name,
  active: z.boolean(),
  logWeight: z.number().finite(),
  healthLevel: healthLevel.default('balanced'),
});
export const createParticipant = z.object({ name });
export const updateParticipant = z.object({
  name: name.optional(),
  active: z.boolean().optional(),
});
export const createPlace = z.object({
  name,
  healthLevel: healthLevel.default('balanced'),
});
export const updatePlace = z.object({
  healthLevel: healthLevel.optional(),
  name: name.optional(),
  active: z.boolean().optional(),
});
export const attendanceRequest = z.object({ drawId: id });
export const purchaseRequest = z.object({
  placeId: id,
  action: z.enum(['boost', 'reduce', 'remove']),
});
export const schedule = z.object({
  timezone: z.string().refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Invalid IANA timezone'),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  weekdays: z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .max(7)
    .refine((days) => new Set(days).size === days.length, 'Duplicate weekdays'),
});
export const drawSkip = z.object({
  localDate: z.iso.date().nullable(),
  cancellable: z.boolean(),
});
export const drawSkipRequest = z.object({ skip: z.boolean() });
export const defaultSchedule = {
  timezone: 'Europe/Dublin',
  time: '11:30',
  weekdays: [1, 2, 3, 4, 5],
} satisfies z.infer<typeof schedule>;
export const wheelAnimation = z.object({
  version: z.literal(1),
  rotation: z.number().finite().min(0).lt(360),
  turns: z.number().int().min(1).max(40),
  durationMs: z.number().int().min(1000).max(60000),
  startsAt: z.iso.datetime(),
});
export type WheelAnimation = z.infer<typeof wheelAnimation>;
export const draw = z.object({
  id,
  localDate: z.iso.date(),
  placeId: id,
  placeName: name,
  drawnAt: z.iso.datetime(),
  timezone: z.string(),
  healthBonus: healthBonus.nullable().optional(),
  animation: wheelAnimation.optional(),
  snapshot: z.array(
    z.object({
      placeId: id,
      name,
      logWeight: z.number().finite(),
      probability: z.number().min(0).max(1),
      healthLevel: healthLevel.optional(),
    }),
  ),
});
export const todayResponse = z.object({
  serverTime: z.iso.datetime().optional(),
  localDate: z.iso.date(),
  schedule,
  preferences: gamePreferences,
  economy: economySettings,
  healthRule: healthRuleSettings.optional(),
  wheel: z.object({
    mode: z.enum(['result', 'upcoming']),
    localDate: z.iso.date(),
  }),
  status: z.enum([
    'pending',
    'drawn',
    'no-options',
    'not-scheduled',
    'skipped',
  ]),
  result: draw.nullable(),
  odds: z.array(
    z.object({
      placeId: id,
      name,
      probability: z.number().min(0).max(1),
      healthLevel: healthLevel.optional(),
    }),
  ),
});
export const tokenActivityEntry = z.object({
  id,
  delta: z.number().int(),
  kind: z.string(),
  reason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  placeId: id.nullable().default(null),
  placeName: name.nullable().default(null),
  betId: id.nullable().default(null),
  betLocalDate: z.iso.date().nullable().default(null),
  influenceLocalDate: z.iso.date().nullable().optional(),
  inferredDrawLocalDate: z.iso.date().optional(),
  transferId: id.nullable().optional(),
  counterpartyId: id.nullable().optional(),
});
export const attendanceResponse = z.object({
  drawId: id,
  awardedTokens: z.number().int(),
  balance: z.number().int().nonnegative(),
});
export const purchaseResponse = z.object({
  place,
  spentTokens: z.number().int().nonnegative(),
  refundedTokens: z.number().int().positive().optional(),
  balance: z.number().int().nonnegative(),
});
export const betView = z.object({
  id,
  localDate: z.iso.date(),
  placeId: id,
  placeName: name,
  stake: z.number().int().positive().max(2147483647),
  status: z.enum(['open', 'won', 'lost', 'cancelled', 'refunded']),
  payout: z.number().int().nonnegative().max(2147483647).nullable(),
  probability: z.number().finite().min(0).max(1).nullable(),
  updatedAt: z.iso.datetime(),
  settledAt: z.iso.datetime().nullable(),
});
export const walletResponse = z.object({
  balance: z.number().int().nonnegative(),
  ledger: z.array(tokenActivityEntry),
  bets: z.array(betView).default([]),
});
export const tokenOverviewResponse = z.object({
  localDate: z.iso.date(),
  timezone: z.string(),
  rows: z.array(
    z.object({
      participantId: id,
      participantName: name,
      balance: z.number().int().nonnegative(),
      totalBalance: z.number().int().nonnegative(),
      rank: z.number().int().positive(),
      todayDelta: z.number().int(),
    }),
  ),
});
export const dailyActivityQuery = z.object({
  date: z.iso.date().optional(),
  scope: z.enum(['day', 'draw']).optional(),
});
export const drawInfluencePosition = z.object({
  placeId: id,
  placeName: name,
  participantId: id,
  participantName: name,
  boosts: z.number().int().nonnegative(),
  reductions: z.number().int().nonnegative(),
  boostTokens: z.number().int().nonnegative(),
  reductionTokens: z.number().int().nonnegative(),
  status: z.enum(['staged', 'locked', 'committed']),
});
export const dailyActivityResponse = z.object({
  localDate: z.iso.date(),
  timezone: z.string(),
  entries: z.array(
    tokenActivityEntry.extend({
      participantId: id,
      participantName: name,
    }),
  ),
  bets: z.array(
    betView.extend({
      participantId: id,
      participantName: name,
      currentProbability: z
        .number()
        .finite()
        .min(0)
        .max(1)
        .nullable()
        .optional(),
      estimatedWinPayout: z
        .number()
        .int()
        .nonnegative()
        .max(2147483647)
        .nullable()
        .optional(),
    }),
  ),
  positions: z.array(drawInfluencePosition).optional(),
  healthBonuses: z
    .array(
      z.object({
        drawId: id,
        placeName: name,
        drawnAt: z.iso.datetime(),
        bonus: healthBonus,
      }),
    )
    .optional(),
});
export type DrawInfluencePosition = z.infer<typeof drawInfluencePosition>;
export type TokenActivityEntry = z.infer<typeof tokenActivityEntry>;
export type DailyActivityResponse = z.infer<typeof dailyActivityResponse>;
export const bettingWindow = z.object({
  localDate: z.iso.date(),
  timezone: z.string(),
  drawTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  cutoffMinutes: z.number().int().min(0).max(1440),
  cutoffLocalDate: z.iso.date(),
  cutoffLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  cutoffAt: z.iso.datetime().optional(),
  opensAt: z.iso.datetime().nullable().optional(),
  open: z.boolean(),
});
export const influencePosition = z.object({
  placeId: id,
  boosts: z.number().int().nonnegative(),
  reductions: z.number().int().nonnegative(),
  yourBoosts: z.number().int().nonnegative(),
  yourReductions: z.number().int().nonnegative(),
});
export const currentInfluenceResponse = z.object({
  window: bettingWindow,
  places: z.array(influencePosition),
});
export const refundInfluenceRequest = z.object({
  localDate: z.iso.date(),
  placeId: id,
});
export const setPlaceWeightRequest = z.object({
  placeId: id,
  weight: z.number().finite().positive(),
});
export const changeInfluenceRequest = z.object({
  localDate: z.iso.date(),
  placeId: id,
  action: z.enum(['boost', 'reduce']),
  change: z.union([z.literal(1), z.literal(-1)]),
});
export const influenceMutationResponse = z.object({
  place,
  balance: z.number().int().nonnegative(),
  tokenDelta: z.number().int(),
});
export type InfluencePosition = z.infer<typeof influencePosition>;
export type CurrentInfluenceResponse = z.infer<typeof currentInfluenceResponse>;
export type ChangeInfluenceRequest = z.infer<typeof changeInfluenceRequest>;
export type InfluenceMutationResponse = z.infer<
  typeof influenceMutationResponse
>;
export const currentBetsResponse = z.object({
  window: bettingWindow,
  bet: betView.nullable(),
  recent: z.array(betView),
});
export const setBetRequest = z.object({
  localDate: z.iso.date(),
  placeId: id,
  stake: z.number().int().min(1).max(2147483647),
});
export const cancelBetRequest = z.object({ localDate: z.iso.date() });
export const betMutationResponse = z.object({
  bet: betView.nullable(),
  balance: z.number().int().nonnegative(),
});
export const adminLogin = z.object({ password: z.string().min(1).max(1024) });
export const tokenCorrection = z.object({
  participantId: id,
  delta: z
    .number()
    .int()
    .min(-2147483648)
    .max(2147483647)
    .refine((value) => value !== 0),
  reason: z.string().trim().min(1).max(500),
});
export const tokenBalanceSetRequest = z.object({
  participantId: id,
  balance: z.number().int().min(0).max(2147483647),
  reason: z.string().trim().min(1).max(500),
});
export const tokenBalanceRow = z.object({
  participantId: id,
  balance: z.number().int().nonnegative(),
});
export const tokenBalanceList = z.object({
  balances: z.array(tokenBalanceRow),
});
export const tokenBalanceSetResponse = tokenBalanceRow.extend({
  delta: z.number().int(),
  reason: z.string().min(1).max(500),
});
export type TokenBalanceSetResponse = z.infer<typeof tokenBalanceSetResponse>;
export const restaurantOdds = z.object({
  placeId: id,
  name,
  percent: z.number().finite().nonnegative().max(100),
});
export const restaurantOddsResponse = z.object({
  places: z.array(restaurantOdds),
});
export const setRestaurantOddsRequest = z.object({
  places: z
    .array(
      z.object({
        placeId: id,
        percent: z.number().finite().positive().max(100),
      }),
    )
    .min(1)
    .max(500)
    .refine(
      (places) =>
        new Set(places.map(({ placeId }) => placeId)).size === places.length,
      'Duplicate places',
    )
    .refine(
      (places) =>
        Math.abs(places.reduce((sum, { percent }) => sum + percent, 0) - 100) <=
        0.01,
      'Restaurant percentages must total 100',
    ),
});
export const pushSubscription = z.object({
  endpoint: z.url().refine((value) => {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      !url.hash &&
      (host === 'fcm.googleapis.com' ||
        host === 'web.push.apple.com' ||
        /^([a-z0-9-]+\.)?push\.services\.mozilla\.com$/.test(host) ||
        /^[a-z0-9-]+\.notify\.windows\.com$/.test(host))
    );
  }, 'Unsupported push service'),
  keys: z.object({
    p256dh: z.string().regex(/^B[A-Za-z0-9_-]{86}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
});
export const pushConfigResponse = z.object({
  publicKey: z.string().nullable(),
});
export const participantsResponse = z.object({
  participants: z.array(participant),
});
export const placesResponse = z.object({ places: z.array(place) });
export type Participant = z.infer<typeof participant>;
export type Place = z.infer<typeof place>;
export type BetView = z.infer<typeof betView>;
export type BettingWindow = z.infer<typeof bettingWindow>;
export type CurrentBetsResponse = z.infer<typeof currentBetsResponse>;
export type SetBetRequest = z.infer<typeof setBetRequest>;
export type WalletResponse = z.infer<typeof walletResponse>;
export type TokenOverviewResponse = z.infer<typeof tokenOverviewResponse>;
export type Draw = z.infer<typeof draw>;
export type AttendanceResponse = z.infer<typeof attendanceResponse>;
export type PurchaseResponse = z.infer<typeof purchaseResponse>;
export type PushSubscriptionInput = z.infer<typeof pushSubscription>;
export const healthResponse = z.object({
  status: z.enum(['ok', 'unavailable']),
  database: z.enum(['ok', 'unavailable']),
  service: z.literal('web'),
});
export const errorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type TodayResponse = z.infer<typeof todayResponse>;
export type PurchaseRequest = z.infer<typeof purchaseRequest>;
export type Schedule = z.infer<typeof schedule>;
export type DrawSkip = z.infer<typeof drawSkip>;
