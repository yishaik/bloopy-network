# Bloopy Network API reference

## Scope

This document describes the current server HTTP surface and the conventions future player-facing meeting/matchmaking APIs must follow.

The Mini App is the primary client. Public endpoints are intentionally limited. Internal IDs and secrets are not stable public API concepts.

## Authentication

### Mini App/player routes

Authenticated player routes expect Telegram Mini App initData in:

```text
x-telegram-init-data: <Telegram initData>
```

The server validates the signature and derives the Telegram user. Managed-bot Mini App launches are validated against the relevant bot token.

Do not send `playerId` or owner IDs as authority. Ownership is derived server-side.

### Admin routes

Admin routes require:

```text
x-admin-key: <ADMIN_API_KEY>
```

Admin endpoints are operator tools and must not be used as dependencies for normal player flows.

### Telegram webhook routes

Telegram sends:

```text
x-telegram-bot-api-secret-token: <webhook secret>
```

The manager bot uses the global webhook secret. Each managed bot uses its own encrypted/registered secret.

## Error shape

Expected domain failures return:

```json
{
  "error": "Player-safe explanation",
  "code": "stable_error_code"
}
```

Validation failures use a curated `bad_input` response. Unexpected errors return a generic `internal` response.

Clients should branch on `code`, not parse English messages.

## Health and readiness

### `GET /livez`

Process liveness only.

### `GET /readyz`

Checks database connectivity, required migrations, queue thresholds and runtime controls. Returns `503` when the service should not receive normal traffic.

### `GET /health`

Checks PostgreSQL and returns the package release version.

## Public share endpoints

These use an opaque share token and expose only fixed public creature fields.

### `GET /share/c/:token`

Self-contained HTML share preview.

### `GET /share/c/:token/profile.svg`

Deterministic 1200×630 profile card.

### `GET /share/c/:token/story.svg`

Deterministic story card.

### `GET /share/c/:token/summary.txt`

Text-only accessible/share fallback.

A missing or invalid token returns a generic not-found result and does not reveal owner identity.

## Bootstrap and sharing

### `GET /api/bootstrap`

Returns the authenticated player's current dashboard and bootstraps a player/creature when required.

The payload may include:

- player/creature dashboard;
- onboarding state;
- current story arc;
- daily return;
- inventory;
- memories and latest personality change;
- notification preferences;
- AI/OpenRouter status;
- public manager-bot username;
- an encounter result when launched through a valid meet/referral parameter.

Bootstrap must remain concurrency-safe and must not duplicate identity or rewards.

### `GET /api/share`

Returns the authenticated creature's current player-safe share data:

```json
{
  "ready": true,
  "url": "https://…/share/c/<opaque-token>",
  "meetUrl": "https://t.me/…",
  "summary": "…"
}
```

## Onboarding

### `POST /api/onboarding/wake`

```json
{
  "choice": "gentle"
}
```

Allowed choices:

- `gentle`
- `noise`
- `snack`

### `POST /api/onboarding/identity`

```json
{
  "name": "Piko",
  "marker": "moon"
}
```

Allowed markers:

- `moon`
- `star`
- `dot`

Both endpoints are replay-safe and owner-scoped.

## Core game

### `POST /api/actions`

```json
{
  "action": "explore"
}
```

Allowed actions:

- `explore`
- `rest`
- `talk`
- `help`
- `social`

The server validates onboarding, energy and canonical prerequisites.

### `POST /api/shop/buy`

```json
{
  "itemId": "warm_snack"
}
```

Current item IDs exposed by the route:

- `warm_snack`
- `accessory_swap`

Purchases are transactional and cannot overdraw or duplicate inventory effects.

### `GET /api/creatures/:id/avatar.svg`

Returns deterministic SVG for an existing creature ID. The response contains public avatar data only.

## Story arcs

### `POST /api/story/arc/choice`

```json
{
  "arcId": "letter-from-tomorrow",
  "beatId": "current-beat",
  "choiceId": "selected-choice"
}
```

The generic endpoint validates the current active arc/beat and applies a canonical choice once.

### `POST /api/story/impossible-door/choice`

Legacy compatibility endpoint:

```json
{
  "beatId": "current-beat",
  "choiceId": "selected-choice"
}
```

New clients should use the generic arc route.

## Daily return and memories

### `POST /api/daily-return/:id/choice`

```json
{
  "choice": "hold_close"
}
```

Current choices:

- `hold_close`
- `tell_someone`
- `set_down`

### `POST /api/memories/:id/correct`

```json
{
  "summary": "Corrected player-approved memory"
}
```

### `DELETE /api/memories/:id`

Soft-deletes/removes the owner-editable memory from future approved context.

World-canon or another player's memory cannot be changed through these routes.

## Notifications

### `POST /api/settings/notifications`

```json
{
  "enabled": true,
  "timezone": "Asia/Jerusalem",
  "deliveryTime": "09:00",
  "quietStart": "22:00",
  "quietEnd": "07:00"
}
```

Times use `HH:mm`. The delivery time must be compatible with the configured quiet-hour rules.

## AI and OpenRouter

### `POST /api/settings/openrouter/connect`

Begins OpenRouter OAuth/PKCE and returns the player-safe authorization information required by the Mini App.

### `GET /auth/openrouter/callback`

External OAuth callback. It suppresses normal request logging and redirects to the Mini App with a connected/error state.

### `POST /api/settings/openrouter/model`

```json
{
  "mode": "balanced"
}
```

Allowed modes:

- `balanced`
- `creative`
- `smart`

### `POST /api/settings/openrouter/verify`

Server-side verification of the stored OpenRouter credential.

### `DELETE /api/settings/openrouter`

Deletes the stored credential and pending connection state.

### `POST /api/settings/ai`

Developer/manual compatible profile:

```json
{
  "baseUrl": "https://provider.example/v1",
  "model": "model-id",
  "apiKey": "secret"
}
```

The key is encrypted and never returned. The base URL is subject to SSRF protection. Normal players should prefer the OpenRouter connection flow.

## Account data controls

### `GET /api/account/export`

Downloads a deterministic JSON export with `no-store` caching.

The export explicitly lists safe game fields and excludes credentials, tokens, initData, OAuth verifier/state and security internals.

### `POST /api/account/creature/reset`

```json
{
  "confirm": "RESET"
}
```

Revokes/detaches managed bots and transactionally removes creature-scoped state. The next launch creates a fresh creature with a new generation slug/share identity.

### `POST /api/account/delete`

```json
{
  "confirm": "DELETE"
}
```

Revokes managed bots, removes player data and credentials and anonymizes/cleans retained operational data according to the account lifecycle rules. Repeated deletion is a no-op success and must not recreate the player.

## Managed bots

These routes are owner-scoped and may be unavailable while the managed-bot fleet is disabled.

### `GET /api/bots/spawn-link`

Returns a player-safe managed-bot creation link after onboarding.

### `GET /api/bots/manage`

Returns the authenticated owner's managed-bot views, including public username, active/revoked state, consent and safe activity metadata.

Secrets and token ciphertext are never returned.

### `POST /api/bots/:botId/interaction-consent`

```json
{
  "enabled": true
}
```

Only the owner can change meeting consent.

### `PUT /api/bots/:botId/access-rule`

```json
{
  "chatId": -1001234567890,
  "telegramUserId": 123456789,
  "chatType": "supergroup",
  "enabled": true
}
```

For a chat-wide group rule, `telegramUserId` may be omitted. Private-chat rules require a user ID.

The API uses numeric bot/chat identifiers internally because Telegram requires them; UI should present names/context rather than raw IDs where possible.

### `POST /api/bots/:botId/rotate-token`

Owner-only, strongly rate-limited token rotation. The new token is obtained and configured server-side.

### `DELETE /api/bots/:botId`

Revokes the managed bot, disables webhook access and cancels active bot interactions.

## Admin operations

### `POST /api/admin/bots/converse`

Current verification-only bot interaction start:

```json
{
  "sourceBotId": 123456,
  "targetUsername": "@OtherCreatureBot"
}
```

This is not the final player meeting API. Issues #58–#63 replace it with invitation and owner-scoped lifecycle routes.

### `GET /api/admin/metrics`

Returns privacy-safe operational counts, release version, migration ledger and runtime flag state.

### `GET /api/admin/outbox/problems?limit=100`

Lists problem deliveries for operator review.

### `POST /api/admin/outbox/:id/replay`

Explicitly replays an approved delivery. Replaying an uncertain Telegram send may create a duplicate and must remain an operator decision.

### `POST /api/admin/runtime/controls/:key`

Supported keys:

- `telegram_ingress`
- `outbox_delivery`
- `risky_mutations`

Body:

```json
{
  "enabled": false,
  "reason": "Non-secret operator reason"
}
```

### `POST /api/admin/runtime/recover`

Recovers expired ingress leases and classifies expired outbound leases as uncertain.

### `GET /api/admin/verification`

Returns a non-secret verification snapshot for production gate tooling.

### `POST /api/admin/verification/replay-update`

Safely probes replay behavior for a previously processed update:

```json
{
  "source": "manager",
  "updateId": 123456789
}
```

## Telegram webhook endpoints

### `POST /telegram/manager`

Validates the manager webhook secret and enqueues the update.

### `POST /telegram/managed/:botId`

Validates the per-bot secret header and enqueues the update when the managed fleet is enabled.

A legacy path-secret endpoint may exist during migration. New integrations must use the header-secret route.

## Planned direct-meeting API

The exact contract will be finalized by issues #60 and #61. The intended shape includes:

```text
POST   /api/bot-meeting-invitations
GET    /api/bot-meeting-invitations/:id
POST   /api/bot-meeting-invitations/:id/accept
POST   /api/bot-meeting-invitations/:id/decline
DELETE /api/bot-meeting-invitations/:id
POST   /api/bot-meetings
GET    /api/bot-meetings
GET    /api/bot-meetings/:id
```

Requirements:

- authenticated owner derived from initData;
- opaque invitation/meeting IDs;
- no private other-owner identifiers;
- accepted invitation bound to one interaction;
- idempotent start;
- safe lifecycle/reason codes;
- transcript/history only for participating owners.

## Planned matchmaking API

Issue #64 proposes a separate surface:

```text
GET    /api/bot-matchmaking/settings
PUT    /api/bot-matchmaking/settings
POST   /api/bot-matchmaking/queue
GET    /api/bot-matchmaking/queue/current
DELETE /api/bot-matchmaking/queue/current
POST   /api/bot-matchmaking/matches/:id/block
POST   /api/bot-matchmaking/matches/:id/report
POST   /api/bot-matchmaking/matches/:id/connect
```

No endpoint may enumerate all players/bots or target arbitrary strangers.

## API change rules

When changing an endpoint:

- validate all new input;
- preserve/plan compatibility for cached Mini App clients;
- add stable error codes;
- document owner and privacy behavior;
- test duplicate/concurrent requests;
- update this file, player docs and behavior spec;
- update release/operations docs when flags or migrations change.
