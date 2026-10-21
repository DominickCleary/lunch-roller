# Task: Keep header and wheel visible while using sidebar controls

- Owner / branch / worktree: coordinator, main workspace.
- Goal and current behavior: page scrolling moves the header and wheel out of view. Pin header and wheel, bound desktop sidebar scrolling and use a compact pinned wheel on mobile.
- Owned files or directories: apps/web/app/globals.css, apps/web/app/page.tsx, tests/e2e/sticky-workspace.spec.ts, this brief.
- Dependencies and contracts: presentation only; activity content remains normally scrollable and native modal behavior is preserved.
- Explicit exclusions: no game, API, schema, animation, dependency or migration changes.
- Acceptance criteria: header stays visible; desktop sidebar scrolls without moving wheel; mobile wheel remains visible with usable controls; activity and admin content can be reached; no horizontal overflow.
- Checks and required fixtures: format, lint, typecheck, unit, build and meaningful browser scrolling checks with disposable PostgreSQL.
- Migration/environment effects: none.

## Handoff

- Result and behavior changed: opaque sticky header in both themes; desktop sidebar has viewport-bounded independent scrolling while wheel stays visible. Mobile uses a compact sticky wheel and document scrolling with focus/anchor offsets. Activity content scrolls normally. Admin/footer layers remain accessible above pinned game content; sidebar itself is not sticky, allowing native scrolling back from admin to its controls.
- Files touched / commit if available: above; no commit.
- Checks executed and outcomes: format:check, lint, typecheck, unit tests (56 passed), production build and full browser suite (32 passed). New browser checks verify actual wheel/scroll positions, sidebar end access, header placement while navigating to admin, mobile wheel visibility, history controls, activity navigation and horizontal overflow. Desktop/mobile screenshots reviewed. git diff --check passed. Browser tests used disposable PostgreSQL.
- Known issues or blockers: none.
- Integration order and follow-up work: complete; no migration or deployment.
