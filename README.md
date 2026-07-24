# Bloopy Network

A proactive Telegram-native creature game with persistent identity, authored adventures, evolving memory/personality, managed personal bots, bounded creature-to-creature meetings and optional constrained AI narration.

Bloopy is not a generic chatbot. Players adopt a recognizable creature that accumulates stories, relationships, items and visible evolution across short Telegram sessions.

## Product principles

- **Persistent creature, not assistant configuration.** Character Genesis creates a continuing identity.
- **Deterministic game state.** Rules, choices, rewards and consequences are owned by application code.
- **AI is optional presentation.** The game remains playable without paid inference.
- **Telegram is part of the fiction.** The manager bot, Mini App and staged personal bots are gameplay surfaces.
- **Safe social play.** Meetings require consent, bounded turns, privacy controls and staged production gates.
- **No dark patterns.** No guilt, fake emergencies, notification spam or punishment for leaving.
- **Low-cost architecture.** A TypeScript modular monolith, PostgreSQL and durable workers keep operation practical.

## Current playable vertical slice

- Character Genesis and persistent creature identity
- populated starting world with recurring NPCs
- explore/talk/help/social/rest actions
- energy costs and background regeneration
- XP, levels, stars, inventory and Momo's shop
- quests and persistent relationships
- genome-based SVG avatars and evolution tiers
- The Impossible Door
- The Letter From Tomorrow
- editable memories and gradual personality changes
- daily-return scenes and opt-in quiet-hour notifications
- shared-link player-to-player encounters
- optional OpenRouter Connected Mind and compatible BYOK narration
- durable leased Telegram ingress and outbox delivery
- retry, uncertain-delivery, dead-letter and recovery states
- health/readiness, degraded mode and operational controls
- managed-bot ownership/access/rotation/revoke foundation
- persisted signed bounded bot-to-bot protocol

## Staged and planned work

Managed personal bots and bot-to-bot conversations are implemented behind production verification gates and are disabled by default.

The player-facing roadmap includes:

- managed-bot hub and meeting consent UI;
- direct creature invitations and mutual acceptance;
- active meeting transcript/history;
- safe pseudonymous stranger matchmaking;
- photo, voice-note, video and link reactions;
- shareable cards and self-service data controls;
- reusable World Packs.

Planned behavior is documented clearly as planned and must not be presented as shipped.

## Run locally

Requirements: Node.js 22+, npm, Docker and OpenSSL.

```bash
cp .env.example .env
# Generate and paste into APP_ENCRYPTION_KEY:
openssl rand -base64 32

docker compose up postgres -d
npm install
npm run migrate
npm run dev
```

Open `http://localhost:3000`.

`DEMO_MODE=true` creates a local demo player without Telegram credentials and is blocked in production.

## Validate changes

```bash
npm run typecheck
npm test
npm run build
```

Database smoke suites:

```bash
npm run test:memory-db -w @bloopy/server
npm run test:notifications-db -w @bloopy/server
npm run test:openrouter-db -w @bloopy/server
npm run test:telegram-control-db -w @bloopy/server
npm run test:delivery-runtime-db -w @bloopy/server
```

## Connect Telegram

1. Create a manager bot.
2. Enable Bot Management Mode and Bot-to-Bot Communication Mode in BotFather.
3. Set `TELEGRAM_MANAGER_BOT_TOKEN`, `TELEGRAM_MANAGER_BOT_USERNAME`, an HTTPS `PUBLIC_BASE_URL` and a random `TELEGRAM_WEBHOOK_SECRET`.
4. The server registers the manager webhook automatically.
5. Keep `MANAGED_BOT_FLEET_ENABLED=false` and `BOT_TO_BOT_ENABLED=false` until the corresponding gates in [`docs/ALPHA_TESTING.md`](docs/ALPHA_TESTING.md) pass.
6. When enabled for a staged cohort, `/spawn` or the Mini App flow can create a managed bot owned by the user and operated by Bloopy.

Never commit or publish bot tokens, API keys, Telegram initData, webhook secrets or decrypted credentials.

## Architecture

The service is a modular monolith:

```text
Telegram manager/managed bots + Mini App
                    │
                 Fastify
                    │
     deterministic domain modules
                    │
               PostgreSQL
            ┌───────┴────────┐
     leased ingress     durable outbox
            │                │
       game handlers    Telegram Bot API
```

Canonical state commits transactionally. AI and external delivery happen through bounded paths with deterministic fallback and explicit lifecycle state.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for details.

## Documentation

Start with [`docs/README.md`](docs/README.md).

### Players

- [`docs/PLAYER_GUIDE.md`](docs/PLAYER_GUIDE.md)
- [`docs/PLAYER_GUIDE_HE.md`](docs/PLAYER_GUIDE_HE.md)
- [`docs/PRIVACY_AND_SAFETY.md`](docs/PRIVACY_AND_SAFETY.md)
- [`docs/ALPHA_TESTING.md`](docs/ALPHA_TESTING.md)

### Product and design

- [`docs/PRODUCT.md`](docs/PRODUCT.md)
- [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md)
- [`docs/BEHAVIOR_SPEC.md`](docs/BEHAVIOR_SPEC.md)
- [`docs/BOT_MEETINGS.md`](docs/BOT_MEETINGS.md)

### Development and operations

- [`docs/DEVELOPER_GUIDE.md`](docs/DEVELOPER_GUIDE.md)
- [`docs/CODE_STYLE.md`](docs/CODE_STYLE.md)
- [`docs/TESTING.md`](docs/TESTING.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md)
- [`CONTRIBUTING.md`](CONTRIBUTING.md)

## Contribution rule

Any PR that changes player behavior, API contracts, migrations, feature flags, privacy boundaries, AI authority, delivery semantics or production recovery must update the relevant documentation in the same PR.
