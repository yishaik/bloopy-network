# Bloopy production operations

This document is the canonical deployment, Railway handoff, incident-control and recovery runbook for Bloopy Network.

## Responsibility split

- **Application/code work**: branches, migrations, tests, pull requests, release notes and rollback compatibility.
- **Alfred / Railway work**: deployments, environment variables, secrets, PostgreSQL verification, public domains and production health checks.

## Railway handoff protocol

Only actionable infrastructure work receives the `railway` label or a comment containing `[railway]` / `@railway`.

Every handoff must include:

1. the exact commit or branch to deploy;
2. the exact migration filenames expected;
3. environment-variable names and whether each is secret;
4. non-secret verification steps;
5. rollback instructions or a kill switch;
6. an explicit instruction not to print secret values in comments or logs.

Alfred must reply with non-secret evidence, report concrete blockers, and remove the `railway` label when the action is complete or blocked on human/product input.

## Required production baseline

Secrets:

- `DATABASE_URL`
- `APP_ENCRYPTION_KEY`
- `TELEGRAM_MANAGER_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- optional `ADMIN_API_KEY` for operational endpoints
- optional `PLATFORM_AI_API_KEY` only after a platform model is explicitly selected

Non-secret configuration:

- `NODE_ENV=production`
- `DEMO_MODE=false`
- `PUBLIC_BASE_URL=https://...`
- `TELEGRAM_MANAGER_BOT_USERNAME`
- `TELEGRAM_INGRESS_ENABLED=true`
- `OUTBOX_ENABLED=true`
- `DEGRADED_MODE=false`

The following risky surfaces remain disabled until their human verification gates pass:

- `MANAGED_BOT_FLEET_ENABLED=false`
- `BOT_TO_BOT_ENABLED=false`

Never place secret values in GitHub issues, PR comments, deployment logs or screenshots.

## Health endpoints

### Liveness

`GET /livez`

Checks that the application process can answer. It does not prove database or queue readiness.

### Readiness

`GET /readyz`

Checks:

- PostgreSQL connectivity;
- migration `019_telegram_delivery_runtime.sql` is applied;
- Telegram update backlog is below `READY_MAX_UPDATE_BACKLOG`;
- outbox backlog is below `READY_MAX_OUTBOX_BACKLOG`.

A `503` response means the deployment should not receive new traffic until the reason is understood. The response contains only non-secret queue and control state.

### Versioned health

`GET /health`

Checks PostgreSQL and returns the application version. Release `0.11.0` is the leased Telegram delivery runtime.

## Runtime controls

The environment variables are boot-time kill switches:

- `TELEGRAM_INGRESS_ENABLED`
- `MANAGED_BOT_FLEET_ENABLED`
- `BOT_TO_BOT_ENABLED`
- `OUTBOX_ENABLED`
- `DEGRADED_MODE`

With `ADMIN_API_KEY`, runtime controls can be changed without a deployment:

- `POST /api/admin/runtime/controls/telegram_ingress`
- `POST /api/admin/runtime/controls/outbox_delivery`
- `POST /api/admin/runtime/controls/risky_mutations`

Body:

```json
{"enabled": false, "reason": "short non-secret operator reason"}
```

Runtime changes are written to `operational_events`.

## Safe degraded mode

For an incident that affects writes but not reading:

1. disable `risky_mutations` through the admin endpoint, or set `DEGRADED_MODE=true` and redeploy;
2. leave `/api/bootstrap`, story history and avatars readable;
3. inspect `/readyz` and `/api/admin/metrics`;
4. resume writes only after queue/database health is understood.

For Telegram ingress pressure:

1. disable `telegram_ingress`;
2. keep the outbox running so committed replies can drain;
3. inspect `telegram_updates` state counts;
4. re-enable ingress after the backlog is below the readiness threshold.

For outbound delivery problems:

1. disable `outbox_delivery`;
2. do not replay `uncertain` rows automatically;
3. inspect problem rows and Telegram status;
4. replay only a specifically approved row.

## Telegram update lifecycle

States:

- `received`
- `processing`
- `retryable`
- `completed`
- `failed`

The webhook validates its secret, persists the full update and returns quickly. A worker claims updates using a short lease. Canonical game mutations use separate command/idempotency keys, so retrying an update cannot reapply XP, stars, energy, quests, stories or memories.

Expired processing leases return to `retryable`.

## Outbox lifecycle

States:

- `pending`
- `sending`
- `retryable`
- `sent`
- `uncertain`
- `dead_letter`

Classification:

- Telegram `429`: retryable and respects `retry_after`;
- known permanent `4xx`: dead letter;
- Telegram `5xx`: bounded retry, then dead letter;
- timeout, aborted request or ambiguous network failure: uncertain;
- expired `sending` lease after restart: uncertain.

`uncertain` means Telegram may have accepted the message. It must not be retried automatically because Telegram `sendMessage` has no application-provided idempotency key.

## Inspecting and replaying delivery

Requires `ADMIN_API_KEY`.

List problem rows:

```text
GET /api/admin/outbox/problems?limit=100
```

Explicitly replay an approved item:

```text
POST /api/admin/outbox/<uuid>/replay
```

Replay resets the delivery attempt and records `outbox_manual_replay` in `operational_events`. An operator must accept that replaying an uncertain row can produce a duplicate Telegram message.

Recover expired leases:

```text
POST /api/admin/runtime/recover
```

This makes expired update leases retryable and expired outbound leases uncertain.

## Metrics to inspect

`GET /api/admin/metrics` requires `ADMIN_API_KEY` and reports:

- Telegram update counts by state;
- outbox counts by state;
- worker lag;
- AI usage/fallbacks;
- analytics events;
- security events;
- bot-interaction states;
- operational events.

Stop adding testers when any of the following occurs:

- `/readyz` returns `503`;
- `failed` Telegram updates increase;
- `uncertain` or `dead_letter` outbox rows are not understood;
- duplicate canonical effects are observed;
- unauthorized managed-bot access succeeds;
- deployment enters a restart loop.

## Deployment checklist

1. All PR checks pass, including every PostgreSQL smoke suite.
2. PR is no longer a draft and has no unresolved review thread.
3. Merge uses the exact tested head SHA.
4. Alfred confirms the exact merge commit was deployed.
5. Expected additive migrations applied once.
6. `/livez` returns `200`.
7. `/readyz` returns `200` and `ready:true`.
8. `/health` returns the expected version.
9. Admin metrics show no unexplained failed/uncertain/dead-letter work.
10. Risky feature flags match the current alpha phase.

## Rollback

Migrations are forward-safe and additive. Do not attempt to roll back schema migrations during an incident.

1. Engage the narrowest kill switch.
2. Redeploy the previous known-good application commit.
3. Keep the additive database schema.
4. Verify `/livez`, `/readyz` and `/health`.
5. Inspect queue state before re-enabling ingress or delivery.
6. Record the incident and the exact non-secret recovery actions.

## Cleanup and retention

- completed Telegram update identifiers are retained for `PROCESSED_UPDATE_RETENTION_DAYS`;
- old sent outbox rows are cleaned after their retention period;
- active, retryable, processing, uncertain and dead-letter work is not deleted by routine cleanup.

## Human verification dependency

Managed-bot ownership and bot-to-bot behavior cannot be fully verified without real Telegram resources. The required staged test and feature-enable sequence is defined in [`ALPHA_TESTING.md`](./ALPHA_TESTING.md).
