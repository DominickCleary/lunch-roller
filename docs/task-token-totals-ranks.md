# Task: Show total and uncommitted tokens with shared ranks

- Owner / branch / worktree: coordinator / main / D:\lunch-roller.
- Goal and current behavior: Token standings currently shows only available ledger balance and gives every row a different rank. Show total and uncommitted tokens separately and share ranks for equal totals.
- Owned files or directories: this brief, `packages/contracts/src/index.ts`, `packages/contracts/src/index.test.ts`, `packages/db/src/operations.ts`, `packages/db/src/activity.integration.test.ts`, new `packages/db/src/token-overview.integration.test.ts`, `apps/web/app/daily-activity.tsx`, `tests/e2e/daily-activity.spec.ts`, `README.md`, `docs/api.md`.
- Dependencies and contracts: coordinator owns additive overview fields `totalBalance` and `rank`; existing `balance` stays uncommitted. Total = ledger balance + open bet stakes on open markets + nonwithdrawn influence costs on open markets (including locked units). Settled, refunded, withdrawn and historical spending is excluded. Rank by total descending with competition ties (1, 1, 3); names only order tied rows. Today delta retains its ledger/uncommitted meaning. All reads share the existing repeatable-read snapshot.
- Explicit exclusions: wallet/purchase behavior, game rules, migrations, dependencies, dump modifications, commits, pushes and deployments.
- Acceptance criteria: both amounts visible; equal total has equal rank even with different available balances; pending bets/influence counted once; refunds free funds without changing total; settlement removes reserved funds from total; archived people excluded; zero balances supported.
- Checks and required fixtures: format, lint, typecheck, unit tests, build; full integration suite and affected activity browser tests against a new synthetic disposable database, never the supplied dump.
- Migration/environment effects: no migration; additive API fields require app server/client deployment together.

## Handoff

- Result and behavior changed: token standings displays Total and Uncommitted; server computes total from the available ledger plus open reservations and supplies shared competition ranks. Today remains the uncommitted ledger delta. Refund/settlement behavior and all mutation rules are unchanged.
- Files touched / commit if available: `README.md`, `docs/api.md`, this brief, contract index, DB operations, existing activity integration test, new token overview integration test, activity UI and browser fixtures/assertions; no commit.
- Checks executed and outcomes: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (58 tests), `pnpm build`, full `pnpm test:integration` (55 tests across 17 files), and `pnpm exec playwright test daily-activity.spec.ts --project=chromium` (6 tests including setup dependencies) passed. Targeted activity/overview integration checks also passed (5 tests). Disposable migration/seed each succeeded twice. `git diff --check` passed. Tests covered different available balances sharing a total/rank, 1/1/3 ranking, zero/archived members, multiple influence lots, original saved costs, withdrawn/refunded/settled/void exclusions, cutoff-locked reservations, refunds preserving totals, and settlement consuming reserved influence. Browser checks assert both columns, separate amounts and shared ranks.
- Known issues or blockers: none.
- Integration order and follow-up work: contract and service, UI and fixtures, verification.
