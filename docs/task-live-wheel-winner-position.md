# Task: Keep live odds on the wheel with today's winner under the arrow

- Owner / branch / worktree: coordinator / main / current worktree.
- Goal and current behavior: replace the frozen post-draw snapshot with live slice sizes, retaining today's winner under the pointer by recalculating the resting angle as odds change.
- Owned files or directories: `apps/web/app/page.tsx`, `apps/web/lib/wheel-colors.ts`, `tests/e2e/wheel-rollover.spec.ts`, `tests/e2e/game.spec.ts`, README, API/architecture/game rules docs, the previous task handoff and this task brief.
- Dependencies and contracts: existing today response, live odds and saved draw animation remain unchanged; no new dependencies.
- Explicit exclusions: no draw, randomness, economy, archival, API or schema changes. Saved animations and the winner dialog retain original snapshots.
- Acceptance criteria: live changes resize slices after a draw and after reload; today's active winner stays under the arrow; replay/dialog use the historical snapshot then restore live slices on dismissal; additions/removals update the wheel, including removal of the winner; next-day view uses the neutral angle.
- Checks and required fixtures: format, lint, typecheck, unit tests, build and affected wheel Playwright tests with a disposable TEST_DATABASE_URL.
- Migration/environment effects: none.

## Handoff

- Result and behavior changed: the resting wheel shows live slices, centred on today’s active winner. Odds updates and place additions/removals update the wheel; reload and replay dismissal retain this behavior. Saved animations and their modal still use immutable draw snapshots.
- Files touched / commit if available: listed above; no commit created.
- Checks executed and outcomes: `pnpm format:check`, `pnpm lint` (460 existing warnings), `pnpm typecheck`, `pnpm test` (71 tests), and `pnpm build` passed. All 49 browser scenarios passed across the full run (44 passes) and the targeted wheel-rollover/preferences/economy/login-throttle rerun (5 passes), using an explicitly disposable `TEST_DATABASE_URL`. Initial browser failures exposed an old saved-angle expectation and an overly strict CSS serialization tolerance; both assertions were corrected. The sandboxed build was interrupted after stalling; the production build succeeded outside the sandbox. Disposable database migrations and seed succeeded; the container was removed after verification.
- Known issues or blockers: none identified.
- Integration order and follow-up work: none.
