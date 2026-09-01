# lockin

Personal trainer app. One user. See [CLAUDE.md](CLAUDE.md) for the full spec.

**Phase 1** is the skeleton: Postgres, a Fastify API, deterministic double
progression, and an Expo app with Today, the workout logger, and Weight.
Offline-first where it matters — a set is written to the phone before the
network is touched.

**Phase 2** is the trainer. Gemini decides what today *is* — lift, treadmill or
rest — and talks to him through a tool set that mutates real state. It does not
decide a single load: those stay in tested code.

## Running it

```sh
cp .env.example .env          # then set APP_BEARER_TOKEN: openssl rand -hex 32
docker compose up -d db       # Postgres 16 on host port 5433
npm --prefix server install
npm --prefix server run migrate:dev
npm --prefix server run dev   # http://localhost:3000
```

Postgres binds host port **5433**, not 5432, because this machine already runs
another Postgres. Override with `POSTGRES_PORT` in `.env`.

Then the app:

```sh
cp app/.env.example app/.env  # EXPO_PUBLIC_API_TOKEN must match APP_BEARER_TOKEN
npm --prefix app install
npm --prefix app run ios
```

On a real phone rather than the simulator, set `EXPO_PUBLIC_API_URL` to the
Mac's LAN address — `localhost` means the phone itself.

The whole backend in Docker:

```sh
docker compose up -d
```

## Tests

```sh
npm --prefix server test
```

64 tests over `server/src/domain/`, which is pure — no database, no clock, no
io. Per §1 of the spec, no number that matters is computed anywhere else:
progression, macro arithmetic, and the weight trend all live there.

## Where the AI sits

The split is the whole design, and it is §1 of the spec:

**Code decides the numbers.** Loads, reps, progression, deloads, the ramp-in
cap, the joint-pain gate, macro arithmetic, the weight trend. All pure
functions, all unit-tested. The model is handed these and told not to do
arithmetic on them.

**The model decides everything else.** Whether today is a lifting day at all,
which template fits, when to back off, what to say about the last two weeks.
Rest is a real answer — the weekly targets are 3 lifts and 2 zone-2 sessions,
so four days a week are not lifting days.

It acts through tools, never through prose. If it says it logged your weight,
a row exists; the Trainer tab prints what actually ran under each reply.

Safety floors sit below the model and cannot be talked past. Ask it to cut you
to 1200 kcal and the tool refuses, clamps to 1800, and the trainer has to tell
you it was refused.

## What phase 1 does

- **Today** — context chip, the day's session with every load resolved from
  history, protein remaining, 7-day weight trend. One round trip.
- **Workout logger** — steppers pre-filled from the prescription so hitting the
  target is one tap, auto-starting rest timer, RIR chips, exercise swap filtered
  by movement pattern, and an RPE + joint-pain finish.
- **Weight** — one number pad, three seconds, and the 7-day average made the
  headline number.
- **Offline** — sets, sessions and weigh-ins are written to local SQLite and
  drained to the API by a queue. See [docs/offline-sync.md](docs/offline-sync.md).

Enforced below the model, in code, ready for phase 2:
double progression with deload, the two-week ramp-in, and the §7 joint-pain gate
that cuts load 20% and calls for a doctor after two consecutive flagged
sessions.

## What phase 2 adds

- **A coach read on Today** — lift / zone-2 / rest, with a reason, generated
  once a day and cached so it does not drift each time the app opens.
- **A Trainer tab** — full chat, with the conversation persisted.
- **Eleven tools** — context switching, weight, sets, sessions, meals, exercise
  swaps, target changes, and rules.
- **§7 safety floors** — calorie, protein, BMI-20 goal weight, two rest days,
  and the automatic calorie raise after two weeks losing faster than
  1.2 kg/week.
- **§5 rules validator** — the seeded rules carry codes mapping to checkers.
  The Skyr rule is tested explicitly, in English and German.

Only `gemini-3.6-flash` is reachable on the current key — every Pro model 404s,
and `gemini-2.5-flash` is closed to new projects. The Phase 3 weekly review
wants Pro and will need project access.

## Not yet

No push (phase 3). No food *screen*, no fridge photo (phase 4) — though the
trainer can already log a meal you mention in chat, and `/today` reads the
meals table.

Two of the thirteen §6 tools are absent rather than half-built:
`generate_meal_plan` needs fridge inventory, `regenerate_week` needs a stored
week plan.

The bearer token comes from `EXPO_PUBLIC_API_TOKEN`, which bakes it into the
bundle. §2 wants it in the iOS keychain; that needs `expo-secure-store` and a
paste-once setup screen, and should land before anything reaches TestFlight.

## Layout

```
server/migrations/   plain .sql, applied in filename order, tracked in schema_migrations
server/src/domain/   pure functions + tests. No db, no io, no clock.
server/src/services/ the single write path to each table
server/src/routes/   thin HTTP wrappers over services
app/app/             expo-router screens
app/src/db/          local SQLite (source of truth mid-workout)
app/src/sync/        offline queue
docs/api.md          endpoint reference
docs/offline-sync.md how the queue behaves, and how it fails
```
