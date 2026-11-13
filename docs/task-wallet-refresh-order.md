# Task: Keep wallet history current when refreshes overlap

- Owner / branch / worktree: coordinator on main in primary checkout; activity subagent reviews read-only from its isolated worktree.
- Goal and current behavior: reproduce and fix an intermittent influence ledger assertion after seven completed boosts. Background SSE refreshes and mutation refreshes may complete out of order; wallet writes currently have no request or identity guard.
- Owned files or directories: apps/web/app/page.tsx, tests/e2e/influence.spec.ts, focused wallet/identity browser regression coverage if necessary, and this brief. Existing UI/UX edits remain intact.
- Dependencies and contracts: current wallet/influence API contracts and persisted ledger; no schema or dependency changes.
- Explicit exclusions: game rules, token math, ledger grouping semantics, migrations, dependency changes, commits or deployments.
- Acceptance criteria: a deliberately delayed old wallet response cannot replace a later purchase's balance or seven-boost ledger group; stale identity responses cannot clear or replace the current person's wallet; persistent purchase assertions remain intact.
- Checks and required fixtures: reproduce regression before fix; repeated affected Playwright tests and full browser suite on disposable PostgreSQL; formatting, lint, typecheck, unit tests and production build.
- Migration/environment effects: none; temporary isolated PostgreSQL container for verification.

## Handoff

- Result and behavior changed: reproduced an old six-boost wallet arriving after the seventh purchase and changing the displayed balance from 65 back to 70. Wallet refreshes now carry an increasing request number and only update state for the still-selected participant. Stale identity errors are ignored, so an earlier name’s delayed 403 cannot clear the new selection. Token accounting and ledger grouping remain unchanged.
- Files touched / commit if available: apps/web/app/page.tsx, tests/e2e/influence.spec.ts, tests/e2e/ui-ux.spec.ts, and this brief. Coordinator main checkout; read-only subagent review confirmed the race. No commit.
- Checks executed and outcomes: the deliberately reordered wallet regression failed before the fix (displayed 70 instead of 65). After the fix, the delayed-response scenario and both old-identity snapshot/error cases pass. Formatting, lint (warnings), typecheck, 72 unit tests and production build pass. Ten repetitions of influence and UI/identity suites passed all 70 checks on disposable PostgreSQL. Full `pnpm test:e2e:local` passed all 54 browser tests on a separate fresh database; its runner removed the container. `git diff --check` passed.
- Known issues or blockers: none. Lint exits successfully with existing non-blocking warnings.
- Integration order and follow-up work: guard integrated with the existing UI/UX changes; all required verification passed and temporary test infrastructure was removed. Changes remain uncommitted for review.
