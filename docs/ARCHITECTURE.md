# Bloopy Network architecture

## Executive summary

Bloopy Network is a TypeScript modular monolith: one deployable Node.js service with strict domain boundaries, PostgreSQL persistence, Telegram webhooks, a static Mini App, public share rendering, background workers, account-lifecycle controls and optional constrained AI narration.

The central rule is:

> Canonical game state is decided transactionally by deterministic domain code. Telegram, public rendering and AI may deliver or present results, but they do not own the rules.

## System context

```text
Telegram user
   ├── manager bot
   ├── managed creature bot (staged)
   └── Mini App
              │
              ▼
       Fastify application
  ┌───────────┼───────────────┬─────────────────┐
  │           │               │                 │
player API  webhooks     public share pages  admin/verification
  │           │               │                 │
  └───────────┴───────┬───────┴─────────────────┘
                      ▼
               domain modules
 game / stories / memory / sharing / account / bots / AI policy
                      │
                      ▼
                  PostgreSQL
 canonical state / credentials / queues / audit / migration ledger
                      │
               background worker
              ┌───────┴─────────┐
              ▼                 ▼
      leased Telegram      scheduled world/
      ingress + outbox     notification work
              │
              ▼
       Telegram Bot API

canonical facts → AI policy/budget → provider → validation/moderation
       └──────────────── deterministic fallback on any failure
```

## Deployment model

One service currently provides:

- authenticated player APIs;
- Telegram manager/managed-bot webhooks;
- Mini App static assets;
- public share HTML/SVG/text surfaces;
- background ingress/outbox/event workers;
- account export/reset/delete;
- migrations and migration-ledger checks;
- liveness/readiness/version health;
- operational and verification endpoints.

PostgreSQL is the durable source of truth. A process restart must preserve state and recover leased asynchronous work.

## Module boundaries

### HTTP composition

`server.ts` should remain composition code:

- Fastify setup;
- request validation/authentication;
- route wiring;
- degraded-mode gate;
- health/admin routes;
- worker scheduling;
- global typed error handling.

Domain logic belongs in focused modules.

### Configuration

`config.ts` parses environment variables, sets bounds/defaults and rejects insecure production configuration such as HTTP public URLs, demo/local-AI production mode, missing/weak admin keys, missing Telegram prerequisites or incompatible risky flags.

### Game domain

Owns:

- player/creature bootstrap;
- Character Genesis;
- actions, energy and progression;
- shop/inventory;
- quests/relationships;
- shared-link encounters and canonical referral rewards.

### Story engine

Validated arc definitions own activation, beats, legal choices, canonical effects, route inheritance and deterministic fallback. Optional AI only enriches presentation after the canonical result exists.

### Memory and notifications

Memory modules own editable memories, lineage, personality and daily-return state. Notification modules own timezone/quiet hours and unique scheduling intent. They enqueue delivery rather than call Telegram directly.

### Public sharing

Public share behavior uses a dedicated player-safe view, not raw domain rows.

Current surfaces:

- `/share/c/:token`;
- profile/story SVG cards;
- text summary fallback.

Architecture rules:

- opaque random share token;
- explicit public field allowlist;
- no scripts/remote assets where the route promises a self-contained page;
- safe text/SVG escaping;
- generic not-found;
- new generation token/slug after creature reset;
- no private owner identifier in the token or response.

Referral attribution is persisted separately from rendering and bound to the durable referred player account, making payout one-time across creature resets.

### Account lifecycle

Account lifecycle owns:

- explicit-column JSON export;
- managed-bot revoke coordination;
- creature reset;
- account deletion;
- cleanup of FK and non-FK identity-bearing records;
- anonymized lifecycle/security audit where retention is required;
- fresh bootstrap after reset;
- idempotent repeated deletion without accidental account recreation.

External bot revocation happens before deleting registry authorization. Canonical reset/delete then occurs transactionally.

### Telegram protocol and control plane

Telegram modules own manager/managed-bot translation, bot registration/configuration, owner/chat authorization, token rotation/revoke and signed interaction turns.

Managed-bot tokens remain encrypted. Owner-private access is default; other users/groups require explicit allowlist rules.

### Delivery runtime

#### Ingress

```text
received → processing → completed
              ├→ retryable → processing
              └→ failed
```

Webhook secret is validated, full update persisted and response returned quickly. A worker claims with a short lease. Command keys protect canonical effects from replay. Expired processing leases become retryable.

#### Outbox

```text
pending → sending → sent
             ├→ retryable → sending
             ├→ dead_letter
             └→ uncertain
```

Claim/finalize transactions are short; Telegram calls occur between them.

- `429` honors retry-after;
- known transient `5xx` retries with bounds;
- permanent `4xx` dead-letters;
- ambiguous timeout/network result becomes uncertain;
- expired sending lease becomes uncertain.

Uncertain delivery is never automatically replayed.

### Worker

The bounded non-overlapping worker loop performs:

- expired lease recovery;
- Telegram ingress processing;
- notification scheduling;
- due world events;
- periodic cleanup;
- outbox delivery.

At larger scale these can become separate processes while preserving the same PostgreSQL queues and idempotency contracts.

### AI and OpenRouter

AI has four boundaries:

1. canonical facts exist before inference;
2. credentials/provider access are encrypted, validated, SSRF-protected and budgeted;
3. prompt context is approved and bounded;
4. output is validated/moderated with deterministic fallback.

AI cannot select rewards, mutate canonical state, choose another player or call Telegram directly.

### Avatar/card rendering

The versioned genome deterministically renders SVG, preserving identity and keeping cost low. Public cards inline only safe visual/text data. Future generative assets must preserve genome identity.

## Authentication

### Mini App

Telegram initData is validated server-side. Managed-bot launches may require validating with the relevant managed-bot token.

### Webhooks

Manager and managed webhooks use Telegram secret-token headers. Legacy path-secret routes should not be used for new integrations.

### Admin

`ADMIN_API_KEY` protects operational, verification and manual-replay endpoints with constant-time comparison.

Admin APIs are not product APIs.

## Ownership

Private resources are owner-scoped server-side:

- managed bots;
- memories;
- account export/reset/delete;
- meeting invitations/history;
- future matchmaking queue entries;
- AI credentials.

Client-supplied owner IDs are never authoritative.

## Canonical mutation pattern

```text
validate
 → authenticate and derive owner
 → load/lock state
 → verify prerequisites
 → claim idempotency
 → apply canonical effects
 → record related audit/analytics
 → commit
 → optional external narration/delivery
 → finalize permitted presentation/operational state
```

External failure must not undo committed canonical state unless the external result is itself the required canonical prerequisite.

## Data model categories

PostgreSQL stores:

- players, creatures and onboarding;
- progression, inventory, quests and relationships;
- story/arc state;
- memories/personality/daily returns;
- notifications;
- share tokens and referral attribution;
- AI profiles/OAuth/usage logs;
- managed bots/access/security events;
- bot interactions/turns;
- Telegram updates/outbox;
- runtime controls/operational events;
- account lifecycle audit;
- migration ledger.

Migrations are additive and immutable once applied.

## Errors

Expected domain failures use `AppError` with stable code, HTTP status and player-safe message. Unexpected errors are logged safely and returned generically.

Never expose stack traces, SQL/Zod internals, provider secret bodies or private ownership information.

## Readiness and release verification

Endpoints:

- `/livez` — process liveness;
- `/readyz` — database, complete migration ledger, queue thresholds and runtime readiness;
- `/health` — database check and package release version.

Release 0.12 reads the version from package metadata rather than a duplicated hardcoded value.

`npm run release:check` verifies:

- expected version;
- migration ledger versus checkout;
- phase-appropriate flags;
- queue health;
- liveness/readiness/health;
- required checks are not silently skipped.

`npm run verify:gate` supports non-secret human-verification probes.

## Backup and restore

Backup/restore tooling is part of architecture, not an external assumption.

The verified restore drill checks:

- PostgreSQL version compatibility;
- migration ledger;
- core tables;
- seeded world;
- migration rerun no-op;
- refusal to target production for destructive verification.

See [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md).

## Degraded mode and runtime controls

Runtime controls can pause Telegram ingress, outbox delivery and risky mutations. Read-only mode preserves safe reads where possible.

Boot-time flags separately control managed bots and bot-to-bot. Planned matchmaking receives its own flag.

## Observability

Admin metrics expose privacy-safe counts for:

- update/outbox lifecycle;
- worker lag;
- AI use/fallback;
- analytics/security/operational events;
- bot interactions;
- migration ledger;
- account lifecycle events;
- runtime flags.

Planned additions include invitation, player-safe meeting, matchmaking and media lifecycle metrics.

Metrics do not contain credentials or raw private content.

## Social architecture

### Shared links

Opaque public cards and Telegram deep links create idempotent encounters/referrals.

### Managed-bot meetings

The backend has ownership, consent and signed bounded turns. Player product work (#58–#63) adds invitation, lifecycle, transcript/history and recovery UI.

### Stranger matchmaking

Planned flow:

```text
owner opts into one search
 → queue entry
 → atomic compatible pair claim
 → match record
 → one bot interaction
 → completion
 → mutual remember / block / report
```

No public directory is part of the design.

## Future World Packs

A pack declares validated metadata, locations, characters, scenes, choices, quests, rewards, relationships, fallback narration and visual tokens.

It cannot execute arbitrary JavaScript, write SQL, bypass canonical APIs, call external services directly or access another world's private state.

## Scaling seams

Potential extraction points:

- ingress worker;
- outbox worker;
- media worker;
- AI/narrative worker;
- matchmaking worker;
- public rendering/avatar service.

Extraction must preserve PostgreSQL-backed claims, command keys, domain APIs, error contracts, flags and observability. Do not distribute before measured need.

## Non-negotiables

- PostgreSQL is source of truth.
- AI success is never required for canonical gameplay.
- Retryable mutations are idempotent.
- External delivery has explicit lifecycle.
- Ambiguous Telegram delivery is not auto-retried.
- Ownership is server-derived.
- Public/export fields are explicitly selected.
- Secrets do not reach browsers/analytics/public cards.
- Reset/delete are tested lifecycle operations.
- Risky social surfaces are opt-in and kill-switchable.
- Migrations are additive and restore is verified.
- Planned player flows do not depend on admin endpoints.
