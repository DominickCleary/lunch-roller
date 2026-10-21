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
  halveWeight,
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
  EconomySettings,
  SetupStatus,
  TodayResponse,
  WalletResponse,
  TokenBalanceSetResponse,
  BetView,
  BettingWindow,
  CurrentBetsResponse,
  SetBetRequest,
  TokenActivityEntry,
  DailyActivityResponse,
} from '@lunch/contracts';
import {
  gamePreferences,
  economySettings,
  tokenBalanceSetRequest,
  dailyActivityQuery,
  setRestaurantOddsRequest,
  setBetRequest,
  cancelBetRequest,
} from '@lunch/contracts';
import type { createDatabase } from './index';
import {
  attendance,
  bets,
  betRequests,
  bettingMarkets,
  draws,
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
  payload: { title: string; body: string; drawId: string };
};

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
  return {
    id: row.id,
    localDate: row.localDate,
    placeId: row.placeId,
    placeName: row.placeName,
    drawnAt: row.drawnAt.toISOString(),
    timezone: row.timezone,
    snapshot: row.snapshot,
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
) {
  const predicates = [];
  if (participantId)
    predicates.push(eq(tokenLedger.participantId, participantId));
  if (localDate && timezone) {
    predicates.push(
      sql`(${tokenLedger.createdAt} at time zone ${timezone})::date = ${localDate}::date`,
    );
  }
  return tx
    .select({
      id: tokenLedger.id,
      delta: tokenLedger.delta,
      kind: tokenLedger.kind,
      reason: tokenLedger.reason,
      createdAt: tokenLedger.createdAt,
      placeId: tokenLedger.placeId,
      placeName: places.name,
      betId: tokenLedger.betId,
      betLocalDate: bettingMarkets.localDate,
      participantId: tokenLedger.participantId,
      participantName: participants.name,
    })
    .from(tokenLedger)
    .leftJoin(places, eq(tokenLedger.placeId, places.id))
    .leftJoin(bets, eq(tokenLedger.betId, bets.id))
    .leftJoin(bettingMarkets, eq(bets.marketId, bettingMarkets.id))
    .innerJoin(participants, eq(tokenLedger.participantId, participants.id))
    .where(predicates.length ? and(...predicates) : undefined)
    .orderBy(desc(tokenLedger.createdAt), desc(tokenLedger.id));
}

function bettingWindowView(
  row: typeof bettingMarkets.$inferSelect,
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
    open: row.status === 'open' && now.getTime() < cutoffInstant,
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
  };
}

function getScheduleFromRow(row: typeof settings.$inferSelect): Schedule {
  return { timezone: row.timezone, time: row.spinTime, weekdays: row.weekdays };
}

function preferencesFromRow(
  row: typeof settings.$inferSelect,
): GamePreferences {
  return {
    wheelSwitchTime: row.wheelSwitchTime,
    checkInPledge: row.checkInPledge,
    bettingCloseMinutes: row.bettingCloseMinutes,
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
    });
    await tx
      .update(bets)
      .set({
        status: 'refunded',
        payout: 0,
        updatedAt: new Date(),
        settledAt: new Date(),
      })
      .where(eq(bets.id, bet.id));
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
      const active = await tx
        .select({ id: places.id, name: places.name })
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
          .set({ logWeight: Math.log(weight) })
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
    const openMarkets = await tx
      .select()
      .from(bettingMarkets)
      .where(eq(bettingMarkets.status, 'open'));
    for (const stale of openMarkets) {
      if (stale.localDate < localClock(now, stale.timezone).localDate)
        await this.refundMarket(tx, stale.id, 'void');
    }
    const today = localClock(now, schedule.timezone).localDate;
    const [todayDraw] = await tx
      .select({ id: draws.id })
      .from(draws)
      .where(eq(draws.localDate, today));
    const localDate = nextBettingDate(now, schedule, Boolean(todayDraw));
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
    return market!;
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
        reason: 'Bet refunded because its draw schedule changed or expired',
      });
      await tx
        .update(bets)
        .set({
          status: 'refunded',
          payout: 0,
          updatedAt: new Date(),
          settledAt: new Date(),
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
      if (payout > 0)
        await tx.insert(tokenLedger).values({
          participantId: bet.participantId,
          delta: payout,
          kind: 'bet-payout',
          idempotencyKey: `bet-payout:${bet.id}`,
          requestHash: createHash(`payout:${bet.id}:${draw.id}`),
          placeId: bet.placeId,
          betId: bet.id,
          reason: 'Winning lunch bet payout',
        });
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
    input: { name?: string; active?: boolean },
    id?: string,
  ): Promise<Place> {
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
          .values({ name: normalizedName(input.name), logWeight })
          .returning();
        return placeView(row!);
      }
      const [current] = await tx.select().from(places).where(eq(places.id, id));
      if (!current) fail(404, 'PLACE_NOT_FOUND', 'Place was not found.');
      if (input.active === false && current.active) {
        const [openBet] = await tx
          .select({ id: bets.id })
          .from(bets)
          .innerJoin(bettingMarkets, eq(bets.marketId, bettingMarkets.id))
          .where(
            and(
              eq(bets.placeId, id),
              eq(bets.status, 'open'),
              eq(bettingMarkets.status, 'open'),
            ),
          )
          .limit(1);
        if (openBet)
          fail(
            409,
            'PLACE_HAS_OPEN_BETS',
            'This restaurant has open bets. Wait for the draw or refund the market before archiving it.',
          );
      }
      if (input.name === undefined && input.active === undefined)
        return placeView(current);
      const [row] = await tx
        .update(places)
        .set({
          ...(input.name === undefined
            ? {}
            : { name: normalizedName(input.name) }),
          ...(input.active === undefined ? {} : { active: input.active }),
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

  async dailyActivity(
    participantId: string,
    date?: string,
    now = new Date(),
  ): Promise<DailyActivityResponse> {
    const parsed = dailyActivityQuery.safeParse({ date });
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
        return {
          localDate,
          timezone: configuration.timezone,
          entries: ledger.map((row) => ({
            ...tokenActivityView(row),
            participantId: row.participantId,
            participantName: row.participantName,
          })),
          bets: dayBets.map(
            ({ bet, participantId: ownerId, participantName }) => ({
              ...betView(bet),
              participantId: ownerId,
              participantName,
            }),
          ),
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  async currentBets(
    participantId: string,
    now = new Date(),
  ): Promise<CurrentBetsResponse> {
    return transaction(this.database, async (tx) => {
      await requireSetupComplete(tx);
      await activeParticipant(tx, participantId);
      const market = await this.currentBettingMarket(tx, now);
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
        window: bettingWindowView(market, now),
        bet: current ? betView(current) : null,
        recent: recent.map(betView),
      };
    });
  }

  async setBet(
    participantId: string,
    input: SetBetRequest,
    key: string,
    now = new Date(),
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
      const market = await this.currentBettingMarket(tx, now);
      if (
        market.localDate !== body.localDate ||
        !bettingWindowView(market, now).open
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
            updatedAt: now,
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
            updatedAt: now,
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
    now = new Date(),
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
      const market = await this.currentBettingMarket(tx, now);
      if (
        market.localDate !== body.localDate ||
        !bettingWindowView(market, now).open
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
        });
        await tx
          .update(bets)
          .set({
            status: 'cancelled',
            payout: 0,
            updatedAt: now,
            settledAt: now,
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

  async setPreferences(input: GamePreferences): Promise<GamePreferences> {
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
          })
          .from(places)
          .where(eq(places.active, true))
          .orderBy(asc(places.id));
        const odds = probabilities(active).map((item) => ({
          placeId: item.id,
          name: active.find((place) => place.id === item.id)!.name,
          probability: item.probability,
        }));
        const evaluated = evaluateSchedule(now, schedule);
        const status = existing
          ? 'drawn'
          : !evaluated.scheduled
            ? 'not-scheduled'
            : active.length
              ? 'pending'
              : 'no-options';
        return {
          localDate: clock.localDate,
          schedule,
          preferences: preferencesFromRow(settingsRow),
          economy: economyFromRow(settingsRow),
          status,
          wheel: wheelDisplay(
            now,
            schedule,
            Boolean(existing),
            settingsRow.wheelSwitchTime,
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
      const due = evaluateSchedule(instant, schedule);
      if (!due.due || !due.scheduled) return null;
      const [existing] = await tx
        .select()
        .from(draws)
        .where(eq(draws.localDate, due.localDate));
      if (existing) return drawView(existing);
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
      }));
      const [row] = await tx
        .insert(draws)
        .values({
          localDate: due.localDate,
          timezone: schedule.timezone,
          placeId: winner.id,
          placeName: winner.name,
          snapshot,
          sample,
          drawnAt: instant,
        })
        .returning();
      await this.settleMarket(tx, due.localDate, row!, instant);
      await tx
        .update(places)
        .set({ logWeight: halveWeight(winner.logWeight) })
        .where(eq(places.id, winner.id));
      const subs = await tx
        .select()
        .from(pushSubscriptions)
        .innerJoin(
          participants,
          eq(pushSubscriptions.participantId, participants.id),
        )
        .where(
          and(
            eq(pushSubscriptions.active, true),
            eq(participants.active, true),
          ),
        );
      if (subs.length)
        await tx
          .insert(notificationOutbox)
          .values(
            subs.map(({ push_subscriptions: sub }) => ({
              drawId: row!.id,
              subscriptionId: sub.id,
              payload: {
                title: 'Lunch is decided',
                body: `${winner.name} won today's lunch draw.`,
                drawId: row!.id,
              },
            })),
          )
          .onConflictDoNothing();
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
  ): Promise<PurchaseResponse> {
    const body = { placeId: input.placeId, action: input.action };
    return this.spendOnPlace(participantId, body, key, '/api/v1/purchases');
  }

  private async spendOnPlace(
    participantId: string,
    input: PurchaseRequest,
    key: string,
    route: string,
  ): Promise<PurchaseResponse> {
    const hash = requestHash('POST', route, input);
    return transaction(this.database, async (tx) => {
      await requireSetupComplete(tx);
      await activeParticipant(tx, participantId);
      const prior = await existingKey(tx, participantId, key, hash);
      if (prior) return replay<PurchaseResponse>(prior);
      const [place] = await tx
        .select()
        .from(places)
        .where(and(eq(places.id, input.placeId), eq(places.active, true)));
      if (!place) fail(404, 'PLACE_NOT_FOUND', 'Active place was not found.');
      if (input.action === 'remove') {
        const [openBet] = await tx
          .select({ id: bets.id })
          .from(bets)
          .innerJoin(bettingMarkets, eq(bets.marketId, bettingMarkets.id))
          .where(
            and(
              eq(bets.placeId, place.id),
              eq(bets.status, 'open'),
              eq(bettingMarkets.status, 'open'),
            ),
          )
          .limit(1);
        if (openBet)
          fail(
            409,
            'PLACE_HAS_OPEN_BETS',
            'This restaurant has open bets and cannot be removed until the draw is settled.',
          );
      }
      const current = await balance(tx, participantId);
      const economy = await currentEconomy(tx);
      const cost =
        input.action === 'boost'
          ? economy.boostCost
          : input.action === 'reduce'
            ? economy.reduceCost
            : economy.removePlaceCost;
      if (current < cost)
        fail(
          409,
          'INSUFFICIENT_TOKENS',
          'There are not enough tokens for this purchase.',
        );
      const [changed] = await tx
        .update(places)
        .set(
          input.action === 'remove'
            ? { active: false }
            : {
                logWeight: influenceWeight(
                  place.logWeight,
                  input.action,
                  economy,
                ),
              },
        )
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
    input: { name: string },
    key: string,
  ): Promise<PurchaseResponse> {
    const body = { name: normalizedName(input.name) };
    const hash = requestHash('POST', '/api/v1/places', body);
    return transaction(this.database, async (tx) => {
      await requireSetupComplete(tx);
      await activeParticipant(tx, participantId);
      const prior = await existingKey(tx, participantId, key, hash);
      if (prior) return replay<PurchaseResponse>(prior);
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
            .set({ name: body.name, active: true, logWeight: startingWeight })
            .where(eq(places.id, archived.id))
            .returning()
        : await tx
            .insert(places)
            .values({
              name: body.name,
              addedBy: participantId,
              logWeight: startingWeight,
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
