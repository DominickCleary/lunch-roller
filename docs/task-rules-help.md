# Task: Put game explanations in navbar Help

- Owner / branch / worktree: coordinator, main, primary checkout.
- Goal and current behavior: replace repeated rule paragraphs among member controls with a Help icon opening a current-rules modal.
- Owned files or directories: apps/web/app/rules-help.tsx and .css, page.tsx, token-transfer.tsx; tests/e2e/rules-help.spec.ts and smoke.spec.ts; README, this brief.
- Dependencies and contracts: public today snapshot supplies saved current economy, schedule, preferences and health rule; current betting window supplies its snapshotted cutoff. No contracts, dependencies or DB changes.
- Explicit exclusions: no financial, draw, admin, migration or deployment changes; retain status messages, transaction confirmations and input guidance necessary for an action.
- Acceptance criteria: navbar Help icon works before/after name selection; native accessible modal closes with button/Escape and restores focus; shows actual prices/multipliers/schedule/cutoff and explains signed influence, refunds, health, bets, transfers and daily activity; no static invented settings or duplicate member rule paragraphs; mobile/dark support.
- Checks and required fixtures: format/lint/types/unit/build; disposable PostgreSQL browser tests with changed settings, refresh and disabled health rule; desktop/mobile screenshots.
- Migration/environment effects: none.

## Handoff

- Result and behavior changed: navbar question-mark Help opens a native scrollable rules modal. Public settings refresh on open; actual prices, multipliers, schedule, spin/switch times, cutoff and health enablement drive the copy. Explains signed influence/refunds, final adds/bans, bets, transfers and activity. Member health/payout/transfer rule paragraphs moved out of controls; live statuses and confirmations retained.
- Files touched / commit if available: listed above, no commit.
- Checks executed and outcomes: pnpm format:check, lint, typecheck, test (55 passing), build and test:e2e (29 passing). Changed-setting tests verify values refresh, disabled health bonus, native focus/Escape/button close, 390px dark modal and 320px layout. Desktop/mobile screenshots reviewed. Corrected the smoke test to select the actual Admin link rather than matching hidden rule paragraphs.
- Known issues or blockers: none.
- Integration order and follow-up work: integrated and verified; no new dependencies or migrations. No commits, pushes or deployments.
