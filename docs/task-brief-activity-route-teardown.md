# Task: Drain Activity browser routes before teardown

- Owner / branch / worktree: coordinator / codex/fix-activity-route-teardown / existing browser-review worktree.
- Goal and current behavior: prevent CI teardown failures when SSE/polling refreshes leave an intercepted bets/current or today request in flight after Activity assertions finish.
- Owned files or directories: tests/e2e/daily-activity.spec.ts and this brief.
- Dependencies and contracts: merged main 8642ac8; existing API and SSE contracts frozen.
- Explicit exclusions: production behavior, dependencies, migrations, unrelated test files, automatic commits or pushes.
- Acceptance criteria: every Activity scenario drains active route callbacks before page teardown, without suppressing callback errors; repeated affected scenarios and full browser suite pass.
- Checks and required fixtures: format:check, lint, typecheck, test, build; Playwright against disposable TEST_DATABASE_URL, repeated Activity tests plus full suite.
- Migration/environment effects: none; local runner removes its temporary PostgreSQL container.

## Handoff

- Result and behavior changed: shared afterEach waits for active route handlers; replaces two scenario-specific cleanups.
- Files touched / commit if available: test file and brief above; no commit.
- Checks executed and outcomes: pnpm format:check, pnpm lint (446 warnings), pnpm typecheck, pnpm test (69 passing), and pnpm build passed. Full Playwright suite: 45 passed. Focused refund scenario: 20 consecutive passes, plus two setup dependencies, using node scripts/test-e2e-local.mjs --project=chromium --grep "activity totals and trend subtract boost and anti-boost refunds" --repeat-each=20. Both browser runs used disposable PostgreSQL containers.
- Known issues or blockers: none; no application or database behavior changed.
- Integration order and follow-up work: test-only change; no deployment or data migration needed.
