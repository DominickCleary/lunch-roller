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
- One self check-in earns the configured participation reward (default 10 tokens) for that day's result, from the draw until local midnight, using the timezone saved on the draw. Changing settings must not move an existing attendance deadline.
- Check-in displays the admin-editable pledge (default “I pledge that I actually obeyed the wheel”). A confirmed check-in becomes grey and disabled for that person/draw, including after reload or in another tab. The pledge is an assertion shown to the participant; the server's one-reward attendance rule remains authoritative.
- Spend the configured boost/reduce price (default 5 each) to multiply an active place's relative weight by the configured factor (defaults 1.25 and 0.8). A purchase affects the next uncommitted draw, never an existing result.
- Spend the configured new-place price (default 20) to add an active place immediately. Starting weight is the arithmetic mean of current active weights, calculated in log space, multiplied by the admin-configured new-place factor (default 1); use 1 as the average when the wheel is empty. Re-adding a restaurant name that was removed restores its archived record, resets it to this starting weight, and charges the same add-place price.
- Spend the configured remove-place price (default 40) to remove an active restaurant from the wheel. The purchase is recorded in the token ledger; the restaurant and historical references are archived, not deleted. It can be added again at its configured starting weight.
- Admin can edit these eight values under Tokens and odds, including the removal price and new-place factor. Token values must be positive whole numbers; boost factors are greater than 1 up to 100 and reduce factors range from 0.01 to below 1; the new-place factor ranges from 0.01 to 100. Settings apply to future actions; historical ledger entries and idempotent retries retain their original amounts and effects. Winner decay remains one half after each draw.
- Admin can set an exact participant token balance with a required reason. The server appends the difference to that person's ledger; prior entries are never rewritten. Admin can equalize a selected subset by setting each selected restaurant to the overall average `1/N` chance; unselected restaurants scale proportionally to fill the remainder. Admin can also set all restaurants equal or edit one restaurant's percentage, scaling the rest proportionally. The distribution remains 100%, becomes the stored relative weights for future draws and does not change saved results. Participants can toggle the odds list between chance percentages and fair decimal odds (`1/chance`); these theoretical odds are not a payout.
- No overdrafts. Repeated requests cannot double-charge or double-reward. Admin corrections append a signed delta with a reason, also without making the balance negative.
- Names are trimmed, 1–100 characters, and case-insensitively unique among active records. Blank or already-active restaurant additions are rejected without charging. Removing a restaurant archives it and preserves history; adding that name later restores the same record with its configured starting weight.
- Admins may remove roster members. Unused profiles are permanently deleted; profiles referenced by attendance, ledger entries, added places or subscriptions are archived, with history retained and notifications retired.

## Notifications

Ask for Web Push permission only after a user clicks an opt-in control. Store subscriptions per browser/participant. Production needs HTTPS and VAPID configuration; support and delivery depend on the browser/device. Missing permission does not prevent play. Deliver the committed result; push failure never rerolls or reverses decay. Browser animation presents the committed winner.
