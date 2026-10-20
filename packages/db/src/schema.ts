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
    addedBy: uuid('added_by').references(() => participants.id),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'place_name_nonempty',
      sql`length(btrim(${t.name})) between 1 and 100`,
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
    boostCost: integer('boost_cost').default(5).notNull(),
    reduceCost: integer('reduce_cost').default(5).notNull(),
    boostMultiplier: doublePrecision('boost_multiplier')
      .default(1.25)
      .notNull(),
    reduceMultiplier: doublePrecision('reduce_multiplier')
      .default(0.8)
      .notNull(),
    wheelSwitchTime: text('wheel_switch_time').default('15:00').notNull(),
    checkInPledge: text('check_in_pledge')
      .default('I pledge that I actually obeyed the wheel')
      .notNull(),
    weekdays: integer()
      .array()
      .default(sql`ARRAY[1,2,3,4,5]`)
      .notNull(),
  },
  (t) => [
    check('settings_singleton', sql`${t.id} = 1`),
    check(
      'settings_token_amounts',
      sql`${t.attendanceReward} > 0 and ${t.addPlaceCost} > 0 and ${t.boostCost} > 0 and ${t.reduceCost} > 0`,
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
      'settings_wheel_switch_time',
      sql`${t.wheelSwitchTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check(
      'settings_check_in_pledge',
      sql`length(btrim(${t.checkInPledge})) between 1 and 500`,
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
    sample: doublePrecision().notNull(),
    drawnAt: timestamp('drawn_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
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
      enum: ['attendance', 'boost', 'reduce', 'add-place', 'correction'],
    }).notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    response: jsonb().$type<unknown>(),
    attendanceId: uuid('attendance_id').references(() => attendance.id),
    placeId: uuid('place_id').references(() => places.id),
    reason: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ledger_request_once').on(t.participantId, t.idempotencyKey),
    uniqueIndex('ledger_attendance_once').on(t.attendanceId),
    index('ledger_balance').on(t.participantId),
    check('ledger_nonzero', sql`${t.delta} <> 0`),
    check(
      'ledger_kind',
      sql`${t.kind} in ('attendance','boost','reduce','add-place','correction')`,
    ),
    check(
      'correction_reason',
      sql`${t.kind} <> 'correction' or length(btrim(${t.reason})) > 0 and ${t.reason} is not null`,
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
    drawId: uuid('draw_id')
      .notNull()
      .references(() => draws.id),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => pushSubscriptions.id),
    payload: jsonb()
      .$type<{ title: string; body: string; drawId: string }>()
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
    uniqueIndex('notification_once').on(t.drawId, t.subscriptionId),
    index('notification_due')
      .on(t.availableAt)
      .where(sql`${t.sentAt} is null`),
  ],
);
