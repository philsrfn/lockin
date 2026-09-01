# lockin

Personal trainer app. One user. See [CLAUDE.md](CLAUDE.md) for the full spec.

**Phase 1** — the skeleton that works with no AI in it: Postgres, a Fastify API,
deterministic double progression, and an Expo app with Today / Workout / Weight.

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

The whole stack in Docker:

```sh
docker compose up -d
```

## Tests

```sh
npm --prefix server test
```

Everything under `server/src/domain/` is pure and unit-tested — progression,
macro math, weight trend. Per §1 of the spec, no number that matters is ever
computed anywhere else.

## The app

```sh
npm --prefix app install
npm --prefix app start
```

Set `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_API_TOKEN` in `app/.env` — see
`app/.env.example`.

## Layout

```
server/migrations/   plain .sql, applied in filename order, tracked in schema_migrations
server/src/domain/   pure functions + tests. No db, no io, no clock.
server/src/services/ the single write path to each table
server/src/routes/   thin HTTP wrappers over services
app/app/             expo-router screens
app/src/db/          local SQLite (source of truth mid-workout)
app/src/sync/        offline queue
```
