# Working on Lunch Roller

Read `README.md`, `docs/architecture.md`, `docs/game-rules.md`, and the instructions in your assigned package before changing code. This is a scaffold, not a playable MVP. Keep future behavior clearly distinguished from shipped behavior.

## Coordination

- The coordinator owns shared contracts, dependency decisions, the lockfile, migrations, cross-package changes, and final integration.
- Agree contracts before dispatching dependent implementation. Agents may propose contract changes but must obtain coordinator assignment before editing shared contracts, migrations, root tooling, or the lockfile concurrently.
- Use separate branches and worktrees for simultaneous agents. Never switch another agent's branch or overwrite its work. The coordinator integrates changes in dependency order and resolves conflicts.
- Independent lanes are web UI/API, domain/database, worker/notifications, and test/verification. A task must name its owned files; lane membership alone does not grant ownership of shared files.
- Do not add infrastructure or dependencies without a concrete need. Domain stays pure; API and worker call shared server-side operations instead of implementing competing rules.
- Run required checks for your changes. Never claim an unrun or failed check passed. No automatic commits, pushes, deployments, or secret files.

## Task brief

Use `docs/task-template.md`. Specify goal, owned files, dependencies and frozen contracts, acceptance criteria, checks, and explicit exclusions. If work requires an unowned file, coordinate before editing it.

## Handoff

Report behavior changed, files touched, commands and results, unresolved issues, and migration/environment effects. Include branch and commit when available. Coordinator reviews the diff, integrates dependencies first, then runs `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`; run database/browser/container checks for affected behavior.

## Invariants

- Server owns draws, odds, and token balances. Name selection is deliberately trust-based and never grants admin rights.
- Only server-side cryptographic randomness chooses a winner; animation cannot select or reroll it.
- One draw per local date, one attendance reward per person/draw, append-only token ledger.
- Future game mutations lock the singleton settings row in a transaction before reading mutable game state. Keep lock acquisition order consistent.
- Store logarithmic weights. No arbitrary weight floor, automatic resets, or historical catch-up draws.
- Preserve draw snapshots and ledger history. Archive participants/places instead of deleting referenced records.

## Commands

Use Node 24 and pinned pnpm. `pnpm db:generate` is coordinator-owned. Review generated SQL and commit migrations plus metadata together. Tests must use a disposable database, never a production URL. CI definitions are in `.github/workflows/ci.yaml`.
