# Task: Group activity by spin and reopen purchases after a roll

- Owner / branch / worktree: Codex coordinator, branch main, /home/docleary/dev/lunch-roller; no commit.
- Goal and current behavior: replace the calendar/draw UI split with spin-date activity; always show live upcoming odds after revealing a roll; remove the pause until the wheel preview switch time.
- Owned files or directories: activity and preferences UI/tests in apps/web and tests/e2e; contracts preferences; domain wheel display and tests; DB settings schema, operations, migration and integration tests; README and docs describing this behavior.
- Dependencies and contracts: add postDrawDelayMinutes (integer 0–1440, default 0) to public/admin preferences, with legacy wheelSwitchTime retained only for compatibility. Retain legacy calendar API scope for compatibility; UI always requests draw scope.
- Explicit exclusions: draw selection, animation, rewards, token pricing, deployment, dependencies, commits and pushes.
- Acceptance criteria: heading identifies spin date; no calendar mode; purchases group by target spin; purchases and bet edits open immediately by default; configured delay is enforced by the server and reflected in controls, including across midnight; previous results never remain as the wheel baseline; winner reveal and replay still work.
- Checks and required fixtures: format, lint, typecheck, unit tests, build; disposable DB migration/seed twice, integration and affected browser tests.
- Migration/environment effects: additive settings column and range constraint; defaults remove the old pause for existing installations; no ledger or draw changes.

## Handoff

- Result and behavior changed: activity always groups by target spin and labels the date; post-roll activity defaults to immediate with a configurable 0–1440 minute delay; the wheel advances to live next-spin odds after the reveal, with no persistent previous-result banner or switch-time control.
- Files touched / commit if available: apps/web/app/{daily-activity,page,rules-help}.tsx; packages/domain/src/{index,wheel-display.test,preferences.test}.ts; packages/contracts/src/index{,.test}.ts; packages/db/src/{schema,operations,preferences.integration.test,activity-dates.integration.test,wheel-display.integration.test}.ts; migration 0012_post_draw_activity_delay.sql with journal/snapshot; affected tests/e2e; README, docs/api.md, docs/architecture.md, docs/game-rules.md and this brief. No commit.
- Checks executed and outcomes: pnpm format:check, pnpm lint, pnpm typecheck, pnpm test (59 tests), pnpm build, and pnpm test:integration (56 tests) passed. Migration and seed each passed twice against disposable PostgreSQL 17. pnpm test:e2e passed all 35 browser tests, including mobile layouts, immediate upcoming odds, replay, spin activity and delay reopening.
- Known issues or blockers: none. The legacy calendar API and wheelSwitchTime field remain for compatibility; the Activity UI and wheel behavior no longer use them.
- Integration order and follow-up work: apply additive migration before running the updated app.
