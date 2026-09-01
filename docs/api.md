# API

Every request except `GET /health` needs `Authorization: Bearer $APP_BEARER_TOKEN`.
One user, one token, no session handling.

Routes are thin wrappers over `server/src/services/`. The offline sync queue
calls the same service functions, and so will the Phase 2 tool handlers —
there is never a second code path to a table.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/health` | — | `{ok, db}`. Unauthenticated. 503 if Postgres is unreachable. |
| GET | `/profile` | — | `{profile}` |
| GET | `/contexts` | — | `{contexts}` |
| POST | `/contexts/:id/activate` | — | `{contexts}` — exclusive, in one statement |
| GET | `/exercises` | — | `{exercises}` with substitute ids |
| GET | `/today` | — | everything the Today screen needs, one round trip |
| GET | `/workouts/next` | `?template=A\|B\|C` | prescriptions; defaults to the next in rotation |
| GET | `/sessions` | `?limit=20` | `{sessions}` newest first, sets included |
| GET | `/sessions/open` | — | `{session}` — the one in progress, or null |
| GET | `/sessions/:id` | — | `{session}` |
| POST | `/sessions` | `{template, performedAt?, contextId?}` | `{session}` — 201 |
| PATCH | `/sessions/:id` | `{rpe?, notes?, jointPain?}` | `{session}` — this is "finish" |
| POST | `/sets` | `{sessionId, exerciseId, setIndex, weightKg, reps, rir?}` | `{setId, session}` — 201 |
| DELETE | `/sets/:id` | — | `{session}` |
| GET | `/bodyweight` | `?days=30` | latest, 7-day average, week change, series |
| POST | `/bodyweight` | `{weightKg, measuredOn?}` | `{entry, summary}` — 201 |
| POST | `/sync` | `{ops:[…]}` | `{results:[…]}` |

## Writes return state

Per §6, every write returns the resulting state rather than an acknowledgement.
`POST /sets` hands back the whole session, so the caller's next decision is made
against ground truth instead of an assumption that the write landed.

## Idempotency

`POST /sets` upserts on `(session_id, exercise_id, set_index)`. Re-posting the
same set corrects it; it never creates a second row. That covers both a replayed
offline write and a fat-fingered correction.

`POST /sync` additionally dedupes on a client-generated uuid per op — see
[offline-sync.md](offline-sync.md).

## Errors

```json
{ "error": "No session 42" }
```

Validation failures add `details`, one entry per bad field:

```json
{ "error": "Invalid request",
  "details": [{ "path": "setIndex", "message": "Number must be greater than or equal to 1" }] }
```

400 validation · 401 bad or missing token · 404 unknown id · 500 bug.
Nothing beyond the status code is returned for a 500; the detail goes to the log.
