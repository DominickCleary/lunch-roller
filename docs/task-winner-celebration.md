# Task: Celebrate the completed draw and hold replay until dismissal

- Owner / branch / worktree: coordinator, main, primary checkout.
- Goal and current behavior: show a winner modal and confetti after live/replayed spins; preserve the historical wheel and landing until dismissal rather than immediately restoring upcoming odds.
- Owned files or directories: web use-wheel-animation hook, winner-celebration component/CSS, page integration, wheel animation/rollover/game browser tests and affected push/economy selectors, README, architecture and game rules notes, this brief.
- Dependencies and contracts: existing committed draw, deterministic animation, and token APIs frozen; use native dialog, CSS confetti, no new dependencies.
- Explicit exclusions: no server selection, money, schema, migration, or dependency changes; no commits/pushes/deployments.
- Acceptance criteria: modal names the saved winner after completion; full-screen confetti respects reduced motion; keyboard/Escape/close dismisses; replay snapshot and landing remain until dismissal even with polling/switch time; close restores latest baseline; existing saved results do not celebrate on every refresh.
- Checks and required fixtures: format/lint/types/unit/build, full browser suite using disposable PostgreSQL, focused normal/reduced motion and snapshot retention assertions, visual review.
- Migration/environment effects: none.

## Handoff

- Result and behavior changed: completed live/replayed spins show a centered native winner dialog and brief full-screen CSS confetti. The saved wheel snapshot/landing persists until button or Escape dismissal, then restores the latest baseline. Reduced motion suppresses confetti; completed historical page loads do not automatically celebrate.
- Files touched / commit if available: as above, no commit.
- Checks executed and outcomes: format/lint/types, 55 unit tests and production build passed. All 28 browser scenarios passed; the final centering CSS fix passed an additional focused rollover test with desktop/mobile center, focus, confetti CSS, held snapshot during polling, and Escape/button assertions. Screenshots reviewed at both sizes, plus a real-time confetti capture. Earlier failures from modal dismissal expectations and obsolete tooltip selectors were repaired.
- Known issues or blockers: none.
- Integration order and follow-up work: integrated and verified. No new dependencies, schema changes or environment settings. No outstanding work.
