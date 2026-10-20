# Architecture

## Shipped local MVP

Next.js serves the interactive wheel, participant picker, wallet and administration UI. API adapters validate shared Zod schemas and call `GameService` in `packages/db/src/operations.ts`. `GET /api/v1/health` returns 200 only when PostgreSQL is reachable and settings row 1 exists; failures return safe 503 JSON. It checks initialization, not exhaustive schema compatibility or scheduler progress.

The worker checks the database and processes today's due draw every 30 seconds, emits structured logs, and optionally writes a health timestamp. Ticks do not overlap. SIGINT/SIGTERM wakes idle waits; bounded in-flight work finishes before shutdown. Configured push delivery runs in concurrent batches of ten with ten-second send timeouts. Missing or invalid VAPID settings disable delivery while retaining scheduling.

The pure domain package calculates odds, selects from an injected [0,1) sample, halves weights, applies influence, computes mean new-place weights, validates spending and evaluates explicit instants against local schedules. Contracts declare request/response schemas. The database service composes these calculations with authoritative persistence and server cryptographic randomness.

## Package dependency direction

`web → contracts, domain, db`; `worker → contracts, domain, db, web-push`; `db → contracts, domain, Drizzle, postgres`; `contracts → Zod`; `domain → nothing`.

Do not import web/worker into packages. Shared application operations live in the database service and compose pure domain functions. Web and worker use the same mutation implementation. Workspace source exports are intentional: Next transpiles them; the Node worker runs through pinned tsx. The DB package depends on domain/contracts as well as Drizzle/postgres.

## Transaction boundary

1. Begin transaction and acquire `SELECT ... FOR UPDATE` on settings row 1. All game mutations use this same first lock; the tiny workplace workload favors simple serialization over throughput. Resolve the live draw/attendance clock after acquiring this lock so a request waiting across local midnight cannot draw the previous date or award expired attendance. Tests can inject explicit instants.
2. Resolve participant/place status and idempotency. Derive balances from the ledger under the lock. Identical replay returns the exact recorded JSON response; reused key with a changed canonical request hash returns 409. Internal replay metadata changes only HTTP creation status, never wire data.
3. Apply validated writes together. Draw: check due date, read active options, select, insert snapshot/result, halve winner, insert per-subscription outbox records. Purchase: insert debit and change weight/create place. Attendance: insert attendance and reward ledger entry.
4. Commit before responding or delivering push. Database unique keys provide the last guard against duplicates. No external calls inside the mutation transaction.

One settings row is seeded and constrained to ID 1. Daily date uniqueness is intentionally global for the single workplace. Ledger request keys are unique per participant; attendance is additionally unique per participant/draw and its reward ledger row references attendance uniquely. Archived records retain foreign-key references. Wallet and today reads use read-only repeatable-read snapshots. Connection statements are bounded to ten seconds; write transactions use eight-second statement and three-second lock timeouts.

Admin participant removal uses the same settings-first transaction. It deletes only profiles with no attendance, ledger, added-place or subscription references; otherwise it archives and retires notification work. Foreign keys guard against references inserted outside the shared mutation path. The wheel-first UI keeps admin tools in a secondary disclosure and confirms removals before calling this operation.

## Identity and transport

Store the participant ID as `lunch-roller.participant-id` in localStorage, send it as `X-Participant-Id`, and validate that the participant is active. It is identity selection, not authentication. Reset stale selection when an ID is inactive or unknown.

New installations initialize settings only and start with `setup_completed=false`. First-run administration uses the same separate password session to configure the empty roster, places and schedule. Completion locks settings first, requires an active person and place, and is persistent and idempotent. Public game/member APIs reject incomplete setup; worker draws and notification claims wait. Existing populated installations are marked complete by the additive migration without changing history. The UI validates saved browser identity before showing the wheel; new or stale identities must select a roster name, and Change name returns to that gate.

Admin login validates `ADMIN_PASSWORD` on the server with timing-safe comparisons and issues a signed eight-hour HttpOnly, SameSite=Strict cookie using a minimum 32-byte `SESSION_SECRET`; Secure follows HTTPS `APP_ORIGIN`. Participant IDs never authorize admin access. State changes reject missing or mismatched Origin headers. Login has a bounded process-local attempt limiter; use one web process or an external shared limiter before scaling. Passwords and session tokens are never logged.

Use polling for today's result initially; avoid a realtime service until needed. Public odds show current weights for the next draw; saved results contain pre-decay historical odds. A worker outage delays drawing, not the UI's authority over selection.

## Scheduling and delivery

Calculate the current local date/weekday/time from the IANA timezone each tick; do not add 24 hours to UTC timestamps. Compare against the configured local time and existing date record under the transaction lock. A skipped spring-forward time becomes due at the first later local time; a repeated autumn time still draws once. No options is retryable without an empty draw record.

Outbox rows deduplicate on draw/subscription. Claims use `FOR UPDATE SKIP LOCKED`, a 60-second lease and a per-claim UUID. Completion checks the UUID so old workers cannot finish a reclaimed job. Retry with bounded exponential delay; stop after five attempts, including a crashed fifth lease, recording the failure. HTTP 404/410 retires the subscription and its remaining jobs. Archiving participants, changing subscription keys/owner and unsubscribing invalidate pending leases. Delivery is at least once: a crash after sending can cause duplicate push. A stable draw-ID notification tag reduces visible duplicates. Shared validation restricts subscriptions to supported browser push service hosts to prevent arbitrary internal HTTPS requests.

## Local deployment and operations

Compose supplies PostgreSQL, one-shot migration and settings initialization services, web, and worker. Dependency conditions ensure the database is initialized before readiness probes. Data uses a named volume. Images retain workspace dependencies to keep this first scaffold simple; optimize production size later.

Initialize the settings singleton after migration, then complete first-run setup through the administrator UI. Provision an always-on host, managed backups and tested restore, HTTPS reverse proxy, strong database/admin/session secrets, and VAPID keys before rollout. Do not expose PostgreSQL publicly. Use a one-shot migration release step before app startup. Check web readiness and worker heartbeat independently; readiness does not imply first-run setup is complete.

Monitor stale heartbeat, overdue scheduled draws, failed outbox jobs and migration errors. The [operations runbook](operations.md) covers configuration, rollout, monitoring and backup/restore. This repository provisions no hosting; production HTTPS and real-device push checks remain environment dependent.
