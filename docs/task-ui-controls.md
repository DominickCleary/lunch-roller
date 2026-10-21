# Task: Simplify influence and place management UI

- Owner / branch / worktree: coordinator on main, primary checkout.
- Goal and current behavior: configurable spin duration; compact boost/reduce plus one whole-spot refund; readable approximate Odds; coloured health badges and inline creation selector; unified place/odds/weight administration.
- Owned files or directories: web page/components/styles/lib and tests; contracts and tests; DB schema/operations/migrations/metadata and integration tests; affected browser tests; README, API, architecture and game rules docs; this brief.
- Dependencies and contracts: preferences add wheelSpinSeconds (5–60, default 20); draws save nullable spinDurationMs (legacy null preserves prior deterministic timing). Signed own positions cancel/refund opposite units before buying, including legacy purchase requests. Atomic own-spot refund uses original lot costs/effects and existing cutoff/idempotency. Admin direct weight edits preserve logs, refund pending influence before overrides and retain snapshots. No dependencies.
- Explicit exclusions: no changes to selection/payouts, no refunds of committed influence or bets via spot control, no health bonus rule changes, no commits/pushes/deployments.
- Acceptance criteria: signed position component with two directional icons plus one accessible tooltip-labelled refund; green Healthy/red Treat; simple approximate fractional Odds with exact chance tooltip; inline health/add controls; one admin table for percentage/weight/health/name/status; duration persists and cannot change saved draws.
- Checks and required fixtures: repository format/lint/types/unit/build; migration and seed twice against disposable PostgreSQL; integration tests for refunds/direct weights/duration persistence; full browser suite and desktop/mobile visual review.
- Migration/environment effects: additive settings/draw duration columns, applied by normal Compose migration service.

## Handoff

- Result and behavior changed: implemented signed influence controls, opposite-unit cancellation/refunds (including legacy requests), whole-spot refund, approximate Odds, coloured health labels, inline creation controls, unified place/percentage/weight admin table, and per-draw saved spin duration.
- Files touched / commit if available: web page/API, influence/place components and styles, odds helper/tests; shared contracts/tests; DB schema/operations/migration 0009 plus metadata and integration tests; affected browser tests; README/API/architecture/game rules. Working diff on main, no commit.
- Checks executed and outcomes: format, lint, typecheck, 55 unit tests, 45 disposable PostgreSQL integration tests, production build, and all 28 browser scenarios passed. Migration/seed reruns passed. Desktop/mobile screenshots reviewed; mobile tooltip/form overflow corrected. A sandboxed build failed to bind a local socket; a clean generated-cache rebuild with expanded execution permissions passed.
- Known issues or blockers: none identified.
- Integration order and follow-up work: additive migration 0009 is required before the web/worker version starts; normal Compose migrate/seed dependencies handle this. No environment additions. Earlier opposing positions net/refund on their next pre-cutoff adjustment; locked historical positions retain their original effects. No outstanding follow-up work.
