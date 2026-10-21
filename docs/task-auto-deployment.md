# Task: Deploy passing main pushes through a server-local Actions runner

- Owner / branch / worktree: coordinator on the current branch in the primary checkout; no parallel agents.
- Goal and current behavior: CI verifies pushes but does not deploy. Add a deployment job for passing pushes to `main` using a runner installed as `webserver` on the user's local-network server.
- Owned files or directories: `.github/workflows/ci.yaml`, `scripts/deploy.sh`, `scripts/deploy.test.mjs`, `README.md`, `docs/operations.md`, this task brief.
- Dependencies and contracts: existing Compose services/migration ordering and existing verify/container checks. No dependencies. Default production checkout `/home/webserver/lunch-roller`, overridable with repository variable `DEPLOY_PATH`. Runner label `lunch-roller-deploy`; repository variable `DEPLOY_ENABLED=true` enables deployment after one-time runner setup.
- Explicit exclusions: no runner installation on the inaccessible server, no production commands, secret files, commits, pushes or deployment during this task. Existing application/browser failures are not bypassed.
- Acceptance criteria: only successful main pushes can reach the server; PR CI stays on GitHub-hosted runners; one deployment at a time; deploy exact verified SHA; preserve `.env`/database volume; refuse dirty/diverged server checkouts; skip older queued releases; use Compose's migration/health sequence; document user setup and disable procedure.
- Checks and required fixtures: shell syntax, real temporary Git repos with fake Docker for deployment tests, workflow structure and repository format/lint/type/unit/build checks. No real Docker/database is required for deployment script tests.
- Migration/environment effects: none to application schema. Server needs Git, Bash, flock and working Docker Compose under `webserver`; runner lives outside the production checkout.

## Handoff

- Result and behavior changed: passing pushes to `main` can deploy through the labelled server runner once explicitly enabled. The script transfers the exact verified commit locally, preserves server configuration, serializes deployments, refuses unsafe checkout states and waits for Compose health.
- Files touched / commit if available: `.github/workflows/ci.yaml`, `scripts/deploy.sh`, `scripts/deploy.test.mjs`, `README.md`, `docs/operations.md`, this task brief. Working diff on `main`; no commit.
- Checks executed and outcomes: nine deployment scenarios passed using temporary Git repositories and fake Docker; `bash -n scripts/deploy.sh`, workflow YAML/gate assertions, `docker compose config --quiet`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (45 tests), `pnpm build` and `git diff --check` passed. No live server deployment or full browser/container run was performed for this change.
- Known issues or blockers: one-time runner registration and repository variables must be configured by the user. Existing browser expectations currently prevent CI success and consequently block deployment as intended.
- Integration order and follow-up work: script, test harness, gated CI job, setup documentation; user registers/starts runner and enables deployment.
