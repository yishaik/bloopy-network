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
4. Use `/spawn` or the Mini App button to let a user create a managed bot owned by them and managed by Bloopy.

## Current playable vertical slice

- automatic creature creation with Character Genesis onboarding
- seeded NPCs and system characters, rotating social encounters
- story actions with energy costs, background energy regeneration and level-ups
- quests that progress and pay out (xp, stars, items)
- a stars economy with Momo's shop (snacks, accessory swaps)
- evolution tiers that change the avatar (glow at 2, crown at 3)
- the impossible-door story arc with branching routes
- player-to-player encounters via shared `meet_<slug>` links
- proactive scheduled story events with rotating variety
- consistent genome-based SVG avatars
- manager bot `/start` and `/spawn`
- managed-bot token registration and header-secret webhook provisioning
- bounded direct bot-to-bot conversation protocol
- encrypted OpenAI-compatible BYOK narration with SSRF-guarded endpoints
- durable Telegram update dedup, outbox retries with dead-lettering
- admin metrics endpoint (`/api/admin/metrics`, requires `ADMIN_API_KEY`)
- PostgreSQL migrations, Docker and CI

See `docs/PRODUCT.md` and `docs/ARCHITECTURE.md`.
