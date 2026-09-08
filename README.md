# lockin

An AI personal trainer that knows your body, your schedule, the places you
train, your food rules and your training history — talks to you continuously,
and actually changes your plan.

It started as one man's app. It is now multi-user, but it is still not a
product: a handful of people use it, every day, and it is built for that rather
than for scale.

**The design in one line:** code decides every number that matters, the model
decides everything else, and the model can only act through tools that write to
Postgres.

---

## Running it

Node 20+, Docker, and a Mac with Xcode for the app.

```bash
cp .env.example .env          # set APP_BEARER_TOKEN: openssl rand -hex 32
docker compose up -d db       # Postgres 16 on host port 5433
npm --prefix server install
npm --prefix server run migrate:dev
npm --prefix server run dev   # http://localhost:3000
```

Postgres binds host port **5433**, not 5432, because the machine this was
written on already runs another Postgres. Override with `POSTGRES_PORT`.

Give yourself an athlete to be, then start the app:

```bash
npm --prefix server run user:create -- --name Sam --timezone Europe/Berlin
cp app/.env.example app/.env  # EXPO_PUBLIC_API_TOKEN = the token it printed
npm --prefix app install
npm --prefix app run ios
```

On a real phone rather than the simulator, `EXPO_PUBLIC_API_URL` must be the
Mac's LAN address — `localhost` on a phone means the phone.

The whole backend in Docker instead: `docker compose up -d`.

**Full setup, conventions and the review checklist:
[CONTRIBUTING.md](CONTRIBUTING.md).**

## Tests

```bash
npm --prefix server test           # 723 tests, 38 files, ~15s
npm --prefix server run typecheck
npm --prefix app run typecheck
```

Two suites. `test:unit` is `server/src/domain/` — pure, no database, no clock,
no io. `test:int` runs against a **real Postgres**, so `docker compose up -d db`
first or it fails immediately and for the wrong reason.

---

## Where the AI sits

This split is the whole design.

**Code decides the numbers.** Loads, reps, progression, deloads, the ramp-in
cap, the joint-pain gate, macro arithmetic, the weight trend, the safety
floors. Pure functions in `server/src/domain/`, all unit-tested. The model is
handed the results and told not to do arithmetic on them.

**The model decides everything else.** Whether today is a lifting day at all,
which template fits, when to back off, what to say about the last two weeks.
Rest is a real answer — the weekly targets are three lifts and two zone-2
sessions, so most days are not lifting days.

**It acts through tools, never through prose.** If it says it logged your
weight, a row exists. The Trainer tab prints what actually ran under each
reply.

**Safety floors sit below the model and cannot be talked past.** Ask it to cut
you to 1200 kcal and the tool refuses, clamps, and the trainer has to tell you
it was refused. Floors are derived from the body in front of the app, not from
one man's numbers.

---

## What it does

**Today** — where you are, the coach's read for the day, the session with every
load resolved from history, protein remaining, the weight trend, a scrollable
week. One round trip.

**The workout logger** — used one-handed, sweaty, between sets, on bad wifi.
Steppers pre-filled from the prescription so hitting the target is one tap. An
auto-starting rest timer, RIR chips, exercise swap filtered by movement
pattern, and an RPE + joint-pain finish. **Offline-first**: a set is written to
the phone's SQLite before the network is touched, and a queue drains it later.

**The trainer** — full chat with thirteen tools that mutate real state:
context, weight, sets, sessions, cardio, meals, exercise swaps, target changes,
rules, and a meal plan built from the fridge you last photographed.

**Food** — quick-add tiles for your actual staples, then recents, then your own
library, then manual entry. No general nutrition database; the library grows by
use. Barcode scan via OpenFoodFacts. Protein remaining is the hero number.

**History** — what you actually did, day by day, lifts and cardio together.
Every session opens to the individual sets without another request, which
matters when you are standing in a gym on bad wifi wondering what you lifted
last time.

**Weight** — one number pad, three seconds. The 7-day average is the headline,
and the chart is a line in a coordinate system: the average is the line, daily
weigh-ins are dots.

**Proactive coaching** — a morning check-in, a reminder of the day's session
and where to do it, a nudge when a session went unlogged, a dinner prompt, and
the Sunday review that reads the last fortnight and adjusts next week's
targets. Each fires against the athlete's **own** local clock, and each stays
quiet when it has nothing to say.

**Apple Health, read** — steps, sleep, resting heart rate, workouts and a smart
scale, so the coach stops having to ask about recovery.

**An admin panel** — who is using this, what it costs, and who is waiting to be
let in. Every model call is priced into `llm_usage`.

Sign in with a token or with Apple. Both resolve to the same row.

---

## Not yet

One of the fourteen tools is absent rather than half-built: `regenerate_week`,
which needs a stored week plan. There is no voice mode and no row-level
security — that last one is [reasoned through](docs/tenancy.md) rather than
forgotten.

The full list, in the order it should be done, is
[docs/roadmap.md](docs/roadmap.md).

---

## Layout

```
server/migrations/   plain .sql, filename order, tracked in schema_migrations
server/src/domain/   pure functions + tests. No db, no io, no clock.
server/src/services/ the single write path to each table. Takes a Ctx.
server/src/routes/   thin HTTP wrappers over services
server/src/llm/      provider interface, gemini impl, tools, prompts
server/src/jobs/     the per-athlete scheduler and its handlers
app/app/             expo-router screens (file = route)
app/src/db/          local SQLite — source of truth mid-workout
app/src/sync/        the offline queue
deploy/              compose, Caddy, provision + deploy + backup scripts
```

## Docs

| | |
|---|---|
| [CLAUDE.md](CLAUDE.md) | the spec and the invariants. Read this first. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | setup, the daily loop, conventions, the checklist |
| [docs/architecture.md](docs/architecture.md) | the map, and recipes for common changes |
| [docs/roadmap.md](docs/roadmap.md) | what is left, in order |
| [docs/api.md](docs/api.md) | every endpoint |
| [docs/tenancy.md](docs/tenancy.md) | tenant isolation, and where it stops |
| [docs/offline-sync.md](docs/offline-sync.md) | the queue, and how it fails |
| [docs/deploy.md](docs/deploy.md) | the box, the app, and the capability trap |
| [docs/health.md](docs/health.md) | Apple Health |
| [docs/generalisation.md](docs/generalisation.md) | what was deliberately not done, and why |

---

## One warning

**This app is in daily use with real data going back to September 2026.**
Migrations are additive only — never `drop`, never `truncate`, never rewrite a
column in place. Take a `pg_dump` (`deploy/backup.sh`) before anything touches
production. §15 of CLAUDE.md is the long version.
