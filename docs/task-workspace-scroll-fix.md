# Task: Correct workspace scrolling and remove sticky header

- Owner / branch / worktree: coordinator in main; layout, browser and review agents in isolated codex worktrees.
- Goal and current behavior: footer/document scrolling competes with sidebar scrolling and the scrollbar crowds controls. Header should no longer stick.
- Owned files or directories: layout agent owns apps/web/app/globals.css; browser agent owns tests/e2e/sticky-workspace.spec.ts; review agent reads only; coordinator owns integration, responsive smoke-test settling, animation test route teardown, and this brief. Coordinate before changing other files.
- Dependencies and frozen contracts: CSS/UI only. Desktop game with admin closed fits viewport with header/footer/admin summary outside two independently scrolling workspace columns. Admin open remains accessible in document flow. Mobile retains one normal page scroll and compact pinned wheel, with a nonsticky header. Reserve real scrollbar gutter and content padding. No game/API changes.
- Explicit exclusions: no dependencies, schema, migrations, commits, pushes or deployment; preserve existing user changes and setup screens.
- Acceptance criteria: desktop sidebar scroll and repeated edge wheel events cannot shift footer/wheel/document; scrollbar never overlaps right-hand controls; header is static; mobile controls and admin/activity remain reachable with no horizontal overflow.
- Checks and required fixtures: required format/lint/typecheck/unit/build and desktop/mobile browser scroll/control checks against disposable PostgreSQL. Review screenshots and integration diff.
- Migration/environment effects: none.

## Handoff

- Result and behavior changed: completed. The normal desktop game uses a viewport-height grid with separate header, workspace, admin summary and footer rows. Sidebar/activity columns scroll independently with contained overscroll; footer and wheel stay stationary. Stable scrollbar gutters and end padding protect controls. Header is static. Admin-open layout restores natural document scrolling; mobile retains normal document scroll and its compact wheel at top zero. Coordinator fixed mobile overflow selector specificity and reduced unused wheel space after integration review.
- Files touched / commit if available: above; no commit.
- Checks executed and outcomes: format:check, lint, typecheck, unit tests (56 passed), production build and complete browser suite (33 passed) all pass. New tests cover footer/document/wheel stability at sidebar scroll edges, control clearance, keyboard focus, activity scrolling, admin-to-sidebar navigation and mobile access. Responsive smoke check waits for container-query layout to settle; animation routes are cleaned up before page teardown. Reviewed desktop/mobile screenshots and read-only agent review. Tests used disposable PostgreSQL only. git diff --check passed.
- Known issues or blockers: none.
- Integration order and follow-up work: integrated assigned CSS and tests from separate codex worktrees, reviewed the combined result, corrected integration findings and verified. Temporary worktrees/branches cleaned up; no commits, migrations or deployment. Supersedes the sticky-header behavior in task-sticky-workspace.md.
