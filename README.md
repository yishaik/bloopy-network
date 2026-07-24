# Bloopy Network

A proactive Telegram-native creature game with managed personal bots, bounded bot-to-bot conversations, a populated story world, deterministic gameplay and optional BYOK narration.

## Run locally

```bash
cp .env.example .env
# generate the required encryption key (the example placeholder is rejected at boot):
#   openssl rand -base64 32   -> paste into APP_ENCRYPTION_KEY in .env
docker compose up postgres -d
npm install
npm run migrate
npm run dev
```

Open `http://localhost:3000`. `DEMO_MODE=true` creates a local demo player without Telegram credentials (blocked in production).

## Connect Telegram

1. Create a manager bot and enable **Bot Management Mode** and **Bot-to-Bot Communication Mode** in BotFather.
2. Set `TELEGRAM_MANAGER_BOT_TOKEN`, `TELEGRAM_MANAGER_BOT_USERNAME`, `PUBLIC_BASE_URL` and a random `TELEGRAM_WEBHOOK_SECRET`.
3. The server registers the manager webhook automatically when `PUBLIC_BASE_URL` uses HTTPS.
4. Managed personal bots and bot-to-bot conversations are disabled by default. Enable them only according to the staged gates in `docs/ALPHA_TESTING.md`.
5. When the managed-bot fleet is enabled, use `/spawn` or the Mini App button to let a user create a managed bot owned by them and managed by Bloopy.

## Current playable vertical slice

- automatic creature creation with Character Genesis onboarding
- seeded NPCs and system characters, rotating social encounters
- story actions with energy costs, background energy regeneration and level-ups
- quests that progress and pay out (xp, stars, items)
- a stars economy with Momo's shop (snacks, accessory swaps)
- evolution tiers that change the avatar (glow at 2, crown at 3)
- two branching authored story arcs
- player-to-player encounters via shared `meet_<slug>` links
- proactive scheduled story events with rotating variety
- consistent genome-based SVG avatars
- manager bot `/start` and staged `/spawn`
- managed-bot ownership, approved-chat controls, token rotation and revoke
- persisted, signed and bounded bot-to-bot conversation protocol
- encrypted OpenRouter OAuth and OpenAI-compatible BYOK narration
- durable leased Telegram ingress and outbox delivery recovery
- explicit retry, uncertain-delivery and dead-letter states
- liveness, readiness, degraded mode and admin operational controls
- PostgreSQL migrations, Docker and CI database smoke suites

## Documentation

- [`docs/PRODUCT.md`](docs/PRODUCT.md) — product direction
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system architecture
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — Railway handoff, deployment, runtime controls and recovery
- [`docs/ALPHA_TESTING.md`](docs/ALPHA_TESTING.md) — staged tester rollout and managed-bot verification gates
