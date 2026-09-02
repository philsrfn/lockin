# API

Every request except `GET /health` needs `Authorization: Bearer <token>`.

The token identifies an athlete: it is matched by its sha256 against
`users.token_hash`, and everything the request touches is scoped to the row it
resolves to. There is no session handling and no signup flow — see
[tenancy.md](tenancy.md).

Routes are thin wrappers over `server/src/services/`. The offline sync queue and
the LLM tool handlers call the same service functions — there is never a second
code path to a table.

## Athlete and settings

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/health` | — | `{ok, db}`. Unauthenticated. 503 if Postgres is unreachable. |
| GET | `/profile` | — | `{profile}` including `timezone` |
| PATCH | `/profile` | `{timezone?, locale?}` | `{profile}`. Rejects a zone the runtime does not know; `locale: null` follows the device. |
| POST | `/onboarding` | see below | `{profile, explanation}`. Computes the targets; idempotent. |
| GET | `/contexts` | — | `{contexts}` |
| POST | `/contexts/:id/activate` | — | `{contexts}` — exclusive, in one statement |
| POST | `/contexts` | `{name, equipment?, foodProfile?}` | `{contexts}` — 201. Inactive until switched to. |
| PATCH | `/contexts/:id` | any of the above | `{contexts}`. The jsonb blobs merge rather than replace. |
| DELETE | `/contexts/:id` | — | `{contexts}`. Archives — sessions keep the place they were performed in. |
| GET | `/rules` | — | `{rules}` |
| POST | `/rules` | `{tier, text, scope?}` | `{rule, enforceable, rules}` — 201 |
| PATCH | `/rules/:id` | `{tier?, text?, scope?, active?}` | `{rules}`. A code-enforced rule's tier cannot change. |

The timezone decides what "today" means everywhere: the week strip, the macros,
which day a session is filed under, and when the 07:30 check-in fires. The
locale decides what language the interface *and the trainer* speak.

`POST /onboarding` takes `{sex, birthYear, heightCm, weightKg, goal,
goalWeightKg?, trainingDaysPerWeek, activity?, weeklyRateKg?, timezone?,
locale?, name?}` and returns the computed profile plus an `explanation`
carrying maintenance, the rate actually used, and anything the §7 floors moved
— in words the athlete can read. Targets are never sent in: they are computed
from the body, in code (§1).

## Training

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/today` | — | everything the Today screen needs, one round trip |
| GET | `/week` | — | the seven-day strip the home screen is built on |
| GET | `/exercises` | — | `{exercises}` with substitute ids |
| GET | `/workouts/next` | `?template=A\|B\|C` | prescriptions; defaults to the next in rotation |
| GET | `/exercises/:id/prescription` | `?excludeSessionId&sets` | one movement's load, from its own history |
| GET | `/progress` | `?days=90` | volume, set count, best set per exercise per day (Epley) |
| GET | `/sessions` | `?limit=20` | `{sessions}` newest first, sets included |
| GET | `/sessions/open` | — | `{session}` — the one in progress, or null |
| GET | `/sessions/:id` | — | `{session}` |
| POST | `/sessions` | `{template, performedAt?, contextId?}` | `{session}` — 201 |
| PATCH | `/sessions/:id` | `{rpe?, notes?, jointPain?}` | `{session}` — this is "finish" |
| POST | `/sets` | `{sessionId, exerciseId, setIndex, weightKg, reps, rir?}` | `{setId, session}` — 201 |
| DELETE | `/sets/:id` | — | `{session}` |
| GET | `/bodyweight` | `?days=30` | latest, 7-day average, week change, series |
| POST | `/bodyweight` | `{weightKg, measuredOn?}` | `{entry, summary}` — 201 |
| POST | `/sync` | `{ops:[…]}` | `{results:[…]}` — see [offline-sync.md](offline-sync.md) |

## Food

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/meals` | — | `{meals}` — today's, in his timezone |
| POST | `/meals` | `{slot, description, kcal?, proteinG?, fatG?, carbsG?, foodId?, eatenAt?}` | `{meal, consumed}` — 201 |
| POST | `/meals/from-food` | `{foodId, slot?}` | `{meal, consumed}` — 201. One tap on a quick-add tile. |
| DELETE | `/meals/:id` | — | `{consumed}` |
| GET | `/foods` | — | `{foods}` — quick-add first, then most recently used |
| POST | `/foods` | `{name, kcal, proteinG, fatG?, carbsG?, quickAdd?, defaultSlot?}` | `{food}` — 201. Upserts on the name. |
| PATCH | `/foods/:id` | any of the above | `{food}` |
| DELETE | `/foods/:id` | — | `{foods}`. Archives — logged meals keep their history. |
| GET | `/foods/barcode` | `?barcode=` | `{candidate}`. His library first, then OpenFoodFacts. Nothing is written. |
| POST | `/foods/scanned` | `{barcode, name, kcal, proteinG, …}` | `{food}` — 201 |
| POST | `/foods/estimate` | `{text}` | `{estimate}`. A candidate to confirm, not a log entry. |
| POST | `/fridge/read` | `{imageBase64, mimeType}` | `{items}`. Vision candidates; the photo is dropped. |
| POST | `/fridge/plan` | `{items:[…confirmed]}` | `{plan}` against what is *left* of today |

## The trainer

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/chat` | `?limit=50` | `{messages}` |
| POST | `/chat` | `{text}` | `{text, ranTools, usage}` |
| POST | `/coach/today` | `{force?}` | `{coach}` — today's note, generated at most once |
| GET | `/review` | — | `{review}` — the latest weekly review |
| POST | `/review/generate` | — | `{review}` |

## Notifications and jobs

| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/push/register` | `{token, platform?}` | `{registered}` — 201 |
| POST | `/push/test` | — | `{result}`. Proves the round trip without waiting for 07:30. |
| GET | `/jobs` | — | `{runs}` — this athlete's recent job runs |
| POST | `/jobs/:job/run` | — | `{result}`. Re-runs a job today, for testing. |

Pushes are addressed, never broadcast: a notification goes only to the devices
registered by the athlete the token resolves to.

## Writes return state

Per §6, every write returns the resulting state rather than an acknowledgement.
`POST /sets` hands back the whole session, so the caller's next decision is made
against ground truth instead of an assumption that the write landed.

## Idempotency

`POST /sets` upserts on `(session_id, exercise_id, set_index)`. Re-posting the
same set corrects it; it never creates a second row. That covers both a replayed
offline write and a fat-fingered correction.

`POST /sync` additionally dedupes on a client-generated uuid per op, scoped to
the athlete — two phones colliding on one uuid do not read each other's stored
results.

## Errors

```json
{ "error": "No session 42", "requestId": "9f2c41a8bd0e77c3" }
```

Validation failures add `details`, one entry per bad field:

```json
{ "error": "Invalid request",
  "requestId": "9f2c41a8bd0e77c3",
  "details": [{ "path": "setIndex", "message": "Number must be greater than or equal to 1" }] }
```

400 validation · 401 bad or missing token · 404 unknown id · 500 bug.
Nothing beyond the status code is returned for a 500; the detail goes to the
log, keyed by that `requestId`. The same id comes back in an `x-request-id`
header on every response, and an `x-request-id` sent by the client is adopted
when it is plain text, so a trace can span the phone and the server.

An id belonging to another athlete returns **404, not 403**. The caller cannot
learn whether it exists, and it is not theirs either way.
