# Task: Align Token standings with spin activity boundaries

- Owner / branch / worktree: Codex coordinator, main, /home/docleary/dev/lunch-roller.
- Goal and current behavior: replace the calendar-day standings change with a spin-based change that follows the Activity view and its target dates.
- Owned files or directories: tokenOverview in packages/db/src/operations.ts and its integration tests, including packages/db/src/activity-dates.integration.test.ts; packages/contracts/src/index.ts and tests; TokenOverview in apps/web/app/daily-activity.tsx; affected browser tests; README, docs/api.md, docs/architecture.md and this brief.
- Dependencies and contracts: preserve authoritative wallet totals and ranking; use the same spin targeting and ledger attribution as Activity. Response adds spinLocalDate and renames row todayDelta to spinDelta; all in-repository consumers updated together. User confirmed target-spin attribution, matching Activity exactly.
- Explicit exclusions: pricing, draw selection, mutation timing, ledger edits, dependencies, migrations, commits, pushes and deployment.
- Acceptance criteria: standings names its spin date, no calendar-day label; changes include earlier actions for that spin and exclude actions for other spins; balances and ties remain correct; weekends, cutoffs, configured post-roll delay and rollover covered.
- Checks and required fixtures: format, lint, typecheck, unit tests, build; integration and affected browser tests against disposable PostgreSQL only.
- Migration/environment effects: no migration or environment changes. The token-overview wire response uses spinLocalDate and spinDelta in place of todayDelta; deploy web and server together.

## Handoff

- Result and behavior changed: Token standings labels its current target spin date and shows This spin rather than Today. Its delta sums the exact same draw-scoped ledger entries as Activity. Current wallet balances, commitments and shared ranks are unchanged.
- Files touched / commit if available: apps/web/app/daily-activity.tsx; packages/contracts/src/index.ts; packages/db/src/operations.ts, activity.integration.test.ts and activity-dates.integration.test.ts; tests/e2e/daily-activity.spec.ts; README.md, docs/api.md, docs/architecture.md and this brief. Branch main; no commit.
- Checks executed and outcomes: pnpm format:check, pnpm lint, pnpm typecheck, pnpm test (59 tests), pnpm test:integration (56 tests) and pnpm build passed. Integration verified target attribution across weekends/DST, delayed draws, saved cutoff, post-roll pause spanning midnight, completed draws and skips. All six affected browser scenarios passed (five in the suite run, then the new standings rollover test after fixing test-only polling cleanup); first-run and fixture setup also passed.
- Known issues or blockers: none.
- Integration order and follow-up work: deploy the updated web UI and API together; no database migration.
