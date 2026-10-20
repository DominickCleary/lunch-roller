# Architecture

## Shipped foundation

Next.js serves a static landing page with a client readiness probe. `GET /api/v1/health` returns 200 only when PostgreSQL is reachable and settings row 1 exists; failures return safe 503 JSON. It checks initialization, not exhaustive schema compatibility. It is a readiness endpoint, not a worker/scheduler status report.

The worker checks the same database every 30 seconds, emits structured logs, and optionally writes a health timestamp. Ticks do not overlap. SIGINT/SIGTERM wakes idle waits; an in-flight bounded connection check finishes before shutdown. **It does not spin or send notifications yet.**

The domain package calculates odds, selects from an injected [0,1) sample, halves weights, applies influence, computes mean new-place weights, and validates spending. Contracts declare intended request/response schemas. Database schema and migration cover the intended persistence boundaries.

## Package dependency direction

`web → contracts, domain, db`; `worker → contracts, domain, db`; `db → Drizzle, postgres`; `contracts → Zod`; `domain → nothing`.

Do not import web/worker into packages. Shared application operations will live in DB/server modules and compose pure domain functions. Avoid separate implementations of the same mutation in web and worker. Workspace source exports are intentional: Next transpiles them; the Node worker runs through pinned tsx.

## Future transaction boundary

1. Begin transaction and acquire `SELECT ... FOR UPDATE` on settings row 1. All game mutations use this same first lock; the tiny workplace workload favors simple serialization over throughput.
2. Resolve participant/place status and idempotency. Derive balances from the ledger under the lock. Identical replay returns the recorded effect; reused key with a changed canonical request hash returns 409.
3. Apply validated writes together. Draw: check due date, read active options, select, insert snapshot/result, halve winner, insert per-subscription outbox records. Purchase: insert debit and change weight/create place. Attendance: insert attendance and reward ledger entry.
4. Commit before responding or delivering push. Database unique keys provide the last guard against duplicates. No external calls inside the mutation transaction.

One settings row is seeded and constrained to ID 1. Daily date uniqueness is intentionally global for the single workplace. Ledger request keys are unique per participant; attendance is additionally unique per participant/draw and its reward ledger row references attendance uniquely. Archived records retain foreign-key references.

## Future identity and transport

Store the participant ID as `lunch-roller.participant-id` in localStorage, send it as `X-Participant-Id`, and validate that the participant is active. It is identity selection, not authentication. Reset stale selection when an ID is inactive or unknown.

Admin login validates `ADMIN_PASSWORD` on the server and issues a signed, expiring HttpOnly, SameSite=Strict cookie using `SESSION_SECRET`; set Secure under HTTPS. Never trust participant IDs for admin checks. Reject cross-origin state changes using the configured `APP_ORIGIN`, rate-limit admin login, and never log passwords or session tokens. These controls are specified for milestone 1, not shipped here.

Use polling for today's result initially; avoid a realtime service until needed. Public odds show current weights for the next draw; saved results contain pre-decay historical odds. A worker outage delays drawing, not the UI's authority over selection.

## Future scheduling and delivery

Calculate the current local date/weekday/time from the IANA timezone each tick; do not add 24 hours to UTC timestamps. Compare against the configured local time and existing date record under the transaction lock. A skipped spring-forward time becomes due at the first later local time; a repeated autumn time still draws once. No options is retryable without an empty draw record.

Outbox rows deduplicate on draw/subscription. Claim with `FOR UPDATE SKIP LOCKED` and a lease; release/expire leases on failure so a crashed worker cannot strand work. Retry with bounded exponential delay; stop after 5 attempts, recording the failure. HTTP 404/410 retires the subscription and its remaining jobs. Delivery is at least once: a crash after sending can cause duplicate push. Use a stable notification tag based on draw ID to reduce visible duplicates.

## Local deployment and operations

Compose supplies PostgreSQL, one-shot migration and development seed services, web, and worker. Dependency conditions ensure the database is initialized before readiness probes. Data uses a named volume. Images retain workspace dependencies to keep this first scaffold simple; optimize production size later.

Do not run development seed in production. Provision an always-on host, managed backups and tested restore, HTTPS reverse proxy, strong database/admin/session secrets, and VAPID keys before rollout. Do not expose PostgreSQL publicly. Use a one-shot migration release step before app startup. Check web readiness and worker heartbeat independently; a healthy health-only worker does not mean the game scheduler exists.

Future monitoring: stale heartbeat, overdue scheduled draw, failed outbox jobs, and migration errors. This phase provisions no hosting and sends no push messages.
