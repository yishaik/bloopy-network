# Bloopy Network developer guide

## Overview

Bloopy Network is a TypeScript modular monolith deployed as one service with PostgreSQL persistence, Telegram webhooks, a Mini App, background workers and optional constrained AI narration.

The architecture intentionally optimizes for:

- low infrastructure cost;
- clear transactional boundaries;
- deterministic canonical game state;
- safe retries and external delivery;
- staged activation of risky Telegram/social surfaces;
- the ability to extract modules later without starting with microservices.

Read these documents before changing behavior:

- [Product vision](./PRODUCT.md)
- [Game design](./GAME_DESIGN.md)
- [Behavior specification](./BEHAVIOR_SPEC.md)
- [Architecture](./ARCHITECTURE.md)
- [Code style](./CODE_STYLE.md)
- [Testing](./TESTING.md)
- [Operations](./OPERATIONS.md)

## Technology stack

- Node.js 22+
- TypeScript, ESM and strict type checking
- Fastify
- PostgreSQL 17
- Zod request/config validation
- Vitest
- Docker Compose for local PostgreSQL
- Telegram Bot API and Mini Apps
- Railway for current production deployment
- optional OpenRouter OAuth and OpenAI-compatible narration providers

## Repository layout

```text
.
├── apps/
│   └── server/
│       ├── public/                 # Mini App static frontend
│       ├── src/                    # HTTP, game, Telegram, workers and tests
│       ├── package.json
│       └── tsconfig.json
├── docs/                            # product, engineering and operations handbook
├── migrations/                      # additive PostgreSQL migrations
├── .github/workflows/ci.yml
├── .env.example
├── docker-compose.yml
└── package.json                     # workspace scripts
```

Important server modules include:

- `server.ts` — route composition, authentication boundaries and worker loop;
- `game.ts` — canonical player/creature actions, onboarding and progression;
- `door-game.ts` — generic authored story-arc engine and current arcs;
- `memory.ts` — memory controls, personality changes and daily return;
- `notifications.ts` — timezone-aware scheduling and quiet hours;
- `telegram.ts` — Telegram manager/managed-bot behavior;
- `telegram-control.ts` — ownership, consent and bot-interaction protocol;
- `delivery-runtime.ts` — leased Telegram ingress, outbox and readiness;
- `ai.ts` / `ai-policy.ts` — bounded narration and budgets;
- `openrouter.ts` — OAuth connection lifecycle;
- `avatar.ts` — deterministic SVG rendering;
- `worker.ts` — scheduled world events and cleanup;
- `errors.ts` — typed player-safe errors;
- `config.ts` — validated configuration and production guards.

The exact module list evolves. Preserve responsibility boundaries rather than treating `server.ts` as the place for all new logic.

## Local setup

### Prerequisites

- Node.js 22+
- npm
- Docker with Compose
- OpenSSL for local key generation

### Start PostgreSQL and the app

```bash
cp .env.example .env
openssl rand -base64 32
# Paste the result into APP_ENCRYPTION_KEY in .env

docker compose up postgres -d
npm install
npm run migrate
npm run dev
```

Open `http://localhost:3000`.

`DEMO_MODE=true` allows a local demo identity and is rejected in production.

### Useful commands

```bash
npm run dev
npm run typecheck
npm test
npm run build
npm run migrate
npm run eval:narrative
```

Database smoke suites:

```bash
npm run test:memory-db -w @bloopy/server
npm run test:notifications-db -w @bloopy/server
npm run test:openrouter-db -w @bloopy/server
npm run test:telegram-control-db -w @bloopy/server
npm run test:delivery-runtime-db -w @bloopy/server
```

## Configuration

Copy `.env.example` and treat it as a schema reference, not production values.

### Required local values

- `DATABASE_URL`
- `APP_ENCRYPTION_KEY`

### Telegram integration values

- `TELEGRAM_MANAGER_BOT_TOKEN`
- `TELEGRAM_MANAGER_BOT_USERNAME`
- `TELEGRAM_WEBHOOK_SECRET`
- an HTTPS `PUBLIC_BASE_URL` for webhooks

### Risky feature flags

These default off in production-oriented configuration:

- `MANAGED_BOT_FLEET_ENABLED`
- `BOT_TO_BOT_ENABLED`
- future `BOT_MATCHMAKING_ENABLED`

Do not enable a risky surface merely because CI passes. Follow [Alpha testing](./ALPHA_TESTING.md).

### Secret handling

Never:

- commit `.env`;
- print tokens or API keys;
- paste secret values into issues or PRs;
- return encrypted credentials to the browser;
- use placeholder secrets in production.

## Request and mutation model

A normal player mutation should follow this shape:

1. validate route params and body with Zod;
2. resolve Telegram identity from trusted initData;
3. load or bootstrap the owning player/creature;
4. verify onboarding and feature prerequisites;
5. generate or accept an idempotency key;
6. perform canonical mutation in a short transaction;
7. commit canonical facts and rewards;
8. call optional external narration after the canonical decision when possible;
9. persist permitted presentation updates separately;
10. return a player-safe response.

Do not call external AI or Telegram APIs while holding a long database transaction.

## Authentication and ownership

### Mini App requests

The server validates Telegram Mini App `initData`. Managed-bot launches may be signed by a managed-bot token, so validation must remain bot-aware.

### Owner-scoped resources

For resources such as managed bots, memories, invitations and future matchmaking entries:

- derive the owner from authenticated Telegram context;
- never trust a client-supplied owner ID;
- query through the owner relationship;
- return `404` or a curated equivalent when ownership should not be disclosed;
- add negative tests for cross-owner access.

### Admin endpoints

Admin endpoints require `ADMIN_API_KEY` and are operational tools, not product APIs. Do not build a player flow that depends on an admin endpoint.

## Canonical state and narration

Canonical state includes:

- player and creature identity;
- energy, XP, level and currency;
- inventory and quests;
- relationships;
- legal story choices and route state;
- rewards and flags;
- approved memories and personality values;
- interaction lifecycle state.

Presentation may include:

- story title and body;
- optional AI-enriched wording;
- player-safe summaries;
- transient UI status.

The canonical layer must be complete without AI output.

## Transactions

Use PostgreSQL transactions for state changes that must succeed or fail together.

Good transaction scope:

- verify current state;
- lock the relevant row when concurrent mutation is possible;
- insert idempotency record;
- apply canonical effects;
- write related story/analytics events that belong to the effect;
- commit.

Bad transaction scope:

- call Telegram;
- call OpenRouter or another model provider;
- wait for user input;
- process large media;
- perform slow unrelated reads.

Use advisory locks or row locks when a logical entity needs serialization. Keep locks narrow and documented.

## Idempotency

Any action that may be retried requires a stable key.

Examples:

- Telegram update: source + update ID;
- managed-bot action: bot ID + update ID;
- story choice: player/creature + arc instance + beat/choice or explicit command key;
- notification: one source key per player/date/event;
- invitation acceptance: invitation + participant;
- meeting start: accepted invitation ID;
- matchmaking result: matched queue pair.

On conflict, return or reconstruct the existing result. Do not silently run the mutation again.

## Adding a normal action

1. Add the action to the declared action type/schema.
2. Define cost, prerequisites and deterministic effects.
3. Add canonical story fallback.
4. Ensure one idempotency key covers the complete effect.
5. Update quest/relationship integrations explicitly.
6. Add unit tests for legal and illegal states.
7. Add a concurrency/replay test when rewards are involved.
8. Update player and behavior documentation.

## Adding an authored story arc

1. Define an arc through the generic arc interface.
2. Give every beat and choice a stable identifier.
3. Declare prerequisites and canonical effects.
4. Provide deterministic title/body fallback for every visible beat.
5. Keep rewards bounded and idempotent.
6. Test activation, each branch, resume, completion and replay.
7. Test inheritance from earlier routes where used.
8. Confirm optional AI receives canonical facts only.
9. Add migration data if quests/items are required.
10. Document the player-facing arc without spoiling hidden branches unnecessarily.

## Adding a migration

Migrations are additive and forward-safe.

Rules:

- use a new unique ordered filename;
- do not rename an already applied migration;
- prefer additive columns/tables/indexes;
- backfill before adding restrictive constraints when needed;
- provide safe defaults for existing rows;
- avoid destructive rollback assumptions;
- run the full migration job from a clean database;
- add or update a DB smoke suite for behavior that depends on the schema.

Production rollback redeploys application code while retaining additive schema.

## Adding a Telegram flow

1. Decide whether the update is manager, managed-bot or bot-originated.
2. Validate webhook secret before persistence.
3. Persist the full update and return quickly.
4. Process through the leased ingress worker.
5. authorize the human or verify the signed bot interaction;
6. apply canonical effects with a command key;
7. enqueue replies through the outbox;
8. never call Telegram directly from canonical game logic;
9. classify failure as retryable, permanent or uncertain;
10. expose metrics and a kill switch for risky behavior.

## Adding AI narration

1. Define the canonical facts and allowed references.
2. Limit memory context to the approved packet.
3. reserve budget before the call;
4. use strict timeouts and output limits;
5. validate and moderate returned text;
6. log metadata without secrets or raw credentials;
7. provide deterministic fallback;
8. never let model output decide state.

## Frontend development

The Mini App is served from `apps/server/public`.

Frontend principles:

- treat the server as the source of truth;
- render explicit loading, empty, disabled, success and error states;
- prevent double submission locally but rely on server idempotency for correctness;
- never store bot tokens or AI credentials in browser storage;
- use Telegram safe-area information where available;
- keep copy concise and translation-friendly;
- avoid exposing internal UUIDs, bot IDs, signatures or queue statuses directly;
- stop polling when the app is backgrounded or state is terminal;
- support reduced motion and semantic status announcements.

## Error handling

Throw `AppError` for expected domain failures.

Each expected error needs:

- stable machine code;
- appropriate HTTP status;
- curated player-facing message.

Do not match arbitrary error strings in the global handler. Unexpected failures should be logged server-side and returned as a generic internal message.

## Analytics and operational events

Analytics should answer product questions without becoming a private-content archive.

Good properties:

- scene or action ID;
- feature mode;
- success/failure code;
- latency bucket;
- turn count;
- anonymous/opaque interaction ID where operationally required.

Do not log:

- raw private messages;
- bot tokens;
- API keys;
- Telegram initData;
- OAuth verifier/state;
- full media content;
- another owner's private identifier.

Operational control changes and manual delivery replays belong in `operational_events`.

## Documentation changes required with code

Update documentation in the same PR when changing:

- a player-visible rule or flow;
- an API contract;
- a migration or persistence invariant;
- a feature flag;
- a privacy or authorization boundary;
- notification behavior;
- AI capabilities;
- deployment, health or recovery steps.

## Pull request checklist

Before requesting review:

- [ ] scope is linked to an issue or clearly explained;
- [ ] strict TypeScript passes;
- [ ] unit tests pass;
- [ ] production build passes;
- [ ] clean migrations pass when schema is touched;
- [ ] relevant DB smoke suites pass;
- [ ] duplicate/retry behavior is tested;
- [ ] cross-owner authorization is tested for social/private resources;
- [ ] secrets and private fields are absent from responses/logs;
- [ ] player failure states are implemented;
- [ ] documentation is updated;
- [ ] Railway handoff is included when production configuration changes;
- [ ] rollback or kill-switch behavior is documented.
