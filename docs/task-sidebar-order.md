# Task: Move sidebar activity to the bottom

- Owner / branch / worktree: coordinator, main workspace.
- Goal and current behavior: move token and bet history below the lunch spots, keeping actions above activity.
- Owned files or directories: apps/web/app/page.tsx, this brief.
- Dependencies and contracts: existing components and state; presentation order only.
- Explicit exclusions: no rule, API, data, styling, migration or dependency changes.
- Acceptance criteria: sidebar order is member actions, betting controls, lunch spots, then activity/history. Lunch spot is immediately above the bottom activity panel on desktop and mobile.
- Checks and required fixtures: format, lint, typecheck, unit, build; affected browser scenarios with disposable PostgreSQL.
- Migration/environment effects: none.

## Handoff

- Result and behavior changed: sidebar now shows member actions, betting controls, lunch spots, then the bottom activity panel (recent token activity, personal bets, team activity and recent bet history). Lunch spot sits immediately above activity. Existing controls/state are preserved.
- Files touched / commit if available: above; no commit.
- Checks executed and outcomes: format:check, lint, typecheck, unit tests (56 passed), production build and affected browser scenarios (8 passed including setup/fixtures). Reviewed desktop screenshot and browser mobile checks. git diff --check passed. Browser tests used disposable PostgreSQL.
- Known issues or blockers: none.
- Integration order and follow-up work: complete; no migration or deployment.
