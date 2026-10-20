# Worker lane

Own worker entrypoint, scheduling adapters, and delivery logic when assigned. Coordinate shared DB operations/contracts before implementation.

- Current worker is health-only. Keep logs explicit until scheduling actually exists.
- Poll every 30 seconds without overlapping ticks. Respect graceful SIGINT/SIGTERM shutdown and bound database/network calls.
- Future draws and outbox inserts commit atomically through the DB operation. Duplicate workers must not duplicate draws, rewards, or outbox records.
- Use local dates in configured IANA timezone; catch up today only. Empty wheels remain retryable. Never reroll after a notification failure.
- Future outbox claims use leases and bounded retries; remove expired subscriptions on 404/410. Never log subscription keys or credentials.
- Verify typecheck, affected integration tests, and `node scripts/check-worker.mjs` on a POSIX host with a seeded database.
