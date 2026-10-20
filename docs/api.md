# API contracts

Base: `/api/v1`. Zod schemas in `@lunch/contracts` are the source of wire shapes. IDs are UUID strings; timestamps are ISO UTC strings; dates are `YYYY-MM-DD`. JSON errors use `{ error: { code, message } }`. **Only health is implemented.**

## Implemented

`GET /health` → `healthResponse`: `{ status: 'ok' | 'unavailable', database: 'ok' | 'unavailable', service: 'web' }`. HTTP 200 when initialized and reachable, otherwise 503. No credentials/details and no caching.

## Planned endpoints

| Method / path                  | Request schema       | Response                                               | Access                                         |
| ------------------------------ | -------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| GET /participants              | —                    | `{ participants: participant[] }` (active only)        | Public                                         |
| POST /identity/select          | participantSelection | participant                                            | Public; validates selection, browser stores ID |
| GET /today                     | —                    | todayResponse                                          | Public                                         |
| GET /wallet                    | —                    | walletResponse                                         | Participant                                    |
| POST /attendance               | attendanceRequest    | attendanceResponse                                     | Participant                                    |
| POST /purchases                | purchaseRequest      | purchaseResponse                                       | Participant                                    |
| POST /places                   | createPlace          | purchaseResponse (20-token charge)                     | Participant                                    |
| POST /push-subscriptions       | pushSubscription     | `{ id: UUID }`                                         | Participant                                    |
| DELETE /push-subscriptions/:id | —                    | 204, empty body                                        | Owning participant                             |
| POST /admin/session            | adminLogin           | 204 + session cookie                                   | Password                                       |
| DELETE /admin/session          | —                    | 204 + expired cookie                                   | Admin                                          |
| GET /admin/participants        | —                    | `{ participants: participant[] }` (including inactive) | Admin                                          |
| POST /admin/participants       | createParticipant    | participant                                            | Admin                                          |
| PATCH /admin/participants/:id  | updateParticipant    | participant                                            | Admin                                          |
| GET /admin/places              | —                    | `{ places: place[] }` (including inactive)             | Admin                                          |
| POST /admin/places             | createPlace          | place, mean weight, no charge                          | Admin                                          |
| PATCH /admin/places/:id        | updatePlace          | place                                                  | Admin                                          |
| GET /admin/schedule            | —                    | schedule                                               | Admin                                          |
| PUT /admin/schedule            | schedule             | schedule                                               | Admin                                          |
| POST /admin/token-corrections  | tokenCorrection      | walletResponse                                         | Admin                                          |

Participant calls use `X-Participant-Id`; no member authentication is claimed. Admin calls use a separate server-verified cookie. Do not implement admin authorization through the name picker.

Attendance, purchases, member place creation, and corrections require `Idempotency-Key` (UUID). Member ledger keys are scoped to the affected participant. Store a hash of method, route, and canonical validated body. Same key and body returns the recorded effect without repeating writes; changed body returns 409. Attendance has a second deduplication boundary on participant/draw; a fresh key must not award again.

Use 201 for newly created resources and 200 for reads/actions/replays; deletes and session changes use 204. Use 400 for invalid schemas, 401 for missing identity/session, 403 for inactive identity or failed origin check, 404 for unknown resources, 409 for duplicate names, idempotency mismatch, already-claimed attendance, insufficient balance, or closed attendance window, and 503 for unavailable persistence. Application-specific codes make errors distinguishable.

`todayResponse.odds` always describes the current wheel for the next uncommitted draw. `result` is today's committed historical choice or null. Empty-wheel and unscheduled states are explicit. Never expose a mutation that accepts a client-selected winner.
