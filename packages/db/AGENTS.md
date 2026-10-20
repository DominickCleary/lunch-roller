# Database lane

Schema, migrations, shared transactional operations, and persistence tests live here. Coordinator owns migration generation, metadata, and dependency changes; obtain explicit file assignment before parallel edits.

- Use PostgreSQL constraints as the final guard for uniqueness. Active names are trimmed and case-insensitively unique.
- Future mutations lock settings row 1 first; check idempotency and balance inside the same transaction as writes. Balance is SUM(ledger.delta), initially zero.
- Draws persist pre-decay snapshots; never reconstruct historical odds from live places. Corrections append ledger rows.
- Migrations are forward-only after integration. Generate with Drizzle, inspect SQL, and include metadata. Seed is development-only and repeat-safe.
- Run migration twice and seed twice against a fresh disposable PostgreSQL database, then `pnpm test:integration`. Never run these against shared or production data.
