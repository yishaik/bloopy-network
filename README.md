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
- shareable creature and story cards with one-time referral attribution
- self-service data export, creature reset and account deletion
- verified backup/restore drill and an automated release preflight
- PostgreSQL migrations, Docker and CI database smoke suites

## Going live

```bash
ADMIN_API_KEY=… npm run release:check -- --base-url https://your-deployment --phase 1
```

The preflight verifies health, version, runtime flags, queue health and the migration ledger, and
exits non-zero if anything fails. Start at [`docs/GO_LIVE.md`](docs/GO_LIVE.md).

## Documentation

**Launch**

- [`docs/GO_LIVE.md`](docs/GO_LIVE.md) — the ordered runbook from a deployed build to real players
- [`docs/PHASE1_ALPHA.md`](docs/PHASE1_ALPHA.md) — Phase-1 roster, tester journey and stop conditions
- [`docs/BACKUP_RESTORE.md`](docs/BACKUP_RESTORE.md) — verified backups and the restore drill

**Operating**

- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — Railway handoff, deployment, runtime controls and recovery
- [`docs/ALPHA_TESTING.md`](docs/ALPHA_TESTING.md) — staged tester rollout and managed-bot verification gates
- [`docs/RAILWAY_DEPLOY.md`](docs/RAILWAY_DEPLOY.md) — Railway specifics

**Players and product**

- [`docs/PRIVACY.md`](docs/PRIVACY.md) — what is stored, who can see it, and how a player removes it
- [`docs/SUPPORT.md`](docs/SUPPORT.md) — support channel, severities and escalation
- [`docs/PRODUCT.md`](docs/PRODUCT.md) — product direction
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system architecture
