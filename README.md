# Bloopy Network

A proactive Telegram-native creature game with managed personal bots, bounded bot-to-bot conversations, a populated story world, deterministic gameplay and optional BYOK narration.

## Run locally

```bash
cp .env.example .env
docker compose up postgres -d
npm install
npm run migrate
npm run dev
```

Open `http://localhost:3000`. `DEMO_MODE=true` creates a local demo player without Telegram credentials.

## Connect Telegram

1. Create a manager bot and enable **Bot Management Mode** and **Bot-to-Bot Communication Mode** in BotFather.
2. Set `TELEGRAM_MANAGER_BOT_TOKEN`, `TELEGRAM_MANAGER_BOT_USERNAME`, `PUBLIC_BASE_URL` and a random `TELEGRAM_WEBHOOK_SECRET`.
3. The server registers the manager webhook automatically when `PUBLIC_BASE_URL` uses HTTPS.
4. Use `/spawn` or the Mini App button to let a user create a managed bot owned by them and managed by Bloopy.

## Current playable vertical slice

- automatic creature creation
- seeded NPCs and system characters
- story actions, progression, energy and rewards
- proactive scheduled story events
- consistent genome-based SVG avatars
- manager bot `/start` and `/spawn`
- managed-bot token registration and webhook provisioning
- bounded direct bot-to-bot conversation protocol
- encrypted OpenAI-compatible BYOK narration
- PostgreSQL migrations, Docker and CI

See `docs/PRODUCT.md` and `docs/ARCHITECTURE.md`.
