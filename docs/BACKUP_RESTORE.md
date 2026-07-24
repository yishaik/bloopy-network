# Backup and restore

A backup that has never been restored is not a backup. This procedure produces one and then proves
it, and the proof runs in CI on every change so a migration cannot quietly break recovery.

## What is at risk

Everything a player has is in PostgreSQL: creature identity, authored choices, stories, memories,
progression, relationships, notification preferences, sealed AI credentials and managed-bot
registrations. There is no second copy in the application.

Two classes of loss need different answers:

| Loss | Answer |
|---|---|
| Database destroyed or corrupted | Restore from the most recent verified dump. |
| `APP_ENCRYPTION_KEY` lost | The database survives; every sealed secret in it does not. |

Losing the encryption key is unrecoverable for stored credentials — managed bot tokens, BYOK and
OpenRouter keys, and OAuth verifiers all decrypt with it. Store it where you store the database
credentials, and back it up separately from the database itself, or a single compromise takes both.

## Take a backup

```bash
DATABASE_URL="postgres://…" ./scripts/backup-database.sh ./backups
```

Writes `bloopy-<UTC timestamp>.dump` in PostgreSQL custom format, then refuses to report success
unless the archive is non-empty and actually lists table data. It prints the dump path on stdout, so
it composes:

```bash
DUMP=$(DATABASE_URL="$DATABASE_URL" ./scripts/backup-database.sh ./backups | tail -1)
```

Railway's managed PostgreSQL takes its own snapshots. Those cover infrastructure loss; this dump is
what you can read, inspect and restore anywhere, including into a scratch database for a drill.

## Verify the restore

Never against production. The script refuses if `RESTORE_URL` equals `DATABASE_URL`.

```bash
createdb bloopy_restore_drill
RESTORE_URL="postgres://…/bloopy_restore_drill" ./scripts/verify-restore.sh "$DUMP"
```

It restores the dump and then checks the restored copy is genuinely usable:

- the migration ledger is complete and matches the migration files in this checkout;
- every core table exists and its row count is reported;
- the seeded world characters survived, so the world is not empty;
- re-running migrations against the restored copy changes nothing, proving the dump sits at a clean
  schema version rather than mid-migration.

The migration step uses a throwaway `APP_ENCRYPTION_KEY`: migrations never touch sealed data, and a
restore drill should not require the production key.

## Cadence

| When | What |
|---|---|
| Before every production migration | Take a backup. Additive migrations still deserve a rollback point. |
| Daily while an alpha is running | Take a backup and keep at least 7 days. |
| Before Phase 2 and Phase 3 | Take a backup **and** run the restore drill. |
| Every CI run | The drill runs automatically against the schema on that commit. |
| Quarterly | Run the drill against a real production dump, not a CI fixture. |

## Restoring for real

1. Stop writes: set `DEGRADED_MODE=true`, or pause `telegram_ingress` and `outbox_delivery` through
   the admin runtime controls. Recovering into a moving target creates a second incident.
2. Restore into a **new** database, never over the damaged one — you may need the damaged copy.
3. Run `verify-restore.sh` against it.
4. Point `DATABASE_URL` at the restored database and redeploy.
5. Run the release preflight: `npm run release:check -- --base-url https://… --phase 1`.
6. Expect duplicate-looking Telegram deliveries for work that was in flight. The outbox is
   idempotent on `source_key` and canonical mutations are keyed by command, so replays do not
   duplicate rewards — but check `/api/admin/metrics` for uncertain deliveries before resuming.
7. Lift the pause only after `/readyz` is green and the queues are clean.

## What a restore cannot undo

A completed account deletion is permanent by design. If a player deletes their account and a backup
taken beforehand is later restored wholesale, their data comes back — which is a privacy incident,
not a recovery. After any restore that crosses a deletion, re-apply deletions recorded in
`account_lifecycle_events` (`event_type='account_deleted'`) for the affected window. The audit rows
carry a one-way `subject_ref`, so match them against your support record of the request rather than
against the database.
