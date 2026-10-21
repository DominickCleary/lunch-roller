# Gambling about lunch

A shared workplace lunch wheel: winners lose half their weight, and showing up earns tokens to influence future lunches.

**Current status: locally playable MVP.** All five [milestones](docs/backlog.md) are implemented: persistent name selection, separate admin sessions and management, scheduled server draws, attendance and token spending, the animated wheel, and optional Web Push with leased delivery. Production HTTPS/device delivery and hosting require environment setup; see the [operations runbook](docs/operations.md).

## Quick start: Docker

Requires Docker Desktop/Engine with Linux containers and Compose v2. Copy `.env.example` to `.env` (PowerShell: `Copy-Item .env.example .env`). Then:

```sh
docker compose up --build --wait
```

Open http://localhost:3000 (or your `WEB_PORT`). Compose migrates and initializes settings before starting web and worker. A new installation has no people or places. Sign in to first-run setup with the configured `ADMIN_PASSWORD`, add your roster and lunch places, check the schedule, then finish setup. The worker waits until setup is complete. Visitors must select a roster name before entering; browsers remember a valid selection and offer Change name. Existing populated installations keep their data and skip first-run setup. Set today's schedule time earlier than the current local time to try a draw on the next worker tick; an existing date's result cannot be rerolled. Logs: `docker compose logs -f web worker`. Stop with `docker compose down`; the named PostgreSQL volume is retained.

The wheel fills the main workspace, with compact member, wallet and place controls alongside it. From the admin-configured switch time (default 3pm) in the configured timezone it shows live odds for the next scheduled draw (Friday afternoon previews Monday on a weekday schedule). Staged boosts and reductions resize those upcoming segments; the actual draw still runs at its configured time. Each draw has a shared admin-configured spin (5–60 seconds, default 20) with several fast turns and a slow final approach, landing at a saved point inside the winner rather than always at its centre. Browsers use the server clock to join the same live phase, including after refresh or returning to a tab. A winner modal with full-screen confetti appears when a live spin or replay finishes. The wheel holds its saved segments and landing until the modal closes, then restores the current view. “The Wheel has spoken” reveals the chosen restaurant; Escape or Praise the Wheel closes it. Replay follows the same saved path; reduced motion suppresses confetti. Reduced-motion mode shows the same landing without rotation. Check-in displays an admin-editable pledge and becomes disabled once attendance is recorded, including after reload. Admin removal permanently deletes unused profiles and archives profiles with activity, preserving their history.

Beside each lunch spot, the influence controls show the team's boost/reduction counts and your signed position. A person holds boosts or reductions on a spot, never both: boosting a −2 position makes it −1 and refunds the reduction’s original price. Moving away from zero spends at the current price; moving toward zero reverses the original multiplier. The refund icon returns all your staged units on that spot. Edits close at the same cutoff as betting. At cutoff, positions lock for the draw. After the draw, their effects remain in the restaurant weights. Adding or banishing a restaurant is an immediate, final purchase; banishing refunds all pending boosts, reductions and bets on that restaurant, including requests already locked for an undrawn result. The Daily activity tab separates outstanding draw positions from the day's purchase/refund history. Existing purchases from before this feature remain historical and cannot be withdrawn.

The navbar **Help** icon opens the current rules, including configured token prices, weight multipliers, health bonuses, schedule, cutoff, betting and transfers. It refreshes public settings when opened; the member controls keep live status and action values without repeating the rule explanations.

The interface uses an iron-and-brass ritual theme, with a parchment-and-brass light variant. Compact member controls, activity charts, admin panels and dialogs share the same palette. The site uses a typographic wordmark while the spinning-wheel/ouroboros logo artwork is supplied separately.

Use the header's Dark mode / Light mode toggle to change the theme. The site follows your system theme until you choose one, then remembers that choice in your browser and synchronizes it across tabs.

Open Team token activity below your own token history to view another active roster member's balance, transactions, reasons and dates. Viewing activity leaves your selected name and game actions unchanged.

Token standings shows Total and Uncommitted tokens. Total includes uncommitted tokens plus stakes in open bets and pending boosts/reductions, including units locked for an undrawn result. Settled purchases and historical spending are excluded. Rankings use total tokens; equal totals share a rank (1, 1, 3), with names only ordering tied rows. Today shows the net change in uncommitted tokens.

Places have three health levels: **Treat**, **Balanced**, and **Healthy**. Choose a level when adding a place; admins can edit it later. Existing places start Balanced. After a Treat place wins, every active Healthy place receives a permanent ×1.25 weight bonus, alongside the winner’s usual halving. Admins can disable the rule or change its multiplier under Health balance. Result and Daily activity panels show automatic bonuses separately from paid boosts, with saved chances before/after the bonus.

Open **Trade tokens** in your wallet to choose another active person, enter a whole-token amount, review, and confirm. Transfers are immediate, final, and fee-free; both wallets and Daily activity record the other person and amount. Only available tokens can be traded. The server serializes transfers with purchases and prevents overdrafts and duplicate sends on retries. Transfers use the same trust-based name selection as the rest of the game.

Token history names the restaurant boosted, anti-boosted, added or removed, and identifies bet reservations, refunds and payouts. Personal and team wallets also show each person's bets, stakes, draw dates and outcomes, including changes that did not move tokens.

Choose **Daily activity** above the wheel for a workplace-day overview: influence spending over time, boosts versus anti-boosts by restaurant, who supported or opposed each place, a filterable activity feed, and the bets for that draw date. Activity opens on today's Calendar day, showing token actions on their actual workplace date, including morning purchases after the wheel advances to tomorrow. Draw activity groups charts, positions, bets and automatic health bonuses by the selected draw date, including purchases made on earlier days. Older boosts and reductions without a saved draw link also appear on their recorded workplace date, labelled as historical purchases; they do not create draw positions. Choose Calendar day to see token actions on their actual workplace date. Today selects Calendar day for today, and Next draw selects Draw activity for the current betting draw. Charts use actual dated timestamps across midnight/weekends and show recorded token spending before refunds, not historical odds. The scheduled label beneath the wheel shows the weekday, date without a year, and draw time.

Under Admin tools → Draw schedule, admins can mark the next roll to be skipped for an office event. The skip applies to that scheduled local date, refunds any open bets or staged influence for it, and advances the wheel and betting market to the next scheduled roll. A pending skip can be cancelled before draw time; changing the schedule clears it. Under Admin tools → Tokens and odds, admins can change the participation reward, new-place cost, separate boost/reduce costs, and their relative-weight multipliers. Defaults remain 10, 20, 5, 5, ×1.25 and ×0.8. Changes apply to future actions; saved draw results and token history stay intact. Member labels show current prices. Admin tools → Places and odds combines percentage sliders, direct relative weight edits, names, health levels and archive controls. Weight and percentage overrides refund pending influence before applying; draw snapshots remain unchanged. Member Odds use readable approximate fractions with exact percentage chances in their tooltips.

Admin tools show people in a table where you can add, disable/restore, rename, and set an exact token balance with a reason. Balance changes appear as correction entries in that person's history. In Restaurant odds, select a group to give each the wheel's average 1/N chance while the rest resize proportionally, set all restaurants equal, or adjust one restaurant with its slider or number field. Members can toggle between chance percentages and fair fractional odds. They can also reserve tokens on a restaurant for the next draw, change or cancel the bet until the admin-configured cutoff, and see estimated return and net gain; settlement uses the final draw snapshot.

Compose binds web/database to localhost and uses development credentials. It is a local setup, not a production deployment. The seed service initializes the settings singleton only and preserves existing data.

If port 5432 is already occupied, set `POSTGRES_PORT` to a free port in `.env` and update the port in `DATABASE_URL` to match. Containers still connect to `db:5432` internally.

If port 3000 is occupied, change `WEB_PORT` and set `APP_ORIGIN` to the matching browser origin so state-changing requests pass the origin check.

## Automatic deployment

CI can deploy passing pushes to `main` through a Linux Actions runner installed as `webserver` on your local-network server. It runs your existing Compose rebuild command from the production checkout, keeping `.env` and database storage in place. Configure the `lunch-roller-deploy` runner label and repository variable `DEPLOY_ENABLED=true`; set `DEPLOY_PATH` if the checkout differs from `/home/webserver/lunch-roller`. See the [one-time setup](docs/operations.md#automatic-deployment-from-main). Deployment waits for both CI jobs to pass and remains disabled until configured.

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

`GET /api/v1/health` returns 200 when the DB is reachable and settings are seeded, otherwise 503. The page polls readiness and today's result every 30 seconds, with lightweight one-second result checks from a minute before a pending draw through its reveal. Returning to a tab refreshes the server clock. The worker logs `started`, database `heartbeat` every 30 seconds, safe scheduling/delivery failures, and `stopped` on Ctrl+C/SIGTERM. It processes today's due draw only; no missed dates are backfilled.

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

Production requires an always-on server, HTTPS, tested backups, strong secrets, and VAPID configuration for opt-in Web Push. Auth and push settings in `.env.example` are consumed by the server; replace example credentials before exposure. Alerts cover committed draws, received transfers, and winning bet payouts; check-in rewards are silent. Missing push configuration or denied permission does not prevent play. No hosting is provisioned by this repository. Follow the [operations runbook](docs/operations.md) for monitoring, backup/restore and device checks.
