# Going live

The single sequence from a deployed build to real players. It gathers the release gates from
[`docs/OPERATIONS.md`](OPERATIONS.md), [`docs/ALPHA_TESTING.md`](ALPHA_TESTING.md) and issue #17 into
one ordered runbook, and replaces the manual parts of gate A with a command.

Every check here reads, with one deliberate exception: the gate-B duplicate-webhook probe re-offers
an already-received update to the ingress, exactly as a Telegram retry would. A correct system
inserts nothing — that is the property under test.

---

## 0. Before anything else

| Requirement | How to satisfy it |
|---|---|
| Deployment reachable over HTTPS | Railway public domain, see [`docs/RAILWAY_DEPLOY.md`](RAILWAY_DEPLOY.md) |
| Environment complete | `.env.example`, plus the production-only guards below |
| Backups verified | [`docs/BACKUP_RESTORE.md`](BACKUP_RESTORE.md) |
| Privacy and support reachable by a player | [`docs/PRIVACY.md`](PRIVACY.md), [`docs/SUPPORT.md`](SUPPORT.md) — support is `@BloopyNetworkBot` and must be watched daily |

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
ADMIN_API_KEY=… npm run verify:gate    -- --base-url https://your-deployment --gate b
```

The **actions** stay manual — they need real Telegram accounts — but `verify:gate` walks you through
them one at a time and *asserts the consequence in production state* after each, so a gate is passed
by a check rather than by someone deciding the screen looked right. It covers:

- owner private chat accepted, producing exactly one canonical effect and one reply;
- non-owner rejected, with the rejection recorded as a security event;
- owner group access rejected *before* an allowlist rule exists;
- an approved group rule works, and saving it twice still leaves exactly one enabled rule;
- **a duplicate webhook produces one canonical effect and one reply** — the runner re-offers the
  update to the ingress exactly as a Telegram retry would, which is the one check nobody can perform
  by hand. A correct system inserts nothing;
- token rotation increments the token version and restores the webhook;
- revoke disables the bot, sets `revoked_at` and clears meeting consent;
- queue health is still clean afterwards.

It ends by printing a non-secret evidence block to paste into #17. A step you skip is reported as
skipped and the gate does not pass — "not checked" never counts as "checked".

Re-check a gate later without redoing the actions:

```bash
ADMIN_API_KEY=… npm run verify:gate -- --base-url https://… --gate b --bot <BOT_ID> --assert-only
```

Assert-only reports the delta-based steps (rejections, rotation) as skipped, because they compare
state around your action and there is no action to compare around.

Keep the fleet enabled for a small group only after every step passes.

---

## 3. Phase 3 — two-owner bot meetings (issue #17 gate C)

Requires two real managed bots owned by two distinct Telegram accounts, both through gate B.

```text
MANAGED_BOT_FLEET_ENABLED=true
BOT_TO_BOT_ENABLED=true
```

```bash
ADMIN_API_KEY=… npm run release:check -- --base-url https://your-deployment --phase 3
ADMIN_API_KEY=… npm run verify:gate    -- --base-url https://your-deployment --gate c
```

The runner asserts, after each manual action:

- a meeting is blocked until both owners consent — and no interaction row is created;
- a signed meeting reaches `completed` with recorded turns exactly equal to the turn budget;
- a copied or altered envelope is rejected, recorded as a security event, and advances no turn;
- pair and owner budgets refuse further meetings;
- flipping the kill switch creates no further interaction.

Two properties are not machine-checkable and stay a human judgement:

- [ ] an expired interaction cannot continue (needs a wait past the TTL);
- [ ] no model output grants canonical rewards or state — read a completed exchange and confirm
      every reward came from the deterministic engine.

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
