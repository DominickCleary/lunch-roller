# Task: Explain the restaurant check-in leader in the sidebar

- Owner / branch / worktree: coordinator, main, primary checkout.
- Goal and current behavior: replace the unexplained outline on the restaurant with the most historical check-ins with a clearly labelled, deliberately spaced Overgoated award.
- Owned files or directories: apps/web/app/restaurant-sidebar.tsx, apps/web/app/globals.css, apps/web/app/influence-controls.css, apps/web/app/restaurant-sidebar.stories.tsx, tests/e2e/ui-controls.spec.ts, and this brief.
- Dependencies and contracts: existing today.restaurantCheckIns holds attendance totals across all draws. API, rules and counting semantics stay frozen.
- Explicit exclusions: database/schema changes, new dependencies, game logic, commits, pushes or deployments.
- Acceptance criteria: the exact Overgoated label requested by the user, a visible check-in count and all-time leader explanation, and a clear joint-leader note; no unexplained row outline; aligned row controls and award with long names/large counts at desktop and phone widths in both themes; zero check-ins show no award.
- Checks and required fixtures: affected Playwright tests against disposable PostgreSQL with explicit historical attendance fixtures; format:check, lint, typecheck, test and build; desktop/mobile screenshots.
- Migration/environment effects: none; temporary isolated database for verification.

## Handoff

- Result and behavior changed: replaced the unexplained full-row outline with a brass trophy award labelled Overgoated, as requested. The award sits below the controls, aligned with the restaurant name, and includes the formatted check-in total plus all-time leader or joint all-time leader text. Zero totals produce no award. Existing historical totals and odds ordering are unchanged.
- Files touched / commit if available: listed above; main at 9a44304, no commit created.
- Checks executed and outcomes: Node 24 and pinned pnpm; format:check, lint (non-blocking warnings), typecheck, 72 unit tests and web/worker build passed. The local E2E runner passed all 55 browser scenarios against a fresh disposable PostgreSQL database. New coverage verifies real historical attendance counts and persistence, tied leaders, no award at zero, and control/award alignment at 1440, 390 and 320px in light/dark themes. Supplemental large-total display fixtures and long restaurant names were checked in browser screenshots. Storybook includes joint leaders, long names/large counts and no-check-in examples. git diff --check passed.
- Known issues or blockers: none.
- Integration order and follow-up work: implementation and verification complete; temporary database containers were removed by the E2E runner. No application migration or environment changes.
