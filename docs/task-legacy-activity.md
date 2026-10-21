# Task: Show historical boosts in activity

- Owner / branch / worktree: coordinator / main / D:\lunch-roller (no commit).
- Goal and current behavior: wallet history includes unlinked historical boosts that Draw activity silently excludes. Show these purchases by their recorded workplace date with an explicit historical label.
- Owned files or directories: this brief, `packages/db/src/operations.ts`, `packages/db/src/activity.integration.test.ts`, `apps/web/app/daily-activity.tsx`, `tests/e2e/daily-activity.spec.ts`, `docs/api.md`, `README.md`.
- Dependencies and contracts: existing activity/wallet wire shapes stay frozen; coordinator owns the read-filter semantic update. Linked influence/bets still use their saved draw date.
- Explicit exclusions: no inferred draw links, historical position reconstruction, ledger edits, migrations, dependencies, deployments or game mutation changes.
- Acceptance criteria: unlinked boost/reduce purchases appear once on their action date in both activity scopes, including archived actors/places; linked purchases never leak into another draw. Historical labels explain that the draw is unknown; outstanding positions remain authoritative.
- Checks and required fixtures: format, lint, typecheck, unit tests, build; disposable PostgreSQL activity regressions covering timezone boundaries and wallet parity; affected activity browser tests.
- Migration/environment effects: none for the app; use and remove a dedicated disposable test database container.

## Handoff

- Result and behavior changed: Draw activity includes unlinked historical boost/reduce purchases on their recorded workplace date; timeline and chart notes explain unknown draw attribution. Saved market attribution and outstanding positions are unchanged.
- Files touched / commit if available: owned files above; no commit.
- Checks executed and outcomes: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (58 tests), `pnpm build`, `pnpm test:integration` (54 tests), and `pnpm exec playwright test daily-activity.spec.ts --project=chromium` (6 tests including setup dependencies) passed. Targeted activity integration tests also passed (5 tests). `git diff --check` passed. Initial fixture omitted a required correction reason; corrected before passing runs. Sandboxed build stalled and was interrupted; elevated build passed. Sandbox denied loopback database access; database/browser checks ran elevated against the disposable container on port 5459, browser port 3059.
- Known issues or blockers: no production data audited. A read-only aggregate check found no boost/reduce records in the running local onboarding database; regression was verified with historical ledger fixtures. Exact user-reported records remain unverified.
- Integration order and follow-up work: database read and UI explanation together; no deployment performed.
