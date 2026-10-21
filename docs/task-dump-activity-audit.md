# Task: Audit missing activity against the supplied database dump

- Owner / branch / worktree: coordinator / main / D:\lunch-roller.
- Goal and current behavior: verify actual morning purchases in the user-supplied dump against wallet, calendar activity and draw activity before concluding the prior UI changes resolve the issue.
- Owned files or directories: this brief, `.gitignore` (exclude database dumps); further code edits require a concrete finding and an updated assignment here.
- Dependencies and contracts: existing read-only GameService APIs; no contract changes planned. Restore into a separate local PostgreSQL container on port 5460.
- Explicit exclusions: production access, source dump edits, running test suites or game mutations against the restored user data, migrations, commits, pushes or deployments.
- Acceptance criteria: compare ledger IDs across wallet and activity for each recorded action date and linked draw date; identify missing entries and separate UI date/position behavior from database/query loss.
- Checks and required fixtures: restore verification and read-only SQL/service comparisons using the supplied dump. Code changes, if needed, require disposable synthetic regression tests and normal repository checks.
- Migration/environment effects: isolated local restored database only; source dump retained and excluded from Git.

## Handoff

- Result and behavior changed: restored the supplied dump into an isolated local container and audited using a SELECT-only role. All 17 influence purchases (12 boosts / 60 tokens, 5 reductions / 25 tokens, 9 people) match wallet and activity IDs, amounts, targets and timestamps for 21 October. All are unlinked historical purchases. The next draw is 22 October, whose activity contains 2 bet events and no influence purchases. Current pending UI changes open today's Calendar day and display all 17 in the rendered screen. No additional activity-query fix was needed for this dump. Added `*.dump` to `.gitignore`.
- Files touched / commit if available: `.gitignore` and this brief; no commit.
- Checks executed and outcomes: `pg_restore --no-owner --no-privileges --exit-on-error` succeeded on PostgreSQL 17. Read-only SQL inspected activity counts and attribution. `pnpm exec tsx test-results/audit-restored-activity.ts` passed exact wallet/activity comparisons for both dates and scopes (no missing or different purchases). `pnpm exec tsx test-results/audit-restored-activity-browser.ts` passed against the current production build and restored data: Calendar day defaults to 21 October; 50 events include 12 boosts and 5 reductions; summaries show 60 / 25 tokens; Next draw has 2 events; Today restores every purchase. Browser blocked mutation requests and market-maintenance GETs; identity selection was fulfilled locally from the read-only roster response. Initial audit-role syntax was corrected before successful service reads; the initial browser attempt blocked identity selection, then passed after adding the local identity response. Audit scripts/screenshots are temporary ignored `test-results` artifacts. Formatting and diff checks passed. Normal checks for the pending UI change were already completed in `task-activity-default-day.md`; no production code changed in this audit.
- Known issues or blockers: no lost boost/reduce rows found in the supplied dump. Historical purchases have no influence lots and correctly do not appear as editable positions. Changes remain local and undeployed.
- Integration order and follow-up work: inspect evidence before any additional behavior changes.
