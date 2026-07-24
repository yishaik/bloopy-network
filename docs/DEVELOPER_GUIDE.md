# Bloopy Network developer guide

## Overview

Bloopy Network is a TypeScript modular monolith deployed as one service with PostgreSQL persistence, Telegram webhooks, a static Mini App, background workers, public share surfaces, self-service account lifecycle controls and optional constrained AI narration.

The architecture optimizes for:

- low infrastructure cost;
- clear transactional boundaries;
- deterministic canonical game state;
- safe retries and external delivery;
- staged activation of risky Telegram/social surfaces;
- explicit privacy and account-lifecycle behavior;
- future extraction seams without premature microservices.

Read before changing behavior:

- [Product vision](./PRODUCT.md)
- [Game design](./GAME_DESIGN.md)
- [Behavior specification](./BEHAVIOR_SPEC.md)
- [Architecture](./ARCHITECTURE.md)
- [API reference](./API.md)
- [Code style](./CODE_STYLE.md)
- [Testing](./TESTING.md)
- [Operations](./OPERATIONS.md)

## Technology stack

- Node.js 22+
- TypeScript, ESM and strict type checking
- Fastify
- PostgreSQL 17
- Zod validation
- Vitest
- Docker Compose
- Telegram Bot API and Mini Apps
- Railway
- optional OpenRouter OAuth and OpenAI-compatible narration providers

## Repository layout

```text
.
├── apps/server/
│   ├── public/                 # Mini App static frontend
│   ├── src/                    # API, domain modules, workers and tests
│   ├── package.json
│   └── tsconfig.json
├── docs/                       # product, player, developer and operations handbook
├── migrations/                 # additive PostgreSQL migrations
├── scripts/                    # release, backup, restore and verification tooling
├── .github/workflows/ci.yml
├── .env.example
├── docker-compose.yml
├── CONTRIBUTING.md
└── package.json
```

Important server responsibilities include:

- `server.ts` — route composition, auth boundaries, health and worker scheduling;
- `game.ts` — bootstrap, onboarding, actions, progression and relationships;
- story-arc modules — authored arc definitions and deterministic choice resolution;
- `memory.ts` — memories, personality and daily return;
- `notifications.ts` — local-time scheduling and quiet hours;
- sharing/referral modules — opaque public cards, safe views and one-time attribution;
- account lifecycle modules — export, creature reset and account deletion;
- `telegram.ts` — manager/managed-bot protocol translation;
- `telegram-control.ts` — ownership, consent and signed bot interactions;
- `delivery-runtime.ts` — leased ingress, outbox and readiness;
- `ai.ts` / `ai-policy.ts` — constrained narration and budgets;
- `openrouter.ts` — OAuth connection lifecycle;
- `avatar.ts` — deterministic SVG rendering;
- `worker.ts` — scheduled events and cleanup;
- `errors.ts` — typed player-safe errors;
- `config.ts` — validated configuration and production guards.

Preserve module ownership. Do not turn `server.ts` into a general-purpose domain module.

## Local setup

Requirements:

- Node.js 22+
- npm
- Docker with Compose
- OpenSSL

```bash
cp .env.example .env
openssl rand -base64 32
# Paste into APP_ENCRYPTION_KEY

docker compose up postgres -d
npm install
npm run migrate
npm run dev
```

Open `http://localhost:3000`.

`DEMO_MODE=true` supports local development and is rejected in production.

## Commands

### Normal development

```bash
npm run dev
npm run typecheck
npm test
npm run build
npm run migrate
npm run eval:narrative
```

### Database smoke suites

```bash
npm run test:memory-db -w @bloopy/server
npm run test:notifications-db -w @bloopy/server
npm run test:openrouter-db -w @bloopy/server
npm run test:telegram-control-db -w @bloopy/server
npm run test:delivery-runtime-db -w @bloopy/server
npm run test:account-db
```

### Release and recovery tooling

```bash
npm run release:check -- --base-url https://deployment.example --phase 1
npm run verify:gate -- --base-url https://deployment.example
npm run backup
npm run verify:restore
```

Read:

- [Go live](./GO_LIVE.md)
- [Backup and restore](./BACKUP_RESTORE.md)
- [Alpha testing](./ALPHA_TESTING.md)

`release:check` must distinguish `SKIP` from `PASS`; an unverified check is not healthy evidence.

## Configuration

Treat `.env.example` as a schema reference, not production values.

Required production values include:

- `DATABASE_URL`
- `APP_ENCRYPTION_KEY`
- `TELEGRAM_MANAGER_BOT_TOKEN`
- `TELEGRAM_MANAGER_BOT_USERNAME`
- `TELEGRAM_WEBHOOK_SECRET`
- HTTPS `PUBLIC_BASE_URL`
- strong `ADMIN_API_KEY`

Risky surfaces default off:

- `MANAGED_BOT_FLEET_ENABLED`
- `BOT_TO_BOT_ENABLED`
- future `BOT_MATCHMAKING_ENABLED`

Do not enable a surface merely because CI passes. Follow the documented human verification gate.

Never commit `.env`, print credentials, paste secrets into GitHub, return credential ciphertext to the browser or use placeholder production secrets.

## Request and mutation model

A normal player mutation should:

1. validate params/body with Zod;
2. resolve Telegram identity from trusted initData;
3. derive ownership server-side;
4. verify feature and domain prerequisites;
5. claim a stable idempotency key;
6. apply canonical mutation in a short transaction;
7. commit canonical facts/rewards;
8. call optional AI or external services outside the transaction;
9. persist permitted presentation/operational results;
10. return a minimal player-safe response.

Never call AI, Telegram or media providers while holding a long database transaction.

## Authentication and ownership

### Mini App

Validate Telegram initData server-side. Managed-bot launches may be signed with the managed bot's token, so validation remains bot-aware.

### Owner-scoped resources

For memories, bots, account data, invitations, meetings and matchmaking:

- derive the owner from auth context;
- never trust client-supplied owner authority;
- query through ownership;
- avoid revealing whether another owner's private resource exists;
- add cross-owner negative tests.

### Admin endpoints

`ADMIN_API_KEY` protects operational endpoints. A normal player flow must never depend on an admin endpoint.

## Canonical state versus presentation

Canonical state includes identity, progression, currency, inventory, quests, relationships, legal story choices, rewards, memories/personality values, referral payout and social lifecycle state.

Presentation includes story wording, public summaries, cards and transient UI status.

The canonical layer must be complete without AI output.

## Transactions

Use short transactions for work that must succeed or fail together:

- load and lock current state;
- validate prerequisites;
- claim idempotency;
- apply canonical effects;
- write related canonical/audit events;
- commit.

Keep outside:

- Telegram calls;
- AI calls;
- media retrieval/analysis;
- slow third-party requests;
- file/backup operations.

Use claim/execute/finalize for external delivery. Use locks in a stable order and never hold them during network calls.

## Idempotency

Any retryable mutation needs a trusted stable key.

Examples:

- Telegram update: source + update ID;
- managed-bot action: bot ID + update ID;
- story choice: arc instance + beat/choice command;
- notification: player/date/event source key;
- referral: durable referred player;
- invitation acceptance: invitation + participant;
- meeting start: accepted invitation;
- matchmaking: claimed queue pair;
- reset/delete: owner plus explicit lifecycle command semantics.

A conflict returns/reconstructs the existing result. Frontend button disabling is not correctness.

## Adding a normal action

1. Add it to the declared schema/type.
2. Define cost, prerequisites and deterministic effects.
3. Add deterministic story fallback.
4. Cover the whole effect with one idempotency boundary.
5. Integrate quests/relationships explicitly.
6. Test legal, illegal, replay and concurrency behavior.
7. Update player and behavior docs.

## Adding an authored arc

1. Use the generic arc definition interface.
2. Give beats/choices stable IDs.
3. Declare activation, legal choices and effects.
4. Provide deterministic text for every visible beat.
5. Keep rewards bounded/idempotent.
6. Test branches, resume, route inheritance, completion and replay.
7. Ensure AI receives canonical facts only.
8. Add migration data for quests/items as needed.
9. Update game/player documentation.

## Adding a public share surface

Public sharing is an explicit privacy boundary.

1. Use an opaque random token, not a private/owner-derived identifier.
2. Build a dedicated public view with explicitly selected fields.
3. Never expose raw domain rows or `SELECT *`.
4. Render player/AI text safely; no executable injection.
5. Provide generic not-found behavior.
6. Define cache policy and token invalidation/reset behavior.
7. Add privacy-contract tests for excluded fields.
8. Keep referral reward separate, durable and idempotent.

## Adding export/reset/delete behavior

### Export

- explicitly list every exported field;
- never implement by serializing whole rows and filtering known secrets afterward;
- include schema version/timestamp;
- assert secret names and known test secret values are absent;
- return `no-store`.

### Reset/delete

- require explicit typed confirmation;
- resolve account without accidentally bootstrapping during repeated deletion;
- revoke external managed bots before removing authorization rows;
- clean non-FK/raw payload data explicitly;
- anonymize only the minimal retained abuse/operational history;
- ensure no active scheduled/social work remains orphaned;
- test fresh bootstrap after reset and idempotent repeated deletion.

## Adding a migration

- create a new unique ordered filename;
- never rename/edit an applied migration;
- prefer additive changes;
- backfill before restrictive constraints;
- provide safe defaults;
- add needed indexes/check constraints;
- test from a clean DB;
- update affected smoke suites;
- update readiness/release checks if running code depends on it.

Production rollback redeploys earlier code while retaining additive schema.

## Adding a Telegram flow

1. classify manager, managed-human or bot-originated update;
2. validate webhook secret before persistence;
3. persist full update and return quickly;
4. process through leased ingress;
5. authorize owner/chat or verify signed bot turn;
6. apply canonical effects using command keys;
7. enqueue replies through outbox;
8. classify retryable/permanent/uncertain delivery;
9. expose metrics and a narrow kill switch;
10. complete real Telegram E2E before enabling broadly.

## Adding AI narration

1. fix canonical facts first;
2. define allowed references and bounded memory;
3. reserve budget;
4. use strict timeouts/output limits;
5. validate/moderate output;
6. log metadata without credentials/content leakage;
7. provide deterministic fallback;
8. never allow model output to decide state.

## Frontend development

The Mini App is served from `apps/server/public`.

- server remains source of truth;
- render loading, empty, disabled, success and error states;
- block double-submit for UX but rely on server idempotency;
- never store bot/AI credentials in browser storage;
- use Telegram safe areas;
- keep copy concise and translation-friendly;
- hide internal UUIDs, signatures and queue protocol;
- stop polling in background/terminal states;
- support reduced motion and semantic status announcements;
- destructive account actions require clear confirmation and aftermath explanation.

## Errors

Expected domain failures use `AppError` with stable code, HTTP status and curated message. Do not infer errors by matching arbitrary strings or expose SQL/Zod/provider internals.

Unexpected failures are logged safely and returned as generic internal errors.

## Analytics and audit events

Use small privacy-safe metadata: stable event name, feature/scene code, state, duration, attempt count and opaque reference.

Never log raw private messages/media, tokens, keys, initData, OAuth verifier/state or another owner's private identifier.

Canonical analytics should be idempotent. Operational changes/replays belong in operational audit events. Account lifecycle actions use a one-way/anonymized subject reference where history must survive deletion.

## Documentation requirements

Update docs in the same PR when changing player behavior, public API, migration/readiness contract, feature flag, privacy/ownership, notification, AI authority, release tooling or recovery.

## Pull request checklist

- [ ] scope linked/explained;
- [ ] strict TypeScript, unit tests and build pass;
- [ ] clean migrations pass when relevant;
- [ ] affected DB smoke suites, including account lifecycle where relevant, pass;
- [ ] backup/restore and release tooling updated when schema/release behavior changes;
- [ ] replay/concurrency tested;
- [ ] cross-owner authorization tested;
- [ ] public/export response privacy tested;
- [ ] no secrets/private fields in responses/logs;
- [ ] player failure states implemented;
- [ ] docs updated;
- [ ] Railway handoff included for infrastructure changes;
- [ ] rollback/kill switch documented.
