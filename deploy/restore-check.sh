#!/usr/bin/env bash
# Does the newest backup actually restore?
#
# A backup nobody has restored is a hope. This takes the newest dump, loads it
# into a scratch database next to the real one, counts what came back, and
# throws the scratch away. It reads the backup and writes nowhere near the
# database it came from.
#
# Worth running by hand after any change to the schema, and worth a cron of its
# own once there is anybody to lose data belonging to.
#
#   ./deploy/restore-check.sh                        # on the box
#   BACKUP_DIR=/tmp/x COMPOSE=docker-compose.yml ./deploy/restore-check.sh

set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-/var/backups/lockin}
COMPOSE=${COMPOSE:-docker-compose.prod.yml}
SCRATCH=lockin_restore_check
DB_USER=${DB_USER:-lockin}

newest=$(ls -t "$BACKUP_DIR"/lockin-*.sql.gz 2>/dev/null | head -1 || true)
if [ -z "$newest" ]; then
  echo "no backup found in $BACKUP_DIR" >&2
  exit 1
fi
echo "restoring $(basename "$newest")"

psql() { docker compose -f "$COMPOSE" exec -T db psql -U "$DB_USER" "$@"; }

# Always from a clean slate, and always cleaned up — including on the way out
# of a failure, so a broken run does not leave a database lying around that the
# next run mistakes for something.
cleanup() { psql -d postgres -q -c "drop database if exists $SCRATCH" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
psql -d postgres -q -c "create database $SCRATCH"

# `--clean --if-exists` in the dump means the errors from dropping things that
# were never there are expected; a genuine failure shows up in the counts.
gunzip -c "$newest" | psql -d "$SCRATCH" -q >/dev/null 2>&1 || true

rows=$(psql -d "$SCRATCH" -t -c "
  select coalesce(sum(n), 0) from (
    select (xpath('/row/c/text()', query_to_xml(
      format('select count(*) as c from %I.%I', table_schema, table_name),
      false, true, '')))[1]::text::int as n
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  ) counted" | tr -d ' \r\n')

tables=$(psql -d "$SCRATCH" -t -c "
  select count(*) from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'" | tr -d ' \r\n')

echo "restored $tables tables, $rows rows"

# A dump that restores into an empty database is a dump of nothing, and it
# passes every check that only looks at the file.
if [ "${tables:-0}" -lt 10 ] || [ "${rows:-0}" -lt 1 ]; then
  echo "that is not a working restore" >&2
  exit 1
fi

echo "ok"
