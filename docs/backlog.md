# Implementation backlog

All five milestones below are implemented in the local MVP. The table records their scope and dependency order. Local verification results and remaining environment checks are recorded in `docs/verification.md`; production hosting is not provisioned. Freeze contract changes with the coordinator before parallel tasks begin.

| Milestone                           | Work and acceptance                                                                                                                                                                                                         | Agent lanes / dependencies                                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1. Shared data and identity         | Implement shared transaction wrapper, participant selection/persistence, wallet reads, admin password sessions, roster/place/schedule management. Active records only for members; admin access independent of name picker. | Coordinator freezes contracts/migrations; DB operations and web identity/admin can proceed in separate worktrees after agreement. |
| 2. Daily draws                      | Implement due-date evaluator, cryptographic sampling, atomic snapshot/decay/outbox operation, worker ticks, today endpoint. Exactly one draw per local date with duplicate workers; restart catches up today only.          | Domain/date logic first; DB draw operation then worker and web adapters.                                                          |
| 3. Attendance and economy           | Atomic self check-in, ledger reward, purchases, mean-weight additions, admin corrections, replay handling and balance display. No duplicate rewards, overdrafts, or partial purchases.                                      | DB/domain operations first; web consumes agreed contracts.                                                                        |
| 4. Wheel UI and admin polish        | Render proportional segments and odds, animate committed result, attendance/purchase controls, token history, responsive admin flows. Keyboard access and reduced motion; no client-selected winner.                        | Web lane after result/economy APIs; verification lane owns assigned browser tests.                                                |
| 5. Push and deployment verification | User-triggered opt-in, service worker, VAPID subscription lifecycle, leased/retried outbox delivery, stale subscription cleanup, HTTPS deployment runbook and monitoring.                                                   | Worker and web subscription work in parallel after contract freeze; coordinator verifies integration.                             |

## Required integration and browser scenarios

- Concurrent worker ticks create one result, one decay, and one outbox row per subscription. Failed transaction leaves none of these effects.
- Concurrent purchases cannot overdraw; duplicate request keys charge once; mismatched replay returns conflict. Duplicate/blank place names leave balance unchanged. Attendance replay with the same or different keys cannot double-award.
- Admin correction writes a reasoned ledger entry, preserves history, and cannot overdraw. Archived people/places cannot participate; historical draws stay readable after names change.
- Dublin DST boundaries, weekend skips, time/weekday/timezone edits, repeated local times, a missed local time, and today's overdue draw after restart. No historical catch-up, no reroll after settings edits. Empty-wheel retries succeed after a place is added.
- Check-in before draw and after local midnight is rejected. Attendance deadlines use the draw's saved timezone.
- Browser picker survives reload; stale identity resets; impersonation cannot access admin routes. Origin rejection, admin session expiry/logout, password throttling, and API schema errors are exercised.
- Permission denial and unsupported Push API preserve core play. Retryable push failures do not reroll; expired subscriptions retire; worker crashes release leases; terminal jobs remain observable.
- Wheel animation ends on the committed result across reloads, slow responses, reduced motion, and multiple browsers. Persisted state agrees across participants.
- At 15:00 workplace local time the baseline wheel switches to the next scheduled draw's live odds, preserving today's saved result/check-in and using saved segments only during replay. Check the cutoff, weekends, DST, midnight continuity, live boosts, and return from replay with reduced motion. Pending late draws must remain the current target.

## Release gate

Coordinator integrates by dependency order, runs all checks on a fresh disposable database, reviews generated SQL and environment changes, then tests container health, worker restart, browser flows, backup/restore, and HTTPS push on supported devices. Production hosting is outside this task; real HTTPS/device push delivery remains a deployment environment check.
