# Task: Include older current-spin boosts in Lunch spot counts

- Owner / branch / worktree: Codex coordinator, main, /home/docleary/dev/lunch-roller.
- Goal and current behavior: Lunch spot currently counts only refundable influence lots, omitting older purchases without lots that Activity attributes to the current spin. User confirmed current-spin counts rather than all-time history.
- Owned files or directories: currentInfluence in packages/db/src/operations.ts; packages/contracts/src/index.ts and contract tests; apps/web/app/influence-controls.tsx; packages/db/src/activity-dates.integration.test.ts; tests/e2e/influence.spec.ts; README, docs/api.md, docs/architecture.md and this brief.
- Dependencies and contracts: reuse the exact draw attribution used by Activity. Team counts include historical current-spin purchases once; add historicalBoosts/historicalReductions breakdown fields defaulting to 0. Personal position/refund eligibility continues to derive from actual unwithdrawn current-market lots.
- Explicit exclusions: all-time counters, backfilled lots, history/weight mutations, pricing, draw logic, dependencies, migrations, commits, pushes and deployment. Preserve ongoing Token standings work.
- Acceptance criteria: historical current-spin boosts/reductions appear; other spins and refunded units do not inflate counts; legacy purchases are not refundable; counts and controls remain correct after reload, purchases and refunds.
- Checks and required fixtures: format, lint, typecheck, unit tests, build; full DB integration and affected browser tests against disposable PostgreSQL only.
- Migration/environment effects: none.

## Handoff

- Result and behavior changed: team counters include older unlinked current-spin purchases using Activity attribution. Historical subsets are exposed in the tooltip. Personal positions and refunds still use real unwithdrawn lots only; other-spin purchases and withdrawn lots are excluded.
- Files touched / commit if available: packages/db/src/operations.ts and activity-dates.integration.test.ts; packages/contracts/src/index.ts and index.test.ts; apps/web/app/influence-controls.tsx; tests/e2e/influence.spec.ts; README.md, docs/api.md, docs/architecture.md and this brief. Branch main; no commit. Prior Token standings changes preserved.
- Checks executed and outcomes: pnpm format:check, pnpm lint, pnpm typecheck, pnpm test (60 tests), pnpm test:integration (56 tests), pnpm build, and affected Playwright suites (10 tests) passed. Browser regression verifies history inclusion after reload, personal-unit refunds, and disabled refund control for historical-only purchases. Integration verifies pre-roll exclusion, no double-counting, withdrawn-unit exclusion and rollover.
- Known issues or blockers: none.
- Integration order and follow-up work: deploy updated API and web together; no migration.
