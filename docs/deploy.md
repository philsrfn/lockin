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

### Hetzner (chosen)

One CX22 in Nuremberg or Falkenstein, ~€3.79/month, running the whole stack:
Caddy for TLS, the API, and Postgres. Only Caddy binds a public port.

**1. Create the server** (web console, ~2 minutes)

- Ubuntu 24.04, CX22, location Nuremberg or Falkenstein
- Add your SSH key: `~/.ssh/id_ed25519.pub`
- Note the IPv4 address

**2. Point a hostname at it**

Either an A record on a domain you own, or — if you do not own one — sslip.io
resolves IP-based names with no setup at all:

    203.0.113.9  ->  203-0-113-9.sslip.io

Let's Encrypt issues for sslip.io names, so TLS works either way.

**3. Provision**

```sh
scp deploy/provision.sh root@YOUR_IP:/tmp/
ssh root@YOUR_IP 'bash /tmp/provision.sh'
```

Installs Docker, opens only 22/80/443, turns off SSH password auth, enables
unattended security updates.

**4. Fill in secrets**

```sh
cp deploy/.env.example deploy/.env
```

Set `LOCKIN_DOMAIN` to the hostname from step 2, generate a
`POSTGRES_PASSWORD` with `openssl rand -hex 32`, and copy `APP_BEARER_TOKEN`
and `GEMINI_API_KEY` from the repo-root `.env`. `deploy/.env` is gitignored.

**5. Deploy**

```sh
./deploy/deploy.sh root@YOUR_IP
```

Syncs the source, builds the image on the box, and waits for
`https://YOUR_DOMAIN/health`. Migrations run on boot and are tracked, so this
is safe to re-run for every future deploy.

**Useful afterwards**

```sh
ssh root@YOUR_IP 'cd /opt/lockin/deploy && docker compose -f docker-compose.prod.yml logs -f api'
ssh root@YOUR_IP 'cd /opt/lockin/deploy && docker compose -f docker-compose.prod.yml exec db psql -U lockin'
```

Back up the database:

```sh
ssh root@YOUR_IP 'cd /opt/lockin/deploy && docker compose -f docker-compose.prod.yml exec -T db pg_dump -U lockin lockin' > backup-$(date +%F).sql
```

You own the backups on a VPS. Nothing takes them for you — worth a cron job
once this is real.

### Fly.io instead

`server/fly.toml` is in the repo if you ever want managed hosting rather than a
box you maintain. Roughly 3× the cost for this workload, and Fly takes the
Postgres backups.

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
`https://YOUR_DOMAIN` and the value of `APP_BEARER_TOKEN` from `.env`.

## Rotating the token later

```sh
NEW=$(openssl rand -hex 32)
# edit deploy/.env, then
./deploy/deploy.sh root@YOUR_IP
```

Then re-enter it on the phone. No rebuild needed — that is the point of keeping
it in the keychain rather than the binary.

## Adding a friend

Every athlete has their own token, their own profile, timezone, contexts, rules
and notification schedule. Adding one is a command on the box, not an endpoint —
"first friends" needs no public signup surface to attack.

```sh
ssh root@YOUR_IP
cd /opt/lockin/deploy
docker compose -f docker-compose.prod.yml exec api npm run user:create -- --name Sam --timezone Europe/Berlin
```

It prints their token once and stores only its hash. Send it the way you would
send a password. They install the same TestFlight build, and on first launch
enter `https://YOUR_DOMAIN` and that token.

They start with a single "Home" context and the enforceable rules — deliberately
not your four German cities or your Skyr breakfast. Those are yours.

`APP_BEARER_TOKEN` is still your own token: it is mirrored onto user 1 at every
boot, so rotating it in `deploy/.env` works exactly as described above.
