# Task: Restore compact lunch spot rows

- Owner / branch / worktree: coordinator, main, primary checkout.
- Goal and current behavior: match the compact old.png reference instead of the large new.png position cards; remove repeated staging/cutoff text.
- Owned files or directories: apps/web/app/influence-controls.tsx and .css; affected tests/e2e/influence.spec.ts and ui-controls.spec.ts; this brief.
- Dependencies and contracts: existing signed position, refund and cutoff behavior is frozen; no API, database or dependency changes.
- Explicit exclusions: do not alter financial rules or other admin/wheel controls; no commits, pushes or deployments; leave reference images intact.
- Acceptance criteria: short rows with names, health/team counts, odds and icon controls aligned; small signed position; brief native action titles without custom popovers; keyboard actions and mobile layout preserved.
- Checks and required fixtures: format/lint/types/unit/build; affected browser tests against disposable PostgreSQL; desktop and mobile visual review.
- Migration/environment effects: none beyond the prior working changes.

## Handoff

- Result and behavior changed: restored short rows with inline odds/directional/refund/ban icons, small signed position and compact health/team counts. Removed position card, Neutral/caption/hint text and repeated staged/editable/locked text; custom tooltips removed and native titles shortened to action/price, Refund tokens, or Locked.
- Files touched / commit if available: listed above, no commit.
- Checks executed and outcomes (compact layout before title simplification): pnpm format:check, lint, typecheck, test (55 passing), build, and test:e2e (28 passing). Browser assertions cover compact row height (at most 48px), absence of repeated messages, signed-position persistence/refunds, cutoff disabling, and mobile overflow. Desktop/light and mobile/dark screenshots reviewed.
- Known issues or blockers: none.
- Integration order and follow-up work: integrated and verified; no additional migration or environment changes, no outstanding work.

Native title follow-up: owned files remain the same. Removed custom tooltip DOM/CSS, shortened directional/refund/position titles, and retained accessible icon names. Verification passed: format, lint, typecheck, 55 unit tests, production build, and 4 affected browser/setup scenarios. No migration or environment changes.
