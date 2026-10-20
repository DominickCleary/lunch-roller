# API contracts

Base: `/api/v1`. Zod schemas in `@lunch/contracts` are the source of wire shapes. IDs are UUID strings; timestamps are ISO UTC strings; dates are `YYYY-MM-DD`. JSON errors use `{ error: { code, message } }`. All endpoints below are implemented. Responses are not cached.

## Implemented

`GET /health` → `healthResponse`: `{ status: 'ok' | 'unavailable', database: 'ok' | 'unavailable', service: 'web' }`. HTTP 200 when initialized and reachable, otherwise 503. No credentials/details and no caching.

## Game and administration endpoints

GET `/setup` returns `{ completed, participantCount, placeCount }`. POST `/admin/setup/complete` requires the existing administrator session and matching Origin, requires at least one active person/place, and completes first-run setup atomically. It returns the same status shape with 200; incomplete configuration is 409 `SETUP_INCOMPLETE`. Until completion, public/member game endpoints return 403 `SETUP_REQUIRED`; administrator configuration, setup status, health and push configuration remain available. Runtime initialization creates no sample people or places. Existing populated installations are marked complete by migration.

| Method / path                  | Request schema       | Response                                                   | Access                                         |
| ------------------------------ | -------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| GET /participants              | —                    | `{ participants: participant[] }` (active only)            | Public                                         |
| POST /identity/select          | participantSelection | participant                                                | Public; validates selection, browser stores ID |
| GET /today                     | —                    | todayResponse                                              | Public                                         |
| GET /push-config               | —                    | `{ publicKey: string or null }`                            | Public; only configured public VAPID key       |
| GET /wallet                    | —                    | walletResponse                                             | Participant                                    |
| POST /attendance               | attendanceRequest    | attendanceResponse                                         | Participant                                    |
| POST /purchases                | purchaseRequest      | purchaseResponse                                           | Participant                                    |
| POST /places                   | createPlace          | purchaseResponse (20-token charge)                         | Participant                                    |
| POST /push-subscriptions       | pushSubscription     | `{ id: UUID }`                                             | Participant                                    |
| DELETE /push-subscriptions/:id | —                    | 204, empty body                                            | Owning participant                             |
| POST /admin/session            | adminLogin           | 204 + session cookie                                       | Password                                       |
| DELETE /admin/session          | —                    | 204 + expired cookie                                       | Admin                                          |
| GET /admin/participants        | —                    | `{ participants: participant[] }` (including inactive)     | Admin                                          |
| POST /admin/participants       | createParticipant    | participant                                                | Admin                                          |
| PATCH /admin/participants/:id  | updateParticipant    | participant                                                | Admin                                          |
| DELETE /admin/participants/:id | —                    | `{ participantId: UUID, action: 'deleted' or 'archived' }` | Admin                                          |
| GET /admin/places              | —                    | `{ places: place[] }` (including inactive)                 | Admin                                          |
| POST /admin/places             | createPlace          | place, mean weight, no charge                              | Admin                                          |
| PATCH /admin/places/:id        | updatePlace          | place                                                      | Admin                                          |
| GET /admin/schedule            | —                    | schedule                                                   | Admin                                          |
| PUT /admin/schedule            | schedule             | schedule                                                   | Admin                                          |
| POST /admin/token-corrections  | tokenCorrection      | walletResponse                                             | Admin                                          |

Participant calls use `X-Participant-Id`; no member authentication is claimed. Admin calls use a separate server-verified cookie. Do not implement admin authorization through the name picker.

Participant removal returns 200 and removes the person from the active roster. Profiles with no attendance, ledger, added-place or subscription references are permanently deleted. Referenced profiles are archived instead, preserving history and retiring subscriptions/pending jobs. Unknown IDs return 404. Repeated removal of an archived profile returns the same archived outcome. Reactivation remains an explicit admin PATCH operation.

Attendance, purchases, member place creation, and corrections require `Idempotency-Key` (UUID). Member ledger keys are scoped to the affected participant. Store a hash of method, route, and canonical validated body. Same key and body returns the recorded effect without repeating writes; changed body returns 409. Attendance has a second deduplication boundary on participant/draw; a fresh key must not award again.

Use 201 for newly created resources and 200 for reads/actions/replays; deletes and session changes use 204. Use 400 for invalid schemas, 401 for missing identity/session, 403 for inactive identity or failed origin check, 404 for unknown resources, 409 for duplicate names, idempotency mismatch, already-claimed attendance, insufficient balance, or closed attendance window, and 503 for unavailable persistence. Application-specific codes make errors distinguishable.

`todayResponse.odds` always describes the current wheel for the next uncommitted draw. `result` is today's committed historical choice or null. Empty-wheel and unscheduled states are explicit. Never expose a mutation that accepts a client-selected winner.

`todayResponse.wheel` is `{ mode: 'result' | 'upcoming', localDate: 'YYYY-MM-DD' }`, computed on the server using the configured schedule timezone. Before 15:00, a saved result uses `result` mode and today's date. From 15:00, it switches to `upcoming` and the next scheduled date strictly after today (Friday to Monday for a weekday schedule). With no today result, it shows live odds for the earliest scheduled date on/after today, retaining today's pending draw even if delayed past 15:00. Upcoming odds remain live until the draw commits; 15:00 creates no snapshot or game mutation. Polling refreshes the presentation every 30 seconds. Replays temporarily show the saved snapshot and then restore the baseline presentation.

Draw results include the saved `timezone` and `snapshot` entries (`placeId`, `name`, `logWeight`, `probability`) from before decay. The UI animates these committed segments while showing current odds and spending controls separately. Wallet responses include `balance` and newest-first `ledger` entries (`id`, `delta`, `kind`, nullable `reason`, UTC `createdAt`).

All state changes require an Origin header exactly matching `APP_ORIGIN`, including identity selection and login. Admin login allows eight attempts per fifteen-minute window in a bounded process-local limiter, returns 429 when limited, and clears attempts after successful authentication. Use one web instance or add a shared edge limiter before scaling. Session lifetime is eight hours; missing/short session secrets fail closed.

Push subscriptions validate browser service hosts (Google, Mozilla, Apple, Windows), HTTPS without custom ports/credentials, and browser key shapes. Deleting a subscription deactivates it and its pending jobs while preserving referenced history. Reusing an endpoint with a new participant or keys retires stale pending jobs.
