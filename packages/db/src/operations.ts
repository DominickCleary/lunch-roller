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
  RULES,
  evaluateSchedule,
  halveWeight,
  influenceWeight,
  localClock,
  newPlaceLogWeight,
  probabilities,
  selectPlace,
} from '@lunch/domain';
import type {
  AttendanceResponse,
  Draw as DrawResponse,
  Participant,
  ParticipantRemoval,
  Place,
  PurchaseRequest,
  PurchaseResponse,
  PushSubscriptionInput,
  Schedule,
  TodayResponse,
  WalletResponse,
} from '@lunch/contracts';
import type { createDatabase } from './index';
import {
  attendance,
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

async function deactivateParticipant(tx: Tx, id: string): Promise<void> {
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

  async listParticipants(includeInactive = false): Promise<Participant[]> {
    const query = this.database.db.select().from(participants);
    const rows = includeInactive
      ? await query.orderBy(asc(participants.name))
      : await query
          .where(eq(participants.active, true))
          .orderBy(asc(participants.name));
    return rows.map(participantView);
  }

  async selectParticipant(id: string): Promise<Participant> {
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
        const logWeight = newPlaceLogWeight(active);
        const [row] = await tx
          .insert(places)
          .values({ name: normalizedName(input.name), logWeight })
          .returning();
        return placeView(row!);
      }
      const [current] = await tx.select().from(places).where(eq(places.id, id));
      if (!current) fail(404, 'PLACE_NOT_FOUND', 'Place was not found.');
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
        const [person] = await tx
          .select({ id: participants.id, active: participants.active })
          .from(participants)
          .where(eq(participants.id, participantId));
        if (!person)
          fail(404, 'PARTICIPANT_NOT_FOUND', 'Participant was not found.');
        if (!person.active)
          fail(403, 'PARTICIPANT_INACTIVE', 'Participant is inactive.');
        const ledger = await tx
          .select({
            id: tokenLedger.id,
            delta: tokenLedger.delta,
            kind: tokenLedger.kind,
            reason: tokenLedger.reason,
            createdAt: tokenLedger.createdAt,
            balance: sql<number>`(select coalesce(sum(delta), 0)::float8 from token_ledger where participant_id = ${participantId})`,
          })
          .from(tokenLedger)
          .where(eq(tokenLedger.participantId, participantId))
          .orderBy(desc(tokenLedger.createdAt), desc(tokenLedger.id));
        const currentBalance = ledger[0]?.balance ?? 0;
        if (!Number.isSafeInteger(currentBalance))
          fail(
            409,
            'BALANCE_OVERFLOW',
            'The token balance exceeds the supported range.',
          );
        return {
          balance: currentBalance,
          ledger: ledger.map(({ id, delta, kind, reason, createdAt }) => ({
            id,
            delta,
            kind,
            reason,
            createdAt: createdAt.toISOString(),
          })),
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
          status,
          result: existing ? drawView(existing) : null,
          odds,
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  async drawIfDue(now?: Date): Promise<DrawResponse | null> {
    return transaction(this.database, async (tx) => {
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
      const total = (await balance(tx, participantId)) + RULES.attendanceReward;
      const response = {
        drawId: draw.id,
        awardedTokens: RULES.attendanceReward,
        balance: total,
      } satisfies AttendanceResponse;
      await tx.insert(tokenLedger).values({
        participantId,
        attendanceId: checkin!.id,
        delta: RULES.attendanceReward,
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
      await activeParticipant(tx, participantId);
      const prior = await existingKey(tx, participantId, key, hash);
      if (prior) return replay<PurchaseResponse>(prior);
      const [place] = await tx
        .select()
        .from(places)
        .where(and(eq(places.id, input.placeId), eq(places.active, true)));
      if (!place) fail(404, 'PLACE_NOT_FOUND', 'Active place was not found.');
      const current = await balance(tx, participantId);
      const cost = RULES.influenceCost;
      if (current < cost)
        fail(
          409,
          'INSUFFICIENT_TOKENS',
          'There are not enough tokens for this purchase.',
        );
      const [changed] = await tx
        .update(places)
        .set({ logWeight: influenceWeight(place.logWeight, input.action) })
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
        kind: input.action,
        idempotencyKey: key,
        requestHash: hash,
        response,
        placeId: place.id,
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
      await activeParticipant(tx, participantId);
      const prior = await existingKey(tx, participantId, key, hash);
      if (prior) return replay<PurchaseResponse>(prior);
      const current = await balance(tx, participantId);
      if (current < RULES.addPlaceCost)
        fail(
          409,
          'INSUFFICIENT_TOKENS',
          'There are not enough tokens to add a place.',
        );
      const active = await tx
        .select({ id: places.id, logWeight: places.logWeight })
        .from(places)
        .where(eq(places.active, true));
      const [place] = await tx
        .insert(places)
        .values({
          name: body.name,
          addedBy: participantId,
          logWeight: newPlaceLogWeight(active),
        })
        .returning();
      const response = {
        place: placeView(place!),
        spentTokens: RULES.addPlaceCost,
        balance: current - RULES.addPlaceCost,
      } satisfies PurchaseResponse;
      await tx.insert(tokenLedger).values({
        participantId,
        delta: -RULES.addPlaceCost,
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
      const history = await tx
        .select()
        .from(tokenLedger)
        .where(eq(tokenLedger.participantId, input.participantId))
        .orderBy(desc(tokenLedger.createdAt), desc(tokenLedger.id));
      const id = randomUUID();
      const createdAt = new Date();
      const response: WalletResponse = {
        balance: current + input.delta,
        ledger: [
          {
            id,
            delta: input.delta,
            kind: 'correction',
            reason: body.reason,
            createdAt: createdAt.toISOString(),
          },
          ...history.map((entry) => ({
            id: entry.id,
            delta: entry.delta,
            kind: entry.kind,
            reason: entry.reason,
            createdAt: entry.createdAt.toISOString(),
          })),
        ],
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
