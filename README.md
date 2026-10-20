# Lunch Roller

A shared workplace lunch wheel: winners lose half their weight, and showing up earns tokens to influence future lunches.

**Current status: repository foundation.** The landing page and database readiness API run; the worker emits health logs. Game calculations and schema are implemented. Name selection, admin sessions, scheduled draws, attendance, spending, wheel animation, and push delivery are planned in [the backlog](docs/backlog.md), not playable yet.

## Quick start: Docker

Requires Docker Desktop/Engine with Linux containers and Compose v2. Copy `.env.example` to `.env` (PowerShell: `Copy-Item .env.example .env`). Then:

```sh
docker compose up --build --wait
```

Open http://localhost:3000. Compose migrates and seeds a development database before starting web and worker. The seed adds Alex, Sam, and three equal-weight sample places, without overwriting existing data. Logs: `docker compose logs -f web worker`. Stop with `docker compose down`; the named PostgreSQL volume is retained.

Compose binds web/database to localhost and uses development credentials. It is a local setup, not a production deployment. The seed service is development-only.

If port 5432 is already occupied, set `POSTGRES_PORT` to a free port in `.env` and update the port in `DATABASE_URL` to match. Containers still connect to `db:5432` internally.

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

`GET /api/v1/health` returns 200 when the DB is reachable and settings are seeded, otherwise 503. The landing page checks it every 30 seconds. The worker logs `started`, database `heartbeat` every 30 seconds, and `stopped` on Ctrl+C/SIGTERM. Its logs explicitly say scheduling is not implemented.

## Checks

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Against a fresh disposable database with `DATABASE_URL` configured:

```sh
pnpm db:migrate
pnpm db:migrate
pnpm db:seed
pnpm db:seed
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
```

Playwright starts the production web server; run `pnpm build` first. On Linux, `node scripts/check-worker.mjs` verifies DB heartbeat and graceful SIGTERM shutdown. On Windows, run `pnpm dev:worker` and check Ctrl+C shutdown manually; Windows process termination does not provide POSIX SIGTERM semantics. CI runs all these checks and a separate Compose startup/health job. Run `pnpm format` to apply formatting.

Schema changes: coordinator runs `pnpm db:generate`, reviews SQL and metadata under `packages/db/migrations`, then applies `pnpm db:migrate`. Never generate migrations concurrently. Development seed is repeat-safe but must not run against production.

## Workspace and agent workflow

| Workspace            | Purpose                                                    |
| -------------------- | ---------------------------------------------------------- |
| `apps/web`           | Next.js App Router, React, Tailwind, HTTP API              |
| `apps/worker`        | Node/tsx health loop; future scheduling and Web Push       |
| `packages/domain`    | Pure game calculations                                     |
| `packages/db`        | PostgreSQL, Drizzle schema/migrations, future transactions |
| `packages/contracts` | Zod wire schemas and inferred types                        |

Start with [AGENTS.md](AGENTS.md). A coordinator owns shared contracts, migrations, dependencies, and integration. Assign agents separate branches/worktrees and explicit file ownership using the [task template](docs/task-template.md). Package instructions define boundaries and checks; handoffs must report results and environment/migration effects. Git is initialized locally; no remote or initial commit is created automatically.

## Specification

- [Architecture and transaction boundaries](docs/architecture.md)
- [Game rules and defaults](docs/game-rules.md)
- [Implemented and planned API](docs/api.md)
- [Implementation stages and acceptance tests](docs/backlog.md)

Defaults: weekdays at 11:30 Europe/Dublin, permanent winner halving, 10-token attendance reward, 5-token ×1.25/×0.8 influence, and 20-token immediate mean-weight additions. Browser identity is intentionally trust-based; anyone can select another roster member. Admin authorization is separate and remains to be implemented.

Production later requires an always-on server, HTTPS, database backups, strong secrets, and VAPID configuration for opt-in Web Push. `.env.example` reserves future auth/push settings; the scaffold does not consume them for authentication or send notifications. No hosting is provisioned by this repository.
