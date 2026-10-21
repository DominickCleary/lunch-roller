# Task: Restore full browser CI verification

- Owner / branch / worktree: coordinator on main, primary checkout.
- Goal and current behavior: GitHub browser verification fails on old branding assertions, preventing downstream tests and deployment. Update stale tests to shipped UI and contracts, and execute the complete suite.
- Owned files or directories: tests/e2e specs requiring repair, playwright.config.ts, this brief. Application code only if a real defect is found and explicitly recorded here.
- Dependencies and contracts: current rendered title, People table and exact balance setting, confirmation-based attendance, staged influence, complete preference/economy schemas. Preserve real database checks and all existing test scenarios.
- Explicit exclusions: no production title revert, skipped assertions/tests, deployment gate bypass, migrations, dependencies, commits, pushes or deployments.
- Acceptance criteria: full pnpm test:e2e passes against a newly migrated/seeded disposable PostgreSQL database; checks retain admin, game, identity, accessibility and persistence coverage.
- Checks and required fixtures: format/lint/types/unit/build, full Playwright suite and disposable PostgreSQL only.
- Migration/environment effects: none. Browser scenarios share the singleton settings/database; serialize shared-state tests to avoid conflicting schedule and economy mutations.

## Handoff

- Result and behavior changed: corrected old branding, People row/button selectors, balance-setting, check-in confirmation and pledge timing, staged boost/place notices, complete preference/economy schemas, and preference save notice. Browser scenarios now run with one worker because all share mutable singleton settings. No production UI/rules were changed and no tests were skipped.
- Files touched / commit if available: playwright.config.ts; tests/e2e/game.spec.ts, removal.spec.ts, smoke.spec.ts, preferences.spec.ts and economy.spec.ts; this brief. Working diff on main; no commit.
- Checks executed and outcomes: full pnpm test:e2e passed all 25 tests from an empty disposable PostgreSQL database after migration/seed (40.3 seconds). pnpm format:check, pnpm lint, pnpm typecheck, pnpm test (48 tests), pnpm build and git diff --check passed. Both downstream worker startup/heartbeat/graceful-shutdown checks passed, with and without VAPID configuration. An initial full run exposed an additional stale preference success message; corrected it and reran the entire suite from a reset database. No remote GitHub workflow or deployment was run.
- Known issues or blockers: none found in the full local browser run. GitHub must run the updated files after they are committed/pushed by the user.
- Integration order and follow-up work: complete. Temporary database container removed after verification. No migration, dependency, secret, commit, push or deployment effects.
