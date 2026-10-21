# Task: Use consistent dates across activity room data

- Owner / branch / worktree: coordinator, main workspace.
- Goal and current behavior: audit draw attribution versus action timestamps; remove the Today bet-date substitution and prevent multi-day chart folding.
- Owned files or directories: activity UI/API, shared activity query contract/tests, DB operations and date integration tests, daily-activity and health-transfers Playwright tests, theme browser fixture (dismiss a live winner modal when checking unrelated forms), README, docs/api.md and this brief.
- Dependencies and contracts: optional scope=day|draw query, day remains API default. Draw scope attributes only linked bet/influence ledger rows to their market date. No schema changes.
- Explicit exclusions: no changes to cutoff, 3pm wheel display, draw selection, balances, weights or settlement rules; no migrations, commits or deployment.
- Acceptance criteria: draw charts/positions/bets/health bonuses share selected date; calendar ledger uses workplace action date; Today never aliases next draw; timeline preserves actual timestamps across midnight/weekends/DST; open quotes remain live, settled odds remain saved.
- Checks and required fixtures: disposable PostgreSQL integration across Friday/Monday, DST, midnight, undo/refund, locked/settled states; affected browser tests and required format/lint/typecheck/unit/build checks.
- Migration/environment effects: none; legacy unlinked purchases remain in Calendar day, no inferred draw attribution.

## Handoff

- Result and behavior changed: Activity room defaults to Draw activity for the upcoming betting draw. Its purchases/refunds, charts, net positions, bets and health bonuses use the selected draw date. Calendar day retains action-date ledger history; its board also uses the selected date. Removed the previous Today/upcoming-board substitution. Timeline charts use chronological timestamps across multiple days instead of folding into local hours; feed timestamps include date and zone. Bet reservation, cancellation and payout ledger timestamps now use the same operation instant as the saved bet/draw.
- Files touched / commit if available: above; no commit.
- Checks executed and outcomes: format:check, lint, typecheck, test (56 passed), build and test:integration (50 passed) passed. Full browser suite passed all 30 tests after updating transfer-history selection and making the unrelated theme test dismiss a live result dialog. Desktop/mobile screenshots reviewed. Date regression exercises Friday after 3pm to Monday, UTC/workplace midnight differences, the Dublin DST transition, refunds, reopened bets, cutoff locking, committed positions and final snapshot odds. No production database was accessed.
- Known issues or blockers: none.
- Integration order and follow-up work: complete; no migration or deployment. Supersedes the earlier Today/upcoming-board behavior documented in task-current-bet-board.md. Unlinked legacy purchases remain visible only in Calendar day because their target draw cannot be inferred safely.
