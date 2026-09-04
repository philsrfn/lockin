# lockin — working instructions

An AI personal trainer. It knows an athlete's body, schedule, places, food
rules and training history, talks to them continuously, and actually mutates
their plan.

It started as one man's app and is now multi-user, but it is still not a
product. A handful of people use it. Optimise for "they use it every day for a
year", not for scale or generality. When a decision is between "correct for
thousands" and "obviously right for twelve", pick the second and write down
why.

**Read this file before changing anything.** Section numbers are referenced
from ~106 code comments (`§7`, `§11`, …). They are load-bearing: renumber a
section and you invalidate every one of them.

**New here?** Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup and the daily
loop, and [docs/architecture.md](docs/architecture.md) for the map and recipes
for common changes. What is left to build is in
[docs/roadmap.md](docs/roadmap.md).

---

## 0. The five things that will bite you

1. **This app is in daily use with real data.** Migrations are additive only.
   Never `drop`, never `truncate`, never rewrite a column in place without a
   backfill you have tested. See §15.
2. **Every query against an owned table must name `user_id`.** A missing
   `where user_id` does not throw — it returns somebody else's body weight,
   shaped exactly like the right answer. A static guard catches this
   (`server/src/__tests__/tenancy.test.ts`); do not exempt yourself from it
   without adding a compensating test.
3. **Integration tests need a real Postgres running.** `docker compose up -d db`
   first, or 38 test files fail for a reason that has nothing to do with your
   change.
4. **The model never computes a number that matters.** Loads, macros, trends,
   streaks — all in `server/src/domain/`, all pure, all tested.
5. **Adding a native iOS capability needs an extra EAS step.** Five builds were
   lost to this. See [docs/deploy.md](docs/deploy.md) § "Adding a native
   capability".

---

## 1. Core principles

1. **Deterministic logic lives in code, not in the model.**
   Progressive overload, macro arithmetic, weight trend smoothing, streaks,
   rule enforcement — plain functions with unit tests. The LLM never computes a
   number that matters.

2. **The model acts through tools, not through prose.**
   Every state change goes through a declared function call that is validated
   and written to Postgres. If the trainer says it, the DB reflects it.

3. **Hard rules are enforced by validators, not by prompts.**
   Prompts drift. A validator that rejects a breakfast without Skyr does not.

4. **Safety floors are non-negotiable and live below the model.** See §7.

5. **Provider-agnostic LLM layer.** All Gemini calls go through
   `server/src/llm/` behind an interface. Swapping providers must stay a
   one-directory change.

6. **Every read and write is scoped to one athlete.** A `Ctx` carries the
   `userId` and the db handle into every service call. There is no ambient
   "current user". See §15.

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| App | Expo SDK 57 (React Native 0.86, React 19) + TypeScript | expo-router |
| Distribution | EAS Build → TestFlight internal (dotSpiro team) | 90-day builds, no App Review |
| Backend | Fastify 5 + TypeScript, ESM, run through `tsx` | **no build step** — no `dist/`, no compile |
| DB | PostgreSQL 16 | plain `.sql` migrations, applied in filename order |
| LLM | Gemini via `@google/genai` | see the model note below |
| Push | APNs via Expo Notifications | proactive coaching, §8 |
| Hosting | Hetzner box, Docker Compose, Caddy for TLS | `deploy/` |

**Never put the Gemini API key in the app.** The app talks only to the backend.

### Authentication

Two ways in, both resolving to a row in `users`:

- **A bearer token** — issued by `npm run user:create` on the box, printed
  once, stored in the iOS keychain via `expo-secure-store`. Never baked into
  the bundle: `EXPO_PUBLIC_API_TOKEN` exists for the simulator only and is
  empty in production builds.
- **Sign in with Apple** — the identity token is verified server-side
  (`server/src/auth/appleIdentity.ts`: RS256, JWKS, `aud` check, single-use
  nonce) and matched against `users.apple_sub`. This is how somebody signs in
  on a new phone.

Still no signup flow, no password reset, no roles beyond a boolean
`users.is_admin`. Do not build auth infrastructure beyond what is here.

### Gemini configuration

- SDK: `@google/genai`
- **Only `gemini-3.6-flash` is reachable on the current key.** Every Pro model
  404s and `gemini-2.5-flash` is closed to new projects, so `GEMINI_MODEL_SMART`
  points at Flash too. The weekly review wants Pro and will need project
  access. Do not "fix" this by hardcoding a model string you have not called.
- Use `systemInstruction` for the trainer persona + assembled context
  (`server/src/llm/prompts/trainer.ts`, assembled in `llm/context.ts`)
- Use `responseSchema` + `responseMimeType: "application/json"` for every
  structured output. Do not parse free text.
- Every call goes through `llm/metered.ts`, which records tokens and cost into
  `llm_usage` — that table is what the admin panel bills against.

---

## 3. Repo layout

```
/app                       Expo app
  /app                     expo-router screens (file = route)
    /(tabs)                index (Today) · chat · food · weight
    account.tsx            settings, profile, Apple ID, admin pairing
    workout.tsx            the logger
    rules.tsx  fridge.tsx  progress.tsx
  /src
    /api                   client, config (keychain), hooks, types
    /auth                  Apple sign-in, session
    /components            shared UI
    /db                    local SQLite — source of truth mid-workout
    /health                Apple Health read + sync
    /lib                   format, locale (every string, DE + EN)
    /sync                  the offline queue
    /workout               the logger's state machine
/server
  /migrations              plain .sql, filename order, tracked in schema_migrations
  /src
    /domain                pure functions + tests. No db, no io, no clock.
    /services              the single write path to each table. Takes a Ctx.
    /routes                thin HTTP wrappers over services
    /llm                   provider interface, gemini impl, tools, prompts
    /rules                 rule schema, validator, enforcement
    /jobs                  scheduler + handlers (cron → push)
    /auth                  Apple identity verification, nonces
    /admin                 the admin panel: pairing, page, tests
    /test                  integration-test database plumbing
/deploy                    docker-compose.prod, Caddyfile, provision + deploy scripts
/docs                      see the index in README.md
```

---

## 4. Data model

**The migrations are the truth.** `server/migrations/` in filename order; this
section is the shape, not the schema. Read `001_schema.sql` then skim forward.

Core tables, all carrying `user_id` unless noted:

```
users                 id, name, token_hash, apple_sub, is_admin, approved_at, last_seen_at
profile               one row per athlete: height, birth year, targets, timezone, locale
contexts              the athlete's places — equipment jsonb, food profile, archived_at
exercises             shared, not owned — name, movement pattern, substitutes
programs              the athlete's programme catalog
program_days/_slots   a programme's days, and the exercise slots in each
sessions / sets       what was actually done
bodyweight            (user_id, measured_on) — keyed on the pair, not the date alone
measurements          waist and the rest of the tape
cardio_sessions       counted towards the weekly targets
meals / foods         foods is the athlete's own library; grows by use.
                      A barcode is a column on foods, not a table of its own.
fridge_inventory      confirmed vision output
rules                 tier (hard|soft|never), text, scope, code → a checker
chat_messages         role, content jsonb
coach_notes           the cached daily read, so it does not drift per app open
deloads               planned + earned
daily_health          steps, sleep, resting HR, workouts, scale weight
job_schedule/job_runs per-athlete cron state
push_tokens           addressed, never broadcast
weekly_reviews
llm_usage             tokens and cost per call — what the admin panel bills against
sync_log              idempotency for the offline queue
sessions_tokens       device pairing for the admin panel
admin_actions         an audit trail of what an admin did
```

Seed data lives in `002_seed.sql` and the programme catalog in `015_programs.sql`.
The original single-user seed (191 cm, 100 → 80 kg, 2300 kcal / 190 g protein,
Home · Münster · Mannheim · Leipzig, the A/B/C rotation) is now just *user 1's*
data, not the app's defaults. New athletes get targets computed from the body in
front of them (`services/onboarding.ts`).

---

## 5. Rules

Three tiers, seeded per athlete, editable in-app on the Rules screen.

```json
{
  "hard":  ["Breakfast is always ~500g Skyr with berries and 40g oats."],
  "soft":  ["Prefer soy chunks as a protein source when cooking."],
  "never": ["Never propose a day under 160g protein."]
}
```

`validateAgainstRules(plan, rules)` runs on **every** generated meal plan and
training week. Rules carry a `code` (migration 003) mapping to a checker in
`server/src/rules/`; a rule without a code is advisory text for the model, a
rule with one is enforced. On violation: do not surface the output. Re-prompt
once naming the specific violation. On second failure, fall back to the
deterministic template and log it.

The Skyr case is tested explicitly, in English and German.

---

## 6. Tool declarations

Declared in `server/src/llm/tools.ts`, each mapping to a validated handler in
`llm/handlers.ts`, which calls the same service the HTTP route calls.

| Tool | Purpose |
|---|---|
| `set_context` | switch places |
| `log_weight` | write a bodyweight entry |
| `log_set` | record weight × reps × RIR |
| `log_session` | close out a session with RPE, notes, joint_pain |
| `log_cardio` | record a cardio session |
| `log_meal` | record a meal with estimated macros |
| `get_today` | today's plan, remaining macros, context |
| `get_history` | last N days of sessions / weight / meals |
| `adjust_calorie_target` | change daily kcal (validated, §7) |
| `swap_exercise` | substitute within the same movement pattern |
| `add_rule` / `deactivate_rule` | mutate the rules document |

**Missing, and deliberately absent rather than half-built:**
`generate_meal_plan` (the `/fridge/plan` route exists — the trainer just cannot
call it) and `regenerate_week` (needs a stored week plan). See
[docs/roadmap.md](docs/roadmap.md).

Rule: any tool that writes returns the resulting state, so the model's next
turn sees ground truth rather than assuming its call succeeded.

---

## 7. Safety floors (hard-coded, below the model)

Enforced in the tool handlers and in `server/src/domain/`. The model cannot
talk its way past these. Floors are derived from the body in front of the app,
not from one man's numbers:

`server/src/domain/safety.ts` derives a floor from the body whenever the app
knows enough about it, and falls back to these constants when it does not — a
profile written before onboarding collected sex and age keeps exactly the
numbers it has always had.

```
MIN_CALORIE_TARGET     = 1800     fallback; derived from BMR when facts exist,
                                  never under 1500 (male) / 1200 (female)
MIN_PROTEIN_TARGET_G   = 160      fallback; otherwise 1.6 g per kg of a
                                  reference weight capped at BMI 25
MAX_WEEKLY_LOSS_KG     = 1.2      or 1% of bodyweight, whichever is smaller
MIN_REST_DAYS_PER_WEEK = 2
MIN_BMI                = 20       the lightest goal weight allowed
UNDERWEIGHT_BMI        = 18.5     below this, onboarding refuses a deficit
```

Rejected calls return an explanation the model must relay honestly. Also:

- `joint_pain = true` on two consecutive sessions → the trainer must cut load
  20% and recommend seeing a doctor. Gated in code, not in wording.
- 7-day average loss over 1.2 kg/week for two consecutive weeks → the system
  raises the calorie target automatically and says why.
- Onboarding refuses a deficit to somebody already underweight or still
  growing, says why, and points at somebody qualified.

---

## 8. Proactive coaching (cron → APNs)

`server/src/jobs/scheduler.ts` sweeps per athlete against **their own local
clock**, not the server's. Times are adjustable per athlete.

| Job | When | Message |
|---|---|---|
| `morning_checkin` | 07:30 | Confirm context for the day. |
| `log_nudge` | 90 min after session start, no sets | Nudge to log. |
| `dinner_prompt` | 20:00 | One-tap dinner logging. |
| `weekly_review` | Sunday 18:00 | 7-day average, adherence, next week's targets. |

**Missing:** the pre-session reminder — 30 min before a planned session, with
which gym in the current city.

The weekly review is the most important job in the app. It reads the last 14
days in full and produces: trend assessment, one thing that went well, one
concrete change, and the updated targets via tool calls.

---

## 9. Fridge photo flow

1. Camera → image to the backend (never straight to Google from the app)
2. Gemini Flash vision → `responseSchema` yielding `[{name, estimated_qty, confidence}]`
3. **The athlete confirms/edits the list.** Never generate a plan off an
   unconfirmed vision pass — mis-detected ingredients produce plans nobody can
   cook.
4. Confirmed list → `fridge_inventory`
5. Plan runs against inventory + **remaining** macros for today (not the daily
   total) + active rules for the current context
6. Validator pass (§5) → present

---

## 10. Trainer system instruction

Assembled fresh per request in `server/src/llm/context.ts` from the template in
`llm/prompts/trainer.ts`. Keep it under ~3k tokens.

```
You are {athlete}'s personal trainer. You have worked with them for months.

PERSONA    direct and warm, no basics re-explained, no moralising about food,
           short messages — they read on a phone
ATHLETE    height, current weight, 7-day trend, goal, targets
CONTEXT    active place, equipment available, food profile
RULES      hard / soft / never, filtered to the current context
RECENT     last 14 days: sessions with top sets, weight trend, meal adherence
TODAY      planned session, macros consumed, macros remaining

You have tools. Use them. When they tell you something that changes their
plan, call the tool — do not merely agree in text.
```

The persona also carries explicit boundaries: it is not a doctor, and it says
so when the question is medical.

---

## 11. Screens and interaction model

**Chat is not the primary interface.** Structured UI handles the 95% that
repeats — sets, meals, weight. Chat handles the 5% that is novel.

**Both paths hit the same handlers.** `POST /sets` is called by the Log screen
*and* by the `log_set` tool. Never two code paths to the same table.

- **Today** (default tab) — context chip, the coach's read for the day, the
  session with every load resolved from history, protein remaining, the weight
  trend, a scrollable week strip. One round trip. Account avatar top right.
- **Workout logger** — used one-handed, sweaty, between sets, on bad wifi.
  Steppers pre-filled from the prescription so hitting the target is one tap.
  Auto-starting rest timer, RIR chips, swap filtered by movement pattern, RPE +
  joint-pain finish. **Offline-first**: writes go to local SQLite immediately
  and a queue drains to the backend. Never block a set on the network.
- **Food** — quick-add tiles for actual staples, then recents, then the
  athlete's own library, then manual entry. **No general nutrition database.**
  Barcode scan via OpenFoodFacts. Protein remaining is the hero number.
  Precision on vegetables is not required and is not requested.
- **Weight** — one number pad, three seconds. The 7-day average is the
  headline, and the chart is a line in a coordinate system: the average is the
  line, daily weigh-ins are dots.
- **Rules** — the §5 editor, three tiered lists, scope selector. Only rules.
- **Account** — profile, language, programme, Apple ID, Health, sign out,
  admin pairing.
- **Chat** — free text plus the tool set. Prints what actually ran under each
  reply.

---

## 12. Build order — where it stands

Phases 1–4 of the original plan are shipped, plus a generalisation pass that
was not in it (multi-user, Apple sign-in, an admin panel, a programme catalog,
cardio, deloads, Apple Health).

Phase 5 is partly done: HealthKit ✅, progress charts ✅, **voice mode ❌**.

The register of what is done, deliberately not done, and blocked on a decision
is [docs/generalisation.md](docs/generalisation.md). What to build next is
[docs/roadmap.md](docs/roadmap.md).

---

## 13. Environment

Copy `.env.example` → `.env`. The full list with comments is in that file; the
ones that matter:

```
DATABASE_URL=            # host port 5433, not 5432 — this machine runs another Postgres
APP_BEARER_TOKEN=        # openssl rand -hex 32
GEMINI_API_KEY=          # AI Studio, Cloud billing enabled
GEMINI_MODEL_FAST=gemini-3.6-flash
GEMINI_MODEL_SMART=gemini-3.6-flash   # Pro 404s on this key
TZ=Europe/Berlin         # the server's clock. Athletes have their own.
```

`app/.env.example` → `app/.env` for the simulator. `deploy/.env.example` is the
production one and lives only on the box.

---

## 14. Notes for Claude Code

- **`server/src/domain/` first, with tests, before any LLM code.** Progression
  and macro math are the parts that must never be wrong.
- **The rules validator gets tests too**, including the Skyr case explicitly.
- **Do not add** user management beyond `users`, roles beyond `is_admin`,
  onboarding flows beyond the questionnaire, or analytics. A handful of users.
- **Do not abstract the training program into a generic program builder.** A
  seeded catalog plus `swap_exercise` covers it.
- **Prefer boring, readable code over clever.** This is a codebase people
  return to after three-week gaps.
- **Comments explain why, not what.** The existing ones are long and prose-like
  on purpose: they record the reason a thing is the way it is, especially when
  the obvious approach was tried and failed. Match that voice. If you fix a
  subtle bug, the comment explaining it is part of the fix.
- **Every user-facing string goes through `app/src/lib/locale.ts`**, in German
  and English. No literal copy in a component.
- **Run the tests before you claim anything works.** `npm --prefix server test`
  (723 of them) and `npm --prefix server run typecheck` and
  `npm --prefix app run typecheck`. All three, all green.
- **When you fix a bug, first write the test that reproduces it.** Then break
  the fix deliberately and confirm the test fails. A test that passes both ways
  tested nothing.
- **Do not report something as verified that you did not run.** If you could
  not test it, say which part and why.

---

## 15. Tenancy and the data that is already there

This is the section that turns a small mistake into a bad one.

**Everything is scoped by `Ctx`.**

```ts
type Ctx = { userId: number; db: Queryable; inTransaction?: boolean };
```

Services take a `Ctx` as their first argument. There is no ambient current
user, no request-local global, no default. If a function needs to know whose
data it is touching, it takes a `Ctx`.

**Every SQL statement against an owned table names `user_id`.** The static
guard in `server/src/__tests__/tenancy.test.ts` reads every SQL literal in the
source and fails the build otherwise. It also forbids `current_date` and
`current_timestamp`, because "today" is the athlete's, not the server's — use
`services/clock.ts`.

The guard cannot tell a correct predicate from a wrong one, only a present one
from an absent one. It is a blunt instrument that catches the specific mistake
that fails silently. `services/admin.ts` is exempt — reading across athletes is
its whole job — and pays for the exemption with tests asserting that every
route reaching it is behind `requireAdmin` and that nothing else imports it.

Row-level security is **not** in place. The reasoning and the four steps that
would finish it are in [docs/tenancy.md](docs/tenancy.md).

**Migrations are additive.** People are training on this app today; there is
real data going back to September 2026.

- Add columns, add tables, add indexes. Backfill in the same migration.
- Never `drop table`, never `truncate`, never `drop column` on a table with
  rows in it.
- A column that changes meaning gets a new name, not a rewrite in place.
- Take a `pg_dump` before running anything on production, and check row counts
  before and after. `deploy/backup.sh` does the first part.
- Migrations run in filename order and are recorded in `schema_migrations`.
  They are never edited after they have run anywhere real — write a new one.

---

## 16. Making a change

The full recipes are in [docs/architecture.md](docs/architecture.md). The shape
of every one of them:

**A new number the app shows** → a pure function in `domain/` with tests → a
service that reads it → a route → the app.

**A new thing the trainer can do** → the service first, then the route, then
the tool declaration in `llm/tools.ts` and the handler in `llm/handlers.ts`
calling the *same service*. Never a second write path.

**A new table** → a migration, additive → add it to `OWNED_TABLES` in the
tenancy test → a service that takes a `Ctx` → integration tests against real
Postgres.

**A new screen** → a file under `app/app/` (expo-router), strings through
`locale.ts`, colours and spacing from `app/src/theme.ts`, and never a raw
`fetch` — go through `app/src/api/client.ts`.

**Anything touching the phone's native layer** (Health, push, sign-in) → read
[docs/deploy.md](docs/deploy.md) § "Adding a native capability" before you
build, or you lose a build cycle.
