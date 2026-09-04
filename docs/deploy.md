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

**`Broken pipe` during the build is not a failed deploy.** The current box has
961 MB of RAM, and `docker build` takes enough of it that sshd cannot fork for
a minute or two — the connection dies, the script reports a broken pipe, and
the build carries on to completion on the server without you. Port 22 comes
back on its own within a minute.

Do not re-run the deploy to "fix" it, and do not hammer SSH while it is down.
Wait, reconnect once, and check what actually happened:

```sh
ssh root@YOUR_IP 'cd /opt/lockin/deploy && docker compose -f docker-compose.prod.yml ps'
ssh root@YOUR_IP 'cd /opt/lockin/deploy && docker compose -f docker-compose.prod.yml \
  exec -T db psql -U lockin -d lockin -tAc \
  "select filename from schema_migrations order by filename desc limit 3;"'
```

An `api` container a few minutes old and your newest migration at the top of
that list means it worked. The real fix is a bigger box or building the image
somewhere else and pushing it to a registry; neither is worth it yet.

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
and stored in the iOS keychain.

The backend's address is **not** in `eas.json`. The repo is public, and a
committed hostname is a standing invitation to probe it, so the value lives as
an EAS environment variable and is injected at build time:

```sh
eas env:list production                       # what a build will see
eas env:set --name EXPO_PUBLIC_API_URL \
  --value https://YOUR_DOMAIN \
  --environment production --environment preview \
  --visibility sensitive --scope project --type string
```

Set it before the first build on a new EAS project, or the app ships with no
server configured and asks every user to type a hostname on first launch. It is
already set for `@philserafin/lockin`.

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

## Adding a native capability

Every capability the app declares — push, HealthKit, Sign in with Apple — has to
be on the App ID *and* inside the provisioning profile. EAS puts it on the App
ID when it mints a profile, and it only mints one when it has none. An existing
valid profile is reported as "All credentials are ready to build" without ever
being compared against the app's entitlements, so the build gets as far as
Xcode and fails there:

```
Provisioning profile "*[expo] de.dotspiro.lockin AppStore ..."
doesn't include the Sign In with Apple capability.
```

`--non-interactive` does not cause this and dropping it does not fix it. What
fixes it is one command, run before the build:

```sh
cd app
npx eas-cli credentials:configure-build --platform ios --profile production
npx eas-cli build --platform ios --profile production --auto-submit
```

It logs in to the Apple account (the password comes from the macOS Keychain),
writes the missing capabilities onto the App ID, notices that the existing
profile is now invalid because the App ID changed, and rebuilds it:

```
✔ Synced capabilities: Enabled: HealthKit, Sign In with Apple
  Provisioning profile (id: X27S72G3X3) is no longer valid
✔ Updated provisioning profile with distribution certificate
```

It is a wizard rather than the `eas credentials` menu — every prompt takes its
default, so `printf '\n\n\n' |` is enough if it is not being run by hand.
Do it in the same sitting as the capability's first build; a profile minted
before the capability existed will fail every build until it is replaced.

## Rotating the token later

```sh
NEW=$(openssl rand -hex 32)
# edit deploy/.env, then
./deploy/deploy.sh root@YOUR_IP
```

Then re-enter it on the phone. No rebuild needed — that is the point of keeping
it in the keychain rather than the binary.

## The admin panel

`https://YOUR_DOMAIN/admin`, in any browser. Press **Approve this browser**, and
it shows a six-character code. Open lockin on your phone → Regeln → Admin, type
the code, and the browser is in.

The panel has no Sign in with Apple of its own: Apple's web flow wants a
Services ID and a verified domain, and this deployment is an IP address wearing
an sslip.io hostname. So the phone does the authenticating — with Apple, as it
already does — and vouches for the browser. The code is shown on a screen and is
worthless on its own; claiming it needs an admin's token. The other half of the
pair is 32 random bytes that never leave the browser that made them, and it is
collected exactly once.

The browser gets its own device row, so signing the laptop out does not touch
the phone. There is a bearer-token box folded away underneath, for the case
where the phone is the thing that is lost.

It shows who is signed up, when they were last seen, what they logged this
week, and what each of them costs — per day, per athlete, and per purpose, so
"the bill went up" has an answer. Two levers: let somebody in or revoke them,
and set a per-athlete daily token ceiling.

The panel needs `users.is_admin`, which is set in the database and by no route
— the panel cannot grant itself access, and anybody without the flag gets a 404
rather than a 403, because there is no reason to confirm it is there. User 1 has
it; to add another:

```sh
ssh root@YOUR_IP
cd /opt/lockin/deploy
docker compose -f docker-compose.prod.yml exec -T db   psql -U lockin -d lockin -c 'update users set is_admin = true where id = 2'
```

Prices come from a table in `server/src/domain/pricing.ts`, which is a thing
that goes stale without telling you. The panel prints the rates it used at the
bottom of the page; correct one in `deploy/.env` when the provider reprices:

```
GEMINI_PRICE_GEMINI_3_6_FLASH=0.3/2.5
```

## Giving somebody access to the server

```sh
./deploy/operator.sh root@YOUR_IP list
./deploy/operator.sh root@YOUR_IP add    tarnas ~/keys/tarnas.pub
./deploy/operator.sh root@YOUR_IP remove tarnas
```

`add` creates a named account, installs their public key, and puts them in the
`docker` group. Running it twice rotates the key rather than adding a second
one.

**Be clear-eyed about what the docker group is.** Anyone in it can run
`docker run -v /:/host` and read or write every file on the box — the Postgres
volume and `deploy/.env` included. It is root, one step removed. This is not a
containment boundary and should not be described as one.

What it does buy is accountability and revocability: their own key, their own
name in the logs and in file ownership, and one command that takes it away
without rotating anybody else's key. Give it only to somebody you would have
given root to.

The database holds body weight, meals and training history for **everyone**
using the app, not just the person you are letting in. That is the actual
decision being made here.

Password authentication is off, so there is nothing to send them and nothing to
leak — you need their **public** key (`~/.ssh/id_ed25519.pub` on their machine,
one line beginning `ssh-ed25519`). If they do not have one:

```sh
ssh-keygen -t ed25519 -C "their@email"
cat ~/.ssh/id_ed25519.pub
```

A public key is safe to send over anything. The private half never moves.

After `remove`, their key is gone and their sessions are killed — but they held
root-equivalent access, so rotate what they could have read: `APP_BEARER_TOKEN`
(see below), `GEMINI_API_KEY`, and `POSTGRES_PASSWORD`.

## Adding a friend

Every athlete has their own profile, timezone, contexts, rules and notification
schedule. There are two ways to become one.

**They sign in with Apple.** Install the TestFlight build, tap the button, and
they land on a screen saying the account is waiting. You let them in from the
admin panel, they open the app again, and they are in. Nothing to send and
nothing for them to type.

Signing in is deliberately not the same as being let in: anybody with the
TestFlight link can create an account, and every account costs money the moment
it talks to the trainer.

The build has to be a real one for this to work: Expo Go ships the module's
JavaScript but not its native view, and a simulator has to be signed into an
Apple ID. In both of those the app falls back to the token form below.

**You hand them a token.** Still there, for a build pointed at a different
backend, and for anyone who would rather not involve Apple.

```sh
ssh root@YOUR_IP
cd /opt/lockin/deploy
docker compose -f docker-compose.prod.yml exec api npm run user:create -- --name Sam --timezone Europe/Berlin
```

It prints their token once and stores only its hash. Send it the way you would
send a password. On first launch they open "I have a server token" and enter
`https://YOUR_DOMAIN` and that token. An account made this way is approved on
the spot — running the command is the approval, so they skip the waiting
screen.

Either way they start with a single "Home" context and the enforceable rules —
deliberately not your four German cities or your Skyr breakfast. Those are
yours.

An athlete who signed in with Apple can delete their own account from the rules
screen, which cascades to every row they own. One provisioned by the command
above cannot: that token is yours to withdraw, and a delete button on your own
account would be one tap between you and a year of training.

`APP_BEARER_TOKEN` is still your own token: it is mirrored onto user 1 at every
boot, so rotating it in `deploy/.env` works exactly as described above.
