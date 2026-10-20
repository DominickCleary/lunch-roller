# Lunch Roller rules

These rules are implemented by the local MVP. Optional notification delivery requires VAPID configuration and a supported browser; production HTTPS/device verification remains an environment check.

One workplace shares an administrator-managed roster and wheel. Participants pick a name and the browser remembers it, without accounts or passwords. Anyone can impersonate a roster member; this is an accepted workplace trust model. Name selection never authorizes administration.

A fresh workplace starts without people or places. An administrator must add at least one active person and place and finish setup before play or scheduled draws begin. Visitors must choose a name; a valid saved browser selection enters automatically and can be changed.

## Daily draw

- Default schedule: Monday–Friday, 11:30, Europe/Dublin. Admin may change time, weekdays, and IANA timezone. ISO weekday numbers are 1=Monday through 7=Sunday.
- At most one result for a local calendar date. No manual rerolls. Schedule changes do not replace today's result.
- Each active option has a positive conceptual weight, stored as its natural logarithm. Seed weight is 1 (log 0). Odds are weight divided by the sum of active weights.
- Selection uses server cryptographic uniform randomness. Persist the random sample, pre-draw odds/weights/name snapshot, selected name, date, and timezone, then subtract ln(2) from the winner's log weight.
- Decay persists indefinitely. No resets or floors. Relative weights use max-subtracted exponentials for numerical stability; probabilities below floating-point resolution may display as zero.
- The worker checks every 30 seconds. A late tick processes today's due draw only. Never backfill missed dates. A weekend/non-scheduled day has no draw. No active places means no result; adding an option permits a retry that day.
- At the admin-configured wheel switch time (default 15:00) in the configured timezone, the wheel moves from today's saved result to live odds for the next scheduled draw. For a weekday schedule, Friday afternoon previews Monday. Those proportions keep changing with purchases and additions until that draw commits. Midnight does not revert to the previous result. If today's scheduled draw is still pending (including a draw scheduled after the switch time), it remains the live target until committed. Today's result and check-in remain available; replay briefly uses its historical segments before returning to the upcoming wheel.

## Tokens

- Initial balance is zero. Balance is the sum of immutable ledger entries.
- One self check-in earns 10 tokens for that day's result, from the draw until local midnight, using the timezone saved on the draw. Changing settings must not move an existing attendance deadline.
- Check-in displays the admin-editable pledge (default “I pledge that I actually obeyed the wheel”). A confirmed check-in becomes grey and disabled for that person/draw, including after reload or in another tab. The pledge is an assertion shown to the participant; the server's one-reward attendance rule remains authoritative.
- Spend 5 to boost an active place by 1.25, or reduce it by 0.8. A purchase affects the next uncommitted draw, never an existing result.
- Spend 20 to add an active place immediately. Starting weight is the arithmetic mean of current active weights, calculated in log space; use 1 if the wheel is empty.
- No overdrafts. Repeated requests cannot double-charge or double-reward. Admin corrections append a signed delta with a reason, also without making the balance negative.
- Names are trimmed, 1–100 characters, and case-insensitively unique among active records. Blank/duplicate additions are rejected without charging. Archiving preserves history; reactivating a conflicting name is rejected.
- Admins may remove roster members. Unused profiles are permanently deleted; profiles referenced by attendance, ledger entries, added places or subscriptions are archived, with history retained and notifications retired.

## Notifications

Ask for Web Push permission only after a user clicks an opt-in control. Store subscriptions per browser/participant. Production needs HTTPS and VAPID configuration; support and delivery depend on the browser/device. Missing permission does not prevent play. Deliver the committed result; push failure never rerolls or reverses decay. Browser animation presents the committed winner.
