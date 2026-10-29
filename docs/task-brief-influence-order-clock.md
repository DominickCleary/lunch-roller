# Task: Make influence reorder timing deterministic

- Owner / branch / worktree: coordinator / codex/fix-influence-order-clock / browser-review worktree.
- Goal and current behavior: remove the CI race where network/assertion time plus a real 1900 ms sleep exceeds the restaurant order's 2000 ms hold.
- Owned files or directories: tests/e2e/influence.spec.ts and this brief.
- Dependencies and contracts: current origin/main; production sidebar timing and API contracts frozen.
- Explicit exclusions: production behavior, migrations, dependencies, unrelated tests, automatic commits/pushes.
- Acceptance criteria: with real persisted influence updates, order remains fixed at 1999 ms and changes at 2000 ms under the browser clock; repeated scenario and full E2E suite pass.
- Checks and required fixtures: format:check, lint, typecheck, test, build; repeated influence scenario and full Playwright suite against isolated disposable PostgreSQL.
- Migration/environment effects: none.

## Handoff

- Result and behavior changed: freeze browser time before loading; advance the actual browser timers across the hold boundary, independently of request latency.
- Files touched / commit if available: test and brief above; uncommitted.
- Checks executed and outcomes: format:check, lint (446 warnings), typecheck, build, and all 69 unit tests passed. The influence order scenario passed 20 consecutive repetitions (22 tests including setup dependencies) via node scripts/test-e2e-local.mjs --project=chromium --grep "holds restaurant order for two seconds after changing influence" --repeat-each=20. The full suite via pnpm test:e2e:local passed all 45 tests. Both browser runs used fresh disposable PostgreSQL containers, removed by the runner.
- Known issues or blockers: none; changes remain uncommitted and unpushed. The separate Activity teardown fix is on its own branch.
- Integration order and follow-up work: no application changes or migration required.
