# Task: Fix reported bet-limit, game and push browser regressions

- Owner / branch / worktree: coordinator, main, primary checkout; sub-agent read-only audit.
- Goal and current behavior: make the three reported browser flows exercise the intended domain responses and current UI.
- Owned files or directories: tests/e2e/bet-limit.spec.ts, game.spec.ts, push.spec.ts and this task brief.
- Dependencies and contracts: retain Origin checks and current API/UI contracts. Valid bet mutations send matching Origin and idempotency key; add-place uses its current accessible label and is verified by persisted odds and wallet state.
- Explicit exclusions: production behavior, schema, dependency changes, commits and deployments.
- Acceptance criteria: bet cap reaches 409, ownership checks reach 404, cutoff checks reach 409; game and push scenarios confirm the created place and token balance; full browser suite passes.
- Checks and required fixtures: format, lint, typecheck, unit suite, build and Playwright on a newly created disposable PostgreSQL database.
- Migration/environment effects: none; use existing migrations in disposable test environment.

## Handoff

- Result and behavior changed: fixed mutation Origin headers and stale add-place assertions.
- Files touched / commit if available: three assigned browser tests; no commits.
- Checks executed and outcomes: pnpm format:check, pnpm lint (warnings), pnpm typecheck and pnpm test (70 passed) succeeded. pnpm test:e2e:local built web/worker, created and migrated/seeded a disposable PostgreSQL container, passed all 48 Playwright tests, and removed the container. git diff --check passed.
- Known issues or blockers: none for the reported failures.
- Integration order and follow-up work: integrated and verified; no deployment or migration changes in this fix.
