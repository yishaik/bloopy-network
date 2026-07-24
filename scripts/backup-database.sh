#!/usr/bin/env bash
# Takes a verified, compressed logical backup of the Bloopy database.
#
#   DATABASE_URL=postgres://... ./scripts/backup-database.sh [output-directory]
#
# Uses pg_dump's custom format so scripts/verify-restore.sh can restore it into a scratch database
# without touching production. The dump is checked for readability before this exits, because an
# unverified backup is indistinguishable from no backup at all.
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "backup-database: DATABASE_URL is required" >&2
  exit 2
fi

OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$OUT_DIR/bloopy-$STAMP.dump"

echo "==> dumping to $DUMP"
# --no-owner/--no-privileges keep the dump restorable into a scratch database owned by anyone, which
# is what makes the restore drill runnable outside production.
pg_dump --format=custom --no-owner --no-privileges --file="$DUMP" "$DATABASE_URL"

if [[ ! -s "$DUMP" ]]; then
  echo "backup-database: dump is empty; refusing to report success" >&2
  rm -f "$DUMP"
  exit 1
fi

echo "==> verifying the archive is readable"
TABLES="$(pg_restore --list "$DUMP" | grep -c 'TABLE DATA' || true)"
if [[ "$TABLES" -lt 1 ]]; then
  echo "backup-database: dump contains no table data; refusing to report success" >&2
  exit 1
fi

SIZE="$(du -h "$DUMP" | cut -f1)"
echo "==> ok: $DUMP ($SIZE, $TABLES tables with data)"
echo "$DUMP"
