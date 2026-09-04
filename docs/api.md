# API

Every request except `GET /health` and the two sign-in routes needs
`Authorization: Bearer <token>`.

The token identifies an athlete: it is matched by its sha256 against
`users.token_hash` or `sessions_tokens.token_hash`, and everything the request
touches is scoped to the row it resolves to. There is no refresh, no expiry and
no password — see [tenancy.md](tenancy.md).

Two things issue a token. `users.token_hash` is one per person, provisioned by
whoever runs the server; `sessions_tokens` is one per device, minted by signing
in with Apple. Both resolve to the same kind of row, and nothing downstream
knows which was used.

## Signing in

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/apple/nonce` | — | `{nonce}`. Unauthenticated, rate limited to 20/hour per address. Single-use, expires after 10 minutes. |
| POST | `/auth/apple` | `{identityToken, nonce, name?, timezone?, locale?, device?}` | `{token, user, isNew, onboarded}`. Unauthenticated. |
| POST | `/auth/signout` | — | `{signedOut}`. Revokes the calling device's token and no other. |
| GET | `/account` | — | `{user, kind, isAdmin, appleLinked}` where kind is `apple` or `root`. |
| POST | `/account/apple` | `{identityToken, nonce}` | `{linked, email}`. Attaches an Apple ID to the account already signed in. |
| DELETE | `/account/apple` | — | `{linked: false}`. Refused when Apple is the only way in. |
| DELETE | `/account` | — | `{deleted}`. Cascades to every owned row. 400 on a `root` account. |

The identity token is verified against Apple's JWKS in
`server/src/auth/appleIdentity.ts`: RS256 only, issuer `appleid.apple.com`,
audience equal to `APPLE_BUNDLE_ID`, expiry with a five-minute skew, and the
nonce claim matched against the one this server issued. The nonce is what stops
a captured token being replayed, which is why it cannot come from the app.

Accounts key on Apple's `sub`. The email arrives only on the very first
authorisation and may be a private relay address that changes, so keying on it
would hand somebody a new account every time they signed in.

**An account that predates Apple sign-in has to be linked before it can use
it.** Without a matching `apple_sub`, signing in with Apple creates a second,
empty account and leaves the history on the first — so `POST /account/apple`
attaches the Apple ID to the account already signed in, verified to exactly the
same standard as signing in, because it hands over a permanent way in. The
token that account already holds keeps working; linking adds a door rather than
replacing one. Linking a `sub` that belongs to somebody else is a 409, as is
swapping an existing link for a different Apple ID without unlinking first.

Deletion is refused on a `root` account: that token was provisioned by the
operator rather than by a sign-in, and is theirs to withdraw.

**Signing in is not being let in.** An account created by Apple sign-in starts
pending, and every route except `/auth/signout` and `/account` answers
`403 {code: "pending_approval"}` until an admin approves it. `/auth/apple`
returns `approved` so the app can show a waiting screen rather than an app that
fails on every tab. An account provisioned by `npm run user:create` is approved
on the spot — running the command is the approval.

## Admin

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/admin` | — | The panel, as HTML. Unauthenticated: it is a shell with no data in it. |
| POST | `/admin/pair` | — | `{id, code}`. Unauthenticated, rate limited to 20/hour. Starts a browser pairing. |
| GET | `/admin/pair/:id` | — | `{pending}` or `{token}`. Unauthenticated — the id is the secret. Collected once. |
| POST | `/admin/pair/claim` | `{code}` | `{claimed}`. Admin only: this is the phone vouching for the browser. |
| GET | `/admin/data` | — | Everything the panel draws, in one request. |
| POST | `/admin/users/:id/approval` | `{approved}` | `{athletes}`. Revoking also deletes that athlete's device tokens. |
| POST | `/admin/users/:id/budget` | `{budget}` | `{athletes}`. Daily token ceiling; `0` is no ceiling. |

Everything but the page requires `users.is_admin`, and answers **404** to
anybody else — there is no reason to confirm to a signed-in athlete that the
panel exists.

The panel signs in by pairing rather than by a typed token, because Apple's web
flow needs a Services ID and a verified domain that this deployment does not
have. The browser shows a code; a phone that is already signed in with Apple,
and is an admin, claims it. The code alone is useless — claiming needs an
admin's token — and the `id` the browser holds is 32 random bytes that are worth
exactly one collection.

`is_admin` is set in the database and by no route, so the panel cannot grant
itself access:

```sql
update users set is_admin = true where id = 2;
```

Spend is priced in `server/src/domain/pricing.ts` from the model recorded on
each `llm_usage` row. Rates are per million tokens and overridable per model —
`GEMINI_PRICE_GEMINI_3_6_FLASH=0.3/2.5`. Tokens spent on a model with no rate
are reported as unpriced rather than counted as free, because a dashboard
reading `$0.00` looks exactly like not having spent anything.

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

`kind` is one of `zone2`, `intervals`, `sport`, `walk`, `other`. A session
counts towards the weekly target when it is not a walk and runs at least 20
minutes — the minutes of a walk are still recorded, they just do not tick a box.

Substitutes are filtered by what the active place has. A context whose
`equipment.available` lists what is there — `["dumbbell", "bodyweight"]` for a
hotel room — only gets substitutes it can actually do; one that says nothing
gets them all, because nobody inventories a commercial gym.

A **programme** is an ordered list of days that rotates — full body A/B/C,
upper/lower U1/L1/U2/L2, push/pull/legs. A day's `code` is what
`sessions.template` stores, so it is history as much as configuration; `dayName`
is what to show. How often the rotation cycles is how often the athlete trains,
which is a separate question and lives on the profile.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/today` | — | everything the Today screen needs, one round trip. `since` is the first day with anything logged, so the strip offers only weeks there is something to see in. |
| GET | `/week` | `ending=YYYY-MM-DD`, optional | the seven-day window ending on that day; today when absent |
| GET | `/exercises` | — | `{exercises}` with substitute ids and equipment |
| GET | `/programs` | — | `{programs, current}` — the catalogue and the one he is on |
| POST | `/programs/choose` | `{programId}` | `{current}`. History keeps its day codes; the rotation restarts. |
| GET | `/workouts/next` | `?template=<day code>` | prescriptions; defaults to the next in rotation |
| GET | `/exercises/:id/prescription` | `?excludeSessionId&sets` | one movement's load, from its own history |
| GET | `/records` | — | `{records}`. All-time bests per movement: heaviest set, and best by estimated max. Finished sessions only. |
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
| POST | `/vitals/sync` | `{days?, workouts?, weights?}` | `{result}` — see [health.md](health.md). Idempotent. |
| GET | `/vitals` | — | `{signals}` — steps, sleep, resting heart rate and its trend |
| GET | `/measurements` | `?days=180` | `{measurements}` newest first |
| POST | `/measurements` | `{measuredOn?, waistCm?, hipCm?, chestCm?, armCm?, thighCm?, notes?}` | `{measurement}` — 201. One row per day; fields merge. |
| DELETE | `/measurements/:date` | — | `{deleted}` |
| GET | `/deload` | — | `{deload}` — where he is in the block |
| PATCH | `/deload` | `{everyWeeks}` | `{deload}`. 0 turns scheduled light weeks off. |
| GET | `/cardio` | `?days=14` | `{sessions}` newest first |
| POST | `/cardio` | `{kind, minutes, description?, distanceKm?, avgHr?, rpe?, performedAt?}` | `{session}` — 201 |
| DELETE | `/cardio/:id` | — | `{deleted}` |
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
| POST | `/fridge/plan` | `{items:[…confirmed], confirmed: true}` | `{plan, inventory}` against what is *left* of today. Stores the confirmed list (§9 step 4) before planning from it. |

The stored list is what the trainer's `generate_meal_plan` tool reads, so a
plan asked for in chat comes from a fridge somebody actually confirmed. It goes
stale after four days and the tool then refuses rather than cooking from food
that has been eaten.

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

## Limits

Two, both per athlete, both returning 429.

* **240 requests a minute.** Generous on purpose: a phone draining a sync queue
  after a basement gym makes a burst of legitimate calls, and the limit must not
  turn that into lost sets. `/health` is exempt.
* **40 model calls an hour**, counted separately so a chat loop cannot lock
  somebody out of logging a set.

There is also a **daily token budget** per athlete, checked before each model
call rather than after — after is a bill. `GET /usage` reports the day's calls,
tokens and what is left. A budget of `0` means no ceiling.

The buckets are in memory: one box, one process. When there is a second, that
is the file that has to change.

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
