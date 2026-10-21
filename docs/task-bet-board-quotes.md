# Task: Show current bet odds and estimated winning returns

- Owner / branch / worktree: coordinator, main workspace.
- Goal and current behavior: bet board lacks live odds and winning return estimates. Add read-only server quotes and visible columns.
- Owned files or directories: packages/contracts/src/index.ts and index.test.ts, packages/db/src/operations.ts, packages/db/src/activity.integration.test.ts, apps/web/app/daily-activity.tsx, tests/e2e/daily-activity.spec.ts, docs/api.md, this brief.
- Dependencies and contracts: optional nullable currentProbability and estimatedWinPayout on activity bet rows; no changes to saved bet probability or payout. Estimates follow settlement rounding/cap and include the stake.
- Explicit exclusions: no betting, settlement, balance or schema mutations, migrations, dependencies, commits or deployment.
- Acceptance criteria: open quotes reflect active weights and refresh; unavailable chances have no estimate; closed bets retain final odds and actual payout; compact table scrolls on mobile.
- Checks and required fixtures: format, lint, typecheck, unit, integration, build and affected Playwright tests against disposable PostgreSQL.
- Migration/environment effects: none.

## Handoff

- Result and behavior changed: open bets show live approximate fractional odds, percentage chance and estimated gross winning return from the server's read snapshot. Quotes refresh with the board. Closed bets retain final settlement odds and actual payout, with no live estimate. Read-only fields do not change any saved bet or balance.
- Files touched / commit if available: above; no commit.
- Checks executed and outcomes: format:check, lint, typecheck, production build, unit tests (56 passed), integration tests (49 passed), and affected browser tests (5 passed including setup/fixtures). Regressions cover changed live weights, unavailable chances, payout cap, settled values, contract bounds and visible odds/return. Database/browser checks used disposable PostgreSQL. git diff --check passed.
- Known issues or blockers: none.
- Integration order and follow-up work: complete; no migration or deployment.
