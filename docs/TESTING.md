# Bloopy Network testing guide

## Testing philosophy

Bloopy is a persistent game connected to Telegram, PostgreSQL and optional external AI. Tests must prove more than happy-path HTTP responses.

Validate:

- deterministic rules;
- transactional state changes;
- replay and concurrency safety;
- owner authorization;
- privacy-safe public/export responses;
- account lifecycle cleanup;
- asynchronous recovery;
- deterministic fallback on external failure;
- release recoverability;
- real Telegram behavior before risky flags are enabled.

## Required validation layers

## 1. Type checking

```bash
npm run typecheck
```

Strict TypeScript is a merge gate. Do not hide unclear contracts with `any`.

## 2. Unit tests

```bash
npm test
```

Unit coverage should include:

- parsers/validators;
- moderation/normalization;
- onboarding and deterministic progression;
- story-arc resolution;
- avatar/card rendering;
- share summaries and token-safe behavior;
- referral rules;
- export schemas and confirmation parsing;
- Telegram initData and signed envelopes;
- AI policy/catalog/fallback;
- timezone/quiet hours;
- release-check parsing and failure paths.

No production credential or external network dependency belongs in unit tests.

## 3. Production build

```bash
npm run build
```

Required because ESM output and static Mini App/share assets are part of the deployable product.

## 4. Clean migration

```bash
docker compose up postgres -d
npm run migrate
```

Migration rules:

- immutable filenames after release;
- additive/forward-safe schema;
- backfill before restrictive constraints;
- earlier application code remains compatible where rollback requires it;
- readiness/release checks update when running code depends on a new migration.

For release 0.12, migration/account-lifecycle behavior includes opaque share tokens, referral/account lifecycle tables and cleanup invariants.

## 5. Database smoke suites

```bash
npm run test:memory-db -w @bloopy/server
npm run test:notifications-db -w @bloopy/server
npm run test:openrouter-db -w @bloopy/server
npm run test:telegram-control-db -w @bloopy/server
npm run test:delivery-runtime-db -w @bloopy/server
npm run test:account-db
```

Use DB smoke tests for unique constraints, transactions, locks, ownership joins, command keys, queue leases, lifecycle transitions, cascades/non-FK cleanup and concurrent requests.

The account suite must cover at least:

- export allowlist and secret exclusion;
- managed-bot revoke coordination;
- reset removes creature-scoped state and permits fresh bootstrap;
- reset creates a new generation/share identity;
- old share links do not target the replacement;
- deletion removes credentials/private state;
- raw/non-FK identity-bearing data is cleaned;
- retained security history is anonymized as designed;
- repeated deletion is idempotent and does not recreate the account.

## 6. Backup and restore drill

```bash
npm run verify:restore
```

The drill should:

- refuse production targets;
- use compatible PostgreSQL client/server versions;
- create a backup;
- restore into an isolated database;
- verify the migration ledger;
- verify core tables and seeded world;
- confirm rerunning migrations is a no-op.

Schema changes must not merge when the documented recovery path is broken.

## CI pipeline

GitHub Actions runs:

1. install;
2. typecheck;
3. unit tests;
4. production build;
5. PostgreSQL service;
6. clean migrations;
7. all six DB smoke suites;
8. backup/verified restore drill.

Failure logs are uploaded as artifacts where configured.

CI enables managed-bot/bot-to-bot flags for automated control-plane coverage. That does not enable them in production.

## Test matrix

| Change | Minimum validation |
|---|---|
| Documentation only | link/content review; normal CI |
| Pure utility/parser | typecheck, unit tests |
| UI state/copy | typecheck/build, browser/component checks, narrow viewport |
| Canonical reward/action | unit + DB replay + concurrency where relevant |
| Migration | clean migration, affected DB smoke, restore drill, upgrade review |
| Public share/card | rendering tests, token privacy, invalid/old token, injection safety |
| Referral | attribution/payout replay, reset/delete abuse, concurrent completion |
| Export | explicit field allowlist, known-secret/name exclusion, no-store headers |
| Reset/delete | account DB smoke, external revoke failure tolerance, orphan cleanup, repeated call |
| Telegram flow | auth/signature, ingress dedup, delivery classification, production gate |
| Managed-bot ownership | cross-owner negative, revoke/rotation, one-bot E2E |
| Bot-to-bot | two-owner DB smoke, replay/forgery/TTL/budget, two-bot E2E |
| Matchmaking | atomic two-worker race, blocks/cooldown/expiry, four-account E2E |
| AI narration | fallback, timeout, budget, prompt boundary, moderation/leakage |
| Media | type/size/timeout, injection, privacy, retention/provider failure |
| Operations | readiness, runtime controls, leases, release check, rollback |

## Replay testing

Run every retryable mutation twice with the same logical command and assert no duplicate:

- XP/stars/items;
- quest completion;
- relationship/story/memory;
- notifications;
- referral payout;
- invitations/meetings/matches;
- account lifecycle event;
- canonical analytics.

When the API promises replay behavior, return stable existing state or an explicit replay marker.

## Concurrency testing

Test concurrent:

- bootstrap/onboarding completion;
- energy spending;
- shop purchase;
- story/daily-return choice;
- referral payout;
- invitation acceptance/start;
- matchmaking claims;
- token rotate/revoke;
- queue worker claims;
- reset/delete versus active operations where relevant.

Assert one canonical winner and safe behavior for all other attempts.

## Authorization testing

For every owner-scoped resource:

- owner can perform intended action;
- another owner cannot read/mutate;
- client identifier substitution fails;
- disabled/revoked resources remain inaccessible;
- response does not leak private owner data.

Account export/reset/delete must always derive the account from authenticated Telegram context.

## Privacy-contract testing

Assert player/public/export responses exclude:

- plaintext and encrypted API keys;
- bot tokens/webhook secrets;
- initData;
- OAuth state/verifier;
- HMAC signatures;
- another owner's Telegram ID;
- raw queue/security payloads;
- private memories outside scope.

For exports, assert both sensitive field names and seeded known-secret values are absent. Explicitly listing export columns is safer than `SELECT *` plus filtering.

Public share tests should confirm the token does not encode the owner identity and only the declared public view is rendered.

## AI testing

Cover:

- no profile/provider disabled;
- budget exhausted;
- timeout/4xx/5xx;
- malformed or moderated output;
- prompt-injection-like content;
- valid enrichment;
- identical canonical state regardless of narration success.

Evaluate voice consistency, factual adherence, brevity, safety, no invented rewards/choices and quality relative to fallback.

## Telegram delivery testing

Cover:

- success records Telegram message ID;
- `429` respects retry-after;
- permanent `4xx` dead-letters;
- `5xx` retries with bounds;
- timeout/network ambiguity becomes uncertain;
- expired sending lease becomes uncertain;
- manual replay is explicit/audited;
- pause/resume preserves work.

Never expect automatic replay of uncertain sends.

## Story testing

For each arc:

- activation prerequisites;
- every branch;
- illegal/stale choice rejection;
- route inheritance;
- reward once;
- quest integration;
- resume/completion;
- fallback;
- AI cannot alter canonical result.

## Frontend testing

Cover loading, empty, disabled, success, typed error, outage, double tap, refresh, narrow Telegram viewport, large text, keyboard/screen-reader behavior and reduced motion.

For destructive account flows, test confirmation, cancellation, post-reset state and post-deletion no-op behavior.

For meeting/matchmaking, both owners must see consistent state without private identity leakage.

## Release preflight

After deployment run:

```bash
ADMIN_API_KEY=… npm run release:check -- --base-url https://deployment.example --phase 1
```

The check must fail on:

- wrong release version;
- missing migration ledger entries;
- flags inconsistent with rollout phase;
- failed/uncertain/dead-letter queue work;
- unhealthy liveness/readiness/health;
- required verification reported as skipped.

`SKIP` is never equivalent to `PASS`.

Use `npm run verify:gate` for the documented human-verification probe where applicable.

## Production verification

Automated tests cannot prove BotFather configuration, ownership or real Telegram delivery.

Follow [Alpha testing](./ALPHA_TESTING.md):

- Phase 1 core game with risky bot surfaces off;
- Phase 2 one real managed bot;
- Phase 3A two-owner protocol;
- Phase 3B player-facing direct meeting flow;
- Phase 4 at least four accounts for stranger matching.

Evidence must remain non-secret.

## Regression tests

A fix should add a behavior-named test that fails before the fix when practical.

Good:

```ts
it("does not grant the referral twice after creature reset", ...)
```

Avoid tests named only after issue numbers.

## Release checklist

Before merge:

- [ ] typecheck, unit tests and build pass;
- [ ] clean migrations pass when relevant;
- [ ] affected/all DB smoke suites pass;
- [ ] backup/restore drill passes for schema/release changes;
- [ ] replay/concurrency tested;
- [ ] authorization/privacy negative tests exist;
- [ ] public/export response contracts tested;
- [ ] docs/flags/release tooling updated;
- [ ] no unresolved review thread.

After deployment:

- [ ] exact tested commit deployed;
- [ ] expected migrations applied once;
- [ ] `/livez`, `/readyz`, `/health` healthy;
- [ ] `release:check` passes with no skips;
- [ ] metrics show no unexplained failed/uncertain/dead-letter work;
- [ ] risky flags match phase;
- [ ] relevant player journey smoke passes;
- [ ] backup/restore procedure remains verified.
