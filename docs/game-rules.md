# Lunch Roller rules

This document specifies the intended MVP. Only pure calculations are shipped in the foundation; workflows appear in the backlog.

One workplace shares an administrator-managed roster and wheel. Participants pick a name and the browser remembers it, without accounts or passwords. Anyone can impersonate a roster member; this is an accepted workplace trust model. Name selection never authorizes administration.

## Daily draw

- Default schedule: Monday–Friday, 11:30, Europe/Dublin. Admin may change time, weekdays, and IANA timezone. ISO weekday numbers are 1=Monday through 7=Sunday.
- At most one result for a local calendar date. No manual rerolls. Schedule changes do not replace today's result.
- Each active option has a positive conceptual weight, stored as its natural logarithm. Seed weight is 1 (log 0). Odds are weight divided by the sum of active weights.
- Selection uses server cryptographic uniform randomness. Persist the random sample, pre-draw odds/weights/name snapshot, selected name, date, and timezone, then subtract ln(2) from the winner's log weight.
- Decay persists indefinitely. No resets or floors. Relative weights use max-subtracted exponentials for numerical stability; probabilities below floating-point resolution may display as zero.
- The worker checks every 30 seconds. A late tick processes today's due draw only. Never backfill missed dates. A weekend/non-scheduled day has no draw. No active places means no result; adding an option permits a retry that day.

## Tokens

- Initial balance is zero. Balance is the sum of immutable ledger entries.
- One self check-in earns 10 tokens for that day's result, from the draw until local midnight, using the timezone saved on the draw. Changing settings must not move an existing attendance deadline.
- Spend 5 to boost an active place by 1.25, or reduce it by 0.8. A purchase affects the next uncommitted draw, never an existing result.
- Spend 20 to add an active place immediately. Starting weight is the arithmetic mean of current active weights, calculated in log space; use 1 if the wheel is empty.
- No overdrafts. Repeated requests cannot double-charge or double-reward. Admin corrections append a signed delta with a reason, also without making the balance negative.
- Names are trimmed, 1–100 characters, and case-insensitively unique among active records. Blank/duplicate additions are rejected without charging. Archiving preserves history; reactivating a conflicting name is rejected.

## Notifications

Ask for Web Push permission only after a user clicks an opt-in control. Store subscriptions per browser/participant. Production needs HTTPS and VAPID configuration; support and delivery depend on the browser/device. Missing permission does not prevent play. Deliver the committed result; push failure never rerolls or reverses decay. Browser animation presents the committed winner.
