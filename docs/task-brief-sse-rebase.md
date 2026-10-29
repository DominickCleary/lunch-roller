# Task: Rebase SSE integration onto current main

- Owner / branch / worktree: coordinator / codex/sse-integration-testing / sse-rebase managed worktree; server and browser review agents use separate read-only branches/worktrees.
- Goal and current behavior: retain generic PostgreSQL-backed SSE invalidation, reconnect recovery and editable bet drafts while incorporating main's current UI, Activity and Storybook changes.
- Owned files or directories: coordinator owns the SSE branch diff, conflict resolutions in README.md, apps/web/app/page.tsx, migration journal and tests/e2e, and this brief. Review agents own no file mutations.
- Dependencies and contracts: origin/main c53936e; original SSE tip 09eb052. Existing API responses and game rules remain frozen; SSE carries only generic invalidation signals.
- Explicit exclusions: no dependencies, new schema design, deployment, production/shared database access or unrelated local changes.
- Acceptance criteria: SSE commits descend from main; main's restaurant sidebar, token history and Storybook remain present; authoritative refresh, draft preservation and reconnect behavior pass browser coverage.
- Checks and required fixtures: format:check, lint, typecheck, test, build; fresh disposable PostgreSQL migration/seed twice and integration tests; local Playwright suite with isolated container and TEST_DATABASE_URL.
- Migration/environment effects: existing additive 0016 notification triggers retained with its journal entry; no new migration or runtime environment variable.

## Handoff

- Result and behavior changed: seven SSE commits rebased onto c53936e, preserving current main UI and SSE behavior; rebased tip d899f44, followed by a formatting and handoff commit authorized for publication.
- Files touched / commit if available: rebased SSE diff plus formatting required by main.
- Checks executed and outcomes: format:check, lint (446 warnings), typecheck and build passed; 69 unit tests, 59 integration tests and all 45 Playwright tests passed. Migrate and seed each passed twice on disposable PostgreSQL; worker startup/heartbeat/shutdown passed.
- Known issues or blockers: none. User subsequently authorized committing the verified formatting updates and publishing the integration branch; unrelated IDE deletion excluded.
- Integration order and follow-up work: migrations precede application startup as before; publish only codex/sse-integration-testing using an explicit force-with-lease against the verified remote tip 09eb052; main is unchanged.
