# Bloopy Network architecture

## Executive summary

Bloopy Network is a modular monolith: one deployable Node.js service with strict domain boundaries, PostgreSQL persistence, Telegram webhooks, a static Mini App and background workers.

This shape is deliberate. It minimizes cost and operational complexity while preserving clear seams for future extraction.

The most important architectural rule is:

> Canonical game state is decided transactionally by deterministic domain code. External Telegram and AI systems may deliver or render results, but they never own the rules.

## System context

```text
Telegram user
   │
   ├── Manager bot ───────────────┐
   ├── Managed creature bot      │
   └── Telegram Mini App         │
                                  ▼
                         Fastify application
                    ┌─────────────┼─────────────┐
                    │             │             │
               HTTP/API      Telegram ingress  Static Mini App
                    │             │
                    └──────┬──────┘
                           ▼
                     Domain modules
          game / stories / memory / bots / AI policy
                           │
                           ▼
                       PostgreSQL
        canonical state / queues / events / credentials
                           │
                    background worker loop
                    ┌──────┴────────┐
                    ▼               ▼
             Telegram outbox   scheduled world work
                    │
                    ▼
             Telegram Bot API

Optional narration path:
canonical facts → AI policy/budget → provider → validation/moderation
                         │
                         └→ deterministic fallback on any failure
```

## Deployment model

One service currently provides:

- public HTTP routes;
- Telegram webhook endpoints;
- static Mini App assets;
- background ingress/outbox/event workers;
- migration execution at startup/deploy workflow;
- health/readiness endpoints;
- operational admin endpoints.

PostgreSQL is the durable source of truth.

This is not an in-memory bot process. A restart must preserve player state and recover claimed asynchronous work through leases.

## Repository/runtime modules

## HTTP composition — `server.ts`

Responsibilities:

- Fastify configuration;
- request validation and authentication composition;
- route definitions;
- degraded-mode write gate;
- health/readiness routes;
- admin route protection;
- background worker scheduling;
- global player-safe error handling.

Domain logic should be delegated to modules rather than accumulating in routes.

## Configuration — `config.ts`

Responsibilities:

- parse environment variables with Zod;
- define defaults and bounds;
- reject insecure production configuration;
- expose feature flags, budgets, TTLs and queue settings.

Production guards reject demo mode and placeholder secrets.

## Database — `db.ts` and migrations

PostgreSQL stores:

- players and creatures;
- onboarding and progression;
- quests, inventory and relationships;
- story entries and arc state;
- memories/personality history;
- notification preferences/daily returns;
- AI profiles/OAuth state/usage logs;
- managed bots, access rules and security events;
- bot interactions and turns;
- Telegram ingress and outbox queues;
- runtime controls and operational events.

Migrations are additive and immutable after application.

## Game domain — `game.ts`

Owns canonical player/creature behavior including:

- bootstrap;
- onboarding;
- actions;
- energy and progression;
- shop/inventory;
- quests and relationships;
- shared-link encounters.

The module should expose domain-shaped results, not raw SQL rows.

## Story engine — `door-game.ts` and story definitions

The story layer separates:

- arc definitions;
- activation prerequisites;
- current beat/legal choices;
- deterministic canonical effects;
- optional presentation enrichment.

The same generic arc engine supports The Impossible Door and The Letter From Tomorrow.

World Packs should extend validated content definitions rather than execute arbitrary code against canonical tables.

## Memory and daily return — `memory.ts`

Owns:

- memory listing/correction/deletion;
- lineage and soft deletion;
- approved AI memory packet;
- personality change records;
- daily-return choice and reward.

Raw Telegram text remains bounded private working memory and is excluded from normal AI context by policy/database rules.

## Notifications — `notifications.ts`

Owns:

- timezone-aware local date/time;
- quiet hours;
- opt-in preferences;
- due daily-return scheduling;
- unique notification source keys;
- opened/sent state.

Scheduling creates outbox intent; it does not call Telegram directly.

## Telegram protocol — `telegram.ts`

Owns:

- manager-bot behavior;
- managed-bot registration/configuration;
- Telegram message-to-domain translation;
- managed-bot human authorization invocation;
- bot-originated turn handling;
- token rotation and revoke orchestration;
- enqueueing replies.

Telegram API calls occur in delivery/configuration paths, not inside canonical game transactions.

## Telegram control plane — `telegram-control.ts`

Owns:

- managed-bot registry views;
- owner and approved-chat authorization;
- consent state;
- token rotation/revoke canonical records;
- bot-interaction creation;
- signed turn protocol;
- TTL/turn/budget enforcement;
- replay/forgery rejection;
- security events.

## Delivery runtime — `delivery-runtime.ts`

Owns two durable asynchronous state machines.

### Telegram ingress

```text
received → processing → completed
              │
              ├→ retryable → processing
              └→ failed
```

Behavior:

- webhook validates secret;
- full update is persisted;
- response returns quickly;
- worker claims with lease;
- domain handler runs;
- result is finalized;
- expired processing lease becomes retryable.

Canonical command keys provide a second layer of replay protection.

### Telegram outbox

```text
pending → sending → sent
             │
             ├→ retryable → sending
             ├→ dead_letter
             └→ uncertain
```

Behavior:

- rows are claimed in a short transaction;
- Telegram network call occurs outside the transaction;
- outcome is finalized in a second transaction;
- `429`/known transient errors retry with bounds;
- permanent errors dead-letter;
- ambiguous timeout/network failure becomes uncertain;
- expired sending lease becomes uncertain;
- uncertain rows require explicit operator judgment.

## Worker — `worker.ts` plus server scheduler

The worker loop processes:

- expired lease recovery;
- Telegram ingress batches;
- notification scheduling;
- due world events;
- cleanup at a bounded interval;
- outbox delivery batches.

Ticks do not overlap. Batch sizes and lease durations are configurable.

For higher scale, workers can later become separate processes while preserving the same PostgreSQL queues and module contracts.

## AI narration — `ai.ts`, `ai-policy.ts`, `openrouter.ts`

AI architecture has four boundaries:

1. canonical facts are decided before inference;
2. provider access is validated, encrypted and budgeted;
3. prompt context is bounded and approved;
4. output is validated/moderated with deterministic fallback.

Connected Mind uses OpenRouter OAuth with PKCE and encrypted credentials. Compatible BYOK profiles remain constrained by SSRF protection, timeouts and curated models/modes.

AI logs metadata such as provider, latency, usage and fallback reason without returning or logging credentials.

## Avatar renderer — `avatar.ts`

The renderer converts a versioned genome into SVG.

Advantages:

- stable identity;
- low cost;
- fast rendering;
- deterministic tests;
- controlled evolution details;
- no dependence on image-generation availability.

If generative assets are added later, the genome remains the canonical identity anchor.

## Authentication model

## Mini App

Telegram initData is validated server-side. Because the Mini App may be opened from either the manager bot or a managed bot, token selection must be bot-aware.

## Manager webhook

Protected by Telegram's secret-token header and the configured manager webhook secret.

## Managed-bot webhook

Protected by a per-bot secret-token header. The bot must be active and not revoked.

## Admin routes

Protected by `ADMIN_API_KEY` using constant-time secret comparison.

Admin endpoints are operational tools and must not be required for normal player flows.

## Ownership model

Private resources are always owner-scoped on the server.

Examples:

- managed bots belong to one Telegram owner and creature;
- memory edits require the creature owner;
- meeting invitations bind both participants server-side;
- future matchmaking queue entries bind the authenticated owner's bot;
- meeting history is visible only to participating owners.

A client-supplied owner ID is never authoritative.

## Canonical mutation pattern

```text
validate input
  → authenticate/derive owner
  → load + lock state
  → validate prerequisites
  → claim idempotency key
  → apply canonical effects
  → record canonical event/analytics
  → commit
  → optional external narration/delivery
  → persist permitted presentation/operational result
```

External failure must not undo an already committed canonical action unless the external result is itself the canonical prerequisite.

## Error model

Expected failures use typed `AppError` values with:

- stable code;
- HTTP status;
- player-safe message.

Unexpected errors are logged and returned as a generic internal response.

The global handler must not expose:

- stack traces;
- SQL errors;
- Zod internals;
- credentials;
- provider response bodies containing secrets.

## Readiness and degraded mode

Endpoints:

- `/livez` — process liveness;
- `/readyz` — database, migration, queue and runtime readiness;
- `/health` — database check and release version.

Runtime controls can pause:

- Telegram ingress;
- outbox delivery;
- risky mutations.

Safe read-only mode preserves player reads where possible while blocking writes.

## Observability

Admin metrics include:

- update/outbox state counts;
- worker lag;
- AI use/fallback;
- analytics events;
- security events;
- bot-interaction states;
- operational control events.

Planned additions:

- invitation state funnel;
- meeting player-safe lifecycle metrics;
- matchmaking queue/match/safety metrics;
- media-processing lifecycle metrics.

Metrics use categories and opaque IDs, not raw private content.

## Current social architecture

### Shared-link encounters

A public creature slug in a Telegram deep link creates an idempotent mutual encounter and relationship/story effects.

### Managed-bot interactions

The existing backend can create a persisted interaction and exchange signed bounded turns through two managed bots.

The normal-player product layer is still planned:

- direct invitation persistence and UI;
- player-scoped meeting lifecycle API;
- progress/transcript/history;
- notifications and recovery states.

### Stranger matchmaking

Planned as a separate server-selected queue:

```text
owner opts in for one encounter
  → queue entry
  → atomic compatible pair claim
  → match record
  → one bot interaction
  → completion
  → optional mutual remember / block / report
```

No public directory is part of the design.

## Future World Pack architecture

The target system separates engine from validated content.

A World Pack should declare:

- metadata and compatibility version;
- locations;
- characters;
- scenes and legal choices;
- quests and rewards;
- items and relationships;
- progression prerequisites;
- deterministic fallback narration;
- visual theme tokens.

It must not:

- execute arbitrary JavaScript;
- write SQL;
- bypass canonical APIs;
- call external services directly;
- access another world's private state.

## Scaling seams

The modular monolith may be separated when load justifies it.

Natural extraction candidates:

- Telegram ingress worker;
- outbox delivery worker;
- media processing worker;
- narrative/AI worker;
- matchmaking worker;
- static asset/avatar service.

Extraction should preserve:

- PostgreSQL-backed durable claims;
- idempotency keys;
- canonical domain APIs;
- player-safe error contracts;
- feature flags and metrics.

Do not introduce distributed services before a measured reliability or scaling need.

## Architectural non-negotiables

- PostgreSQL is the source of truth.
- Canonical state does not depend on AI success.
- Every retryable mutation is idempotent.
- Every external delivery has explicit lifecycle state.
- Ambiguous Telegram delivery is not automatically retried.
- Ownership is derived server-side.
- Secrets never reach browser payloads or analytics.
- Social features are opt-in and kill-switchable.
- Migrations are additive and production rollback keeps schema.
- Planned player flows do not depend on admin endpoints.
