# Task: Configure a minimum percentage-point reduction after a win

- Owner / branch / worktree: coordinator / main / current worktree.
- Goal and current behavior: add an optional minimum after-win chance reduction. Currently only the winner's weight multiplier and removal thresholds apply. With a positive minimum, target chance is min(pre-draw chance × winner multiplier, pre-draw chance − configured percentage points). Zero or negative targets archive the winner.
- Owned files or directories: contracts/domain source and tests, database schema/operations/integration tests and generated migration metadata, web page and rules Help, chance-removal E2E, economy fixtures, README and API/architecture/game rules docs, this task brief.
- Dependencies and contracts: coordinator owns `winnerChanceReductionPoints` (finite 0–100, default 0) in economy settings and migration. Zero preserves existing weight-based decay. Positive values apply the existing multiplier to chance; surviving other weights stay unchanged, so their odds resize proportionally. Health bonuses follow the reduction, then existing removal thresholds. A sole remaining place retains 100% if its target is positive because there is no other place to receive the released chance.
- Explicit exclusions: no changes to selection, replay, saved snapshots, ledger history or existing configured thresholds. No dependencies or deployment.
- Acceptance criteria: admin can save/reload/disable the setting; 30→15, 15→5, 9→removed and 10→removed at the default multiplier with 10 points. Reduction is durable, archives through existing settlement/refund path, and does not alter saved odds or payouts. Extreme logarithmic weights remain finite. Legacy requests default to off.
- Checks and required fixtures: contract/domain tests, DB integration, migration twice/seed twice on disposable PostgreSQL, formatting, lint, typecheck, unit tests, production build and full browser suite on fresh disposable TEST_DATABASE_URL.
- Migration/environment effects: new non-null checked settings column default 0; no existing game opts in automatically.

## Handoff

- Result and behavior changed: added a configurable minimum percentage-point reduction in Admin and public Help. Enabled mode applies the larger chance reduction, archives zero/negative targets using the existing settlement/refund path, and retains saved draw snapshots. Zero preserves the original weight-multiplier mode.
- Files touched / commit if available: listed above; no commit created.
- Checks executed and outcomes: `pnpm format:check`, `pnpm lint` (warnings remain), `pnpm typecheck`, `pnpm test` (72 tests), `pnpm build` and `git diff --check` passed. `pnpm test:integration` passed all 64 tests. Final full `pnpm test:e2e` passed all 49 tests in one run (1.1m). Migrations and seed each succeeded twice against disposable PostgreSQL. An initial browser test raced a prior success message when disabling the new setting; the test now awaits each save response. An initial exact-zero unit boundary exposed log-space round-off; zero-target comparisons now account for floating-point precision, with a nearby positive-target case also covered.
- Known issues or blockers: a sole positive-chance surviving place necessarily retains 100%; documented in rules. No verification blockers.
- Integration order and follow-up work: apply new migration before deploying updated API.
