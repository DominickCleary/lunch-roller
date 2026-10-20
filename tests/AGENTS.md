# Verification lane

Own assigned tests and fixtures, not production interfaces or migrations without coordination. Browser tests run against a built web server and migrated/seeded disposable PostgreSQL. Do not mock away persistence when checking transactions or uniqueness.

Check outcomes, not private implementation details. Record test commands and results; distinguish skipped/environment-blocked checks from passing ones. Required future concurrency, scheduling, and push scenarios are listed in `docs/backlog.md`.
