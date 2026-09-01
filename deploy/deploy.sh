#!/usr/bin/env bash
# Ship the current working tree to the server and bring it up.
#
#   ./deploy/deploy.sh root@YOUR_IP
#
# Rebuilds the API image on the server and restarts it. Migrations run on boot
# and are tracked in schema_migrations, so this is safe to run repeatedly.

set -euo pipefail

TARGET="${1:?usage: deploy.sh user@host}"
REMOTE_DIR=/opt/lockin
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -f "$ROOT/deploy/.env" ]; then
  echo "deploy/.env is missing. Copy deploy/.env.example and fill it in." >&2
  exit 1
fi

echo "==> syncing to $TARGET:$REMOTE_DIR"
# Source only. node_modules is rebuilt in the image; .env is sent separately
# so a stray local file can never overwrite the server's secrets by accident.
rsync -az --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'dist' \
  --exclude '.env' \
  --exclude 'app/' \
  "$ROOT/server" "$ROOT/deploy" \
  "$TARGET:$REMOTE_DIR/"

echo "==> sending secrets"
scp -q "$ROOT/deploy/.env" "$TARGET:$REMOTE_DIR/deploy/.env"

echo "==> building and starting"
ssh "$TARGET" "cd $REMOTE_DIR/deploy && docker compose -f docker-compose.prod.yml up -d --build"

echo "==> waiting for health"
DOMAIN=$(grep '^LOCKIN_DOMAIN=' "$ROOT/deploy/.env" | cut -d= -f2-)
for i in $(seq 1 60); do
  if curl -sf -m 5 "https://$DOMAIN/health" >/dev/null 2>&1; then
    echo "    healthy after ${i}s"
    curl -s "https://$DOMAIN/health"; echo
    exit 0
  fi
  sleep 2
done

echo "    not healthy yet — check: ssh $TARGET 'cd $REMOTE_DIR/deploy && docker compose -f docker-compose.prod.yml logs --tail 50'" >&2
exit 1
