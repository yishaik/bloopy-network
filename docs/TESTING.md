# Bloopy Network testing guide

## Testing philosophy

Bloopy is a persistent game connected to Telegram and optional external AI. A successful test strategy must prove more than happy-path HTTP responses.

Tests should verify:

- deterministic rules;
- transactional state changes;
- replay and concurrency safety;
- owner authorization;
- privacy-safe responses;
- asynchronous lifecycle recovery;
- deterministic fallback when external services fail;
- production behavior with real Telegram resources before risky flags are enabled.

## Required validation layers

## 1. Type checking

```bash
npm run typecheck
```

Strict TypeScript is a merge gate. Do not suppress an error with `any` or unsafe casts when the real problem is an unclear contract.

## 2. Unit tests

```bash
npm test
```

Unit tests should cover:

- parsers and validators;
- moderation and normalization;
- story-arc resolution;
- onboarding and state rules;
- avatar/genome behavior;
- Telegram initData and interaction-envelope verification;
- AI catalog/policy decisions;
- timezone and quiet-hour calculations;
- deterministic fallback content.

Unit tests should not require production credentials or external network access.

## 3. Production build

```bash
npm run build
```

The build is required even when type checking passes because runtime ESM output and static assets are part of the deployable product.

## 4. Clean migration test

```bash
docker compose up postgres -d
npm run migrate
```

A migration change must be tested from a clean PostgreSQL database.

Also test upgrade assumptions when the migration backfills or constrains existing rows.

Rules:

- migration filenames are immutable after release;
- migrations are additive and forward-safe;
- prior application versions should tolerate additive schema where rollback requires it;
- readiness expectations must be updated when a migration becomes release-critical.

## 5. Database smoke suites

Current suites:

```bash
npm run test:memory-db -w @bloopy/server
npm run test:notifications-db -w @bloopy/server
npm run test:openrouter-db -w @bloopy/server
npm run test:telegram-control-db -w @bloopy/server
npm run test:delivery-runtime-db -w @bloopy/server
```

A DB smoke test is appropriate when behavior depends on:

- unique constraints;
- transactions;
- row/advisory locks;
- ownership joins;
- idempotency keys;
- queue claims and leases;
- lifecycle transitions;
- cascade/delete behavior;
- concurrent requests.

Use a transaction for test setup/cleanup where possible. When committed rows are required to test workers, use unique test identifiers and explicit cleanup.

## CI pipeline

GitHub Actions runs:

1. install;
2. typecheck;
3. unit tests;
4. production build;
5. PostgreSQL service;
6. clean migrations;
7. all database smoke suites.

Failed typecheck/test/smoke logs are uploaded as artifacts.

CI intentionally enables managed-bot and bot-to-bot flags for automated coverage. That does not mean those flags should automatically be enabled in production.

## Test matrix by change type

| Change | Minimum required validation |
|---|---|
| Documentation only | link/content review; CI should remain unaffected |
| Pure utility/parser | typecheck, unit tests |
| UI state/copy | typecheck/build, component or browser checks where available, mobile viewport review |
| Canonical action/reward | unit tests, DB replay test, concurrency test if relevant |
| Migration | clean migration, affected DB smoke, upgrade/backfill review |
| Telegram flow | signature/auth tests, ingress dedup, outbox delivery classification, production gate |
| Managed-bot ownership | cross-owner negative tests, revoke/rotation tests, real one-bot verification |
| Bot-to-bot flow | two-owner DB smoke, replay/forgery/TTL/budget tests, real two-bot verification |
| Matchmaking | two-worker matching race, block/cooldown/expiry tests, 4-account E2E |
| AI narration | fallback, timeout, budget, prompt boundary, moderation and leakage tests |
| Media processing | type/size/timeout, injection, privacy, retention, provider failure and moderation tests |
| Operations/runtime | readiness, control transition, lease recovery, rollback documentation |

## Replay testing

Every retryable mutation should be tested at least twice with the same logical command.

Assert that repeated execution does not duplicate:

- XP;
- stars;
- items;
- quest completion;
- relationship edges;
- story entries;
- memories;
- notifications;
- invitations;
- meetings;
- analytics that represent a canonical event.

When the API promises a replay result, assert that the response is stable or clearly marked as replayed.

## Concurrency testing

Use concurrent transactions or requests for operations where races matter:

- bootstrap;
- action spending energy;
- shop purchase;
- story choice;
- daily return completion;
- invitation acceptance/start;
- matchmaking claims;
- token rotation/revoke;
- queue worker claims.

Assert one canonical winner and a safe result for every loser/retry.

## Authorization testing

For every owner-scoped resource, test:

- owner can read/write the intended fields;
- another owner cannot read it;
- another owner cannot mutate it;
- changing a client-supplied identifier does not bypass ownership;
- disabled/revoked resources stay inaccessible;
- response shape does not leak private owner data.

## Privacy-contract testing

Player/API responses must not include:

- encrypted or plaintext API keys;
- bot tokens;
- webhook secrets;
- Telegram initData;
- OAuth verifier or raw state;
- internal HMAC signatures;
- another owner's Telegram ID;
- raw operational queue payloads;
- private memories outside the authenticated player's scope.

Add explicit assertions against sensitive field names for new public response models.

## AI testing

Test both AI and fallback paths.

Required cases:

- no profile connected;
- provider disabled;
- budget exhausted;
- timeout;
- provider 4xx/5xx;
- malformed output;
- moderated output;
- prompt-injection-like memory/content;
- valid enriched output;
- canonical state identical regardless of narration success.

Narrative evaluation should assess:

- voice consistency;
- factual adherence;
- brevity;
- safety;
- absence of invented rewards/choices;
- quality relative to deterministic fallback.

## Telegram delivery testing

Test lifecycle classifications:

- success records message ID;
- `429` respects retry-after;
- known permanent `4xx` dead-letters;
- `5xx` retries with bounds;
- timeout/network ambiguity becomes uncertain;
- expired sending lease becomes uncertain;
- manual replay is explicit and audited;
- pausing/resuming delivery preserves queued work.

Never assert automatic retry for uncertain Telegram delivery.

## Story-arc testing

For each arc, test:

- activation prerequisites;
- every legal branch;
- illegal/stale choice rejection;
- route inheritance;
- reward exactly once;
- quest integration;
- refresh/resume;
- completion state;
- deterministic fallback;
- optional AI update cannot alter canonical result.

## Frontend testing

Player-facing flows should cover:

- loading;
- empty state;
- disabled feature;
- normal success;
- typed domain error;
- offline/temporary outage;
- double tap;
- refresh/resume;
- narrow Telegram viewport;
- large text;
- keyboard and screen-reader semantics;
- reduced motion.

For meeting/matchmaking flows, both owners should see consistent state.

## Production verification

Automated tests cannot prove Telegram resource ownership, BotFather configuration, webhook behavior or real delivery semantics.

Use staged production gates from [Alpha testing](./ALPHA_TESTING.md):

- Phase 1: core game with risky bot surfaces off;
- Phase 2: one real managed bot;
- Phase 3: two owners and two bots for bot-to-bot;
- later matchmaking: at least four real accounts for concurrent pairing/no-repeat behavior.

Production evidence must be non-secret.

## Bug regression tests

A bug fix should include a test that fails before the fix when practical.

Name the behavior, not the issue number alone.

Good:

```ts
it("does not grant the daily reward twice after a repeated choice", ...)
```

Weak:

```ts
it("fixes #123", ...)
```

## Release checklist

Before merge:

- [ ] typecheck passes;
- [ ] unit tests pass;
- [ ] build passes;
- [ ] migrations pass from clean DB when relevant;
- [ ] affected smoke suites pass;
- [ ] replay and concurrency risks are tested;
- [ ] authorization/privacy negative tests exist;
- [ ] docs and flags are updated;
- [ ] no unresolved review thread remains.

After deployment:

- [ ] exact tested commit is deployed;
- [ ] expected migrations applied once;
- [ ] `/livez` is healthy;
- [ ] `/readyz` is ready;
- [ ] `/health` reports expected version;
- [ ] metrics show no unexplained failed/uncertain/dead-letter work;
- [ ] risky flags match the rollout phase;
- [ ] a player journey smoke test passes.
