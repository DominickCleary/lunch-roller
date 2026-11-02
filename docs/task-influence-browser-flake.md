# Task: Make influence sort and refund browser checks reliable

- Owner / branch / worktree: coordinator in primary checkout; sub-agent read-only review.
- Goal and current behavior: investigate intermittent influence refund assertion in CI and stabilize browser coverage without weakening server/UI checks.
- Owned files or directories: tests/e2e/influence.spec.ts and this brief.
- Dependencies and contracts: existing influence POST/refund responses, original token prices, 2-second sort hold, disposable database fixtures.
- Explicit exclusions: game rules, server authorization, schema, dependencies and deployments.
- Acceptance criteria: preserve exact 1999/2000ms ordering assertions; resume normal timers for refund, assert server acceptance/position/balance; seven purchases each confirmed independently; repeated influence runs and full browser suite pass.
- Checks and required fixtures: Node 24/pinned pnpm, format/lint/typecheck/unit/build; repeated Playwright influence tests and full suite on disposable PostgreSQL.
- Migration/environment effects: none.

## Handoff

- Result and behavior changed: test synchronization and server response diagnostics added; production behavior unchanged.
- Files touched / commit if available: assigned influence browser test; no commits.
- Checks executed and outcomes: initial repeated run reproduced two intermittent rapid-boost ledger failures in eight runs; sort/refund flow passed eight runs. Updated repeated run passed all three influence scenarios 12 times each (36 influence tests plus setup/fixtures, 38 total). Format, lint (warnings), typecheck and 70 unit tests passed; web/worker build passed. pnpm test:e2e:local then passed all 48 browser tests on a separate fresh disposable PostgreSQL database. Both local runners removed their test containers.
- Known issues or blockers: none observed after verification. The original CI refund failure was not reproduced locally in the initial eight repetitions; the related rapid-purchase ledger failure was reproduced and both workflows now verify each completed server action.
- Integration order and follow-up work: integrated and verified on main; no environment or migration changes.
