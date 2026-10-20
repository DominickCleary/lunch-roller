# Local operation and HTTPS rollout

Lunch Roller requires an always-on web server, worker, PostgreSQL and a one-shot migration step. Hosting is not provisioned. Keep PostgreSQL private. Use Node 24 and pinned pnpm, or the supplied Compose services.

## Configuration

- `DATABASE_URL`: server-only PostgreSQL connection string. Never point tests at production.
- `ADMIN_PASSWORD`: strong administrator password, separate from the trust-based name picker.
- `SESSION_SECRET`: at least 32 random characters. Changing it invalidates every administrator session. Sessions expire after eight hours; logout clears the browser cookie.
- `APP_ORIGIN`: exact browser origin, including scheme and non-default port. Every mutation requires a matching Origin header. Set the public HTTPS origin behind a reverse proxy; secure session cookies follow this setting.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: optional Web Push configuration on both web and worker. The subject is a `mailto:` or HTTPS contact. Generate a matching key pair locally with `pnpm --filter @lunch/worker exec web-push generate-vapid-keys`; keep the private key secret. The public key is intentionally exposed by `/api/v1/push-config`.
- `WORKER_HEARTBEAT_FILE`: optional freshness file, configured in Compose.
- `TEST_DATABASE_URL`: explicit migrated/seeded disposable PostgreSQL URL required by integration/browser tests. Test tooling never falls back to the normal application database URL.

The default `.env.example` credentials are development examples. Replace them before exposing the service. Do not commit `.env` or actual credentials. Set HTTPS and preserve the browser Origin through your proxy. Avoid caching API responses. No CORS access is provided.

## Start and verify

Copy `.env.example` to `.env`, configure it, then run `docker compose up --build --wait`. Compose migrates and runs the repeat-safe development seed before web and worker. The seed is intended for local use; omit its service from a production release and initialize roster/settings deliberately. Use `pnpm db:migrate` as a one-shot release step before upgrading both processes. Retain both migration SQL and metadata in source control.

For a local game, open the site, select a roster member and open Admin in the toolbar to configure places and schedule. The worker checks every 30 seconds. To try a draw immediately, set the schedule to an earlier local time on the current weekday and wait for a tick; there is no reroll endpoint. Once today's result exists, schedule edits cannot replace that date's result. Check in for tokens, then influence the next draw or add a place.

Use `GET /api/v1/health` for database readiness. Check worker structured logs for `started`, `heartbeat`, scheduling failures and delivery failures. Database health alone does not prove draws or notifications are progressing. Graceful termination finishes the current bounded tick; a 45-second Compose grace period allows normal completion.

## Monitoring

Alert on a missing/stale worker heartbeat (90 seconds), repeated `draw_attempt_failed`, `notification_claim_failed` or `notification_completion_failed`, unavailable API readiness, migration failures and database capacity. Inspect schedule timezone/time/weekdays before diagnosing an overdue draw: only today's scheduled due date is processed. Empty wheels are retryable. Never repair an outage by inserting historical draws or resetting weights.

Inspect terminal notification failures and expired leases without exposing endpoint keys:

```sql
SELECT id, draw_id, attempts, available_at, locked_until, sent_at, last_error
FROM notification_outbox
WHERE last_error IS NOT NULL OR (sent_at IS NULL AND locked_until < now())
ORDER BY created_at DESC;
```

`last_error` records safe labels. A terminal row may have `sent_at` set with a failure label; count successful deliveries only when `sent_at IS NOT NULL AND last_error IS NULL`. Claims expire after 60 seconds. Jobs retry up to five times with bounded exponential delays. Gone subscriptions retire their remaining jobs. Do not manually replay terminal jobs without investigating; delivery is at least once and a crash after sending can duplicate a visible notification. Stable draw tags reduce duplicates. Push failure never changes a committed draw.

## Backups and restore

Take scheduled encrypted PostgreSQL backups, retain multiple generations and test restoration to a separate database. Example commands inside a PostgreSQL container (replace identifiers with your own; do not use an application database as a restore target):

```sh
pg_dump -U lunch -Fc -f /tmp/lunch-backup.dump lunch_roller
createdb -U lunch lunch_restore_check
pg_restore -U lunch --no-owner --exit-on-error -d lunch_restore_check /tmp/lunch-backup.dump
psql -U lunch -d lunch_restore_check -c 'SELECT count(*) FROM draws; SELECT count(*) FROM token_ledger;'
```

Compare draw snapshots, ledger balances, settings, participants and places in the restored database. Run readiness and read-only application checks against the restored copy. Keep the restored worker stopped until intentionally resuming: a running worker may process today's overdue draw. Preserve ledger/history; archive referenced people and places.

## Device verification before rollout

On the final HTTPS origin, use a supported browser/device, select a member, click Get lunch alerts, grant permission, and verify a subsequent committed draw arrives. Test denial, opt-out, browser restart and a retired subscription. The API accepts browser push services from Google, Mozilla, Apple and Windows only, preventing arbitrary internal notification targets. Unsupported devices and missing/invalid VAPID configuration must retain core play. Localhost can support service workers, but a local test does not establish production HTTPS delivery or mobile support.

Run concurrent worker/restart checks and restore checks in a disposable environment before release. Integration and browser checks are separate from real provider delivery and production operations; report these separately.
