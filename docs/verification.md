# Local milestone verification

Verified on 20 October 2026 with Node 24.19.0, pnpm 11.21.0, PostgreSQL 17.6, Chromium and Docker Desktop Linux containers. Three bounded Luna agents implemented the data, web and worker lanes in separate branches/worktrees, with coordinator-owned contracts, dependencies, migration generation and final integration. All five backlog milestones are implemented. No remote push or deployment was performed.

## Required checks

| Check                                    | Result                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                      | Passed                                                                                                                                                              |
| `pnpm lint`                              | Passed                                                                                                                                                              |
| `pnpm typecheck`                         | Passed across all packages/apps                                                                                                                                     |
| `pnpm test`                              | 28 tests passed                                                                                                                                                     |
| `pnpm build`                             | Next production Turbopack build and worker type build passed                                                                                                        |
| Fresh migration and seed, each run twice | Passed on a dedicated disposable PostgreSQL database                                                                                                                |
| `pnpm test:integration`                  | 24 tests passed; repeat run passed                                                                                                                                  |
| `pnpm test:e2e`                          | 9 Chromium scenarios passed against the real built app/database                                                                                                     |
| Compose configuration/build/startup      | Separate project on web 3018 / database 5450; DB, web and worker healthy                                                                                            |
| POSIX worker check                       | `node scripts/check-worker.mjs` passed inside Linux worker container                                                                                                |
| Worker restart                           | Graceful SIGTERM/stopped/start/heartbeat logs; same one daily draw ID and snapshot retained                                                                         |
| Backup/restore                           | Custom-format dump restored into a separate database; draw ID/snapshot and two ledger entries with net balance 5 matched; restored readiness and today reads passed |
| Visual inspection                        | Desktop 1440px and mobile 390px layouts inspected                                                                                                                   |

Integration tests use an explicitly supplied `TEST_DATABASE_URL`; application `.env` URLs are not used as fallback. Disposable test fixtures restore settings/weights and remove only their own records. Browser fixtures archive their records so referenced history survives. Run the integration seed-count tests on a fresh test database before browser tests.

## Behavior exercised

- The wheel-first redesign removes the marketing hero and rules strip, uses a large coloured wheel with radial labels and a side pointer, and keeps member/place controls in a compact sidebar. Desktop/mobile geometry and overflow are checked, with screenshots inspected. Centre and footer replay controls present the saved result without mutating the draw or wallet.
- Admin removal confirms before mutation, rejects unauthenticated/cross-origin requests, deletes unused profiles, archives referenced profiles, preserves history and retires pending notifications. A concurrent attendance/removal test verifies serialization. The development seed bootstraps only once; a regression verifies deleted/archived sample members do not return on restart.

- Settings-first transaction locking; concurrent duplicate workers create one draw/decay/outbox; injected outbox failure rolls all draw effects back.
- Cryptographic server selection, immutable historical snapshots after rename/archive, current next-draw odds, empty-wheel retries and no historical catch-up.
- Dublin spring/autumn DST, weekends, schedule/timezone changes, no reroll after edits, saved-timezone attendance deadlines, before-draw/after-midnight rejection, and real lock waits spanning midnight.
- Concurrent spending without overdrafts, same-key replay with exact original responses, changed-body/cross-route key conflicts, one attendance reward, blank/duplicate names without charges and reasoned append-only corrections.
- Trust-based name persistence and stale selection reset; independent admin authorization; cookie signature/expiry/logout, origin/schema rejection, password throttling and safe errors.
- Real admin create/rename/archive/schedule/correction forms, check-in and spending, ledger balance/history, cross-browser committed result, final pointer angle and reduced-motion behavior.
- Subscription ownership and retirement, unsupported notifications and permission denial after a user click, no automatic permission request, internal push endpoint rejection, 201/200 replay semantics, and core play after denial.
- Lease reclaim and stale completion protection, retry/gone handling, failed-completion recovery, terminal fifth attempts, and safe degradation with missing/invalid VAPID configuration.

Permission-denial tests intercept only public push configuration and the browser permission response; API mutations and database persistence remain real. Worker transport tests inject delivery outcomes; they do not contact push providers.

The installed Web Push library also passed a real VAPID signing/encryption test without network access. `node scripts/check-worker.mjs --push-config` passed in the Linux container with an ephemeral generated key pair, confirming configured-worker startup and shutdown. `pnpm db:generate` reported no outstanding schema changes after final migration review.

## Files and environment effects

Implementation changes cover `apps/web/app` and `apps/web/public` (API, UI, service worker), `apps/worker/src` (scheduler/delivery), `packages/db/src` (shared service/schema/integration tests), `packages/domain/src` (pure timezone evaluation), and `packages/contracts/src` (wire shapes and push validation). Root test/CI configuration, Compose, worker verification scripts, manifests/lockfile and documentation were updated. Agent-owned source commits were reviewed and integrated locally; no agent edited another lane concurrently.

Migration `packages/db/migrations/0001_mushy_anthem.sql` adds the ledger replay response JSON, active subscription flag and outbox lease UUID; generated metadata is committed with it. No destructive migration or history rewrite is required. The worker adds pinned `web-push` and its types; the DB package adds explicit workspace dependencies on contracts/domain. `WEB_PORT` is configurable; the worker receives VAPID settings in Compose. Integration/browser tooling now requires `TEST_DATABASE_URL`. Runtime secrets remain environment supplied; no secret files were added.

## Environment-dependent release checks

Real Web Push delivery still needs a matching VAPID key pair and testing on the final HTTPS origin with supported desktop/mobile devices. This run did not verify public HTTPS/proxy behavior, production credentials, production backups/retention, external alert delivery or Firefox/WebKit/mobile browser compatibility. These are release-environment checks, not claims of local verification. Follow [the operations runbook](operations.md). Hosting and deployment remain outside this local implementation.

The isolated demo stack is available at `http://localhost:3018`, with the development seed and `.env.example` development admin password. Its Compose project is `lunch-roller-verify`; the original local stack was left intact. Worktrees remain under `.worktrees` for review. Coordinator commits are on the existing `main` branch; agent branches use `codex/` prefixes. User-owned `.codex` and `.idea` changes were preserved and excluded from implementation commits.
