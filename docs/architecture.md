# The map

How the pieces fit, and how to add to them. [CLAUDE.md](../CLAUDE.md) is the
spec; this is the "where does my change go" document.

---

## The shape of a request

```
phone
  │  POST /sets   Authorization: Bearer <token>
  ▼
routes/index.ts          thin. Parses with zod, calls one service, returns.
  │
  │  ← auth.ts resolved the token to a users row and built request.ctx
  │    { userId, db }. Every route reaches data through it; there is no
  │    service call that does not take one.
  ▼
services/sets.ts         the only write path to `sets`. Takes a Ctx.
  │
  ├─→ domain/progression.ts    pure. No db, no clock, no io. Tested.
  ▼
Postgres
```

The same service is called from a second direction:

```
Gemini decides to call log_set
  ▼
llm/tools.ts             the declaration Gemini sees
  ▼
llm/handlers.ts          validates, then calls …
  ▼
services/sets.ts         … the same function the route calls
```

That is rule 2 of [CONTRIBUTING.md](../CONTRIBUTING.md): one write path per
table. The trainer and the API cannot disagree about what happened, because
there is only one thing that happens.

### The layers, and what each may do

| Layer | May | May not |
|---|---|---|
| `domain/` | arithmetic, pure logic | touch the db, read the clock, do io |
| `services/` | SQL, call domain, call other services | know about HTTP |
| `routes/` | parse, authorise, call one service | contain logic |
| `llm/` | assemble context, call the model, dispatch tools | write to a table directly |
| `jobs/` | schedule, call services, send push | compute a number |

If a function in `services/` is getting long and arithmetical, the arithmetic
wants to be in `domain/` with a test.

### Time

There is no `current_date` anywhere, and the tenancy test fails the build if
you add one. "Today" belongs to the athlete, not the server — they have their
own timezone in `profile`. Use `services/clock.ts`.

### Money

Every model call goes through `llm/metered.ts`, which writes tokens and cost
into `llm_usage`. That table is what the admin panel bills against, and what
the per-athlete daily budget is checked against before a call is made. A model
call that bypasses `metered.ts` is invisible and free-looking, which it is not.

---

## The app

expo-router: a file under `app/app/` is a route.

```
app/app/(tabs)/index.tsx     Today — the default tab
app/app/(tabs)/chat.tsx      the trainer
app/app/(tabs)/food.tsx
app/app/(tabs)/weight.tsx
app/app/workout.tsx          the logger — pushed, not a tab
app/app/account.tsx          settings, profile, Apple ID, Health, admin pairing
app/app/rules.tsx  fridge.tsx  progress.tsx
```

State is React state and `app/src/api/hooks.ts`. There is no Redux, no Zustand,
no query library. The app is small enough that a hook per screen is clearer
than a store, and it has stayed that way on purpose.

**Local SQLite is the source of truth mid-workout** (`app/src/db/local.ts`). A
set is written there before the network is touched, and `app/src/sync/queue.ts`
drains it to the backend with idempotency keys the server records in
`sync_log`. Never block a set on the network — the gym wifi is bad and the
athlete is between sets. How it behaves and how it fails is in
[offline-sync.md](offline-sync.md).

**The API client is the only thing that calls `fetch`** (`app/src/api/client.ts`).
It handles the base URL, the keychain token, refusals (403 pending approval,
401 revoked) and errors. A relative fetch is answered by Metro's dev manifest
with a 200 and cached as valid data; that bug cost a day and is why this rule
exists.

---

## Recipes

### Add a number the app shows

1. A pure function in `server/src/domain/`, with tests. No db, no clock.
2. A service that reads the rows and calls it.
3. A field on the response of an existing route — prefer widening `/today`
   over adding a round trip. The Today screen is one request on purpose.
4. The app: type in `app/src/api/types.ts`, render it.

### Add a thing the trainer can do

1. **The service first.** If the trainer can do it, a person should be able to
   do it too, and both go through the same function.
2. The HTTP route.
3. The declaration in `server/src/llm/tools.ts` — name, description, and a
   parameter schema. The description is what Gemini reads to decide whether to
   call it; write it for a reader who has no other context.
4. The handler in `server/src/llm/handlers.ts`. Validate, call the service,
   **return the resulting state** — the model's next turn must see ground truth
   rather than assuming the call worked.
5. If it changes a target or a load, it goes through `domain/safety.ts` and the
   refusal is relayed honestly.

### Add a table

1. A migration, next number, **additive**. Backfill in the same file.
2. `user_id int not null references users(id)` unless it is genuinely shared
   (only `exercises` is).
3. Add the name to `OWNED_TABLES` in `server/src/__tests__/tenancy.test.ts`.
   The test that keeps that list in step with the migrations will tell you.
4. A service taking a `Ctx`, and integration tests against real Postgres.

### Add a screen

1. A file under `app/app/`. The filename is the route.
2. Strings through `app/src/lib/locale.ts`, German and English. Both.
3. Colours, spacing, radii from `app/src/theme.ts`.
4. Data through `app/src/api/hooks.ts` → `client.ts`. Never a raw `fetch`.
5. Wrap in `<Screen>` for the safe area and the standard padding.

### Add a scheduled job

1. A handler in `server/src/jobs/handlers.ts`.
2. A row shape in `job_schedule` — the scheduler sweeps per athlete against
   **their** local clock, not the server's.
3. Push goes to `push_tokens` for that athlete. Addressed, never broadcast.
4. Test it with a fixed clock. Jobs that read the wall clock are untestable and
   this codebase does not have any.

### Change the trainer's behaviour

The persona and the assembled context are in
`server/src/llm/prompts/trainer.ts` and `server/src/llm/context.ts`. Keep the
whole instruction under ~3k tokens.

But first: **is this a prompt change or a validator?** Prompts drift and a rule
that matters should not depend on one. If the answer is "the model must never
do X", that is a checker in `server/src/rules/` or a floor in
`domain/safety.ts`, not a sentence in the prompt.

---

## Things that look like bugs and are not

**Postgres is on 5433.** The machine this was written on already ran another
Postgres. `POSTGRES_PORT` in `.env`.

**`GEMINI_MODEL_SMART` points at Flash.** Every Pro model 404s on the current
key and `gemini-2.5-flash` is closed to new projects. The weekly review wants
Pro and will need project access.

**There is no build step on the server.** It runs through `tsx`. No `dist/`, no
compile, no source maps to configure. `typecheck` is a separate command
precisely because nothing else type-checks.

**A non-admin hitting an admin route gets 404, not 403.** A 403 confirms the
route exists.

**`services/admin.ts` reads across every athlete** and is exempt from the
tenancy guard. It pays for that with tests asserting every route reaching it is
behind `requireAdmin`, and that nothing else imports it.

**The admin panel counts in server time**, not per-athlete time, on purpose:
the bill arrives in one timezone.
