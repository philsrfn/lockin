#!/usr/bin/env bash
# Nightly database backup.
#
# A training history cannot be reconstructed — nobody can re-lift a lost week.
# Keeps 30 daily dumps, which is small: this database is measured in kilobytes
# for a long time yet.
#
# AND THEN OFF THE BOX.
#
# Thirty dumps on the same disk as the database they came from is a copy, not
# a backup: the failure they exist for — the machine is gone — takes them with
# it. `BACKUP_REMOTE` is an rclone destination and the script refuses to run
# without it unless `BACKUP_LOCAL_ONLY=1` says so out loud. A backup that
# silently only half works is the kind that is discovered on the worst
# possible day.

set -euo pipefail

BACKUP_DIR=/var/backups/lockin
KEEP_DAYS=30
STAMP=$(date +%F-%H%M)

# Read where to send it. deploy/.env is the same file the stack is configured
# from, so there is one place to look.
if [ -f /opt/lockin/deploy/.env ]; then
  # shellcheck disable=SC1091
  set -a; . /opt/lockin/deploy/.env; set +a
fi

if [ -z "${BACKUP_REMOTE:-}" ] && [ "${BACKUP_LOCAL_ONLY:-0}" != "1" ]; then
  echo "BACKUP_REMOTE is not set: this would keep the backups on the same disk" >&2
  echo "as the database. Set it to an rclone destination, or set" >&2
  echo "BACKUP_LOCAL_ONLY=1 if that is genuinely what you want." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

cd /opt/lockin/deploy
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U lockin --clean --if-exists lockin \
  | gzip > "$BACKUP_DIR/lockin-$STAMP.sql.gz"

# A dump that failed halfway is worse than no dump, because it looks like one.
if [ ! -s "$BACKUP_DIR/lockin-$STAMP.sql.gz" ]; then
  echo "backup produced an empty file" >&2
  rm -f "$BACKUP_DIR/lockin-$STAMP.sql.gz"
  exit 1
fi
if ! gzip -t "$BACKUP_DIR/lockin-$STAMP.sql.gz" 2>/dev/null; then
  echo "backup is not valid gzip" >&2
  exit 1
fi

# Off the box, before the local copy is trimmed — so a failure here leaves
# everything where it was rather than having tidied up first.
if [ -n "${BACKUP_REMOTE:-}" ]; then
  if ! command -v rclone >/dev/null 2>&1; then
    echo "rclone is not installed but BACKUP_REMOTE is set" >&2
    exit 1
  fi
  rclone copy "$BACKUP_DIR/lockin-$STAMP.sql.gz" "$BACKUP_REMOTE" --no-traverse
  # Trust nothing: ask the far end whether it has the file and how big it is.
  remote_size=$(rclone size "$BACKUP_REMOTE/lockin-$STAMP.sql.gz" --json 2>/dev/null \
    | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')
  local_size=$(wc -c < "$BACKUP_DIR/lockin-$STAMP.sql.gz" | tr -d ' ')
  if [ "${remote_size:-0}" != "$local_size" ]; then
    echo "copy to $BACKUP_REMOTE did not arrive intact ($remote_size vs $local_size)" >&2
    exit 1
  fi
fi

find "$BACKUP_DIR" -name 'lockin-*.sql.gz' -mtime +$KEEP_DAYS -delete

echo "$(date -Is) ok $(du -h "$BACKUP_DIR/lockin-$STAMP.sql.gz" | cut -f1)${BACKUP_REMOTE:+ -> $BACKUP_REMOTE}"
