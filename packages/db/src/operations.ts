import {
  createHash as createHashImpl,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import {
  evaluateSchedule,
  postDrawWeights,
  wheelLandingRotation,
  influenceWeight,
  localClock,
  newPlaceLogWeight,
  probabilities,
  selectPlace,
  wheelDisplay,
  nextBettingDate,
  bettingCutoff,
  scheduledInstant,
} from '@lunch/domain';
import type {
  AttendanceStatus,
  AttendanceResponse,
  Draw as DrawResponse,
  Participant,
  ParticipantRemoval,
  Place,
  PurchaseRequest,
  PurchaseResponse,
  PushSubscriptionInput,
  Schedule,
  GamePreferences,
  GamePreferencesInput,
  EconomySettings,
  SetupStatus,
  TodayResponse,
  WalletResponse,
  TokenBalanceSetResponse,
  BetView,
  BettingWindow,
  CurrentBetsResponse,
  CurrentInfluenceResponse,
  ChangeInfluenceRequest,
  InfluenceMutationResponse,
  SetBetRequest,
  TokenActivityEntry,
  DailyActivityResponse,
  TokenOverviewResponse,
  DrawInfluencePosition,
  HealthLevel,
  HealthRuleSettings,
  TransferRequest,
  TransferResponse,
  DrawSkip,
} from '@lunch/contracts';
import {
  gamePreferences,
  economySettings,
  tokenBalanceSetRequest,
  dailyActivityQuery,
  setRestaurantOddsRequest,
  setBetRequest,
  cancelBetRequest,
  changeInfluenceRequest,
  healthLevel,
  healthRuleSettings,
  transferRequest,
  refundInfluenceRequest,
  setPlaceWeightRequest,
} from '@lunch/contracts';
import type { createDatabase } from './index';
import {
  attendance,
  bets,
  betRequests,
  bettingMarkets,
  draws,
  influenceLots,
  notificationOutbox,
  participants,
  places,
  pushSubscriptions,
  settings,
  tokenLedger,
} from './schema';

type Database = ReturnType<typeof createDatabase>;
type Tx = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
type DrawRow = typeof draws.$inferSelect;
type LedgerRow = typeof tokenLedger.$inferSelect;
type BetMutationResponse = { bet: BetView | null; balance: number };

export class GameError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GameError';
  }
}

const replayResponses = new WeakSet<object>();

/** True only for response objects returned from an idempotency replay. */
export function isReplay(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && replayResponses.has(value)
  );
}

export type NotificationJob = {
  id: string;
  leaseToken: string;
  attempts: number;
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  payload: { title: string; body: string; tag?: string; drawId?: string };
};

type NotificationPayload = {
  title: string;
  body: string;
  tag: string;
  drawId?: string;
};

async function enqueueNotifications(
  tx: Tx,
  eventKey: string,
  payload: NotificationPayload,
  options: { participantIds?: string[]; drawId?: string } = {},
) {
  if (options.participantIds?.length === 0) return;
  const predicates = [
    eq(pushSubscriptions.active, true),
    eq(participants.active, true),
  ];
  if (options.participantIds)
    predicates.push(
      inArray(pushSubscriptions.participantId, options.participantIds),
    );
  const subscriptions = await tx
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .innerJoin(
      participants,
      eq(pushSubscriptions.participantId, participants.id),
    )
    .where(and(...predicates));
  if (!subscriptions.length) return;
  await tx
    .insert(notificationOutbox)
    .values(
      subscriptions.map((subscription) => ({
        eventKey,
        drawId: options.drawId,
        subscriptionId: subscription.id,
        payload,
      })),
    )
    .onConflictDoNothing();
}

function fail(status: number, code: string, message: string): never {
  throw new GameError(status, code, message);
}

function mapDatabaseError(error: unknown): never {
  let current = error as {
    code?: string;
    constraint_name?: string;
    constraint?: string;
    cause?: unknown;
  };
  const seen = new Set<unknown>();
  while (current && !current.code && current.cause && !seen.has(current)) {
    seen.add(current);
    current = current.cause as typeof current;
  }
  const candidate = current;
  if (candidate?.code === '23505') {
    const constraint = candidate.constraint_name ?? candidate.constraint ?? '';
    if (constraint.includes('name'))
      fail(409, 'DUPLICATE_NAME', 'That name is already in use.');
    if (constraint.includes('attendance'))
      fail(409, 'ALREADY_ATTENDED', 'Attendance was already recorded.');
    if (constraint.includes('local_date'))
      fail(409, 'DRAW_EXISTS', 'A draw already exists for this date.');
    fail(409, 'CONFLICT', 'This change conflicts with existing data.');
  }
  throw error;
}

function normalizedName(name: string): string {
  const value = name.trim();
  if (value.length < 1 || value.length > 100)
    fail(400, 'INVALID_NAME', 'Name must contain 1 to 100 characters.');
  return value;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}

function requestHash(method: string, route: string, body: unknown): string {
  // SHA-256 is deterministic and does not expose request contents in the ledger.
  return createHash(`${method}\n${route}\n${canonical(body)}`);
}

function createHash(value: string): string {
  // Keep Node crypto usage in one place for request fingerprints.
  return createHashImpl('sha256').update(value).digest('hex');
}

function drawView(row: DrawRow): DrawResponse {
  const seed = Number.parseInt(
    createHash(`wheel-v1:${row.id}`).slice(0, 8),
    16,
  );
  return {
    id: row.id,
    localDate: row.localDate,
    placeId: row.placeId,
    placeName: row.placeName,
    drawnAt: row.drawnAt.toISOString(),
    timezone: row.timezone,
    snapshot: row.snapshot,
    healthBonus: row.healthBonus,
    animation: {
      version: 1,
      rotation: wheelLandingRotation(row.snapshot, row.placeId, row.sample),
      turns:
        row.spinDurationMs === null
          ? 9 + (seed % 4)
          : Math.max(3, Math.round(row.spinDurationMs / 2000)) + (seed % 2),
      durationMs: row.spinDurationMs ?? 18000 + (seed % 4) * 1000,
      startsAt: new Date(row.drawnAt.getTime() + 3000).toISOString(),
    },
  };
}

function betView(row: typeof bets.$inferSelect): BetView {
  return {
    id: row.id,
    localDate: row.localDate,
    placeId: row.placeId,
    placeName: row.placeName,
    stake: row.stake,
    status: row.status,
    payout: row.payout,
    probability: row.probability,
    updatedAt: row.updatedAt.toISOString(),
    settledAt: row.settledAt?.toISOString() ?? null,
  };
}

function tokenActivityView(row: {
  id: string;
  delta: number;
  kind: string;
  reason: string | null;
  createdAt: Date;
  placeId: string | null;
  placeName: string | null;
  betId: string | null;
  betLocalDate: string | null;
  influenceLocalDate?: string | null;
  inferredDrawLocalDate?: string;
  transferId?: string | null;
  counterpartyId?: string | null;
}): TokenActivityEntry {
  return {
    id: row.id,
    delta: row.delta,
    kind: row.kind,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    placeId: row.placeId,
    placeName: row.placeName,
    betId: row.betId,
    betLocalDate: row.betLocalDate,
    transferId: row.transferId ?? null,
    counterpartyId: row.counterpartyId ?? null,
    ...(row.influenceLocalDate
      ? { influenceLocalDate: row.influenceLocalDate }
      : {}),
    ...(row.inferredDrawLocalDate
      ? { inferredDrawLocalDate: row.inferredDrawLocalDate }
      : {}),
  };
}

async function walletBets(tx: Tx, participantId: string): Promise<BetView[]> {
  const rows = await tx
    .select()
    .from(bets)
    .where(eq(bets.participantId, participantId))
    .orderBy(desc(bets.updatedAt), desc(bets.id));
  return rows.map(betView);
}

async function tokenLedgerActivity(
  tx: Tx,
  participantId?: string,
  localDate?: string,
  timezone?: string,
  drawDate?: string,
) {
  const predicates = [];
  if (participantId)
    predicates.push(eq(tokenLedger.participantId, participantId));
  if (drawDate) {
    predicates.push(
      // Include unlinked wheel purchases and transfers for read-only attribution below.
      sql`(coalesce(influence_market.local_date, ${bettingMarkets.localDate}) = ${drawDate}::date
        or (${tokenLedger.influenceMarketId} is null
          and ${tokenLedger.betId} is null
          and ${tokenLedger.kind} in (
            'boost', 'reduce', 'add-place', 'remove-place',
            'transfer-sent', 'transfer-received'
          )))`,
    );
  } else if (localDate && timezone) {
    predicates.push(
      sql`(${tokenLedger.createdAt} at time zone ${timezone})::date = ${localDate}::date`,
    );
  }
  const rows = await tx
    .select({
      id: tokenLedger.id,
      delta: tokenLedger.delta,
      transferId: tokenLedger.transferId,
      counterpartyId: tokenLedger.counterpartyId,
      kind: tokenLedger.kind,
      reason: tokenLedger.reason,
      createdAt: tokenLedger.createdAt,
      placeId: tokenLedger.placeId,
      placeName: places.name,
      betId: tokenLedger.betId,
      betLocalDate: bettingMarkets.localDate,
      influenceLocalDate: sql<string | null>`influence_market.local_date`,
      participantId: tokenLedger.participantId,
      participantName: participants.name,
    })
    .from(tokenLedger)
    .leftJoin(places, eq(tokenLedger.placeId, places.id))
    .leftJoin(bets, eq(tokenLedger.betId, bets.id))
    .leftJoin(bettingMarkets, eq(bets.marketId, bettingMarkets.id))
    .leftJoin(
      sql`betting_markets as influence_market`,
      sql`influence_market.id = ${tokenLedger.influenceMarketId}`,
    )
    .innerJoin(participants, eq(tokenLedger.participantId, participants.id))
    .where(predicates.length ? and(...predicates) : undefined)
    .orderBy(desc(tokenLedger.createdAt), desc(tokenLedger.id));
  const needsAttribution = (row: (typeof rows)[number]) =>
    !row.influenceLocalDate &&
    !row.betId &&
    [
      'boost',
      'reduce',
      'add-place',
      'remove-place',
      'transfer-sent',
      'transfer-received',
    ].includes(row.kind);
  const [configuration] = rows.some(needsAttribution)
    ? await tx.select().from(settings).where(eq(settings.id, 1))
    : [];
  const history = configuration
    ? await tx
        .select({
          localDate: draws.localDate,
          drawnAt: draws.drawnAt,
        })
        .from(draws)
        .orderBy(asc(draws.drawnAt))
    : [];
  const attributed = rows.map((row) => {
    let inferredDrawLocalDate: string | undefined;
    if (configuration && needsAttribution(row)) {
      const nextDraw = history.find((draw) => draw.drawnAt > row.createdAt);
      const actionDate = localClock(
        row.createdAt,
        configuration.timezone,
      ).localDate;
      inferredDrawLocalDate =
        nextDraw?.localDate ??
        nextBettingDate(
          row.createdAt,
          getScheduleFromRow(configuration),
          history.some(
            (draw) =>
              draw.localDate === actionDate && draw.drawnAt <= row.createdAt,
          ),
          configuration.skipDrawDate,
        );
    }
    return { ...row, inferredDrawLocalDate };
  });
  return drawDate
    ? attributed.filter(
        (row) =>
          (row.influenceLocalDate ??
            row.betLocalDate ??
            row.inferredDrawLocalDate) === drawDate,
      )
    : attributed;
}

async function wheelPeriodOpensAt(
  tx: Tx,
  row: typeof settings.$inferSelect,
  now: Date,
) {
  if (row.postDrawDelayMinutes === 0) return null;
  const [lastDraw] = await tx
    .select({ drawnAt: draws.drawnAt })
    .from(draws)
    .where(lte(draws.drawnAt, now))
    .orderBy(desc(draws.drawnAt))
    .limit(1);
  if (!lastDraw) return null;
  return new Date(
    lastDraw.drawnAt.getTime() + row.postDrawDelayMinutes * 60_000,
  ).toISOString();
}

async function requireWheelPeriod(tx: Tx, now: Date) {
  const [row] = await tx.select().from(settings).where(eq(settings.id, 1));
  if (!row) fail(503, 'NOT_INITIALIZED', 'Game settings are not initialized.');
  const opensAt = await wheelPeriodOpensAt(tx, row, now);
  if (opensAt && now < new Date(opensAt))
    fail(409, 'WHEEL_ACTIVITY_PAUSED', `Wheel activity reopens at ${opensAt}.`);
}

function bettingWindowView(
  row: typeof bettingMarkets.$inferSelect & { opensAt?: string | null },
  now: Date,
): BettingWindow {
  const cutoff = bettingCutoff(
    row.localDate,
    row.scheduledTime,
    row.cutoffMinutes,
    row.timezone,
  );
  const cutoffInstant =
    scheduledInstant(row.localDate, row.scheduledTime, row.timezone).getTime() -
    row.cutoffMinutes * 60_000;
  return {
    localDate: row.localDate,
    timezone: row.timezone,
    drawTime: row.scheduledTime,
    cutoffMinutes: row.cutoffMinutes,
    cutoffLocalDate: cutoff.localDate,
    cutoffLocalTime: cutoff.time,
    cutoffAt: new Date(cutoffInstant).toISOString(),
    opensAt: row.opensAt ?? null,
    open:
      row.status === 'open' &&
      now.getTime() < cutoffInstant &&
      (!row.opensAt || now.getTime() >= Date.parse(row.opensAt)),
  };
}

function participantView(row: typeof participants.$inferSelect): Participant {
  return { id: row.id, name: row.name, active: row.active };
}

function placeView(row: typeof places.$inferSelect): Place {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    logWeight: row.logWeight,
    healthLevel: row.healthLevel,
  };
}

function getScheduleFromRow(row: typeof settings.$inferSelect): Schedule {
  return { timezone: row.timezone, time: row.spinTime, weekdays: row.weekdays };
}

function drawSkipFromRow(
  row: typeof settings.$inferSelect,
  now: Date,
): DrawSkip {
  const schedule = getScheduleFromRow(row);
  const clock = localClock(now, schedule.timezone);
  const localDate =
    row.skipDrawDate && row.skipDrawDate >= clock.localDate
      ? row.skipDrawDate
      : null;
  return {
    localDate,
    cancellable:
      localDate !== null &&
      (localDate > clock.localDate || clock.time < schedule.time),
  };
}

function preferencesFromRow(
  row: typeof settings.$inferSelect,
): GamePreferences {
  return {
    postDrawDelayMinutes: row.postDrawDelayMinutes,
    wheelSwitchTime: row.wheelSwitchTime,
    wheelSpinSeconds: row.wheelSpinSeconds,
    checkInPledge: row.checkInPledge,
    bettingCloseMinutes: row.bettingCloseMinutes,
    maxWalkMinutes: row.maxWalkMinutes,
  };
}

function economyFromRow(row: typeof settings.$inferSelect): EconomySettings {
  return {
    attendanceReward: row.attendanceReward,
    addPlaceCost: row.addPlaceCost,
    boostCost: row.boostCost,
    reduceCost: row.reduceCost,
    removePlaceCost: row.removePlaceCost,
    boostMultiplier: row.boostMultiplier,
    reduceMultiplier: row.reduceMultiplier,
    newPlaceMultiplier: row.newPlaceMultiplier,
  };
}

async function currentEconomy(tx: Tx): Promise<EconomySettings> {
  const [row] = await tx.select().from(settings).where(eq(settings.id, 1));
  if (!row) fail(503, 'NOT_INITIALIZED', 'Game settings are not initialized.');
  return economyFromRow(row);
}

async function deactivateParticipant(tx: Tx, id: string): Promise<void> {
  const now = new Date();
  const openBets = await tx
    .select({
      id: bets.id,
      participantId: bets.participantId,
      placeId: bets.placeId,
      stake: bets.stake,
    })
    .from(bets)
    .innerJoin(bettingMarkets, eq(bets.marketId, bettingMarkets.id))
    .where(
      and(
        eq(bets.participantId, id),
        eq(bets.status, 'open'),
        eq(bettingMarkets.status, 'open'),
      ),
    );
  for (const bet of openBets) {
    await tx.insert(tokenLedger).values({
      participantId: bet.participantId,
      delta: bet.stake,
      kind: 'bet-release',
      idempotencyKey: `bet-disabled:${bet.id}`,
      requestHash: createHash(`disabled:${bet.id}`),
      placeId: bet.placeId,
      betId: bet.id,
      reason: 'Bet stake refunded because participant was disabled',
      createdAt: now,
    });
    await tx
      .update(bets)
      .set({
        status: 'refunded',
        payout: 0,
        updatedAt: now,
        settledAt: now,
      })
      .where(eq(bets.id, bet.id));
  }
  const openMarkets = await tx
    .select({ id: bettingMarkets.id })
    .from(bettingMarkets)
    .where(eq(bettingMarkets.status, 'open'));
  for (const market of openMarkets) {
    const lots = await tx
      .select()
      .from(influenceLots)
      .where(
        and(
          eq(influenceLots.marketId, market.id),
          eq(influenceLots.participantId, id),
          isNull(influenceLots.withdrawnAt),
        ),
      );
    for (const lot of lots) {
      await withdrawInfluenceLot(
        tx,
        lot,
        now,
        'Influence refunded because participant was disabled',
      );
    }
  }
  const subs = await tx
    .update(pushSubscriptions)
    .set({ active: false })
    .where(eq(pushSubscriptions.participantId, id))
    .returning({ id: pushSubscriptions.id });
  if (subs.length)
    await tx
      .update(notificationOutbox)
      .set({
        sentAt: new Date(),
        lockedUntil: null,
        leaseToken: null,
        lastError: 'participant-inactive',
      })
      .where(
        and(
          inArray(
            notificationOutbox.subscriptionId,
            subs.map((subscription) => subscription.id),
          ),
          isNull(notificationOutbox.sentAt),
        ),
      );
}

async function participantHasReferences(tx: Tx, id: string): Promise<boolean> {
  const [row] = await tx.execute<{ referenced: boolean }>(sql`
    select
      exists(select 1 from attendance where participant_id = ${id}::uuid) or
      exists(select 1 from token_ledger where participant_id = ${id}::uuid) or
      exists(select 1 from places where added_by = ${id}::uuid) or
      exists(select 1 from bets where participant_id = ${id}::uuid) or
      exists(select 1 from bet_requests where participant_id = ${id}::uuid) or
      exists(select 1 from influence_lots where participant_id = ${id}::uuid) or
      exists(select 1 from push_subscriptions where participant_id = ${id}::uuid)
      as referenced
  `);
  return row?.referenced ?? false;
}

async function transaction<T>(
  database: Database,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  try {
    return await database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('statement_timeout', '8000ms', true), set_config('lock_timeout', '3000ms', true)`,
      );
      const [row] = await tx
        .select({ id: settings.id })
        .from(settings)
        .where(eq(settings.id, 1))
        .for('update');
      if (!row)
        fail(503, 'NOT_INITIALIZED', 'Game settings are not initialized.');
      return fn(tx);
    });
  } catch (error) {
    if (error instanceof GameError) throw error;
    mapDatabaseError(error);
  }
}

async function activeParticipant(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(participants)
    .where(eq(participants.id, id));
  if (!row) fail(404, 'PARTICIPANT_NOT_FOUND', 'Participant was not found.');
  if (!row.active)
    fail(403, 'PARTICIPANT_INACTIVE', 'Participant is inactive.');
  return row;
}

async function balance(tx: Tx, participantId: string): Promise<number> {
  const [row] = await tx
    .select({
      value: sql<number>`coalesce(sum(${tokenLedger.delta}), 0)::float8`,
    })
    .from(tokenLedger)
    .where(eq(tokenLedger.participantId, participantId));
  const value = row?.value ?? 0;
  if (!Number.isSafeInteger(value))
    fail(
      409,
      'BALANCE_OVERFLOW',
      'The token balance exceeds the supported range.',
    );
  return value;
}

async function withdrawInfluenceLot(
  tx: Tx,
  lot: typeof influenceLots.$inferSelect,
  now: Date,
  reason: string,
  request?: { key: string; hash: string; response: unknown },
): Promise<void> {
  const [place] = await tx
    .select({ id: places.id, logWeight: places.logWeight })
    .from(places)
    .where(eq(places.id, lot.placeId));
  if (!place)
    fail(409, 'PLACE_NOT_FOUND', 'Influence restaurant was not found.');
  const restoredWeight = place.logWeight - lot.logMultiplier;
  if (!Number.isFinite(restoredWeight))
    fail(
      409,
      'INVALID_WEIGHT',
      'The restaurant weight cannot be restored safely.',
    );
  await tx
    .update(places)
    .set({ logWeight: restoredWeight })
    .where(eq(places.id, place.id));
  await tx
    .update(influenceLots)
    .set({ withdrawnAt: now })
    .where(eq(influenceLots.id, lot.id));
  await tx.insert(tokenLedger).values({
    participantId: lot.participantId,
    delta: lot.tokenCost,
    kind: lot.action === 'boost' ? 'boost-refund' : 'reduce-refund',
    idempotencyKey: request?.key ?? `influence-refund:${lot.id}`,
    requestHash: request?.hash ?? createHash(`influence-refund:${lot.id}`),
    response: request?.response,
    placeId: lot.placeId,
    influenceMarketId: lot.marketId,
    reason,
    createdAt: now,
  });
  await balance(tx, lot.participantId);
}

async function existingKey(
  tx: Tx,
  participantId: string,
  key: string,
  hash: string,
): Promise<LedgerRow | null> {
  const [row] = await tx
    .select()
    .from(tokenLedger)
    .where(
      and(
        eq(tokenLedger.participantId, participantId),
        eq(tokenLedger.idempotencyKey, key),
      ),
    );
  if (!row) return null;
  if (row.requestHash !== hash)
    fail(
      409,
      'IDEMPOTENCY_MISMATCH',
      'This idempotency key was used for a different request.',
    );
  return row;
}

function replay<T>(row: LedgerRow): T {
  if (row.response === null || row.response === undefined)
    fail(
      503,
      'REPLAY_UNAVAILABLE',
      'The recorded request response is unavailable.',
    );
  const response = row.response as T;
  if (typeof response === 'object' && response !== null)
    replayResponses.add(response as object);
  return response;
}

async function currentSchedule(tx: Tx): Promise<Schedule> {
  const [row] = await tx.select().from(settings).where(eq(settings.id, 1));
  if (!row) fail(503, 'NOT_INITIALIZED', 'Game settings are not initialized.');
  return getScheduleFromRow(row);
}

async function setupStatusInTransaction(tx: Tx): Promise<SetupStatus> {
  const [row] = await tx
    .select({ completed: settings.setupCompleted })
    .from(settings)
    .where(eq(settings.id, 1));
  if (!row) fail(503, 'NOT_INITIALIZED', 'Game settings are not initialized.');
  const [participantCount] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(participants)
    .where(eq(participants.active, true));
  const [placeCount] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(places)
    .where(eq(places.active, true));
  return {
    completed: row.completed,
    participantCount: participantCount!.count,
    placeCount: placeCount!.count,
  };
}

async function requireSetupComplete(tx: Tx): Promise<void> {
  const [row] = await tx
    .select({ completed: settings.setupCompleted })
    .from(settings)
    .where(eq(settings.id, 1));
  if (!row) fail(503, 'NOT_INITIALIZED', 'Game settings are not initialized.');
  if (!row.completed)
    fail(403, 'SETUP_REQUIRED', 'Administrator setup is not complete.');
}

function secureSample(): number {
  // 53 unbiased bits produce a representable uniform value in [0, 1).
  const bytes = randomBytes(7);
  const bits =
    ((BigInt(bytes.readUIntBE(0, 6)) << 8n) | BigInt(bytes[6]!)) &
    ((1n << 53n) - 1n);
  return Number(bits) / 2 ** 53;
}

export class GameService {
  constructor(private readonly database: Database) {}

  async getSetupStatus(): Promise<SetupStatus> {
    return this.database.db.transaction(
      (tx) => setupStatusInTransaction(tx as Tx),
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  async completeSetup(): Promise<SetupStatus> {
    return transaction(this.database, async (tx) => {
      const status = await setupStatusInTransaction(tx);
      if (status.completed) return status;
      if (status.participantCount < 1 || status.placeCount < 1)
        fail(
          409,
          'SETUP_INCOMPLETE',
          'Add at least one active participant and place before completing setup.',
        );
      await tx
        .update(settings)
        .set({ setupCompleted: true })
        .where(eq(settings.id, 1));
      return { ...status, completed: true };
    });
  }

  async listParticipants(includeInactive = false): Promise<Participant[]> {
    const query = this.database.db.select().from(participants);
    const rows = includeInactive
      ? await query.orderBy(asc(participants.name))
      : await query
          .where(eq(participants.active, true))
          .orderBy(asc(participants.name));
    return rows.map(participantView);
  }

  async listTokenBalances(): Promise<{
    balances: { participantId: string; balance: number }[];
  }> {
    const rows = await this.database.db
      .select({
        participantId: participants.id,
        balance: sql<number>`coalesce(sum(${tokenLedger.delta}), 0)::float8`,
      })
      .from(participants)
      .leftJoin(tokenLedger, eq(tokenLedger.participantId, participants.id))
      .groupBy(participants.id, participants.name)
      .orderBy(asc(participants.name));
    for (const row of rows) {
      if (!Number.isSafeInteger(row.balance) || row.balance < 0)
        fail(
          409,
          'BALANCE_OVERFLOW',
          'A token balance exceeds the supported range.',
        );
    }
    return { balances: rows };
  }

  async setTokenBalance(
    input: { participantId: string; balance: number; reason: string },
    key: string,
  ): Promise<TokenBalanceSetResponse> {
    const parsed = tokenBalanceSetRequest.safeParse(input);
    if (!parsed.success)
      fail(
        400,
        'INVALID_BALANCE',
        'Provide a valid target balance and reason.',
      );
    const body = { ...parsed.data, reason: parsed.data.reason.trim() };
    const hash = requestHash('POST', '/api/v1/admin/token-balances', body);
    return transaction(this.database, async (tx) => {
      const [person] = await tx
        .select({ id: participants.id })
        .from(participants)
        .where(eq(participants.id, body.participantId));
      if (!person)
        fail(404, 'PARTICIPANT_NOT_FOUND', 'Participant was not found.');
      const prior = await existingKey(tx, body.participantId, key, hash);
      if (prior) return replay<TokenBalanceSetResponse>(prior);
      const current = await balance(tx, body.participantId);
      const delta = body.balance - current;
      if (delta === 0)
        fail(
          409,
          'BALANCE_UNCHANGED',
          'This person already has that token balance.',
        );
      if (delta < -2147483648 || delta > 2147483647)
        fail(
          409,
          'BALANCE_RANGE',
          'The requested balance change exceeds the ledger range.',
        );
      const response: TokenBalanceSetResponse = {
        participantId: body.participantId,
        balance: body.balance,
        delta,
        reason: body.reason,
      };
      await tx.insert(tokenLedger).values({
        participantId: body.participantId,
        delta,
        kind: 'correction',
        idempotencyKey: key,
        requestHash: hash,
        response,
        reason: body.reason,
      });
      return response;
    });
  }

  async selectParticipant(id: string): Promise<Participant> {
    const setup = await this.database.db
      .select({ completed: settings.setupCompleted })
      .from(settings)
      .where(eq(settings.id, 1));
    if (!setup[0])
      fail(503, 'NOT_INITIALIZED', 'Game settings are not initialized.');
    if (!setup[0].completed)
      fail(403, 'SETUP_REQUIRED', 'Administrator setup is not complete.');
    const [row] = await this.database.db
      .select()
      .from(participants)
      .where(eq(participants.id, id));
    if (!row) fail(404, 'PARTICIPANT_NOT_FOUND', 'Participant was not found.');
    if (!row.active)
      fail(403, 'PARTICIPANT_INACTIVE', 'Participant is inactive.');
    return participantView(row);
  }

  async saveParticipant(
    input: { name?: string; active?: boolean },
    id?: string,
  ): Promise<Participant> {
    return transaction(this.database, async (tx) => {
      if (!id) {
        if (input.name === undefined)
          fail(400, 'INVALID_NAME', 'Name is required.');
        const [row] = await tx
          .insert(participants)
          .values({ name: normalizedName(input.name) })
          .returning();
        return participantView(row!);
      }
      const [current] = await tx
        .select()
        .from(participants)
        .where(eq(participants.id, id));
      if (!current)
        fail(404, 'PARTICIPANT_NOT_FOUND', 'Participant was not found.');
      if (input.name === undefined && input.active === undefined)
        return participantView(current);
      const [row] = await tx
        .update(participants)
        .set({
          ...(input.name === undefined
            ? {}
            : { name: normalizedName(input.name) }),
          ...(input.active === undefined ? {} : { active: input.active }),
        })
        .where(eq(participants.id, id))
        .returning();
      if (input.active === false) {
        await deactivateParticipant(tx, id);
      }
      return participantView(row!);
    });
  }

  async removeParticipant(id: string): Promise<ParticipantRemoval> {
    return transaction(this.database, async (tx) => {
      const [current] = await tx
        .select({ id: participants.id })
        .from(participants)
        .where(eq(participants.id, id));
      if (!current)
        fail(404, 'PARTICIPANT_NOT_FOUND', 'Participant was not found.');

      if (await participantHasReferences(tx, id)) {
        await tx
          .update(participants)
          .set({ active: false })
          .where(eq(participants.id, id));
        await deactivateParticipant(tx, id);
        return { participantId: id, action: 'archived' };
      }

      // Foreign keys remain the final guard if a reference is added outside the
      // settings-locked game mutation path.
      await tx.delete(participants).where(eq(participants.id, id));
      return { participantId: id, action: 'deleted' };
    });
  }

  async listPlaces(includeInactive = false): Promise<Place[]> {
    const query = this.database.db.select().from(places);
    const rows = includeInactive
      ? await query.orderBy(asc(places.name))
      : await query.where(eq(places.active, true)).orderBy(asc(places.name));
    return rows.map(placeView);
  }

  async listRestaurantOdds(): Promise<{
    places: { placeId: string; name: string; percent: number }[];
  }> {
    const active = await this.database.db
      .select({ id: places.id, name: places.name, logWeight: places.logWeight })
      .from(places)
      .where(eq(places.active, true))
      .orderBy(asc(places.name));
    const odds = probabilities(active);
    return {
      places: odds.map(({ id, probability }) => ({
        placeId: id,
        name: active.find((place) => place.id === id)!.name,
        percent: probability * 100,
      })),
    };
  }

  async setRestaurantOdds(input: {
    places: { placeId: string; percent: number }[];
  }): Promise<{
    places: { placeId: string; name: string; percent: number }[];
  }> {
    const parsed = setRestaurantOddsRequest.safeParse(input);
    if (!parsed.success)
      fail(
        400,
        'INVALID_RESTAURANT_ODDS',
        'Provide one positive percentage for every active restaurant; the total must be 100%.',
      );
    return transaction(this.database, async (tx) => {
      const instant = new Date();
      await this.refundAllOpenInfluence(
        tx,
        instant,
        'Restaurant odds changed by an administrator',
      );
      const active = await tx
        .select({
          id: places.id,
          name: places.name,
          logWeight: places.logWeight,
        })
        .from(places)
        .where(eq(places.active, true))
        .orderBy(asc(places.id));
      const supplied = parsed.data.places;
      if (
        active.length !== supplied.length ||
        active.some(
          (place) => !supplied.some((entry) => entry.placeId === place.id),
        )
      )
        fail(
          409,
          'RESTAURANT_LIST_CHANGED',
          'The active restaurant list changed. Refresh and try again.',
        );
      const total = supplied.reduce((sum, entry) => sum + entry.percent, 0);
      // Refunds restore base weights first. Preserve their total in log space,
      // including weights too small or large to exponentiate directly.
      const logTotalWeight =
        newPlaceLogWeight(active) + Math.log(active.length);
      for (const entry of supplied) {
        const weight = entry.percent / total;
        if (!Number.isFinite(weight) || weight <= 0)
          fail(
            400,
            'INVALID_RESTAURANT_ODDS',
            'Each restaurant must have a representable positive percentage.',
          );
        await tx
          .update(places)
          .set({ logWeight: logTotalWeight + Math.log(weight) })
          .where(eq(places.id, entry.placeId));
      }
      return this.listRestaurantOddsIn(tx);
    });
  }

  private async listRestaurantOddsIn(
    tx: Tx,
  ): Promise<{ places: { placeId: string; name: string; percent: number }[] }> {
    const active = await tx
      .select({ id: places.id, name: places.name, logWeight: places.logWeight })
      .from(places)
      .where(eq(places.active, true))
      .orderBy(asc(places.name));
    const odds = probabilities(active);
    return {
      places: odds.map(({ id, probability }) => ({
        placeId: id,
        name: active.find((place) => place.id === id)!.name,
        percent: probability * 100,
      })),
    };
  }

  private async currentBettingMarket(tx: Tx, now: Date) {
    const [row] = await tx.select().from(settings).where(eq(settings.id, 1));
    if (!row)
      fail(503, 'NOT_INITIALIZED', 'Game settings are not initialized.');
    const schedule = getScheduleFromRow(row);
    await this.refundExpiredMarkets(tx, now);
    const today = localClock(now, schedule.timezone).localDate;
    const [todayDraw] = await tx
      .select({ id: draws.id })
      .from(draws)
      .where(eq(draws.localDate, today));
    const localDate = nextBettingDate(
      now,
      schedule,
      Boolean(todayDraw),
      row.skipDrawDate,
    );
    let [market] = await tx
      .select()
      .from(bettingMarkets)
      .where(
        and(
          eq(bettingMarkets.localDate, localDate),
          eq(bettingMarkets.status, 'open'),
        ),
      );
    if (!market) {
      [market] = await tx
        .insert(bettingMarkets)
        .values({
          localDate,
          timezone: schedule.timezone,
          scheduledTime: schedule.time,
          cutoffMinutes: row.bettingCloseMinutes,
        })
        .returning();
    }
    return {
      ...market!,
      opensAt: await wheelPeriodOpensAt(tx, row, now),
    };
  }

  private async refundExpiredMarkets(tx: Tx, now: Date): Promise<void> {
    const openMarkets = await tx
      .select()
      .from(bettingMarkets)
      .where(eq(bettingMarkets.status, 'open'));
    for (const stale of openMarkets) {
      if (stale.localDate < localClock(now, stale.timezone).localDate)
        await this.refundMarket(tx, stale.id, 'void');
    }
  }

  private async refundInfluenceLots(
    tx: Tx,
    marketId: string,
    now: Date,
    options: { placeId?: string; participantId?: string; reason: string },
  ): Promise<void> {
    const predicates = [
      eq(influenceLots.marketId, marketId),
      isNull(influenceLots.withdrawnAt),
    ];
    if (options.placeId)
      predicates.push(eq(influenceLots.placeId, options.placeId));
    if (options.participantId)
      predicates.push(eq(influenceLots.participantId, options.participantId));
    const lots = await tx
      .select()
      .from(influenceLots)
      .where(and(...predicates));
    for (const lot of lots)
      await withdrawInfluenceLot(tx, lot, now, options.reason);
  }

  private async refundOpenBets(
    tx: Tx,
    marketId: string,
    now: Date,
    placeId?: string,
    reason = 'Bet refunded because its restaurant was removed',
  ): Promise<void> {
    const predicates = [eq(bets.marketId, marketId), eq(bets.status, 'open')];
    if (placeId) predicates.push(eq(bets.placeId, placeId));
    const open = await tx
      .select()
      .from(bets)
      .where(and(...predicates));
    for (const bet of open) {
      await tx.insert(tokenLedger).values({
        participantId: bet.participantId,
        delta: bet.stake,
        kind: 'bet-release',
        idempotencyKey: `bet-refund:${bet.id}`,
        requestHash: createHash(`refund:${bet.id}`),
        placeId: bet.placeId,
        betId: bet.id,
        reason,
        createdAt: now,
      });
      await balance(tx, bet.participantId);
      await tx
        .update(bets)
        .set({
          status: 'refunded',
          payout: 0,
          updatedAt: now,
          settledAt: now,
        })
        .where(eq(bets.id, bet.id));
    }
  }

  private async refundAllOpenInfluence(tx: Tx, now: Date, reason: string) {
    const openMarkets = await tx
      .select({ id: bettingMarkets.id })
      .from(bettingMarkets)
      .where(eq(bettingMarkets.status, 'open'));
    for (const market of openMarkets) {
      await this.refundInfluenceLots(tx, market.id, now, { reason });
    }
  }

  private async refundPlaceActivity(
    tx: Tx,
    placeId: string,
    now: Date,
  ): Promise<void> {
    const openMarkets = await tx
      .select({ id: bettingMarkets.id })
      .from(bettingMarkets)
      .where(eq(bettingMarkets.status, 'open'));
    for (const market of openMarkets) {
      await this.refundInfluenceLots(tx, market.id, now, {
        placeId,
        reason: 'Influence refunded because its restaurant was removed',
      });
      await this.refundOpenBets(
        tx,
        market.id,
        now,
        placeId,
        'Bet refunded because its restaurant was removed',
      );
    }
  }

  private async recordBetRequest<T>(
    tx: Tx,
    participantId: string,
    key: string,
    hash: string,
    response: T,
  ): Promise<void> {
    await tx.insert(betRequests).values({
      participantId,
      idempotencyKey: key,
      requestHash: hash,
      response: response as unknown,
    });
  }

  private async replayBetRequest<T>(
    tx: Tx,
    participantId: string,
    key: string,
    hash: string,
  ): Promise<T | null> {
    const [prior] = await tx
      .select()
      .from(betRequests)
      .where(
        and(
          eq(betRequests.participantId, participantId),
          eq(betRequests.idempotencyKey, key),
        ),
      );
    if (!prior) return null;
    if (prior.requestHash !== hash)
      fail(
        409,
        'IDEMPOTENCY_MISMATCH',
        'This idempotency key was used for a different request.',
      );
    const response = prior.response as T;
    if (typeof response === 'object' && response !== null)
      replayResponses.add(response as object);
    return response;
  }

  private async refundMarket(
    tx: Tx,
    marketId: string,
    status: 'void' | 'settled',
    drawId?: string,
  ) {
    const now = new Date();
    if (status === 'void') {
      await this.refundInfluenceLots(tx, marketId, now, {
        reason:
          'Influence refunded because its betting market was voided or expired',
      });
    }
    const open = await tx
      .select()
      .from(bets)
      .where(and(eq(bets.marketId, marketId), eq(bets.status, 'open')));
    for (const bet of open) {
      await tx.insert(tokenLedger).values({
        participantId: bet.participantId,
        delta: bet.stake,
        kind: 'bet-release',
        idempotencyKey: `bet-refund:${bet.id}`,
        requestHash: createHash(`refund:${bet.id}`),
        placeId: bet.placeId,
        betId: bet.id,
        reason:
          'Bet refunded because its roll was skipped, its schedule changed, or it expired',
        createdAt: now,
      });
      await balance(tx, bet.participantId);
      await tx
        .update(bets)
        .set({
          status: 'refunded',
          payout: 0,
          updatedAt: now,
          settledAt: now,
        })
        .where(eq(bets.id, bet.id));
    }
    await tx
      .update(bettingMarkets)
      .set({ status, drawId: drawId ?? null })
      .where(eq(bettingMarkets.id, marketId));
  }

  private async settleMarket(
    tx: Tx,
    localDate: string,
    draw: DrawRow,
    now: Date,
  ) {
    const [market] = await tx
      .select()
      .from(bettingMarkets)
      .where(
        and(
          eq(bettingMarkets.localDate, localDate),
          eq(bettingMarkets.status, 'open'),
        ),
      );
    if (!market) return;
    const open = await tx
      .select()
      .from(bets)
      .where(and(eq(bets.marketId, market.id), eq(bets.status, 'open')));
    for (const bet of open) {
      const probability =
        draw.snapshot.find((item) => item.placeId === bet.placeId)
          ?.probability ?? 0;
      const won = bet.placeId === draw.placeId;
      const payout =
        won && probability > 0
          ? Math.min(2147483647, Math.floor(bet.stake / probability))
          : 0;
      if (payout > 0) {
        await tx.insert(tokenLedger).values({
          participantId: bet.participantId,
          delta: payout,
          kind: 'bet-payout',
          idempotencyKey: `bet-payout:${bet.id}`,
          requestHash: createHash(`payout:${bet.id}:${draw.id}`),
          placeId: bet.placeId,
          betId: bet.id,
          reason: 'Winning lunch bet payout',
          createdAt: now,
        });
        const placeName =
          draw.snapshot.find((place) => place.placeId === bet.placeId)?.name ??
          'your restaurant';
        await enqueueNotifications(
          tx,
          `bet-payout:${bet.id}`,
          {
            title: 'Your lunch bet won',
            body: `Your bet on ${placeName} paid ${payout} tokens.`,
            tag: `lunch-bet-${bet.id}`,
          },
          { participantIds: [bet.participantId], drawId: draw.id },
        );
      }
      await tx
        .update(bets)
        .set({
          status: won ? 'won' : 'lost',
          payout,
          probability,
          updatedAt: now,
          settledAt: now,
        })
        .where(eq(bets.id, bet.id));
    }
    await tx
      .update(bettingMarkets)
      .set({ status: 'settled', drawId: draw.id })
      .where(eq(bettingMarkets.id, market.id));
  }

  async savePlace(
    input: { name?: string; active?: boolean; healthLevel?: HealthLevel },
    id?: string,
  ): Promise<Place> {
    if (
      input.healthLevel !== undefined &&
      !healthLevel.safeParse(input.healthLevel).success
    )
      fail(400, 'INVALID_HEALTH_LEVEL', 'Choose Treat, Balanced or Healthy.');
    return transaction(this.database, async (tx) => {
      if (!id) {
        if (input.name === undefined)
          fail(400, 'INVALID_NAME', 'Name is required.');
        const active = await tx
          .select({ id: places.id, logWeight: places.logWeight })
          .from(places)
          .where(eq(places.active, true));
        const economy = await currentEconomy(tx);
        const logWeight = newPlaceLogWeight(active, economy.newPlaceMultiplier);
        const [row] = await tx
          .insert(places)
          .values({
            name: normalizedName(input.name),
            logWeight,
            healthLevel: input.healthLevel ?? 'balanced',
          })
          .returning();
        return placeView(row!);
      }
      const [current] = await tx.select().from(places).where(eq(places.id, id));
      if (!current) fail(404, 'PLACE_NOT_FOUND', 'Place was not found.');
      if (input.active === false && current.active) {
        await this.refundPlaceActivity(tx, id, new Date());
      }
      if (
        input.name === undefined &&
        input.active === undefined &&
        input.healthLevel === undefined
      )
        return placeView(current);
      const [row] = await tx
        .update(places)
        .set({
          ...(input.name === undefined
            ? {}
            : { name: normalizedName(input.name) }),
          ...(input.active === undefined ? {} : { active: input.active }),
          ...(input.healthLevel === undefined
            ? {}
            : { healthLevel: input.healthLevel }),
        })
        .where(eq(places.id, id))
        .returning();
      return placeView(row!);
    });
  }

  async getSchedule(): Promise<Schedule> {
    const [row] = await this.database.db
      .select()
      .from(settings)
      .where(eq(settings.id, 1));
    if (!row)
      fail(503, 'NOT_INITIALIZED', 'Game settings are not initialized.');
    return getScheduleFromRow(row);
  }

  async getDrawSkip(now = new Date()): Promise<DrawSkip> {
    const [row] = await this.database.db
      .select()
      .from(settings)
      .where(eq(settings.id, 1));
    if (!row)
      fail(503, 'NOT_INITIALIZED', 'Game settings are not initialized.');
    return drawSkipFromRow(row, now);
  }

  async setDrawSkip(skip: boolean, now = new Date()): Promise<DrawSkip> {
    return transaction(this.database, async (tx) => {
      const [row] = await tx.select().from(settings).where(eq(settings.id, 1));
      if (!row)
        fail(503, 'NOT_INITIALIZED', 'Game settings are not initialized.');
      const schedule = getScheduleFromRow(row);
      const clock = localClock(now, schedule.timezone);

      if (!skip) {
        if (row.skipDrawDate === clock.localDate && clock.time >= schedule.time)
          fail(
            409,
            'DRAW_SKIP_NOT_CANCELLABLE',
            'This roll has reached its scheduled time and can no longer be restored.',
          );
        if (row.skipDrawDate) {
          const [updated] = await tx
            .update(settings)
            .set({ skipDrawDate: null })
            .where(eq(settings.id, 1))
            .returning();
          return drawSkipFromRow(updated!, now);
        }
        return drawSkipFromRow(row, now);
      }

      if (row.skipDrawDate && row.skipDrawDate >= clock.localDate)
        return drawSkipFromRow(row, now);

      const [todayDraw] = await tx
        .select({ id: draws.id })
        .from(draws)
        .where(eq(draws.localDate, clock.localDate));
      const localDate = nextBettingDate(now, schedule, Boolean(todayDraw));
      const [market] = await tx
        .select({ id: bettingMarkets.id })
        .from(bettingMarkets)
        .where(
          and(
            eq(bettingMarkets.localDate, localDate),
            eq(bettingMarkets.status, 'open'),
          ),
        );
      if (market) await this.refundMarket(tx, market.id, 'void');
      const [updated] = await tx
        .update(settings)
        .set({ skipDrawDate: localDate })
        .where(eq(settings.id, 1))
        .returning();
      return drawSkipFromRow(updated!, now);
    });
  }

  async setSchedule(schedule: Schedule): Promise<Schedule> {
    return transaction(this.database, async (tx) => {
      const current = await currentSchedule(tx);
      if (
        current.timezone === schedule.timezone &&
        current.time === schedule.time &&
        [...current.weekdays].sort().join(',') ===
          [...schedule.weekdays].sort().join(',')
      )
        return current;
      const open = await tx
        .select({ id: bettingMarkets.id })
        .from(bettingMarkets)
        .where(eq(bettingMarkets.status, 'open'));
      for (const market of open) await this.refundMarket(tx, market.id, 'void');
      const [row] = await tx
        .update(settings)
        .set({
          timezone: schedule.timezone,
          spinTime: schedule.time,
          weekdays: schedule.weekdays,
          skipDrawDate: null,
        })
        .where(eq(settings.id, 1))
        .returning();
      if (!row)
        fail(503, 'NOT_INITIALIZED', 'Game settings are not initialized.');
      return getScheduleFromRow(row);
    });
  }

  async wallet(participantId: string): Promise<WalletResponse> {
    return this.database.db.transaction(
      async (tx) => {
        await requireSetupComplete(tx as Tx);
        const [person] = await tx
          .select({ id: participants.id, active: participants.active })
          .from(participants)
          .where(eq(participants.id, participantId));
        if (!person)
          fail(404, 'PARTICIPANT_NOT_FOUND', 'Participant was not found.');
        if (!person.active)
          fail(403, 'PARTICIPANT_INACTIVE', 'Participant is inactive.');
        const [balanceRow] = await tx
          .select({
            balance: sql<number>`coalesce(sum(${tokenLedger.delta}), 0)::float8`,
          })
          .from(tokenLedger)
          .where(eq(tokenLedger.participantId, participantId));
        const currentBalance = balanceRow?.balance ?? 0;
        if (!Number.isSafeInteger(currentBalance))
          fail(
            409,
            'BALANCE_OVERFLOW',
            'The token balance exceeds the supported range.',
          );
        return {
          balance: currentBalance,
          ledger: (await tokenLedgerActivity(tx, participantId)).map(
            tokenActivityView,
          ),
          bets: await walletBets(tx, participantId),
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  async tokenOverview(
    participantId: string,
    now = new Date(),
  ): Promise<TokenOverviewResponse> {
    return this.database.db.transaction(
      async (tx) => {
        const typedTx = tx as Tx;
        await requireSetupComplete(typedTx);
        const [person] = await typedTx
          .select({ id: participants.id, active: participants.active })
          .from(participants)
          .where(eq(participants.id, participantId));
        if (!person)
          fail(404, 'PARTICIPANT_NOT_FOUND', 'Participant was not found.');
        if (!person.active)
          fail(403, 'PARTICIPANT_INACTIVE', 'Participant is inactive.');
        const [configuration] = await typedTx
          .select()
          .from(settings)
          .where(eq(settings.id, 1));
        if (!configuration)
          fail(503, 'NOT_INITIALIZED', 'Game settings are not initialized.');
        const localDate = localClock(now, configuration.timezone).localDate;
        const balance = sql<number>`coalesce(sum(${tokenLedger.delta}), 0)::float8`;
        const [todayDraw] = await typedTx
          .select({ id: draws.id })
          .from(draws)
          .where(eq(draws.localDate, localDate));
        const spinLocalDate = nextBettingDate(
          now,
          getScheduleFromRow(configuration),
          Boolean(todayDraw),
          configuration.skipDrawDate,
        );
        const activity = await tokenLedgerActivity(
          typedTx,
          undefined,
          undefined,
          undefined,
          spinLocalDate,
        );
        const spinDeltas = new Map<string, number>();
        for (const entry of activity)
          spinDeltas.set(
            entry.participantId,
            (spinDeltas.get(entry.participantId) ?? 0) + entry.delta,
          );
        const todayActivity = await tokenLedgerActivity(
          typedTx,
          undefined,
          localDate,
          configuration.timezone,
        );
        const todayDeltas = new Map<string, number>();
        for (const entry of todayActivity)
          todayDeltas.set(
            entry.participantId,
            (todayDeltas.get(entry.participantId) ?? 0) + entry.delta,
          );
        const balances = await typedTx
          .select({
            participantId: participants.id,
            participantName: participants.name,
            balance,
          })
          .from(participants)
          .leftJoin(tokenLedger, eq(tokenLedger.participantId, participants.id))
          .where(eq(participants.active, true))
          .groupBy(participants.id, participants.name)
          .orderBy(asc(participants.name));
        const pendingBets = await typedTx
          .select({
            participantId: bets.participantId,
            tokens: sql<number>`sum(${bets.stake})::float8`,
          })
          .from(bets)
          .innerJoin(bettingMarkets, eq(bets.marketId, bettingMarkets.id))
          .where(
            and(eq(bets.status, 'open'), eq(bettingMarkets.status, 'open')),
          )
          .groupBy(bets.participantId);
        const pendingInfluence = await typedTx
          .select({
            participantId: influenceLots.participantId,
            tokens: sql<number>`sum(${influenceLots.tokenCost})::float8`,
          })
          .from(influenceLots)
          .innerJoin(
            bettingMarkets,
            eq(influenceLots.marketId, bettingMarkets.id),
          )
          .where(
            and(
              isNull(influenceLots.withdrawnAt),
              eq(bettingMarkets.status, 'open'),
            ),
          )
          .groupBy(influenceLots.participantId);
        const betTokens = new Map(
          pendingBets.map((row) => [row.participantId, row.tokens]),
        );
        const influenceTokens = new Map(
          pendingInfluence.map((row) => [row.participantId, row.tokens]),
        );
        const totals = balances
          .map((row) => ({
            ...row,
            spinDelta: spinDeltas.get(row.participantId) ?? 0,
            todayDelta: todayDeltas.get(row.participantId) ?? 0,
            totalBalance:
              row.balance +
              (betTokens.get(row.participantId) ?? 0) +
              (influenceTokens.get(row.participantId) ?? 0),
          }))
          .sort(
            (a, b) =>
              b.totalBalance - a.totalBalance ||
              a.participantName.localeCompare(b.participantName),
          );
        let rank = 0;
        const rows = totals.map((row, index) => {
          if (
            index === 0 ||
            row.totalBalance !== totals[index - 1]!.totalBalance
          )
            rank = index + 1;
          return { ...row, rank };
        });
        for (const row of rows) {
          if (
            !Number.isSafeInteger(row.balance) ||
            row.balance < 0 ||
            !Number.isSafeInteger(row.totalBalance) ||
            row.totalBalance < row.balance ||
            !Number.isSafeInteger(row.spinDelta) ||
            !Number.isSafeInteger(row.todayDelta)
          )
            fail(
              409,
              'BALANCE_OVERFLOW',
              'A token balance exceeds the supported range.',
            );
        }
        return {
          localDate,
          spinLocalDate,
          timezone: configuration.timezone,
          rows,
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  async dailyActivity(
    participantId: string,
    date?: string,
    now = new Date(),
    scope: 'day' | 'draw' = 'day',
  ): Promise<DailyActivityResponse> {
    const parsed = dailyActivityQuery.safeParse({ date, scope });
    if (!parsed.success)
      fail(
        400,
        'INVALID_ACTIVITY_DATE',
        'Provide a valid local calendar date.',
      );
    return this.database.db.transaction(
      async (tx) => {
        const typedTx = tx as Tx;
        await requireSetupComplete(typedTx);
        const [person] = await typedTx
          .select({ id: participants.id, active: participants.active })
          .from(participants)
          .where(eq(participants.id, participantId));
        if (!person)
          fail(404, 'PARTICIPANT_NOT_FOUND', 'Participant was not found.');
        if (!person.active)
          fail(403, 'PARTICIPANT_INACTIVE', 'Participant is inactive.');
        const [configuration] = await typedTx
          .select({ timezone: settings.timezone })
          .from(settings)
          .where(eq(settings.id, 1));
        if (!configuration)
          fail(503, 'NOT_INITIALIZED', 'Game settings are not initialized.');
        const localDate =
          parsed.data.date ?? localClock(now, configuration.timezone).localDate;
        const ledger = await tokenLedgerActivity(
          typedTx,
          undefined,
          localDate,
          configuration.timezone,
          scope === 'draw' ? localDate : undefined,
        );
        const dayBets = await typedTx
          .select({
            bet: bets,
            participantId: participants.id,
            participantName: participants.name,
          })
          .from(bets)
          .innerJoin(participants, eq(bets.participantId, participants.id))
          .where(eq(bets.localDate, localDate))
          .orderBy(desc(bets.updatedAt), desc(bets.id));
        const positions = await this.dailyInfluencePositions(
          typedTx,
          localDate,
          now,
        );
        const liveOdds = probabilities(
          await typedTx
            .select({ id: places.id, logWeight: places.logWeight })
            .from(places)
            .where(eq(places.active, true)),
        );
        return {
          localDate,
          timezone: configuration.timezone,
          entries: ledger.map((row) => ({
            ...tokenActivityView(row),
            participantId: row.participantId,
            participantName: row.participantName,
          })),
          bets: dayBets.map(
            ({ bet, participantId: ownerId, participantName }) => {
              const currentProbability =
                bet.status === 'open'
                  ? (liveOdds.find((place) => place.id === bet.placeId)
                      ?.probability ?? null)
                  : null;
              return {
                ...betView(bet),
                participantId: ownerId,
                participantName,
                currentProbability,
                estimatedWinPayout:
                  currentProbability !== null && currentProbability > 0
                    ? Math.min(
                        2147483647,
                        Math.floor(bet.stake / currentProbability),
                      )
                    : null,
              };
            },
          ),
          positions,
          healthBonuses: (
            await typedTx
              .select()
              .from(draws)
              .where(eq(draws.localDate, localDate))
          )
            .filter((row) => row.healthBonus !== null)
            .map((row) => ({
              drawId: row.id,
              placeName: row.placeName,
              drawnAt: row.drawnAt.toISOString(),
              bonus: row.healthBonus!,
            })),
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  private async dailyInfluencePositions(
    tx: Tx,
    localDate: string,
    now: Date,
  ): Promise<DrawInfluencePosition[]> {
    const markets = await tx
      .select()
      .from(bettingMarkets)
      .where(
        and(
          eq(bettingMarkets.localDate, localDate),
          or(
            eq(bettingMarkets.status, 'open'),
            eq(bettingMarkets.status, 'settled'),
          ),
        ),
      );
    const grouped = new Map<string, DrawInfluencePosition>();
    for (const market of markets) {
      const status: DrawInfluencePosition['status'] =
        market.status === 'settled'
          ? 'committed'
          : bettingWindowView(market, now).open
            ? 'staged'
            : 'locked';
      const rows = await tx
        .select({
          placeId: influenceLots.placeId,
          placeName: places.name,
          participantId: influenceLots.participantId,
          participantName: participants.name,
          action: influenceLots.action,
          tokenCost: influenceLots.tokenCost,
        })
        .from(influenceLots)
        .innerJoin(places, eq(influenceLots.placeId, places.id))
        .innerJoin(
          participants,
          eq(influenceLots.participantId, participants.id),
        )
        .where(
          and(
            eq(influenceLots.marketId, market.id),
            isNull(influenceLots.withdrawnAt),
          ),
        );
      for (const row of rows) {
        const key = `${row.placeId}:${row.participantId}`;
        let position = grouped.get(key);
        if (!position) {
          position = {
            placeId: row.placeId,
            placeName: row.placeName,
            participantId: row.participantId,
            participantName: row.participantName,
            boosts: 0,
            reductions: 0,
            boostTokens: 0,
            reductionTokens: 0,
            status,
          };
          grouped.set(key, position);
        }
        if (row.action === 'boost') {
          position.boosts += 1;
          position.boostTokens += row.tokenCost;
        } else {
          position.reductions += 1;
          position.reductionTokens += row.tokenCost;
        }
      }
    }
    return [...grouped.values()].sort(
      (a, b) =>
        a.placeName.localeCompare(b.placeName) ||
        a.participantName.localeCompare(b.participantName),
    );
  }

  private async netPendingInfluence(
    tx: Tx,
    participantId: string,
    placeId: string,
    marketId: string,
    now: Date,
  ): Promise<number> {
    const lots = await tx
      .select()
      .from(influenceLots)
      .where(
        and(
          eq(influenceLots.participantId, participantId),
          eq(influenceLots.placeId, placeId),
          eq(influenceLots.marketId, marketId),
          isNull(influenceLots.withdrawnAt),
        ),
      )
      .orderBy(desc(influenceLots.createdAt), desc(influenceLots.id));
    const boosts = lots.filter((lot) => lot.action === 'boost');
    const reductions = lots.filter((lot) => lot.action === 'reduce');
    let refunded = 0;
    while (boosts.length && reductions.length) {
      for (const lot of [boosts.pop()!, reductions.pop()!]) {
        await withdrawInfluenceLot(
          tx,
          lot,
          now,
          'Opposing staged units netted before adjusting this position',
        );
        refunded += lot.tokenCost;
      }
    }
    return refunded;
  }

  private async buyInfluenceUnit<T>(
    tx: Tx,
    participantId: string,
    place: typeof places.$inferSelect,
    marketId: string,
    action: 'boost' | 'reduce',
    key: string,
    hash: string,
    now: Date,
    responseFor: (place: Place, cost: number, balance: number) => T,
  ): Promise<T> {
    const nettedRefund = await this.netPendingInfluence(
      tx,
      participantId,
      place.id,
      marketId,
      now,
    );
    if (nettedRefund) {
      const [refreshed] = await tx
        .select()
        .from(places)
        .where(eq(places.id, place.id));
      place = refreshed!;
    }
    const [opposite] = await tx
      .select()
      .from(influenceLots)
      .where(
        and(
          eq(influenceLots.marketId, marketId),
          eq(influenceLots.participantId, participantId),
          eq(influenceLots.placeId, place.id),
          eq(influenceLots.action, action === 'boost' ? 'reduce' : 'boost'),
          isNull(influenceLots.withdrawnAt),
        ),
      )
      .orderBy(desc(influenceLots.createdAt), desc(influenceLots.id))
      .limit(1);
    if (opposite) {
      const nextBalance =
        (await balance(tx, participantId)) + opposite.tokenCost;
      const logWeight = place.logWeight - opposite.logMultiplier;
      if (!Number.isSafeInteger(nextBalance) || !Number.isFinite(logWeight))
        fail(
          409,
          'BALANCE_OVERFLOW',
          'This position cannot be adjusted safely.',
        );
      const response = responseFor(
        placeView({ ...place, logWeight }),
        -(nettedRefund + opposite.tokenCost),
        nextBalance,
      );
      await withdrawInfluenceLot(
        tx,
        opposite,
        now,
        `Moved toward zero: refunded a ${opposite.action} on ${place.name}`,
        { key, hash, response },
      );
      return response;
    }
    const economy = await currentEconomy(tx);
    const cost = action === 'boost' ? economy.boostCost : economy.reduceCost;
    const currentBalance = await balance(tx, participantId);
    if (currentBalance < cost)
      fail(
        409,
        'INSUFFICIENT_TOKENS',
        'There are not enough tokens for this influence unit.',
      );
    const multiplier =
      action === 'boost' ? economy.boostMultiplier : economy.reduceMultiplier;
    const logMultiplier = Math.log(multiplier);
    const logWeight = influenceWeight(place.logWeight, action, economy);
    if (!Number.isFinite(logWeight) || !Number.isFinite(logMultiplier))
      fail(
        409,
        'INVALID_WEIGHT',
        'The restaurant weight cannot be changed safely.',
      );
    const [changed] = await tx
      .update(places)
      .set({ logWeight })
      .where(eq(places.id, place.id))
      .returning();
    const currentPlace = placeView(changed!);
    const nextBalance = currentBalance - cost;
    const response = responseFor(
      currentPlace,
      cost - nettedRefund,
      nextBalance,
    );
    const [ledger] = await tx
      .insert(tokenLedger)
      .values({
        participantId,
        delta: -cost,
        kind: action,
        idempotencyKey: key,
        requestHash: hash,
        response,
        placeId: place.id,
        influenceMarketId: marketId,
        createdAt: now,
      })
      .returning({ id: tokenLedger.id });
    await tx.insert(influenceLots).values({
      marketId,
      participantId,
      placeId: place.id,
      action,
      tokenCost: cost,
      logMultiplier,
      purchaseLedgerId: ledger!.id,
      createdAt: now,
    });
    return response;
  }

  async currentInfluence(
    participantId: string,
    now?: Date,
  ): Promise<CurrentInfluenceResponse> {
    return transaction(this.database, async (tx) => {
      await requireSetupComplete(tx);
      await activeParticipant(tx, participantId);
      const instant = now ?? new Date();
      const market = await this.currentBettingMarket(tx, instant);
      const activePlaces = await tx
        .select({ id: places.id })
        .from(places)
        .where(eq(places.active, true))
        .orderBy(asc(places.name));
      const lots = await tx
        .select({
          placeId: influenceLots.placeId,
          participantId: influenceLots.participantId,
          action: influenceLots.action,
        })
        .from(influenceLots)
        .where(
          and(
            eq(influenceLots.marketId, market.id),
            isNull(influenceLots.withdrawnAt),
          ),
        );
      const totals = new Map<
        string,
        {
          boosts: number;
          reductions: number;
          historicalBoosts: number;
          historicalReductions: number;
          yourBoosts: number;
          yourReductions: number;
        }
      >();
      for (const place of activePlaces)
        totals.set(place.id, {
          boosts: 0,
          reductions: 0,
          historicalBoosts: 0,
          historicalReductions: 0,
          yourBoosts: 0,
          yourReductions: 0,
        });
      for (const lot of lots) {
        const count = totals.get(lot.placeId);
        if (!count) continue;
        if (lot.action === 'boost') {
          count.boosts += 1;
          if (lot.participantId === participantId) count.yourBoosts += 1;
        } else {
          count.reductions += 1;
          if (lot.participantId === participantId) count.yourReductions += 1;
        }
      }
      const activity = await tokenLedgerActivity(
        tx,
        undefined,
        undefined,
        undefined,
        market.localDate,
      );
      for (const entry of activity) {
        // Linked purchases are already represented by their unwithdrawn lots.
        // Legacy purchases have no refundable lot; only their display is inferred.
        if (entry.influenceLocalDate || entry.betId || !entry.placeId) continue;
        const count = totals.get(entry.placeId);
        if (!count) continue;
        if (entry.kind === 'boost') {
          count.boosts += 1;
          count.historicalBoosts += 1;
        } else if (entry.kind === 'reduce') {
          count.reductions += 1;
          count.historicalReductions += 1;
        }
      }
      return {
        window: bettingWindowView(market, instant),
        places: activePlaces.map(({ id }) => ({
          placeId: id,
          ...totals.get(id)!,
        })),
      };
    });
  }

  async refundInfluence(
    participantId: string,
    input: { localDate: string; placeId: string },
    key: string,
    now?: Date,
  ): Promise<InfluenceMutationResponse> {
    const parsed = refundInfluenceRequest.safeParse(input);
    if (!parsed.success)
      fail(400, 'INVALID_INFLUENCE', 'Provide a restaurant and draw date.');
    const body = parsed.data;
    const hash = requestHash('POST', '/api/v1/influence/refund', body);
    return transaction(this.database, async (tx) => {
      await requireSetupComplete(tx);
      await activeParticipant(tx, participantId);
      const prior = await existingKey(tx, participantId, key, hash);
      if (prior) return replay<InfluenceMutationResponse>(prior);
      const instant = now ?? new Date();
      const market = await this.currentBettingMarket(tx, instant);
      if (
        market.localDate !== body.localDate ||
        !bettingWindowView(market, instant).open
      )
        fail(
          409,
          'INFLUENCE_CLOSED',
          'Influence changes are closed for that draw.',
        );
      const [place] = await tx
        .select()
        .from(places)
        .where(and(eq(places.id, body.placeId), eq(places.active, true)));
      if (!place)
        fail(404, 'PLACE_NOT_FOUND', 'That restaurant is not on the wheel.');
      const lots = await tx
        .select()
        .from(influenceLots)
        .where(
          and(
            eq(influenceLots.marketId, market.id),
            eq(influenceLots.participantId, participantId),
            eq(influenceLots.placeId, place.id),
            isNull(influenceLots.withdrawnAt),
          ),
        )
        .orderBy(desc(influenceLots.createdAt), desc(influenceLots.id));
      if (!lots.length)
        fail(
          409,
          'INFLUENCE_NOT_FOUND',
          'You have no staged tokens on this restaurant.',
        );
      const tokenDelta = lots.reduce((sum, lot) => sum + lot.tokenCost, 0);
      const nextBalance = (await balance(tx, participantId)) + tokenDelta;
      const logWeight = lots.reduce(
        (weight, lot) => weight - lot.logMultiplier,
        place.logWeight,
      );
      if (!Number.isSafeInteger(nextBalance) || !Number.isFinite(logWeight))
        fail(
          409,
          'BALANCE_OVERFLOW',
          'These positions cannot be refunded safely.',
        );
      const response = {
        place: placeView({ ...place, logWeight }),
        balance: nextBalance,
        tokenDelta,
      };
      for (let index = 0; index < lots.length; index++)
        await withdrawInfluenceLot(
          tx,
          lots[index]!,
          instant,
          `Refunded your staged influence on ${place.name}`,
          index === 0 ? { key, hash, response } : undefined,
        );
      return response;
    });
  }

  async setPlaceWeight(input: {
    placeId: string;
    weight: number;
  }): Promise<Place> {
    const parsed = setPlaceWeightRequest.safeParse(input);
    if (!parsed.success)
      fail(400, 'INVALID_WEIGHT', 'Provide a finite positive weight.');
    return transaction(this.database, async (tx) => {
      const [place] = await tx
        .select()
        .from(places)
        .where(
          and(eq(places.id, parsed.data.placeId), eq(places.active, true)),
        );
      if (!place)
        fail(404, 'PLACE_NOT_FOUND', 'That restaurant is not on the wheel.');
      await this.refundAllOpenInfluence(
        tx,
        new Date(),
        'Influence refunded before an admin weight override',
      );
      const [updated] = await tx
        .update(places)
        .set({ logWeight: Math.log(parsed.data.weight) })
        .where(eq(places.id, place.id))
        .returning();
      return placeView(updated!);
    });
  }

  async changeInfluence(
    participantId: string,
    input: ChangeInfluenceRequest,
    key: string,
    now?: Date,
  ): Promise<InfluenceMutationResponse> {
    const parsed = changeInfluenceRequest.safeParse(input);
    if (!parsed.success)
      fail(
        400,
        'INVALID_INFLUENCE',
        'Provide a restaurant, action and unit change.',
      );
    const body = parsed.data;
    const hash = requestHash('POST', '/api/v1/influence/current', body);
    return transaction(this.database, async (tx) => {
      await requireSetupComplete(tx);
      await activeParticipant(tx, participantId);
      const prior = await existingKey(tx, participantId, key, hash);
      if (prior) return replay<InfluenceMutationResponse>(prior);
      const instant = now ?? new Date();
      const market = await this.currentBettingMarket(tx, instant);
      if (
        market.localDate !== body.localDate ||
        !bettingWindowView(market, instant).open
      )
        fail(
          409,
          'INFLUENCE_CLOSED',
          'Influence changes are closed for that draw.',
        );
      const [place] = await tx
        .select()
        .from(places)
        .where(and(eq(places.id, body.placeId), eq(places.active, true)));
      if (!place)
        fail(404, 'PLACE_NOT_FOUND', 'That restaurant is not on the wheel.');
      if (body.change === 1) {
        return this.buyInfluenceUnit(
          tx,
          participantId,
          place,
          market.id,
          body.action,
          key,
          hash,
          instant,
          (updatedPlace, _cost, nextBalance) => ({
            place: updatedPlace,
            balance: nextBalance,
            tokenDelta: -_cost,
          }),
        );
      }
      const [lot] = await tx
        .select()
        .from(influenceLots)
        .where(
          and(
            eq(influenceLots.marketId, market.id),
            eq(influenceLots.participantId, participantId),
            eq(influenceLots.placeId, place.id),
            eq(influenceLots.action, body.action),
            isNull(influenceLots.withdrawnAt),
          ),
        )
        .orderBy(desc(influenceLots.createdAt), desc(influenceLots.id))
        .limit(1);
      if (!lot)
        fail(
          409,
          'INFLUENCE_NOT_FOUND',
          `You have no active ${body.action} unit on that restaurant.`,
        );
      const restoredWeight = place.logWeight - lot.logMultiplier;
      if (!Number.isFinite(restoredWeight))
        fail(
          409,
          'INVALID_WEIGHT',
          'The restaurant weight cannot be restored safely.',
        );
      const currentBalance = await balance(tx, participantId);
      const nextBalance = currentBalance + lot.tokenCost;
      if (!Number.isSafeInteger(nextBalance))
        fail(
          409,
          'BALANCE_OVERFLOW',
          'The token balance exceeds the supported range.',
        );
      const response: InfluenceMutationResponse = {
        place: placeView({ ...place, logWeight: restoredWeight }),
        balance: nextBalance,
        tokenDelta: lot.tokenCost,
      };
      await withdrawInfluenceLot(
        tx,
        lot,
        instant,
        `Returned ${body.action} influence from ${place.name}`,
        {
          key,
          hash,
          response,
        },
      );
      return response;
    });
  }

  async currentBets(
    participantId: string,
    now?: Date,
  ): Promise<CurrentBetsResponse> {
    return transaction(this.database, async (tx) => {
      await requireSetupComplete(tx);
      await activeParticipant(tx, participantId);
      const instant = now ?? new Date();
      const market = await this.currentBettingMarket(tx, instant);
      const [current] = await tx
        .select()
        .from(bets)
        .where(
          and(
            eq(bets.marketId, market.id),
            eq(bets.participantId, participantId),
            eq(bets.status, 'open'),
          ),
        );
      const recent = await tx
        .select()
        .from(bets)
        .where(eq(bets.participantId, participantId))
        .orderBy(desc(bets.updatedAt), desc(bets.id))
        .limit(10);
      return {
        window: bettingWindowView(market, instant),
        bet: current ? betView(current) : null,
        recent: recent.map(betView),
      };
    });
  }

  async setBet(
    participantId: string,
    input: SetBetRequest,
    key: string,
    now?: Date,
  ) {
    const parsed = setBetRequest.safeParse(input);
    if (!parsed.success)
      fail(
        400,
        'INVALID_BET',
        'Provide a restaurant and positive whole token stake.',
      );
    const body = parsed.data;
    const hash = requestHash('PUT', '/api/v1/bets/current', body);
    return transaction(this.database, async (tx) => {
      await requireSetupComplete(tx);
      await activeParticipant(tx, participantId);
      const prior = await this.replayBetRequest<BetMutationResponse>(
        tx,
        participantId,
        key,
        hash,
      );
      if (prior) return prior;
      const instant = now ?? new Date();
      const market = await this.currentBettingMarket(tx, instant);
      if (
        market.localDate !== body.localDate ||
        !bettingWindowView(market, instant).open
      )
        fail(409, 'BETTING_CLOSED', 'Betting is closed for that draw.');
      const [place] = await tx
        .select()
        .from(places)
        .where(and(eq(places.id, body.placeId), eq(places.active, true)));
      if (!place)
        fail(404, 'PLACE_NOT_FOUND', 'That restaurant is not on the wheel.');
      const activePlaces = await tx
        .select({ id: places.id, logWeight: places.logWeight })
        .from(places)
        .where(eq(places.active, true));
      const probability =
        probabilities(activePlaces).find((item) => item.id === place.id)
          ?.probability ?? 0;
      if (probability <= 0)
        fail(
          409,
          'PLACE_UNAVAILABLE',
          'That restaurant has no current chance of winning.',
        );
      const [existing] = await tx
        .select()
        .from(bets)
        .where(
          and(
            eq(bets.marketId, market.id),
            eq(bets.participantId, participantId),
          ),
        );
      const delta =
        existing?.status === 'open' ? existing.stake - body.stake : -body.stake;
      const currentBalance = await balance(tx, participantId);
      if (-delta > currentBalance)
        fail(
          409,
          'INSUFFICIENT_TOKENS',
          'You do not have enough tokens for that stake.',
        );
      let row: typeof bets.$inferSelect | undefined;
      if (existing) {
        [row] = await tx
          .update(bets)
          .set({
            placeId: place.id,
            placeName: place.name,
            stake: body.stake,
            status: 'open',
            payout: null,
            probability: null,
            settledAt: null,
            updatedAt: instant,
          })
          .where(eq(bets.id, existing.id))
          .returning();
      } else {
        [row] = await tx
          .insert(bets)
          .values({
            marketId: market.id,
            localDate: market.localDate,
            participantId,
            placeId: place.id,
            placeName: place.name,
            stake: body.stake,
            status: 'open',
            updatedAt: instant,
          })
          .returning();
      }
      if (delta !== 0)
        await tx.insert(tokenLedger).values({
          participantId,
          delta,
          kind: delta < 0 ? 'bet-stake' : 'bet-release',
          idempotencyKey: `bet-change:${key}:${randomUUID()}`,
          requestHash: hash,
          placeId: place.id,
          betId: row!.id,
          reason:
            delta < 0
              ? 'Tokens reserved for lunch bet'
              : 'Bet stake reduced and tokens released',
          createdAt: instant,
        });
      const responseBody = {
        bet: betView(row!),
        balance: await balance(tx, participantId),
      };
      await this.recordBetRequest(tx, participantId, key, hash, responseBody);
      return responseBody;
    });
  }

  async cancelBet(
    participantId: string,
    input: { localDate: string },
    key: string,
    now?: Date,
  ) {
    const parsed = cancelBetRequest.safeParse(input);
    if (!parsed.success) fail(400, 'INVALID_BET', 'Provide the draw date.');
    const body = parsed.data;
    const hash = requestHash('DELETE', '/api/v1/bets/current', body);
    return transaction(this.database, async (tx) => {
      await requireSetupComplete(tx);
      await activeParticipant(tx, participantId);
      const prior = await this.replayBetRequest<BetMutationResponse>(
        tx,
        participantId,
        key,
        hash,
      );
      if (prior) return prior;
      const instant = now ?? new Date();
      const market = await this.currentBettingMarket(tx, instant);
      if (
        market.localDate !== body.localDate ||
        !bettingWindowView(market, instant).open
      )
        fail(409, 'BETTING_CLOSED', 'Betting is closed for that draw.');
      const [existing] = await tx
        .select()
        .from(bets)
        .where(
          and(
            eq(bets.marketId, market.id),
            eq(bets.participantId, participantId),
            eq(bets.status, 'open'),
          ),
        );
      if (existing) {
        await tx.insert(tokenLedger).values({
          participantId,
          delta: existing.stake,
          kind: 'bet-release',
          idempotencyKey: `bet-cancel:${key}:${randomUUID()}`,
          requestHash: hash,
          placeId: existing.placeId,
          betId: existing.id,
          reason: 'Lunch bet cancelled and stake refunded',
          createdAt: instant,
        });
        await tx
          .update(bets)
          .set({
            status: 'cancelled',
            payout: 0,
            updatedAt: instant,
            settledAt: instant,
          })
          .where(eq(bets.id, existing.id));
      }
      const responseBody = {
        bet: null,
        balance: await balance(tx, participantId),
      };
      await this.recordBetRequest(tx, participantId, key, hash, responseBody);
      return responseBody;
    });
  }

  async getHealthRule(): Promise<HealthRuleSettings> {
    const [row] = await this.database.db
      .select()
      .from(settings)
      .where(eq(settings.id, 1));
    if (!row)
      fail(503, 'NOT_INITIALIZED', 'Game settings are not initialized.');
    return {
      enabled: row.healthBonusEnabled,
      multiplier: row.healthBonusMultiplier,
    };
  }

  async setHealthRule(input: HealthRuleSettings): Promise<HealthRuleSettings> {
    const parsed = healthRuleSettings.safeParse(input);
    if (!parsed.success)
      fail(
        400,
        'INVALID_HEALTH_RULE',
        'Provide a health bonus multiplier greater than 1 and at most 100.',
      );
    return transaction(this.database, async (tx) => {
      await tx
        .update(settings)
        .set({
          healthBonusEnabled: parsed.data.enabled,
          healthBonusMultiplier: parsed.data.multiplier,
        })
        .where(eq(settings.id, 1));
      return parsed.data;
    });
  }

  async transferTokens(
    participantId: string,
    input: TransferRequest,
    key: string,
  ): Promise<TransferResponse> {
    const parsed = transferRequest.safeParse(input);
    if (!parsed.success)
      fail(
        400,
        'INVALID_TRANSFER',
        'Choose a recipient and a positive whole-token amount.',
      );
    const body = parsed.data;
    const hash = requestHash('POST', '/api/v1/transfers', body);
    return transaction(this.database, async (tx) => {
      await requireSetupComplete(tx);
      const sender = await activeParticipant(tx, participantId);
      const prior = await existingKey(tx, participantId, key, hash);
      if (prior) return replay<TransferResponse>(prior);
      if (body.recipientId === participantId)
        fail(400, 'SELF_TRANSFER', 'Choose someone other than yourself.');
      const recipient = await activeParticipant(tx, body.recipientId);
      const current = await balance(tx, participantId);
      if (current < body.amount)
        fail(
          409,
          'INSUFFICIENT_TOKENS',
          'There are not enough available tokens for this transfer.',
        );
      const recipientBalance = await balance(tx, recipient.id);
      if (!Number.isSafeInteger(recipientBalance + body.amount))
        fail(
          409,
          'BALANCE_OVERFLOW',
          'The recipient balance exceeds the supported range.',
        );
      const transferId = randomUUID();
      const response = {
        transferId,
        recipientId: recipient.id,
        recipientName: recipient.name,
        amount: body.amount,
        balance: current - body.amount,
      };
      const createdAt = new Date();
      await tx.insert(tokenLedger).values([
        {
          participantId,
          delta: -body.amount,
          kind: 'transfer-sent',
          idempotencyKey: key,
          requestHash: hash,
          response,
          transferId,
          counterpartyId: recipient.id,
          reason: `Sent to ${recipient.name}`,
          createdAt,
        },
        {
          participantId: recipient.id,
          delta: body.amount,
          kind: 'transfer-received',
          idempotencyKey: `transfer-received:${transferId}`,
          requestHash: hash,
          transferId,
          counterpartyId: participantId,
          reason: `Received from ${sender.name}`,
          createdAt,
        },
      ]);
      await enqueueNotifications(
        tx,
        `transfer:${transferId}`,
        {
          title: 'Tokens received',
          body: `${sender.name} sent you ${body.amount} token${body.amount === 1 ? '' : 's'}.`,
          tag: `lunch-transfer-${transferId}`,
        },
        { participantIds: [recipient.id] },
      );
      return response;
    });
  }

  async getPreferences(): Promise<GamePreferences> {
    const [row] = await this.database.db
      .select()
      .from(settings)
      .where(eq(settings.id, 1));
    if (!row)
      fail(503, 'NOT_INITIALIZED', 'Game settings are not initialized.');
    return preferencesFromRow(row);
  }

  async getEconomy(): Promise<EconomySettings> {
    const [row] = await this.database.db
      .select()
      .from(settings)
      .where(eq(settings.id, 1));
    if (!row)
      fail(503, 'NOT_INITIALIZED', 'Game settings are not initialized.');
    return economyFromRow(row);
  }

  async setEconomy(input: EconomySettings): Promise<EconomySettings> {
    const parsed = economySettings.safeParse(input);
    if (!parsed.success)
      fail(
        400,
        'INVALID_ECONOMY',
        'Provide positive whole token amounts and valid odds multipliers.',
      );
    return transaction(this.database, async (tx) => {
      const [row] = await tx
        .update(settings)
        .set(parsed.data)
        .where(eq(settings.id, 1))
        .returning();
      if (!row)
        fail(503, 'NOT_INITIALIZED', 'Game settings are not initialized.');
      return economyFromRow(row);
    });
  }

  async setPreferences(input: GamePreferencesInput): Promise<GamePreferences> {
    const parsed = gamePreferences.safeParse(input);
    if (!parsed.success)
      fail(
        400,
        'INVALID_PREFERENCES',
        'Provide a valid switch time and check-in pledge.',
      );
    return transaction(this.database, async (tx) => {
      const [row] = await tx
        .update(settings)
        .set(parsed.data)
        .where(eq(settings.id, 1))
        .returning();
      if (!row)
        fail(503, 'NOT_INITIALIZED', 'Game settings are not initialized.');
      return preferencesFromRow(row);
    });
  }

  async attendanceStatus(
    participantId: string,
    now = new Date(),
  ): Promise<AttendanceStatus> {
    return this.database.db.transaction(
      async (tx) => {
        await requireSetupComplete(tx as Tx);
        await activeParticipant(tx as Tx, participantId);
        const schedule = await currentSchedule(tx as Tx);
        const [draw] = await tx
          .select()
          .from(draws)
          .where(
            eq(draws.localDate, localClock(now, schedule.timezone).localDate),
          );
        if (!draw) return { drawId: null, checkedIn: false, open: false };
        const [record] = await tx
          .select({ id: attendance.id })
          .from(attendance)
          .where(
            and(
              eq(attendance.participantId, participantId),
              eq(attendance.drawId, draw.id),
            ),
          );
        return {
          drawId: draw.id,
          checkedIn: Boolean(record),
          open:
            localClock(now, draw.timezone).localDate === draw.localDate &&
            now.getTime() >= draw.drawnAt.getTime(),
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  async today(now = new Date()): Promise<TodayResponse> {
    return this.database.db.transaction(
      async (tx) => {
        const [settingsRow] = await tx
          .select()
          .from(settings)
          .where(eq(settings.id, 1));
        if (!settingsRow)
          fail(503, 'NOT_INITIALIZED', 'Game settings are not initialized.');
        const schedule = getScheduleFromRow(settingsRow);
        const clock = localClock(now, schedule.timezone);
        const [existing] = await tx
          .select()
          .from(draws)
          .where(eq(draws.localDate, clock.localDate));
        const active = await tx
          .select({
            id: places.id,
            name: places.name,
            logWeight: places.logWeight,
            healthLevel: places.healthLevel,
          })
          .from(places)
          .where(eq(places.active, true))
          .orderBy(asc(places.id));
        const odds = probabilities(active).map((item) => ({
          placeId: item.id,
          name: active.find((place) => place.id === item.id)!.name,
          healthLevel: active.find((place) => place.id === item.id)!
            .healthLevel,
          probability: item.probability,
        }));
        const evaluated = evaluateSchedule(now, schedule);
        const status = existing
          ? 'drawn'
          : settingsRow.skipDrawDate === clock.localDate
            ? 'skipped'
            : !evaluated.scheduled
              ? 'not-scheduled'
              : active.length
                ? 'pending'
                : 'no-options';
        return {
          serverTime: now.toISOString(),
          localDate: clock.localDate,
          schedule,
          preferences: preferencesFromRow(settingsRow),
          economy: economyFromRow(settingsRow),
          healthRule: {
            enabled: settingsRow.healthBonusEnabled,
            multiplier: settingsRow.healthBonusMultiplier,
          },
          status,
          wheel: wheelDisplay(
            now,
            schedule,
            Boolean(existing),
            settingsRow.skipDrawDate,
          ),
          result: existing ? drawView(existing) : null,
          odds,
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  async drawIfDue(now?: Date): Promise<DrawResponse | null> {
    return transaction(this.database, async (tx) => {
      const [setup] = await tx
        .select({ completed: settings.setupCompleted })
        .from(settings)
        .where(eq(settings.id, 1));
      if (!setup?.completed) return null;
      const schedule = await currentSchedule(tx);
      // Resolve the live clock after the serialization lock: a waiting tick may cross midnight.
      const instant = now ?? new Date();
      await this.refundExpiredMarkets(tx, instant);
      const due = evaluateSchedule(instant, schedule);
      if (!due.due || !due.scheduled) return null;
      const [existing] = await tx
        .select()
        .from(draws)
        .where(eq(draws.localDate, due.localDate));
      if (existing) return drawView(existing);
      const [skip] = await tx
        .select({ localDate: settings.skipDrawDate })
        .from(settings)
        .where(eq(settings.id, 1));
      if (skip?.localDate === due.localDate) return null;
      const active = await tx
        .select()
        .from(places)
        .where(eq(places.active, true))
        .orderBy(asc(places.id));
      if (!active.length) return null;
      const sample = secureSample();
      const odds = probabilities(active);
      const winnerId = selectPlace(active, sample)!;
      const winner = active.find((place) => place.id === winnerId)!;
      const snapshot = active.map((place) => ({
        placeId: place.id,
        name: place.name,
        logWeight: place.logWeight,
        probability: odds.find((item) => item.id === place.id)!.probability,
        healthLevel: place.healthLevel,
      }));
      const [rule] = await tx.select().from(settings).where(eq(settings.id, 1));
      const healthRule = {
        enabled: rule!.healthBonusEnabled,
        multiplier: rule!.healthBonusMultiplier,
      };
      const nextWeights = postDrawWeights(active, winner.id, healthRule);
      const healthy = active.filter(
        (place) =>
          healthRule.enabled &&
          winner.healthLevel === 'treat' &&
          place.healthLevel === 'healthy',
      );
      const beforeBonus = probabilities(
        postDrawWeights(active, winner.id, { ...healthRule, enabled: false }),
      );
      const afterBonus = probabilities(nextWeights);
      const healthBonus = healthy.length
        ? {
            multiplier: healthRule.multiplier,
            places: healthy.map((place) => ({
              placeId: place.id,
              name: place.name,
              probabilityBefore: beforeBonus.find(
                (item) => item.id === place.id,
              )!.probability,
              probabilityAfter: afterBonus.find((item) => item.id === place.id)!
                .probability,
            })),
          }
        : null;
      const [row] = await tx
        .insert(draws)
        .values({
          localDate: due.localDate,
          timezone: schedule.timezone,
          placeId: winner.id,
          placeName: winner.name,
          snapshot,
          spinDurationMs: rule!.wheelSpinSeconds * 1000,
          healthBonus,
          sample,
          drawnAt: instant,
        })
        .returning();
      await this.settleMarket(tx, due.localDate, row!, instant);
      for (const place of nextWeights) {
        if (
          place.id === winner.id ||
          healthy.some((entry) => entry.id === place.id)
        )
          await tx
            .update(places)
            .set({ logWeight: place.logWeight })
            .where(eq(places.id, place.id));
      }
      await enqueueNotifications(
        tx,
        `draw:${row!.id}`,
        {
          title: 'Lunch is decided',
          body: `${winner.name} won today's lunch draw.`,
          tag: `lunch-draw-${row!.id}`,
          drawId: row!.id,
        },
        { drawId: row!.id },
      );
      return drawView(row!);
    });
  }

  async attend(
    participantId: string,
    input: { drawId: string },
    key: string,
    now?: Date,
  ): Promise<AttendanceResponse> {
    const body = { drawId: input.drawId };
    const hash = requestHash('POST', '/api/v1/attendance', body);
    return transaction(this.database, async (tx) => {
      await requireSetupComplete(tx);
      await activeParticipant(tx, participantId);
      const prior = await existingKey(tx, participantId, key, hash);
      if (prior) return replay<AttendanceResponse>(prior);
      const [draw] = await tx
        .select()
        .from(draws)
        .where(eq(draws.id, input.drawId));
      if (!draw) fail(404, 'DRAW_NOT_FOUND', 'Draw was not found.');
      const instant = now ?? new Date();
      const clock = localClock(instant, draw.timezone);
      if (
        clock.localDate !== draw.localDate ||
        instant.getTime() < draw.drawnAt.getTime()
      )
        fail(409, 'ATTENDANCE_CLOSED', 'The attendance window is closed.');
      const [already] = await tx
        .select({ id: attendance.id })
        .from(attendance)
        .where(
          and(
            eq(attendance.participantId, participantId),
            eq(attendance.drawId, draw.id),
          ),
        );
      if (already)
        fail(409, 'ALREADY_ATTENDED', 'Attendance was already recorded.');
      const [checkin] = await tx
        .insert(attendance)
        .values({ participantId, drawId: draw.id })
        .returning();
      const { attendanceReward } = await currentEconomy(tx);
      const total = (await balance(tx, participantId)) + attendanceReward;
      if (!Number.isSafeInteger(total))
        fail(
          409,
          'BALANCE_OVERFLOW',
          'The token balance exceeds the supported range.',
        );
      const response = {
        drawId: draw.id,
        awardedTokens: attendanceReward,
        balance: total,
      } satisfies AttendanceResponse;
      await tx.insert(tokenLedger).values({
        participantId,
        attendanceId: checkin!.id,
        delta: attendanceReward,
        kind: 'attendance',
        idempotencyKey: key,
        requestHash: hash,
        response,
      });
      return response;
    });
  }

  async purchase(
    participantId: string,
    input: PurchaseRequest,
    key: string,
    now?: Date,
  ): Promise<PurchaseResponse> {
    const body = { placeId: input.placeId, action: input.action };
    return this.spendOnPlace(
      participantId,
      body,
      key,
      '/api/v1/purchases',
      now,
    );
  }

  private async spendOnPlace(
    participantId: string,
    input: PurchaseRequest,
    key: string,
    route: string,
    now?: Date,
  ): Promise<PurchaseResponse> {
    const hash = requestHash('POST', route, input);
    return transaction(this.database, async (tx) => {
      await requireSetupComplete(tx);
      await activeParticipant(tx, participantId);
      const prior = await existingKey(tx, participantId, key, hash);
      if (prior) return replay<PurchaseResponse>(prior);
      const instant = now ?? new Date();
      const [place] = await tx
        .select()
        .from(places)
        .where(and(eq(places.id, input.placeId), eq(places.active, true)));
      if (!place) fail(404, 'PLACE_NOT_FOUND', 'Active place was not found.');
      if (input.action === 'remove') {
        await requireWheelPeriod(tx, instant);
        await this.refundPlaceActivity(tx, place.id, instant);
      } else {
        const market = await this.currentBettingMarket(tx, instant);
        if (!bettingWindowView(market, instant).open)
          fail(
            409,
            'INFLUENCE_CLOSED',
            'Influence changes are closed for that draw.',
          );
        const [currentPlace] = await tx
          .select()
          .from(places)
          .where(and(eq(places.id, place.id), eq(places.active, true)));
        if (!currentPlace)
          fail(404, 'PLACE_NOT_FOUND', 'Active place was not found.');
        return this.buyInfluenceUnit(
          tx,
          participantId,
          currentPlace,
          market.id,
          input.action,
          key,
          hash,
          instant,
          (updatedPlace, cost, nextBalance) => ({
            place: updatedPlace,
            spentTokens: Math.max(0, cost),
            ...(cost < 0 ? { refundedTokens: -cost } : {}),
            balance: nextBalance,
          }),
        );
      }
      const current = await balance(tx, participantId);
      const economy = await currentEconomy(tx);
      const cost = economy.removePlaceCost;
      if (current < cost)
        fail(
          409,
          'INSUFFICIENT_TOKENS',
          'There are not enough tokens for this purchase.',
        );
      const [changed] = await tx
        .update(places)
        .set({ active: false })
        .where(eq(places.id, place.id))
        .returning();
      const response = {
        place: placeView(changed!),
        spentTokens: cost,
        balance: current - cost,
      } satisfies PurchaseResponse;
      await tx.insert(tokenLedger).values({
        participantId,
        delta: -cost,
        kind: input.action === 'remove' ? 'remove-place' : input.action,
        createdAt: instant,
        idempotencyKey: key,
        requestHash: hash,
        response,
        placeId: place.id,
        ...(input.action === 'remove'
          ? { reason: `Removed ${place.name} from the wheel.` }
          : {}),
      });
      return response;
    });
  }

  async addPlace(
    participantId: string,
    input: { name: string; healthLevel?: HealthLevel },
    key: string,
    now?: Date,
  ): Promise<PurchaseResponse> {
    if (
      input.healthLevel !== undefined &&
      !healthLevel.safeParse(input.healthLevel).success
    )
      fail(400, 'INVALID_HEALTH_LEVEL', 'Choose Treat, Balanced or Healthy.');
    const body = {
      name: normalizedName(input.name),
      ...(input.healthLevel && input.healthLevel !== 'balanced'
        ? { healthLevel: input.healthLevel }
        : {}),
    };
    const hash = requestHash('POST', '/api/v1/places', body);
    return transaction(this.database, async (tx) => {
      await requireSetupComplete(tx);
      await activeParticipant(tx, participantId);
      const prior = await existingKey(tx, participantId, key, hash);
      if (prior) return replay<PurchaseResponse>(prior);
      const instant = now ?? new Date();
      await requireWheelPeriod(tx, instant);
      const current = await balance(tx, participantId);
      const economy = await currentEconomy(tx);
      const { addPlaceCost } = economy;
      if (current < addPlaceCost)
        fail(
          409,
          'INSUFFICIENT_TOKENS',
          'There are not enough tokens to add a place.',
        );
      const active = await tx
        .select({ id: places.id, logWeight: places.logWeight })
        .from(places)
        .where(eq(places.active, true));
      const [alreadyActive] = await tx
        .select({ id: places.id })
        .from(places)
        .where(
          and(
            eq(places.active, true),
            sql`lower(btrim(${places.name})) = lower(${body.name})`,
          ),
        );
      if (alreadyActive)
        fail(409, 'DUPLICATE_NAME', 'That restaurant is already on the wheel.');
      const [archived] = await tx
        .select()
        .from(places)
        .where(
          and(
            eq(places.active, false),
            sql`lower(btrim(${places.name})) = lower(${body.name})`,
          ),
        )
        .orderBy(desc(places.createdAt))
        .limit(1);
      const startingWeight = newPlaceLogWeight(
        active,
        economy.newPlaceMultiplier,
      );
      const [place] = archived
        ? await tx
            .update(places)
            .set({
              name: body.name,
              active: true,
              logWeight: startingWeight,
              healthLevel: input.healthLevel ?? 'balanced',
            })
            .where(eq(places.id, archived.id))
            .returning()
        : await tx
            .insert(places)
            .values({
              name: body.name,
              addedBy: participantId,
              logWeight: startingWeight,
              healthLevel: input.healthLevel ?? 'balanced',
            })
            .returning();
      const response = {
        place: placeView(place!),
        spentTokens: addPlaceCost,
        balance: current - addPlaceCost,
      } satisfies PurchaseResponse;
      await tx.insert(tokenLedger).values({
        participantId,
        delta: -addPlaceCost,
        kind: 'add-place',
        createdAt: instant,
        idempotencyKey: key,
        requestHash: hash,
        response,
        placeId: place!.id,
      });
      return response;
    });
  }

  async correctTokens(
    input: { participantId: string; delta: number; reason: string },
    key: string,
  ): Promise<WalletResponse> {
    const body = {
      participantId: input.participantId,
      delta: input.delta,
      reason: input.reason.trim(),
    };
    const hash = requestHash('POST', '/api/v1/admin/token-corrections', body);
    return transaction(this.database, async (tx) => {
      await activeParticipant(tx, input.participantId);
      const prior = await existingKey(tx, input.participantId, key, hash);
      if (prior) return replay<WalletResponse>(prior);
      const current = await balance(tx, input.participantId);
      if (
        !Number.isSafeInteger(input.delta) ||
        input.delta < -2_147_483_648 ||
        input.delta > 2_147_483_647 ||
        input.delta === 0
      )
        fail(
          400,
          'INVALID_CORRECTION',
          'Correction must be a nonzero whole number in the supported range.',
        );
      if (!Number.isSafeInteger(current + input.delta))
        fail(
          409,
          'BALANCE_OVERFLOW',
          'The token balance exceeds the supported range.',
        );
      if (current + input.delta < 0)
        fail(
          409,
          'INSUFFICIENT_TOKENS',
          'A correction cannot make the balance negative.',
        );
      const history = await tokenLedgerActivity(tx, input.participantId);
      const id = randomUUID();
      const createdAt = new Date();
      const response: WalletResponse = {
        balance: current + input.delta,
        ledger: [
          tokenActivityView({
            id,
            delta: input.delta,
            kind: 'correction',
            reason: body.reason,
            createdAt,
            placeId: null,
            placeName: null,
            betId: null,
            betLocalDate: null,
          }),
          ...history.map(tokenActivityView),
        ],
        bets: await walletBets(tx, input.participantId),
      };
      await tx.insert(tokenLedger).values({
        id,
        createdAt,
        participantId: input.participantId,
        delta: input.delta,
        kind: 'correction',
        idempotencyKey: key,
        requestHash: hash,
        response,
        reason: body.reason,
      });
      return response;
    });
  }

  async subscribe(
    participantId: string,
    input: PushSubscriptionInput,
  ): Promise<{ id: string }> {
    return transaction(this.database, async (tx) => {
      await requireSetupComplete(tx);
      await activeParticipant(tx, participantId);
      const [found] = await tx
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, input.endpoint));
      if (found) {
        if (
          found.participantId !== participantId ||
          found.p256dh !== input.keys.p256dh ||
          found.auth !== input.keys.auth
        ) {
          await tx
            .update(notificationOutbox)
            .set({
              sentAt: new Date(),
              lockedUntil: null,
              leaseToken: null,
              lastError:
                found.participantId === participantId
                  ? 'subscription-refreshed'
                  : 'subscription-transferred',
            })
            .where(
              and(
                eq(notificationOutbox.subscriptionId, found.id),
                isNull(notificationOutbox.sentAt),
              ),
            );
        }
        await tx
          .update(pushSubscriptions)
          .set({
            participantId,
            p256dh: input.keys.p256dh,
            auth: input.keys.auth,
            active: true,
          })
          .where(eq(pushSubscriptions.id, found.id));
        return { id: found.id };
      }
      const [row] = await tx
        .insert(pushSubscriptions)
        .values({
          participantId,
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
        })
        .returning();
      return { id: row!.id };
    });
  }

  async unsubscribe(participantId: string, id: string): Promise<void> {
    await transaction(this.database, async (tx) => {
      await requireSetupComplete(tx);
      const [sub] = await tx
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.id, id));
      if (!sub || sub.participantId !== participantId)
        fail(404, 'SUBSCRIPTION_NOT_FOUND', 'Subscription was not found.');
      await tx
        .update(pushSubscriptions)
        .set({ active: false })
        .where(eq(pushSubscriptions.id, id));
      await tx
        .update(notificationOutbox)
        .set({
          sentAt: new Date(),
          lockedUntil: null,
          leaseToken: null,
          lastError: 'subscription-unsubscribed',
        })
        .where(
          and(
            eq(notificationOutbox.subscriptionId, id),
            isNull(notificationOutbox.sentAt),
          ),
        );
    });
  }

  async claimNotifications(
    now = new Date(),
    limit = 10,
  ): Promise<NotificationJob[]> {
    return transaction(this.database, async (tx) => {
      const [setup] = await tx
        .select({ completed: settings.setupCompleted })
        .from(settings)
        .where(eq(settings.id, 1));
      if (!setup?.completed) return [];
      await tx
        .update(notificationOutbox)
        .set({
          sentAt: now,
          lockedUntil: null,
          leaseToken: null,
          lastError: 'attempts-exhausted',
        })
        .where(
          and(
            isNull(notificationOutbox.sentAt),
            gte(notificationOutbox.attempts, 5),
            lte(notificationOutbox.lockedUntil, now),
          ),
        );
      const rows = await tx
        .select({
          job: notificationOutbox,
          sub: pushSubscriptions,
          person: participants,
        })
        .from(notificationOutbox)
        .innerJoin(
          pushSubscriptions,
          eq(notificationOutbox.subscriptionId, pushSubscriptions.id),
        )
        .innerJoin(
          participants,
          eq(pushSubscriptions.participantId, participants.id),
        )
        .where(
          and(
            isNull(notificationOutbox.sentAt),
            lte(notificationOutbox.availableAt, now),
            or(
              isNull(notificationOutbox.lockedUntil),
              lte(notificationOutbox.lockedUntil, now),
            ),
            eq(pushSubscriptions.active, true),
            eq(participants.active, true),
            sql`${notificationOutbox.attempts} < 5`,
          ),
        )
        .orderBy(
          asc(notificationOutbox.availableAt),
          asc(notificationOutbox.createdAt),
        )
        .limit(Math.max(0, Math.min(100, Math.floor(limit))))
        .for('update', { of: notificationOutbox, skipLocked: true });
      const claimed: NotificationJob[] = [];
      for (const { job, sub } of rows) {
        const token = randomUUID();
        const [updated] = await tx
          .update(notificationOutbox)
          .set({
            attempts: job.attempts + 1,
            lockedUntil: new Date(now.getTime() + 60_000),
            leaseToken: token,
          })
          .where(eq(notificationOutbox.id, job.id))
          .returning();
        claimed.push({
          id: updated!.id,
          leaseToken: token,
          attempts: updated!.attempts,
          subscription: {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload: updated!.payload,
        });
      }
      return claimed;
    });
  }

  async finishNotification(
    id: string,
    leaseToken: string,
    outcome: 'sent' | 'retry' | 'gone',
    now = new Date(),
  ): Promise<void> {
    await transaction(this.database, async (tx) => {
      const [job] = await tx
        .select()
        .from(notificationOutbox)
        .where(
          and(
            eq(notificationOutbox.id, id),
            eq(notificationOutbox.leaseToken, leaseToken),
            isNull(notificationOutbox.sentAt),
          ),
        );
      if (!job) return;
      if (outcome === 'sent') {
        await tx
          .update(notificationOutbox)
          .set({
            sentAt: now,
            lockedUntil: null,
            leaseToken: null,
            lastError: null,
          })
          .where(eq(notificationOutbox.id, id));
        return;
      }
      if (outcome === 'gone') {
        await tx
          .update(pushSubscriptions)
          .set({ active: false })
          .where(eq(pushSubscriptions.id, job.subscriptionId));
        await tx
          .update(notificationOutbox)
          .set({
            sentAt: now,
            lockedUntil: null,
            leaseToken: null,
            lastError: 'subscription-gone',
          })
          .where(
            and(
              eq(notificationOutbox.subscriptionId, job.subscriptionId),
              isNull(notificationOutbox.sentAt),
            ),
          );
        return;
      }
      if (job.attempts >= 5) {
        await tx
          .update(notificationOutbox)
          .set({
            sentAt: now,
            lockedUntil: null,
            leaseToken: null,
            lastError: 'attempts-exhausted',
          })
          .where(eq(notificationOutbox.id, id));
        return;
      }
      const delaySeconds = Math.min(
        3600,
        15 * 2 ** Math.max(0, job.attempts - 1),
      );
      await tx
        .update(notificationOutbox)
        .set({
          availableAt: new Date(now.getTime() + delaySeconds * 1000),
          lockedUntil: null,
          leaseToken: null,
          lastError: 'delivery-failed',
        })
        .where(eq(notificationOutbox.id, id));
    });
  }
}
