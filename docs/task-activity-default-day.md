# Task: Keep today's morning boosts visible when Activity opens

- Owner / branch / worktree: coordinator / main / D:\lunch-roller.
- Goal and current behavior: Activity opens on the next draw, hiding today's older purchases after the next draw date advances. Open on today's Calendar day instead; make Today and Next draw select the matching scope as well as date.
- Owned files or directories: this brief, `apps/web/app/daily-activity.tsx`, `tests/e2e/daily-activity.spec.ts`, `README.md`.
- Dependencies and contracts: existing activity and wallet APIs frozen; no database changes. The 9:06am `bfb8be3` purchase operation wrote unlinked boost/reduce ledger entries with database timestamps. The later draw-default UI can exclude these simply by selecting tomorrow.
- Explicit exclusions: database access or edits, historical backfills, inferred market links, commits, pushes, deployment and dependencies.
- Acceptance criteria: opening Activity after the wheel advances to tomorrow shows today's morning historical purchases and today's linked actions together. Next draw opens draw scope for the next date; Today restores all of today's token actions. Historical and draw views retain date separation and request cancellation.
- Checks and required fixtures: format, lint, typecheck, unit tests and production build; activity Playwright scenarios on a disposable database, including distinct today/next dates and legacy morning boosts.
- Migration/environment effects: none; dedicated disposable PostgreSQL container for browser fixtures only.

## Handoff

- Result and behavior changed: Activity now opens on today's Calendar day. Today and Next draw set both scope and date and clear stale person/restaurant filters. Existing draw view remains available explicitly.
- Files touched / commit if available: owned files above; no commit.
- Checks executed and outcomes: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (58 tests), `pnpm build`, and `pnpm exec playwright test daily-activity.spec.ts --project=chromium` (6 tests including setup dependencies) passed. Browser regression includes a morning purchase without a draw link, newer purchases linked to tomorrow, today's initial feed, and both shortcuts. `git diff --check` passed. Browser fixtures used a separate disposable database on port 5459 and server port 3059; no application database was mutated. No integration rerun required because API and database code were unchanged.
- Known issues or blockers: user's database is unavailable. Read-only HTTP comparison on the site documented in the repo found 17 boost/reduce entries in team wallets, all also present in activity for 21 October; the live wheel date was 22 October. This does not establish access to the user's database or confirm their exact records.
- Integration order and follow-up work: UI and browser regression together; no migration or deployment.
