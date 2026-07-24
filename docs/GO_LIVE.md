# Going live

The single sequence from a deployed build to real players. It gathers the release gates from
[`docs/OPERATIONS.md`](OPERATIONS.md), [`docs/ALPHA_TESTING.md`](ALPHA_TESTING.md) and issue #17 into
one ordered runbook, and replaces the manual parts of gate A with a command.

Nothing here mutates production. Every check reads.

---

## 0. Before anything else

| Requirement | How to satisfy it |
|---|---|
| Deployment reachable over HTTPS | Railway public domain, see [`docs/RAILWAY_DEPLOY.md`](RAILWAY_DEPLOY.md) |
| Environment complete | `.env.example`, plus the production-only guards below |
| Backups verified | [`docs/BACKUP_RESTORE.md`](BACKUP_RESTORE.md) |
| Privacy and support reachable by a player | [`docs/PRIVACY.md`](PRIVACY.md), [`docs/SUPPORT.md`](SUPPORT.md) |

### Production configuration guards

The server refuses to boot in `NODE_ENV=production` if any of these is wrong, so a misconfigured
deploy fails at start rather than at the first player:

- `PUBLIC_BASE_URL` must be `https://` — Telegram will not deliver a webhook anywhere else.
- `DEMO_MODE` must be `false`.
- `ALLOW_LOCAL_AI` must be `false` — it exempts loopback addresses from the SSRF guard.
- `TELEGRAM_MANAGER_BOT_TOKEN` is required whenever `TELEGRAM_INGRESS_ENABLED=true`.
- `ADMIN_API_KEY` is required, minimum 32 characters — recovery and the preflight depend on it.
- `TELEGRAM_MANAGER_BOT_USERNAME` is required whenever `MANAGED_BOT_FLEET_ENABLED=true`.
- `BOT_TO_BOT_ENABLED` requires `MANAGED_BOT_FLEET_ENABLED` (enforced in every environment).
- `APP_ENCRYPTION_KEY` must not be the published all-zero development key.
- `TELEGRAM_WEBHOOK_SECRET` must not be a placeholder.

---

## 1. Phase 1 — core-game private alpha

**Audience:** 5–10 known testers. **Risky surfaces:** off.

```text
TELEGRAM_INGRESS_ENABLED=true
OUTBOX_ENABLED=true
DEGRADED_MODE=false
MANAGED_BOT_FLEET_ENABLED=false
BOT_TO_BOT_ENABLED=false
```

### Gate A — automated preflight

```bash
ADMIN_API_KEY=… npm run release:check -- --base-url https://your-deployment --phase 1
```

Exits non-zero if any check fails. It verifies:

- `/livez` and `/readyz`, including `migrationsReady` and that degraded mode is off;
- `/health` version matches the version in this checkout;
- the runtime flags match the phase (a phase-2 flag set fails a phase-1 check, and vice versa);
- no failed Telegram updates, uncertain deliveries, dead letters or failed deliveries;
- the applied migration ledger matches the migration files on this commit;
- the Mini App shell is served and an unknown share token returns 404.

Without `ADMIN_API_KEY` the flag, queue and migration checks report `SKIP`, never `PASS`. A release
sign-off needs a run with zero skips.

### Gate A — the parts a human still has to do

- [ ] Confirm the deployed commit is the one you intended.
- [ ] Manager bot `/start` in Telegram returns the expected reply.
- [ ] Mini App opens from the bot, bootstraps, and one action persists across a reopen.
- [ ] Run the outbox pause/resume recovery drill in [`docs/OPERATIONS.md`](OPERATIONS.md).
- [ ] Backup and restore drill passed today ([`docs/BACKUP_RESTORE.md`](BACKUP_RESTORE.md)).

### Then invite

Follow [`docs/PHASE1_ALPHA.md`](PHASE1_ALPHA.md) for the roster, the tester journey, the stop
conditions and the findings template.

---

## 2. Phase 2 — one managed bot (issue #17 gate B)

Requires one real managed bot owned by one test Telegram account.

```text
MANAGED_BOT_FLEET_ENABLED=true
BOT_TO_BOT_ENABLED=false
```

```bash
ADMIN_API_KEY=… npm run release:check -- --base-url https://your-deployment --phase 2
```

Then verify by hand, because none of this can be proven without a real Telegram account:

- [ ] owner private chat accepted;
- [ ] non-owner rejected, with no private state leaked in the rejection;
- [ ] owner group access rejected *before* an allowlist rule exists;
- [ ] an approved group rule works, and saving it twice still leaves exactly one rule;
- [ ] a duplicate webhook delivery produces one canonical effect and one reply;
- [ ] token rotation invalidates the previous token and restores the webhook;
- [ ] revoke disables webhook access and the bot;
- [ ] queue health still clean afterwards (re-run the preflight).

Keep the fleet enabled for a small group only after every box is ticked.

---

## 3. Phase 3 — two-owner bot meetings (issue #17 gate C)

Requires two real managed bots owned by two distinct Telegram accounts, both through gate B.

```text
MANAGED_BOT_FLEET_ENABLED=true
BOT_TO_BOT_ENABLED=true
```

```bash
ADMIN_API_KEY=… npm run release:check -- --base-url https://your-deployment --phase 3
```

- [ ] a meeting is blocked until both owners consent;
- [ ] a signed meeting completes within the turn budget;
- [ ] a copied or altered envelope is rejected;
- [ ] stale, repeated and out-of-order turns do not advance state;
- [ ] an expired interaction cannot continue;
- [ ] pair and owner budgets are enforced;
- [ ] flipping the kill switch blocks new interactions immediately;
- [ ] no model output grants canonical rewards or state.

Close #17 once gates A, B and C have passed with non-secret production evidence.

---

## 4. Broad or public release

Every one of these must hold. They are the roadmap's hard gates, not preferences.

- [ ] #17 gates A, B and C passed with recorded evidence.
- [ ] Backup **and restore** exercised against a real production dump.
- [ ] Self-service export, creature reset and account deletion are live in the Mini App, and the
      manual fallback in [`docs/PRIVACY.md`](PRIVACY.md) is staffed.
- [ ] Privacy copy and a support channel are reachable by a player who has never met you.
- [ ] Media ingestion (#43), if enabled, satisfies its validation and retention requirements.
- [ ] Production metrics show no unexplained failed updates, uncertain delivery or duplicate
      canonical effects.
- [ ] Tester evidence confirms onboarding, both arcs, daily return and notifications are stable.

---

## If something goes wrong

| Symptom | First move |
|---|---|
| `/readyz` returns 503 | Read the body: it names the failing dimension. See OPERATIONS.md. |
| Deliveries failing or uncertain | Pause `outbox_delivery` via the admin runtime control, then inspect `/api/admin/outbox/problems`. |
| Duplicate rewards or stories | Stop invitations immediately. This is a P0; the idempotency guarantees are the product. |
| Suspected data exposure | Set `DEGRADED_MODE=true` (safe read-only), then investigate. |
| Bad release | Roll back per OPERATIONS.md. Migrations 001–020 are additive; the previous build reads the newer schema. |

Pausing invitations is always cheaper than debugging in front of players.
