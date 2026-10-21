import type { HealthBonus, HealthLevel } from '@lunch/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).defaultNow().notNull();

export const participants = pgTable(
  'participants',
  {
    id: uuid().defaultRandom().primaryKey(),
    name: text().notNull(),
    active: boolean().default(true).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'participant_name_nonempty',
      sql`length(btrim(${t.name})) between 1 and 100`,
    ),
    uniqueIndex('participant_active_name')
      .on(sql`lower(btrim(${t.name}))`)
      .where(sql`${t.active}`),
  ],
);

export const places = pgTable(
  'places',
  {
    id: uuid().defaultRandom().primaryKey(),
    name: text().notNull(),
    active: boolean().default(true).notNull(),
    logWeight: doublePrecision('log_weight').default(0).notNull(),
    healthLevel: text('health_level', {
      enum: ['treat', 'balanced', 'healthy'],
    })
      .default('balanced')
      .notNull(),
    addedBy: uuid('added_by').references(() => participants.id),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'place_name_nonempty',
      sql`length(btrim(${t.name})) between 1 and 100`,
    ),
    check(
      'place_health_level',
      sql`${t.healthLevel} in ('treat','balanced','healthy')`,
    ),
    check(
      'place_weight_finite',
      sql`${t.logWeight} > '-Infinity'::float8 and ${t.logWeight} < 'Infinity'::float8`,
    ),
    uniqueIndex('place_active_name')
      .on(sql`lower(btrim(${t.name}))`)
      .where(sql`${t.active}`),
  ],
);

/** Singleton row is also the future game-wide transaction lock. */
export const settings = pgTable(
  'settings',
  {
    id: integer().primaryKey().default(1),
    timezone: text().default('Europe/Dublin').notNull(),
    setupCompleted: boolean('setup_completed').default(false).notNull(),
    spinTime: text('spin_time').default('11:30').notNull(),
    attendanceReward: integer('attendance_reward').default(10).notNull(),
    addPlaceCost: integer('add_place_cost').default(20).notNull(),
    removePlaceCost: integer('remove_place_cost').default(40).notNull(),
    boostCost: integer('boost_cost').default(5).notNull(),
    reduceCost: integer('reduce_cost').default(5).notNull(),
    boostMultiplier: doublePrecision('boost_multiplier')
      .default(1.25)
      .notNull(),
    reduceMultiplier: doublePrecision('reduce_multiplier')
      .default(0.8)
      .notNull(),
    newPlaceMultiplier: doublePrecision('new_place_multiplier')
      .default(1)
      .notNull(),
    healthBonusEnabled: boolean('health_bonus_enabled').default(true).notNull(),
    healthBonusMultiplier: doublePrecision('health_bonus_multiplier')
      .default(1.25)
      .notNull(),
    wheelSpinSeconds: integer('wheel_spin_seconds').default(20).notNull(),
    wheelSwitchTime: text('wheel_switch_time').default('15:00').notNull(),
    checkInPledge: text('check_in_pledge')
      .default('I pledge that I actually obeyed the wheel')
      .notNull(),
    bettingCloseMinutes: integer('betting_close_minutes').default(5).notNull(),
    weekdays: integer()
      .array()
      .default(sql`ARRAY[1,2,3,4,5]`)
      .notNull(),
    skipDrawDate: date('skip_draw_date'),
  },
  (t) => [
    check(
      'settings_health_bonus_multiplier',
      sql`${t.healthBonusMultiplier} > 1 and ${t.healthBonusMultiplier} <= 100`,
    ),
    check(
      'settings_wheel_spin_seconds',
      sql`${t.wheelSpinSeconds} between 5 and 60`,
    ),
    check('settings_singleton', sql`${t.id} = 1`),
    check(
      'settings_token_amounts',
      sql`${t.attendanceReward} > 0 and ${t.addPlaceCost} > 0 and ${t.removePlaceCost} > 0 and ${t.boostCost} > 0 and ${t.reduceCost} > 0`,
    ),
    check(
      'settings_boost_multiplier',
      sql`${t.boostMultiplier} > 1 and ${t.boostMultiplier} <= 100`,
    ),
    check(
      'settings_reduce_multiplier',
      sql`${t.reduceMultiplier} >= 0.01 and ${t.reduceMultiplier} < 1`,
    ),
    check(
      'settings_new_place_multiplier',
      sql`${t.newPlaceMultiplier} >= 0.01 and ${t.newPlaceMultiplier} <= 100`,
    ),
    check(
      'settings_wheel_switch_time',
      sql`${t.wheelSwitchTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check(
      'settings_check_in_pledge',
      sql`length(btrim(${t.checkInPledge})) between 1 and 500`,
    ),
    check(
      'settings_betting_close_minutes',
      sql`${t.bettingCloseMinutes} between 0 and 1440`,
    ),
    check(
      'settings_time',
      sql`${t.spinTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check(
      'settings_weekdays',
      sql`cardinality(${t.weekdays}) between 1 and 7 and ${t.weekdays} <@ ARRAY[1,2,3,4,5,6,7]`,
    ),
  ],
);

export type DrawSnapshot = {
  placeId: string;
  name: string;
  logWeight: number;
  probability: number;
  healthLevel?: HealthLevel;
}[];
export const draws = pgTable(
  'draws',
  {
    id: uuid().defaultRandom().primaryKey(),
    localDate: date('local_date').notNull().unique(),
    timezone: text().notNull(),
    placeId: uuid('place_id')
      .notNull()
      .references(() => places.id),
    placeName: text('place_name').notNull(),
    snapshot: jsonb().$type<DrawSnapshot>().notNull(),
    healthBonus: jsonb('health_bonus').$type<HealthBonus>(),
    spinDurationMs: integer('spin_duration_ms'),
    sample: doublePrecision().notNull(),
    drawnAt: timestamp('drawn_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    check(
      'draw_spin_duration',
      sql`${t.spinDurationMs} is null or ${t.spinDurationMs} between 5000 and 60000`,
    ),
    check('draw_sample_range', sql`${t.sample} >= 0 and ${t.sample} < 1`),
  ],
);

export const attendance = pgTable(
  'attendance',
  {
    id: uuid().defaultRandom().primaryKey(),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => participants.id),
    drawId: uuid('draw_id')
      .notNull()
      .references(() => draws.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('attendance_once').on(t.participantId, t.drawId)],
);

export const bettingMarkets = pgTable(
  'betting_markets',
  {
    id: uuid().defaultRandom().primaryKey(),
    localDate: date('local_date').notNull(),
    timezone: text().notNull(),
    scheduledTime: text('scheduled_time').notNull(),
    cutoffMinutes: integer('cutoff_minutes').notNull(),
    status: text({ enum: ['open', 'settled', 'void'] })
      .default('open')
      .notNull(),
    drawId: uuid('draw_id').references(() => draws.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('betting_market_open_date')
      .on(t.localDate)
      .where(sql`${t.status} = 'open'`),
    check(
      'betting_market_status',
      sql`${t.status} in ('open','settled','void')`,
    ),
    check('betting_market_cutoff', sql`${t.cutoffMinutes} between 0 and 1440`),
    check(
      'betting_market_time',
      sql`${t.scheduledTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
  ],
);

export const bets = pgTable(
  'bets',
  {
    id: uuid().defaultRandom().primaryKey(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => bettingMarkets.id),
    localDate: date('local_date').notNull(),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => participants.id),
    placeId: uuid('place_id')
      .notNull()
      .references(() => places.id),
    placeName: text('place_name').notNull(),
    stake: integer().notNull(),
    status: text({ enum: ['open', 'won', 'lost', 'cancelled', 'refunded'] })
      .default('open')
      .notNull(),
    payout: integer(),
    probability: doublePrecision(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('bet_once_per_market').on(t.marketId, t.participantId),
    check(
      'bet_status',
      sql`${t.status} in ('open','won','lost','cancelled','refunded')`,
    ),
    index('bet_participant_recent').on(t.participantId, t.updatedAt),
    index('bet_place_open')
      .on(t.placeId)
      .where(sql`${t.status} = 'open'`),
    check('bet_stake_positive', sql`${t.stake} between 1 and 2147483647`),
    check(
      'bet_payout_valid',
      sql`${t.payout} is null or ${t.payout} between 0 and 2147483647`,
    ),
    check(
      'bet_probability_valid',
      sql`${t.probability} is null or ${t.probability} between 0 and 1`,
    ),
  ],
);

/** Own idempotency namespace: edits may move a stake without a ledger delta. */
export const betRequests = pgTable(
  'bet_requests',
  {
    id: uuid().defaultRandom().primaryKey(),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => participants.id),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    response: jsonb().$type<unknown>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('bet_request_once').on(t.participantId, t.idempotencyKey),
  ],
);

/** Authoritative balance is SUM(delta); never rewrite ledger history. */
export const tokenLedger = pgTable(
  'token_ledger',
  {
    id: uuid().defaultRandom().primaryKey(),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => participants.id),
    delta: integer().notNull(),
    kind: text({
      enum: [
        'attendance',
        'boost',
        'reduce',
        'boost-refund',
        'reduce-refund',
        'add-place',
        'remove-place',
        'correction',
        'bet-stake',
        'bet-release',
        'bet-payout',
        'transfer-sent',
        'transfer-received',
      ],
    }).notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    response: jsonb().$type<unknown>(),
    attendanceId: uuid('attendance_id').references(() => attendance.id),
    placeId: uuid('place_id').references(() => places.id),
    betId: uuid('bet_id').references(() => bets.id),
    influenceMarketId: uuid('influence_market_id').references(
      () => bettingMarkets.id,
    ),
    transferId: uuid('transfer_id'),
    counterpartyId: uuid('counterparty_id').references(() => participants.id),
    reason: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ledger_request_once').on(t.participantId, t.idempotencyKey),
    uniqueIndex('ledger_transfer_direction').on(t.transferId, t.kind),
    check(
      'ledger_transfer_valid',
      sql`(${t.kind} in ('transfer-sent','transfer-received') and ${t.transferId} is not null and ${t.counterpartyId} is not null and ${t.counterpartyId} <> ${t.participantId} and ((${t.kind} = 'transfer-sent' and ${t.delta} < 0) or (${t.kind} = 'transfer-received' and ${t.delta} > 0))) or (${t.kind} not in ('transfer-sent','transfer-received') and ${t.transferId} is null and ${t.counterpartyId} is null)`,
    ),
    uniqueIndex('ledger_attendance_once').on(t.attendanceId),
    index('ledger_balance').on(t.participantId),
    check('ledger_nonzero', sql`${t.delta} <> 0`),
    check(
      'ledger_kind',
      sql`${t.kind} in ('attendance','boost','reduce','boost-refund','reduce-refund','add-place','remove-place','correction','bet-stake','bet-release','bet-payout','transfer-sent','transfer-received')`,
    ),
    check(
      'correction_reason',
      sql`${t.kind} <> 'correction' or length(btrim(${t.reason})) > 0 and ${t.reason} is not null`,
    ),
  ],
);

/** One refundable unit, preserving its original price and logarithmic effect. */
export const influenceLots = pgTable(
  'influence_lots',
  {
    id: uuid().defaultRandom().primaryKey(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => bettingMarkets.id),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => participants.id),
    placeId: uuid('place_id')
      .notNull()
      .references(() => places.id),
    action: text({ enum: ['boost', 'reduce'] }).notNull(),
    tokenCost: integer('token_cost').notNull(),
    logMultiplier: doublePrecision('log_multiplier').notNull(),
    purchaseLedgerId: uuid('purchase_ledger_id')
      .notNull()
      .references(() => tokenLedger.id),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('influence_purchase_once').on(t.purchaseLedgerId),
    index('influence_market_positions')
      .on(t.marketId, t.placeId, t.participantId)
      .where(sql`${t.withdrawnAt} is null`),
    check('influence_action', sql`${t.action} in ('boost','reduce')`),
    check('influence_cost', sql`${t.tokenCost} between 1 and 2147483647`),
    check(
      'influence_multiplier',
      sql`(${t.action} = 'boost' and ${t.logMultiplier} > 0 and ${t.logMultiplier} <= ln(100.0)) or (${t.action} = 'reduce' and ${t.logMultiplier} < 0 and ${t.logMultiplier} >= ln(0.01))`,
    ),
  ],
);

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid().defaultRandom().primaryKey(),
  participantId: uuid('participant_id')
    .notNull()
    .references(() => participants.id),
  endpoint: text().notNull().unique(),
  p256dh: text().notNull(),
  auth: text().notNull(),
  active: boolean().default(true).notNull(),
  createdAt: createdAt(),
});

export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: uuid().defaultRandom().primaryKey(),
    eventKey: text('event_key').notNull(),
    drawId: uuid('draw_id').references(() => draws.id),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => pushSubscriptions.id),
    payload: jsonb()
      .$type<{ title: string; body: string; tag?: string; drawId?: string }>()
      .notNull(),
    attempts: integer().default(0).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    leaseToken: uuid('lease_token'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('notification_once').on(t.eventKey, t.subscriptionId),
    index('notification_due')
      .on(t.availableAt)
      .where(sql`${t.sentAt} is null`),
  ],
);
