# Task: Move the draw countdown into the sidebar and show one phase at a time

- Owner / branch / worktree: Codex coordinator, current branch and worktree; no commit.
- Goal and current behavior: The countdown spans the full workspace and displays bet cutoff and spin timers together. Move it to the sidebar and show the bet cutoff until it closes, then show only the spin countdown.
- Owned files or directories: `apps/web/app/countdown-banner.tsx`, `apps/web/app/countdown-banner.css`, `tests/e2e/countdown.spec.ts`, `README.md`, and this task brief.
- Dependencies and contracts: Preserve the current `countdownState` calculation, saved betting-market cutoff, server-clock source, and wheel animation behavior. No shared contract or API changes.
- Explicit exclusions: Worker cadence, draw reveal timing, winner secrecy, countdown calculations, database schema, dependencies, deployment, commits, and pushes.
- Acceptance criteria: Desktop countdown is confined to the sidebar and does not take width from the wheel; before cutoff, only the betting cutoff countdown appears; at cutoff, it switches to the spin countdown; small screens keep the countdown above the wheel without horizontal overflow; E2E coverage asserts phase switching and sidebar placement.
- Checks and required fixtures: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and the countdown E2E test against an explicitly disposable database.
- Migration/environment effects: None.

## Handoff

- Result and behavior changed: The desktop countdown now occupies the sidebar above member controls; the wheel spans the remaining main workspace. It shows only the bet cutoff before cutoff and switches to the scheduled spin countdown afterward. Mobile retains the countdown above the wheel. The E2E test checks sidebar placement, single-phase visibility, cutoff switching, and mobile overflow.
- Files touched / commit if available: `apps/web/app/countdown-banner.tsx`, `apps/web/app/countdown-banner.css`, `tests/e2e/countdown.spec.ts`, `README.md`, and this brief. No commit.
- Checks executed and outcomes: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (68 tests), and the focused countdown Playwright test passed. E2E used a disposable local database; the database and temporary Playwright config were removed.
- Known issues or blockers: None.
- Integration order and follow-up work: None.
