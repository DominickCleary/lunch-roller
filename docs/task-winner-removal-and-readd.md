# Task: Configurable winner removal and searchable restaurant restoration

- Owner / branch / worktree: coordinator in primary checkout; sub-agents on codex/zero-reduction, codex/place-readd, codex/removal-e2e in separate /tmp worktrees.
- Goal and current behavior: winners currently halve weight; add a configurable after-win factor whose zero value archives the winner. Existing paid name-based restoration gains archived-name search.
- Owned files or directories: coordinator owns contracts, schema, generated migration/metadata and docs; winner agent owns domain and database operations/tests; re-add agent owns sidebar, archived API adapter and restoration E2E; UI agent owns page, help and winner E2E.
- Dependencies and contracts: economy winnerMultiplier is finite 0–1, defaults 0.5; settings winner_multiplier matches. Zero archives after settlement, preserving history and refunding outstanding activity on undrawn markets. GET /places/archived uses existing placesResponse with selected active identity.
- Explicit exclusions: changing paid reduction behavior, dependencies, deployments, commits and pushes.
- Acceptance criteria: zero removes future eligibility and retains saved winner/bets/history; positive factor adjusts weights; settings persist; archived names can be searched and restored through existing paid operation with same record ID; browser failure and identity cases covered.
- Checks and required fixtures: format, lint, typecheck, unit tests, build; disposable PostgreSQL migrations/seed twice, integration suite and affected Playwright flows.
- Migration/environment effects: additive settings column and constraint; default preserves existing behavior. No new environment variables.

## Handoff

- Result and behavior changed: integrated and reviewed three agent lanes. Admin after-win factor 0 archives the winner after settlement; 0.5 preserves default halving and 1 retains weight. Archived-name lookup and keyboard-accessible search restore the existing record through the paid add flow, with saved health level.
- Files touched / commit if available: contracts, domain, DB operations/schema, migration 0017 and metadata, web page/sidebar/API/help, associated unit/integration/E2E tests and documentation. Primary branch main; agent branches listed above. No commits.
- Checks executed and outcomes: Node 24.20.0 / pinned pnpm 12.15.0. Format, lint (warnings), typecheck, unit suite (70 tests), web/worker production build passed. Migrations twice and seed twice passed on a fresh disposable PostgreSQL 17.6 Docker container. Browser first-run/fixtures passed; four affected Playwright flows passed (restoration, winner removal, Help, economy), including search failure/retry, keyboard selection, identity checks, duplicate-name failure, settings persistence and saved history. Full integration suite passed all 61 tests after the strengthened settlement/restoration assertions.
- Known issues or blockers: no implementation blockers. The initial sandboxed Next build stalled; the production build passed outside the sandbox. Intermediate browser assertions were corrected to use persisted odds rows rather than transient status text or ambiguous names.
- Integration order and follow-up work: schema/contracts, domain/database, UI/API integrated; browser verification complete. Apply pnpm db:migrate to an installation before starting the updated app. No new environment variables or dependencies.
