# Local operation and HTTPS rollout

Gambling about lunch requires an always-on web server, worker, PostgreSQL and a one-shot migration step. Hosting is not provisioned. Keep PostgreSQL private. Use Node 24 and pinned pnpm, or the supplied Compose services.

## Configuration

- `DATABASE_URL`: server-only PostgreSQL connection string. Never point tests at production.
- `ADMIN_PASSWORD`: strong administrator password, separate from the trust-based name picker.
- `SESSION_SECRET`: at least 32 random characters. Changing it invalidates every administrator session. Sessions expire after eight hours; logout clears the browser cookie.
- `APP_ORIGIN`: exact browser origin, including scheme and non-default port. Every mutation requires a matching Origin header. Set the public HTTPS origin behind a reverse proxy; secure session cookies follow this setting.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: optional Web Push configuration on both web and worker. The subject is a `mailto:` or HTTPS contact. Generate a matching key pair locally with `pnpm --filter @lunch/worker exec web-push generate-vapid-keys`; keep the private key secret. The public key is intentionally exposed by `/api/v1/push-config`.
- `WORKER_HEARTBEAT_FILE`: optional freshness file, configured in Compose.
- `TEST_DATABASE_URL`: explicit disposable PostgreSQL URL required by integration/browser tests. Test tooling never falls back to the normal application database URL. `pnpm test:e2e:local` creates an isolated container and sets this value automatically for the browser suite.

The default `.env.example` credentials are development examples. Replace them before exposing the service. Do not commit `.env` or actual credentials. Set HTTPS and preserve the browser Origin through your proxy. Avoid caching API responses. No CORS access is provided.

## Start and verify

Copy `.env.example` to `.env`, configure it, then run `docker compose up --build --wait`. Compose migrates and initializes the settings singleton before web and worker; it creates no people or places. Use `pnpm db:migrate` as a one-shot release step before upgrading both processes, and `pnpm db:seed` to initialize settings for a fresh database. Retain both migration SQL and metadata in source control. Never load test fixtures into an application database.

For a new game, open the site and sign in to first-run setup using `ADMIN_PASSWORD`. Add people and places, review the schedule, then finish setup. Until then, game APIs are gated and the worker waits. Everyone then selects their roster name; valid saved browser selections are reused and can be changed. Existing populated installations are marked complete by migration and retain all data. The worker checks every 30 seconds. To try a draw immediately, set the schedule to an earlier local time on the current weekday and wait for a tick; there is no reroll endpoint. Once today's result exists, schedule edits cannot replace that date's result. Check in for tokens, then influence the next draw or add a place.

Use `GET /api/v1/health` for database readiness. Check worker structured logs for `started`, `heartbeat`, scheduling failures and delivery failures. Database health alone does not prove draws or notifications are progressing. Graceful termination finishes the current bounded tick; a 45-second Compose grace period allows normal completion.

## Automatic deployment from main

The CI workflow includes a deployment job for the local-network server. It stays disabled until repository variable `DEPLOY_ENABLED` is set to `true`. A push to `main` must pass both the full verification job and the Docker Compose job before deployment can start. Pull requests and other branches never use the server runner; their checks stay on GitHub-hosted runners.

The deployment job needs a Linux self-hosted runner with the custom label `lunch-roller-deploy`. It runs as `webserver`, using `/home/webserver/lunch-roller` as the default existing application checkout. Set repository variable `DEPLOY_PATH` if the actual folder differs. The runner checks out the tested commit into its separate workspace, then `scripts/deploy.sh` fast-forwards the existing server checkout to that exact commit and runs:

```sh
docker compose up -d --build --wait --wait-timeout 300
```

The existing Compose migration/seed services run before the updated app and worker. The production `.env` and PostgreSQL volume remain in place. The script refuses dirty checkouts, a different repository, a branch other than `main`, and divergent server commits. It does not reset files or automatically roll back schema changes. An older queued release is skipped if the server already contains a newer commit. GitHub concurrency and a server-side file lock prevent simultaneous deployments; running deployments are not cancelled when another push arrives.

One-time setup on the server:

1. Log in as `webserver`. Confirm the production checkout is clean and on `main`, its `.env` exists, and `docker compose ps` works under this user without an interactive sudo prompt. Keep the runner outside this checkout, for example in `/home/webserver/actions-runner`.
2. In the repository on GitHub, open **Settings → Actions → Runners → New self-hosted runner**. Select Linux and the server's actual CPU architecture. Follow GitHub's generated download/registration commands inside `/home/webserver/actions-runner` as `webserver`, adding `--labels lunch-roller-deploy` to the `./config.sh` registration command. Keep the registration token on the server; it does not belong in the repository. See [GitHub's runner setup](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners) and [custom labels](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/apply-labels).
3. On a systemd server, install and start the service from that runner folder:

   ```sh
   sudo ./svc.sh install webserver
   sudo ./svc.sh start
   sudo ./svc.sh status
   ```

   GitHub documents [running the registered runner as a service](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/configure-the-application?platform=linux). Restart the service after changing this user's Docker group membership or access so it picks up those changes.

4. In **Settings → Secrets and variables → Actions → Variables**, add `DEPLOY_ENABLED` with value `true`. Add `DEPLOY_PATH` if the production path is different from `/home/webserver/lunch-roller`. No SSH private key or copied production environment is required: the runner transfers the checked-out Git objects locally using its read-only job checkout.
5. Commit and push the workflow/script changes through the normal review process. A passing push to `main` deploys automatically. Check the **Deploy main to server** job in Actions. To retry a failed deployment of the same commit, rerun that workflow/job after resolving the failure.

The server only needs outbound access to GitHub and build registries; this setup adds no inbound SSH port. Keep changes to `main` trusted because deployment code runs with `webserver`'s Docker access. Existing failing checks must be repaired before deployment will run; the deployment gate does not bypass them. Disable future automatic deployments by setting `DEPLOY_ENABLED=false`; an already-running deployment finishes normally. Your manual Compose command still works.

Validate deployment-script changes locally with `bash -n scripts/deploy.sh` and `node --test scripts/deploy.test.mjs`. The tests use temporary local Git repositories and a fake Docker command; they never access a server or application database.

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

For a Compose deployment, generate the keys once on the server (the output includes the private key; keep it in your local environment configuration):

```sh
docker compose run --rm --no-deps worker pnpm --filter @lunch/worker exec web-push generate-vapid-keys
```

Copy the generated `Public Key` and `Private Key` values into `.env` as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Set `VAPID_SUBJECT` to your HTTPS contact/site URL or `mailto:` contact, and `APP_ORIGIN` to the actual public HTTPS origin. For this deployment, both URLs can be `https://lunch.dominick.ie`. Compose passes the same values to web and worker. Apply changed environment values with `docker compose up -d --wait web worker`, then verify `/api/v1/push-config` has a public key and the worker's startup log has `pushConfigured:true`. Do not publish the private key or replace the pair on every restart; changing the pair requires browsers to subscribe again.

Missing keys intentionally disable notification delivery. After configuration, select a name and use Get lunch and token alerts to grant browser permission. Subscriptions receive subsequent committed draws, token transfers, and winning bet payouts; enabling alerts does not resend earlier events. Check-in rewards do not trigger alerts. Permission must be requested directly from the user's opt-in action, before awaited registration/network work.

On the final HTTPS origin, use a supported browser/device, select a member, click Get lunch and token alerts, grant permission, and verify a subsequent committed draw and a received token transfer arrive. Test denial, opt-out, browser restart and a retired subscription. The API accepts browser push services from Google, Mozilla, Apple and Windows only, preventing arbitrary internal notification targets. Unsupported devices and missing/invalid VAPID configuration must retain core play. Localhost can support service workers, but a local test does not establish production HTTPS delivery or mobile support.

Run concurrent worker/restart checks and restore checks in a disposable environment before release. Integration and browser checks are separate from real provider delivery and production operations; report these separately.
