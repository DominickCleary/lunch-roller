# Task: Keep winner celebrations from blocking SSE browser actions

- Owner / branch / worktree: coordinator / codex/fix-activity-route-teardown / existing browser-review worktree; update PR #2.
- Goal and current behavior: prevent the SSE scenario timing out when an earlier committed draw finishes animating and its winner dialog intercepts the first boost or later actions.
- Owned files or directories: tests/e2e/sse.spec.ts and this brief.
- Dependencies and contracts: existing consolidated PR branch; API, persistence, SSE and winner dialog behavior frozen.
- Explicit exclusions: production code changes, migrations, dependencies, force clicks, disabled SSE or increased test timeouts.
- Acceptance criteria: both pages dismiss a visible winner celebration before actions, including after reconnect/reload; cross-page updates, draft preservation, identity and missed-change recovery assertions remain intact.
- Checks and required fixtures: format:check, lint, typecheck, unit tests, build; repeated SSE scenario and full Playwright suite on disposable PostgreSQL.
- Migration/environment effects: none; temporary test databases removed after verification.

## Handoff

- Result and behavior changed: register persistent Playwright locator handlers on both pages before navigation; use the real Praise the Wheel button to dismiss modal overlays.
- Files touched / commit if available: SSE test and this brief.
- Checks executed and outcomes: format:check, lint (446 warnings), typecheck, 69 unit tests and production build passed. SSE scenario passed ten repetitions (12 tests including setup dependencies); full suite passed all 45 tests via pnpm test:e2e:local. Browser runs used fresh disposable PostgreSQL containers, removed by the runner.
- Known issues or blockers: none in local verification; GitHub CI will run after publication.
- Integration order and follow-up work: publish to the existing PR #2 branch after validation, per user instruction to consolidate changes there.
