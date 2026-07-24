#!/usr/bin/env bash
# Exercises the restore half of the backup procedure — the part that is easy to assume and never test.
#
#   RESTORE_URL=postgres://.../bloopy_restore_drill ./scripts/verify-restore.sh ./backups/bloopy-....dump
#
# Restores a dump into a scratch database, then checks the restored copy is actually usable:
# the migration ledger is complete, the tables the game depends on exist and carry their data, and
# re-running migrations against the restored copy is a no-op. Never point RESTORE_URL at production.
set -euo pipefail

DUMP="${1:-}"
if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "verify-restore: pass the path to a dump produced by scripts/backup-database.sh" >&2
  exit 2
fi
if [[ -z "${RESTORE_URL:-}" ]]; then
  echo "verify-restore: RESTORE_URL (a scratch database, never production) is required" >&2
  exit 2
fi
if [[ -n "${DATABASE_URL:-}" && "$RESTORE_URL" == "$DATABASE_URL" ]]; then
  echo "verify-restore: RESTORE_URL is the same as DATABASE_URL; refusing to restore over the live database" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_MIGRATIONS="$(find "$REPO_ROOT/apps/server/migrations" -name '*.sql' | wc -l | tr -d ' ')"

echo "==> restoring $DUMP into the scratch database"
# --clean --if-exists makes the drill repeatable against the same scratch database.
pg_restore --no-owner --no-privileges --clean --if-exists --dbname="$RESTORE_URL" "$DUMP" 2>&1 | grep -vE 'does not exist, skipping' || true

query() { psql --quiet --no-align --tuples-only --dbname="$RESTORE_URL" --command "$1"; }

echo "==> checking the migration ledger"
APPLIED="$(query 'SELECT count(*) FROM schema_migrations')"
LATEST="$(query 'SELECT max(filename) FROM schema_migrations')"
if [[ "$APPLIED" != "$EXPECTED_MIGRATIONS" ]]; then
  echo "verify-restore: restored copy has $APPLIED migrations, this checkout has $EXPECTED_MIGRATIONS (latest restored: $LATEST)" >&2
  exit 1
fi
echo "    $APPLIED migrations, latest $LATEST"

echo "==> checking core tables survived the round trip"
for TABLE in players creatures story_entries memories quest_instances relationships schema_migrations runtime_controls referrals account_lifecycle_events; do
  COUNT="$(query "SELECT count(*) FROM $TABLE" 2>/dev/null || echo MISSING)"
  if [[ "$COUNT" == "MISSING" ]]; then
    echo "verify-restore: table $TABLE is missing from the restored copy" >&2
    exit 1
  fi
  printf '    %-26s %s rows\n' "$TABLE" "$COUNT"
done

echo "==> checking the seeded world restored intact"
NPCS="$(query "SELECT count(*) FROM creatures WHERE kind IN ('npc','system')")"
if [[ "$NPCS" -lt 1 ]]; then
  echo "verify-restore: the restored copy has no seeded NPCs; the world would be empty" >&2
  exit 1
fi
echo "    $NPCS seeded world characters"

echo "==> checking migrations are idempotent against the restored copy"
BEFORE="$APPLIED"
# The migration runner imports the app config, which insists on an encryption key. Migrations never
# touch sealed data, so the drill uses a throwaway key rather than requiring the production one, and
# runs outside production mode so the live-deployment config gates do not apply to a scratch database.
DATABASE_URL="$RESTORE_URL" \
NODE_ENV=development \
APP_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  npm --prefix "$REPO_ROOT" run migrate --silent >/dev/null
AFTER="$(query 'SELECT count(*) FROM schema_migrations')"
if [[ "$BEFORE" != "$AFTER" ]]; then
  echo "verify-restore: re-running migrations changed the ledger ($BEFORE -> $AFTER); the dump is not at a clean schema version" >&2
  exit 1
fi

echo "==> restore drill passed"
