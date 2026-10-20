# Task: View other people's token activity

- Owner / branch / worktree: coordinator implements in current checkout; Luna reviewer is read-only with no concurrent edits.
- Goal/current behavior: only own wallet is shown. Add a compact Team token activity disclosure, active-roster picker excluding self, authoritative balance/history with signed amounts, reasons and timestamps, Show all and clear loading/empty/error/retry states.
- Owned files: apps/web/app/team-activity.tsx, page.tsx integration, globals.css, tests/e2e/team-activity.spec.ts and documentation. Reviewer owns no files.
- Frozen interface/dependencies: reuse existing GET /api/v1/wallet with viewed participant's header. Existing intentional trust-based identity permits any active roster wallet read. No API/contract/DB/schema/dependency changes. Viewing never writes selected identity/localStorage, invokes identity selection, or routes mutations through the viewed ID.
- Acceptance/checks: open-only 30-second polling, stale/aborted responses cannot show another person's wallet, identity/actions remain own, archived/unavailable people show an error or disappear from roster, readable light/dark mobile view. Test real unique disposable ledger fixtures, view balance/history, own identity preserved and no mutations, empty/error/retry and rapid selection/close. Run required static/unit/build and browser checks.
- Exclusions: no admin controls, token mutations, identity changes, archived history browser, commits, push/deploy or secret files.
- Migration/environment effects: none.

## Handoff

Coordinator reviews read-only boundaries and records verification. Reviewer provides findings without editing.
