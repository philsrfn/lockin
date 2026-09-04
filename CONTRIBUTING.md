# Working on lockin

This is a small codebase with a few strong opinions. The opinions are written
down so you do not have to guess at them, and so a change that violates one is
a conversation rather than a surprise in review.

Read [CLAUDE.md](CLAUDE.md) first — it is the spec and the working
instructions, and its section numbers are referenced from the code. Then
[docs/architecture.md](docs/architecture.md) for the map.

---

## The first hour

You need: Node 20+, Docker, and (for the app) a Mac with Xcode.

```bash
git clone git@github.com:philsrfn/lockin.git && cd lockin
cp .env.example .env
```

Open `.env` and set two things:

```bash
openssl rand -hex 32     # paste as APP_BEARER_TOKEN
```

and `GEMINI_API_KEY` if you are going to touch anything the trainer does. The
app runs without it; every LLM call fails loudly, nothing else does.

Then:

```bash
docker compose up -d db
npm --prefix server install
npm --prefix server run migrate:dev
npm --prefix server run dev
```

The API is on `http://localhost:3000`. Postgres binds host port **5433**, not
5432, because the machine this was written on already ran another Postgres.
Override with `POSTGRES_PORT` in `.env` if that is not your problem.

Give yourself an athlete to be:

```bash
npm --prefix server run user:create -- --name Sam --timezone Europe/Berlin
```

It prints a token once and never again. Put it in `app/.env`:

```bash
cp app/.env.example app/.env    # set EXPO_PUBLIC_API_TOKEN to that token
npm --prefix app install
npm --prefix app run ios
```

On a real phone rather than the simulator, `EXPO_PUBLIC_API_URL` has to be the
Mac's LAN address — `localhost` on a phone means the phone.

There is also a demo fixture, `npm --prefix server run seed:demo`, which
refuses to run against anything that looks like real data.

---

## The daily loop

```bash
docker compose up -d db              # once, if it is not already up
npm --prefix server run dev          # tsx watch — no build step, no dist/
npm --prefix app run ios
```

Before every commit, all three of these, all green:

```bash
npm --prefix server test
npm --prefix server run typecheck
npm --prefix app run typecheck
```

`npm --prefix server test` is 723 tests over 38 files and takes about 15
seconds. It splits into two projects:

- `npm --prefix server run test:unit` — `src/domain/`, pure, no database
- `npm --prefix server run test:int` — everything else, against a **real
  Postgres**

The integration suite builds one template database with every migration
applied, then hands each test file its own copy. If it fails immediately and
loudly, the database is not running. `docker compose up -d db`.

There is no linter and no formatter config. Match the file you are editing.

---

## The five rules that are not negotiable

**1. The model never computes a number that matters.** Loads, macros, trends,
progression, streaks — pure functions in `server/src/domain/`, with tests. The
LLM is handed the results. If you find yourself asking Gemini for arithmetic,
you are writing the wrong thing.

**2. One write path per table.** The service layer is it. The HTTP route and
the LLM tool handler both call the same service function. Never two paths to
the same table — that is how the API and the trainer end up disagreeing about
what happened.

**3. Every query against an owned table names `user_id`.** A missing
`where user_id` does not throw. It returns somebody else's data, shaped exactly
like the right answer, and nothing downstream can tell. A static guard reads
every SQL literal in the source and fails the build
(`server/src/__tests__/tenancy.test.ts`). Do not add yourself to its exemption
list without a compensating test.

**4. Migrations are additive.** People train on this app today, with data going
back to September 2026. Add columns, add tables, backfill in the same
migration. Never `drop`, never `truncate`, never rewrite a column in place. A
migration that has run somewhere real is never edited — write a new one.

**5. Safety floors sit below the model and cannot be talked past.** §7 of
CLAUDE.md. A tool call that would breach one is refused, clamped, and the
refusal is relayed honestly to the athlete. If you are adding a way to change a
target, it goes through `domain/safety.ts`.

---

## Conventions

**Comments explain why, not what.** The ones in this codebase are long and
prose-like on purpose — they record the reason a thing is the way it is,
especially when the obvious approach was tried first and failed. If you fix a
subtle bug, the comment explaining it is part of the fix. Match the voice; do
not strip it out for being unusual.

**Commit messages are a sentence, not a category.** Look at the log:
*"A relative fetch is not an answer"*, *"A programme you left cannot take the
app down with it"*. Say what changed about the world, not which files you
touched.

**Every user-facing string goes through `app/src/lib/locale.ts`**, in German
and English. No literal copy in a component. ~180 phrase pairs live there.

**Colours, spacing and radii come from `app/src/theme.ts`.** No hex literals in
components.

**The app never calls `fetch` directly.** `app/src/api/client.ts` handles the
base URL, the token, refusals and errors. A relative fetch is answered by
Metro's dev manifest with a cheerful 200 and cached as valid data — that bug
cost a day.

**Naming follows the domain, not the framework.** `athlete`, `session`, `set`,
`context` (a place), `programme`. Not `entity`, not `record`.

---

## Before you open a PR

- [ ] All three checks green (tests, both typechecks)
- [ ] New behaviour has a test. **Bugs get the test first** — write it, watch
      it fail, then fix it. Then break your fix deliberately and confirm the
      test catches it. A test that passes both ways tested nothing.
- [ ] New table → added to `OWNED_TABLES` in the tenancy test
- [ ] New migration → additive, numbered next, run once locally
- [ ] New string → in `locale.ts`, both languages
- [ ] New tool → declared in `llm/tools.ts`, handled in `llm/handlers.ts`,
      calling an existing service
- [ ] Touched a native capability (Health, push, Apple sign-in) → read
      [docs/deploy.md](docs/deploy.md) § "Adding a native capability" **before**
      building, not after

Say what you did not test. An honest gap is worth more than a claim that does
not hold.

---

## Deploying

Backend and app both: [docs/deploy.md](docs/deploy.md). Short version — the
server is a Hetzner box running Docker Compose behind Caddy, `deploy/deploy.sh`
ships it, and `deploy/backup.sh` takes the `pg_dump` you want before any
migration.

The app goes to TestFlight through EAS. The trap that cost five builds: EAS
syncs Apple capabilities only when it *mints* a provisioning profile, so adding
HealthKit or Sign in with Apple to `app.json` is not enough. Run
`npx eas-cli credentials:configure-build --platform ios --profile production`
first. This is written up properly in the deploy doc.

---

## Where to ask

The docs are the answer to most of it:

| | |
|---|---|
| [CLAUDE.md](CLAUDE.md) | the spec, the invariants, the working rules |
| [docs/architecture.md](docs/architecture.md) | the map, and recipes for common changes |
| [docs/roadmap.md](docs/roadmap.md) | what is left, in the order it should be done |
| [docs/api.md](docs/api.md) | every endpoint |
| [docs/tenancy.md](docs/tenancy.md) | how tenant isolation works, and where it does not |
| [docs/offline-sync.md](docs/offline-sync.md) | the queue, and how it fails |
| [docs/deploy.md](docs/deploy.md) | the box, the app, the capability trap |
| [docs/health.md](docs/health.md) | Apple Health |
| [docs/generalisation.md](docs/generalisation.md) | what was deliberately not done, and why |
