# Task: Preserve restaurant weight scale when editing odds

- Owner / branch / worktree: coordinator, main workspace.
- Goal and current behavior: percentage overrides currently replace weights with probabilities totaling 1. Preserve the existing total base weight instead.
- Owned files or directories: packages/db/src/operations.ts, packages/db/src/restaurant-weights.integration.test.ts, packages/db/src/influence.integration.test.ts, docs/game-rules.md, this brief.
- Dependencies and contracts: existing odds request/response and refund transaction; no shared contract changes.
- Explicit exclusions: no historical rewrites, automatic rescaling of existing data, migrations, dependencies, commits or deployment.
- Acceptance criteria: saving 40/40/20 preserves weights 1/1/0.5; percentage changes retain their total; repeated saves do not reset scale; extreme log weights remain finite; pending influence is refunded before measuring the base total.
- Checks and required fixtures: disposable PostgreSQL integration tests; format, lint, typecheck, unit tests and build.
- Migration/environment effects: none. Previously normalized weights cannot be unambiguously reconstructed; direct admin weight editing remains available.

## Handoff

- Result and behavior changed: percentage overrides preserve the total active base weight after pending influence refunds, calculated in log space. Saving 40/40/20 now retains weights 1/1/0.5; direct overrides and draw halving retain their existing behavior.
- Files touched / commit if available: above; no commit.
- Checks executed and outcomes: format:check, lint, typecheck, test (55 passed), build and test:integration (48 passed) all passed. Regression cases cover unchanged/repeated percentage saves at ordinary and extreme log scales, plus preserving the refunded base total. git diff --check passed. Database checks used a fresh disposable PostgreSQL container; no browser changes were made.
- Known issues or blockers: none.
- Integration order and follow-up work: complete. Previously normalized data retains its current scale; restore desired individual values using existing admin weight inputs. No automatic data rewrite or migration.
