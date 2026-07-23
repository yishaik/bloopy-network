# Railway production deployment

## Services

Create one Railway project with:

1. An application service connected to `yishaik/bloopy-network`, branch `main`.
2. A Railway PostgreSQL service named `Postgres`.

The repository root contains a Dockerfile and `railway.json`; do not set a service root directory or override the start command.

## Application variables

```dotenv
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
PUBLIC_BASE_URL=https://YOUR_RAILWAY_DOMAIN
TELEGRAM_MANAGER_BOT_TOKEN=YOUR_BOTFATHER_TOKEN
TELEGRAM_MANAGER_BOT_USERNAME=YourManagerBot
TELEGRAM_WEBHOOK_SECRET=GENERATE_A_RANDOM_URL_SAFE_SECRET
APP_ENCRYPTION_KEY=GENERATE_A_32_BYTE_BASE64_KEY
DEMO_MODE=false
ALLOW_LOCAL_AI=false
PROACTIVE_DELAY_SECONDS=7200
ADMIN_API_KEY=GENERATE_A_RANDOM_ADMIN_SECRET
```

Do not set `PORT`; Railway injects it.

Generate secrets locally:

```bash
openssl rand -base64 32
openssl rand -hex 32
```

Use the Base64 value for `APP_ENCRYPTION_KEY`. Use URL-safe alphanumeric/underscore/hyphen values for `TELEGRAM_WEBHOOK_SECRET`.

## Railway steps

1. Deploy the GitHub service and add PostgreSQL.
2. Generate a public domain for the application service.
3. Set all variables, using the generated HTTPS domain as `PUBLIC_BASE_URL`.
4. Redeploy. The pre-deploy command runs migrations, `/health` gates activation, and startup configures Telegram webhooks and menu buttons.
5. Keep one application replica for the first release.
6. Set a usage alert and hard spending limit.

## BotFather steps

1. Create the manager bot and retain its token.
2. Enable Bot Management Mode.
3. Enable Bot-to-Bot Communication Mode.
4. Set the bot profile photo, description and short description.
5. The service automatically configures `/start`, `/spawn`, the Mini App menu button and webhook after deployment.

## Verification

1. Open `https://YOUR_RAILWAY_DOMAIN/health` and confirm `{ "ok": true }`.
2. Send `/start` to the manager bot.
3. Open the Mini App and perform one action.
4. Wait for the configured proactive delay and confirm a proactive Telegram message arrives.
5. Send `/spawn`, create a managed bot, and confirm its menu button opens the same Mini App.
6. Inspect Railway logs for webhook or database errors.

## Current release boundary

This deployment is appropriate for a private production alpha. Before unrestricted public launch, add Telegram update deduplication, owner-level access controls for managed bots, media validation, and stronger bot-to-bot interaction authorization/rate limits.
