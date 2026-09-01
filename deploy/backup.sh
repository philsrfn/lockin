#!/usr/bin/env bash
# Nightly database backup. Installed by provision-backups.sh into /etc/cron.daily.
#
# Phil's training history cannot be reconstructed — he cannot re-lift a lost
# week. Keeps 30 daily dumps, which is small: this database is measured in
# kilobytes for a long time yet.

set -euo pipefail

BACKUP_DIR=/var/backups/lockin
KEEP_DAYS=30
STAMP=$(date +%F-%H%M)

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

find "$BACKUP_DIR" -name 'lockin-*.sql.gz' -mtime +$KEEP_DAYS -delete

echo "$(date -Is) ok $(du -h "$BACKUP_DIR/lockin-$STAMP.sql.gz" | cut -f1)"
