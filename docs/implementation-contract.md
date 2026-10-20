# Frozen implementation interface

Coordinator owns this document, contracts, schema, migrations, manifests, lockfile and root tooling. Existing game rules and API requirements apply. Agents must not delegate. Each agent reads root and assigned AGENTS.md and docs/task-template.md. Do not edit outside assignment; propose changes to coordinator. Commit only assigned implementation files on your branch; do not push/deploy.

## Shared server service (DB lane)

Implement `packages/db/src/operations.ts`, exported by coordinator from `@lunch/db`. `new GameService(database: ReturnType<typeof createDatabase>)`. Methods below are asynchronous. Public shapes use `@lunch/contracts` inferred types. `GameError` has public `status: number`, `code: string`, and safe message. Map PostgreSQL uniqueness to safe 409 errors. All mutations lock settings row 1 FIRST in a transaction, with transaction-local bounded statement/lock timeouts. Never do network delivery inside a transaction.

- `listParticipants(includeInactive = false): Participant[]`
- `selectParticipant(id: string): Participant` (404 unknown, 403 inactive)
- `saveParticipant(input: {name?: string; active?: boolean}, id?: string): Participant` (create requires name)
- `listPlaces(includeInactive = false): Place[]`
- `savePlace(input: {name?: string; active?: boolean}, id?: string): Place` (admin create uses mean active weight, no cost)
- `getSchedule(): Schedule`; `setSchedule(schedule: Schedule): Schedule`
- `wallet(participantId: string): WalletResponse` (ledger newest first)
- `today(now = new Date()): TodayResponse` (read only; never initiates draw)
- `drawIfDue(now = new Date()): Draw | null` (crypto sample internal; existing result may return, no reroll)
- `attend(participantId, {drawId}, key, now = new Date()): AttendanceResponse`
- `purchase(participantId, {placeId, action}, key): PurchaseResponse`
- `addPlace(participantId, {name}, key): PurchaseResponse`
- `correctTokens({participantId,delta,reason}, key): WalletResponse`
- `subscribe(participantId, PushSubscriptionInput): {id: string}` (existing endpoint may transfer to current participant, retire pending jobs when transferring)
- `unsubscribe(participantId, id): void` (owner only; deactivate and terminalize pending jobs, preserve referenced history)
- `claimNotifications(now = new Date(), limit = 10): NotificationJob[]`
- `finishNotification(id, leaseToken, outcome: 'sent' | 'retry' | 'gone', now = new Date()): void`

`NotificationJob = {id: string; leaseToken: string; attempts: number; subscription: {endpoint: string; keys: {p256dh: string; auth: string}}; payload: {title: string; body: string; drawId: string}}`. Claims take settings lock first, then SKIP LOCKED due outbox rows; lease is 60 seconds, new UUID each claim. Increment attempts on claim. Attempts <=5, bounded exponential retry, expired fifth leases become terminal. Finishes compare leaseToken and ignore stale completions. Inactive participant/subscription never receives new jobs. Gone outcomes retire subscription and all remaining jobs. Persist safe error labels only. Never physically delete referenced subscriptions.

Idempotent operations hash method + canonical API route + validated normalized body (stable explicit object property order), participant-scoped key. Ledger `response` stores exact original response for replay. Same key changed operation/body conflicts even across routes. Attendance with fresh key conflicts when already awarded. Replay checks before checking changed resource state/deadline, after active identity validation. Ledger history stays append only. Schema includes response jsonb, subscription active boolean, outbox lease_token UUID; coordinator generates migration.

## Scheduling (domain/worker lane)

Append pure exports to domain: `localClock(now: Date, timezone: string): {localDate: string; weekday: number; time: string}` and `evaluateSchedule(now: Date, schedule: {timezone:string;time:string;weekdays:number[]}): {localDate:string;due:boolean;scheduled:boolean}`. Intl date parts, ISO weekdays, lexical HH:mm comparison. DB lane can implement against these frozen signatures before integration. No clock/random/env calls inside domain.

Worker calls GameService.drawIfDue once per non-overlapping 30 second tick and then drains one claim batch if VAPID configured. Uses web-push (coordinator adds exact dependency/types), 10 second timeout, stable `tag: lunch-draw-${drawId}` in JSON payload. Do not claim without all VAPID config. Always continue scheduling if delivery fails. Retain heartbeat and graceful shutdown. Pure domain tests cover DST, weekends, edits and explicit dates; worker tests use injectable send adapter where useful.

## Web/API lane

Own `apps/web/**` except package.json. Implement all documented routes with shared schemas/service; extra GET `/push-config` returns `{publicKey: string|null}`. Use catch-all route if convenient; preserve health route. API creates server-only shared database/service instance. Header UUID and Idempotency-Key validation; safe errors, no-store. Enforce Origin equals APP_ORIGIN for all state changes, including login (missing Origin rejected). Separate signed expiring HttpOnly Strict admin cookie; timing safe credential/signature checks, >=32 char session secret; HTTPS secure cookie based on configured origin. Rate limit login with bounded in-memory state, no forwarded-header trust. No admin secret in client. No API accepts winner/sample. Push API endpoint allowlist must prevent arbitrary internal HTTPS targets: coordinator will supply schema validator policy if needed.

Implement full responsive accessible wheel, persistent identity, wallet/history, check-in, influence/add place, admin login/roster/place/schedule/corrections, user-click push opt in and opt out, service worker. Proportional live odds; committed animation uses result.snapshot and result.placeId, correct final pointer angle, persisted winner across reloads, reduced motion. Polling failures show safe messages; stale identity resets only for identity errors. No initial automatic browser permission prompts. Idempotency keys retained across retry of same pending action; new intent gets new key.

## Acceptance/checks and exclusions

Follow all five backlog milestones in dependency order. Agents run package typecheck and affected tests; web build after dependencies integrated. Coordinator runs format/lint/typecheck/unit/build, disposable DB migration+seed twice, integration concurrency tests, browser flows, Docker checks as environment permits. Report actual commands, failures, branch/commit, migration/env effects and outstanding checks. No secrets, infrastructure provisioning, production operations, pushes or deployment.
