# Task: Make desktop wheel assertions respect the available workspace

- Owner / branch / worktree: coordinator / main / current worktree.
- Goal and current behavior: fix the E2E assumption that every desktop wheel exceeds 600px. The wheel also fits available height and shrinks when admin tools occupy part of the workspace.
- Owned files or directories: `tests/e2e/game.spec.ts`, `tests/e2e/sticky-workspace.spec.ts`, and this task brief.
- Dependencies and contracts: existing layout and app behavior; no shared contract changes or dependencies.
- Explicit exclusions: no application CSS, odds, animation, database or CI configuration changes.
- Acceptance criteria: the admin/game flow checks a visible, square wheel sized within the available workspace; layout coverage explicitly checks that opening admin shrinks the wheel to fit; all 49 E2E tests pass in a single full run on a fresh disposable database.
- Checks and required fixtures: formatting, lint, typecheck, unit tests, production build and full `pnpm test:e2e` with disposable `TEST_DATABASE_URL`.
- Migration/environment effects: none; disposable database only for verification.

## Handoff

- Result and behavior changed: replaced the fixed 600px minimum with checks for viewport visibility, a square shape and dimensions fitting the workspace. Added explicit coverage that opening admin shrinks the wheel while keeping it visible.
- Files touched / commit if available: listed above; no commit created.
- Checks executed and outcomes: `pnpm format:check`, `pnpm lint` (459 existing warnings), `pnpm typecheck`, `pnpm test` (71 tests), `pnpm build`, and `git diff --check` passed. Final full `pnpm test:e2e` passed all 49 tests in one run (1.0m), using a fresh migrated/seeded disposable PostgreSQL database. An initial rerun rejected a strict 100% intersection assertion on the wheel wrapper; final checks assert viewport visibility and workspace dimensions instead. The disposable container was removed after verification.
- Known issues or blockers: none identified.
- Integration order and follow-up work: none.
