# Deploying

Two halves, in this order. The backend must be live and have an HTTPS URL
before the app is built, because the app is configured against it.

Actually — the app stores its server URL in the keychain and asks for it on
first launch, so a rebuild is not strictly required if the URL changes later.
But you still want the backend up first so there is something to connect to.

## Why HTTPS is not optional

iOS App Transport Security blocks cleartext HTTP by default. Beyond that, the
API's entire auth is one static bearer token: over plain HTTP on the public
internet, anyone on the path can lift it and then read and write your body data.
Every option below terminates TLS for you.

## Backend

### Fly.io (recommended)

Docker-native, so `server/Dockerfile` is used as-is. Frankfurt region. Managed
Postgres. Machines can stay warm, which matters for the phase 3 cron jobs.

```sh
brew install flyctl
fly auth login

# From the repo root:
fly launch --no-deploy --copy-config --config server/fly.toml --name lockin-api
fly postgres create --name lockin-db --region fra
fly postgres attach lockin-db --app lockin-api   # sets DATABASE_URL for you

fly secrets set --app lockin-api \
  APP_BEARER_TOKEN="$(grep '^APP_BEARER_TOKEN=' .env | cut -d= -f2-)" \
  GEMINI_API_KEY="$(grep '^GEMINI_API_KEY=' .env | cut -d= -f2-)" \
  GEMINI_MODEL_FAST=gemini-3.6-flash \
  GEMINI_MODEL_SMART=gemini-3.6-flash

fly deploy --config server/fly.toml
fly logs --app lockin-api
```

Migrations run on boot and are tracked in `schema_migrations`, so the deploy
needs no second command and re-deploys are a no-op.

Check it:

```sh
curl https://lockin-api.fly.dev/health
```

### A VPS instead (Hetzner, etc.)

`docker-compose.yml` works nearly as-is. You need a reverse proxy for TLS —
Caddy is two lines of config and gets Let's Encrypt automatically. Cheaper and
fully under your control; roughly an hour more work, and you own the backups.

## App

The bundle ships with **no** bearer token — it is entered once on first launch
and stored in the iOS keychain. So there is no secret to configure in EAS.

```sh
npm i -g eas-cli
eas login                      # your Expo account
cd app
eas init                       # writes extra.eas.projectId into app.json
eas build --platform ios --profile production
```

EAS will offer to create the bundle identifier `de.dotspiro.lockin` and manage
signing. Log in with the Apple ID on the dotSpiro team when prompted — the
credentials stay between you and Apple.

Then:

```sh
eas submit --platform ios --latest
```

TestFlight internal distribution needs no App Review. Builds last 90 days.

On first launch the app asks for the server URL and the bearer token — paste
`https://lockin-api.fly.dev` and the value of `APP_BEARER_TOKEN` from `.env`.

## Rotating the token later

```sh
NEW=$(openssl rand -hex 32)
fly secrets set --app lockin-api APP_BEARER_TOKEN="$NEW"
```

Then re-enter it on the phone. No rebuild needed — that is the point of keeping
it in the keychain rather than the binary.
