# Task: Preserve bet drafts and recover SSE listener startup

- Owner / branch / worktree: Coordinator / `codex/sse-integration-testing` / `/home/docleary/lunch-roller`.
- Goal and current behavior: Background SSE refreshes overwrite unfinished bets; failed listener startup leaves connected streams without automatic recovery. Preserve edited fields while refreshing saved game state and close failed streams so EventSource retries.
- Owned files or directories: `apps/web/app/page.tsx`, `apps/web/app/api/v1/events/route.ts`, `apps/web/lib/game-state-events.test.ts`, `tests/e2e/sse.spec.ts`, and this brief.
- Dependencies and contracts (link version/commit): Existing SSE contract at `b20271f`; empty change events, three-second browser reconnect, authoritative HTTP reads. No shared contract changes.
- Explicit exclusions: Database operations, migrations, dependencies, identity or authorization changes, deployment, and unrelated UI work.
- Acceptance criteria: Unfinished bet fields survive background changes; saving/cancelling resets fields to persisted values; switching identity or market initializes the appropriate draft. Failed startup closes all affected streams, clears heartbeat timers, and permits a reconnect to start the shared listener.
- Checks and required fixtures: Format, lint, workspace typecheck, unit tests, production build, and affected Playwright coverage using an explicitly disposable `TEST_DATABASE_URL`.
- Migration/environment effects: None.

## Handoff

- Result and behavior changed: Edited bet inputs survive shared refreshes, including when a refresh was already in flight. Successful save/cancel releases the draft; identity and market changes initialize it again. Failed SSE listener startup closes every affected stream and clears its heartbeat, allowing the browser's three-second reconnect to retry startup.
- Files touched / commit if available: Owned files above; no commit created. The pre-existing deletion of `.idea/db-forest-config.xml` was left untouched.
- Checks executed and outcomes: On Node 24.22.1, installed local binaries passed `biome format .`, `biome lint . --max-diagnostics=0` (444 existing warnings), `tsc --noEmit -p <workspace>/tsconfig.json` for contracts/domain/db/worker/web, `vitest run` (69 tests across 12 files), and `git diff --check`. The transport regression checks shared startup failure, closed streams, timer cleanup, reconnect and change delivery. Updated Playwright coverage checks edited drafts across SSE changes, saved-bet persistence after reload, failed submission, cancellation and recovery from a successfully opened stream that closes immediately.
- Known issues or blockers: `playwright test tests/e2e/sse.spec.ts` exits before running tests because `TEST_DATABASE_URL` is unset; Docker is unavailable in this WSL environment. E2E is explicitly unverified. The default Next production build remained at compile without a result and was interrupted; a webpack build attempt failed with `Could not parse output from TypeScript's --showConfig.` Production build remains unverified. Windows-mounted package-manager/executable shims are unreliable here, so checks used installed local tools and the Linux Node binary directly.
- Integration order and follow-up work: Review and run the affected browser flow with a disposable database before integration.
