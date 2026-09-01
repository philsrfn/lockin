# lockin

Personal trainer app. One user. See [CLAUDE.md](CLAUDE.md) for the full spec.

**Phase 1** is the skeleton that works with no AI in it: Postgres, a Fastify
API, deterministic double progression, and an Expo app with Today, the workout
logger, and Weight. It is offline-first where it matters — a set is written to
the phone before the network is touched.

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

## Not in phase 1

No Gemini, no chat, no push, no food logging. Today shows macro *targets* and
says so — `/today` already reads the meals table, so phase 4 only adds writes.

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
