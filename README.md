# Lunch Roller

A shared workplace lunch wheel: winners lose half their weight, and showing up earns tokens to influence future lunches.

**Current status: locally playable MVP.** All five [milestones](docs/backlog.md) are implemented: persistent name selection, separate admin sessions and management, scheduled server draws, attendance and token spending, the animated wheel, and optional Web Push with leased delivery. Production HTTPS/device delivery and hosting require environment setup; see the [operations runbook](docs/operations.md).

## Quick start: Docker

Requires Docker Desktop/Engine with Linux containers and Compose v2. Copy `.env.example` to `.env` (PowerShell: `Copy-Item .env.example .env`). Then:

```sh
docker compose up --build --wait
```

Open http://localhost:3000 (or your `WEB_PORT`). Compose migrates and initializes settings before starting web and worker. A new installation has no people or places. Sign in to first-run setup with the configured `ADMIN_PASSWORD`, add your roster and lunch places, check the schedule, then finish setup. The worker waits until setup is complete. Visitors must select a roster name before entering; browsers remember a valid selection and offer Change name. Existing populated installations keep their data and skip first-run setup. Set today's schedule time earlier than the current local time to try a draw on the next worker tick; an existing date's result cannot be rerolled. Logs: `docker compose logs -f web worker`. Stop with `docker compose down`; the named PostgreSQL volume is retained.

The wheel fills the main workspace, with compact member, wallet and place controls alongside it. Replay animates today's saved result without choosing again. Admin removal permanently deletes unused profiles and archives profiles with activity, preserving their history.

Compose binds web/database to localhost and uses development credentials. It is a local setup, not a production deployment. The seed service initializes the settings singleton only and preserves existing data.

If port 5432 is already occupied, set `POSTGRES_PORT` to a free port in `.env` and update the port in `DATABASE_URL` to match. Containers still connect to `db:5432` internally.

If port 3000 is occupied, change `WEB_PORT` and set `APP_ORIGIN` to the matching browser origin so state-changing requests pass the origin check.

## Local development

Requires Node **24.x**, pnpm **11.21.0**, and PostgreSQL (Compose supplies PostgreSQL 17). Install pnpm with `npm install --global pnpm@11.21.0` if needed. Copy the environment example before running database commands.

```sh
pnpm install --frozen-lockfile
docker compose up -d db
pnpm db:migrate
pnpm db:seed
pnpm dev
```

In another terminal run `pnpm dev:worker`. The web server uses port 3000. Database commands, API, and worker load the root `.env`; existing process environment variables take precedence. When running the full Compose stack instead, stop it before starting a second web/database on the same ports.

`GET /api/v1/health` returns 200 when the DB is reachable and settings are seeded, otherwise 503. The page polls readiness and today's result every 30 seconds. The worker logs `started`, database `heartbeat` every 30 seconds, safe scheduling/delivery failures, and `stopped` on Ctrl+C/SIGTERM. It processes today's due draw only; no missed dates are backfilled.

## Checks

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Against a fresh disposable database, configure `DATABASE_URL` for migration/seed and the same URL as `TEST_DATABASE_URL` for integration/browser tests. Tests require the explicit disposable URL and never fall back to the app database. Set `APP_ORIGIN` to the browser test origin (default `http://localhost:3000`); use a free port if an app is already running:

```sh
pnpm db:migrate
pnpm db:migrate
pnpm db:seed
pnpm db:seed
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
```

Integration tests explicitly create and remove their own sample fixtures; these are separate from runtime initialization. Playwright requires the disposable database to be empty and setup incomplete: it checks first-run setup before loading fixtures for game scenarios. It starts the production web server; run `pnpm build` first. On Linux, `node scripts/check-worker.mjs` verifies DB heartbeat and graceful SIGTERM shutdown. On Windows, run `pnpm dev:worker` and check Ctrl+C shutdown manually; Windows process termination does not provide POSIX SIGTERM semantics. CI runs all these checks and a separate Compose startup/health job. Run `pnpm format` to apply formatting.

Schema changes: coordinator runs `pnpm db:generate`, reviews SQL and metadata under `packages/db/migrations`, then applies `pnpm db:migrate`. Never generate migrations concurrently. Settings initialization is repeat-safe; test fixtures must only run against a disposable database.

## Workspace and agent workflow

| Workspace            | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `apps/web`           | Next.js App Router, React, Tailwind, HTTP API                  |
| `apps/worker`        | Node/tsx scheduler, heartbeat and Web Push delivery            |
| `packages/domain`    | Pure game calculations                                         |
| `packages/db`        | PostgreSQL, schema/migrations and shared transactional service |
| `packages/contracts` | Zod wire schemas and inferred types                            |

Start with [AGENTS.md](AGENTS.md). A coordinator owns shared contracts, migrations, dependencies, and integration. Assign agents separate branches/worktrees and explicit file ownership using the [task template](docs/task-template.md). Package instructions define boundaries and checks; handoffs must report results and environment/migration effects. Git is initialized locally; no remote or initial commit is created automatically.

## Specification

- [Architecture and transaction boundaries](docs/architecture.md)
- [Game rules and defaults](docs/game-rules.md)
- [Implemented API](docs/api.md)
- [Implementation stages and acceptance tests](docs/backlog.md)

Defaults: weekdays at 11:30 Europe/Dublin, permanent winner halving, 10-token attendance reward, 5-token ×1.25/×0.8 influence, and 20-token immediate mean-weight additions. Browser identity is intentionally trust-based; anyone can select another roster member. Admin authorization uses a separate signed, expiring HttpOnly session cookie.

Production requires an always-on server, HTTPS, tested backups, strong secrets, and VAPID configuration for opt-in Web Push. Auth and push settings in `.env.example` are consumed by the server; replace example credentials before exposure. Missing push configuration or denied permission does not prevent play. No hosting is provisioned by this repository. Follow the [operations runbook](docs/operations.md) for monitoring, backup/restore and device checks.
