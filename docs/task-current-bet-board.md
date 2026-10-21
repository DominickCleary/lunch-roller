# Task: Show upcoming bets on today's activity board

- Owner / branch / worktree: coordinator, main workspace.
- Goal and current behavior: today's calendar-date activity hides open bets belonging to the upcoming draw after today's result. Load the upcoming draw's bets independently of today's ledger activity.
- Owned files or directories: apps/web/app/daily-activity.tsx, tests/e2e/daily-activity.spec.ts, this brief.
- Dependencies and contracts: existing read-only activity API; no contract, database or mutation changes.
- Explicit exclusions: no betting, settlement, balance, schedule or schema changes.
- Acceptance criteria: today's ledger/charts stay on today, board shows the current betting draw with an explicit date; historical dates show historical bets; refresh and stale request protections retained.
- Checks and required fixtures: format, lint, typecheck, unit tests, build and affected Playwright tests against a disposable database.
- Migration/environment effects: none.

## Handoff

- Result and behavior changed: today's activity keeps its calendar-day ledger/charts and loads the current betting draw's board separately when its date differs. The board and bet count label show that draw date. Other selected activity dates retain their own bets. Requests share abort, retry, polling and stale response protection.
- Files touched / commit if available: above; no commit.
- Checks executed and outcomes: format:check, lint, typecheck, test (55 passed), build and affected Playwright tests (5 passed, including setup/fixtures) all passed. Browser regression covers tomorrow's open bet alongside today's activity, historical selection, returning to Today, retries and delayed responses. Tests used a fresh disposable PostgreSQL database. git diff --check passed.
- Known issues or blockers: none.
- Integration order and follow-up work: complete; no migration or deployment.
