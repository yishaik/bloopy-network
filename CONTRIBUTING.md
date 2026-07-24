# Contributing to Bloopy Network

## Before you start

Read:

- [`docs/README.md`](docs/README.md)
- [`docs/PRODUCT.md`](docs/PRODUCT.md)
- [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md)
- [`docs/BEHAVIOR_SPEC.md`](docs/BEHAVIOR_SPEC.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/CODE_STYLE.md`](docs/CODE_STYLE.md)
- [`docs/TESTING.md`](docs/TESTING.md)

Bloopy's core constraints are product rules, not optional implementation preferences:

- deterministic canonical game state;
- transactional/idempotent mutations;
- owner-derived authorization;
- safe external delivery through queues;
- optional AI that cannot control rewards or state;
- privacy boundaries between player and public creature identity;
- staged feature flags for managed bots, bot-to-bot and matchmaking.

## Issues

Use an issue for any change that affects:

- player-visible behavior;
- a new game mechanic or story system;
- schema or migration behavior;
- a Telegram or social flow;
- privacy/security;
- production configuration;
- a substantial refactor.

An implementation issue should describe:

- goal and player outcome;
- current gap;
- scope and non-scope;
- data/API changes;
- authorization and privacy boundaries;
- idempotency/retry behavior;
- failure states;
- feature flags and rollout;
- acceptance criteria;
- test requirements;
- documentation changes.

Before opening a new issue, search for overlapping roadmap, epic and bug issues.

## Branches

Use a focused branch from current `main`.

Recommended format:

```text
agent/<short-description>
```

Keep unrelated work in separate branches and pull requests.

## Local validation

```bash
npm install
npm run typecheck
npm test
npm run build
```

When database behavior changes:

```bash
docker compose up postgres -d
npm run migrate
npm run test:memory-db -w @bloopy/server
npm run test:notifications-db -w @bloopy/server
npm run test:openrouter-db -w @bloopy/server
npm run test:telegram-control-db -w @bloopy/server
npm run test:delivery-runtime-db -w @bloopy/server
```

Run at least the affected smoke suite. CI runs all suites.

## Pull requests

Default to a draft PR while work is incomplete.

A useful PR description includes:

- what changed;
- why it changed;
- player/developer impact;
- migration and environment changes;
- security/privacy impact;
- verification performed;
- rollout and rollback;
- linked issues.

### PR checklist

- [ ] scope is focused and linked to an issue where appropriate;
- [ ] strict TypeScript passes;
- [ ] unit tests pass;
- [ ] production build passes;
- [ ] clean migrations and affected DB smokes pass;
- [ ] replay/double-submit behavior is safe;
- [ ] concurrent behavior is tested where relevant;
- [ ] cross-owner authorization is tested;
- [ ] no secret/private fields appear in logs or responses;
- [ ] AI failure leaves canonical behavior intact;
- [ ] feature flags/metrics/rollback exist for risky behavior;
- [ ] player, developer and operations docs are updated;
- [ ] no unresolved review thread remains before merge.

## Review priorities

Review in this order:

1. canonical correctness;
2. ownership and privacy;
3. idempotency and concurrency;
4. external-delivery failure behavior;
5. player experience and accessibility;
6. tests and operations;
7. maintainability and formatting.

A visually correct flow is not safe to merge when retries can duplicate rewards or another owner can access it.

## Migrations

- Never rename or edit an already applied migration.
- Use a new unique ordered migration file.
- Prefer additive changes.
- Backfill before enforcing constraints.
- Add indexes and state constraints deliberately.
- Document release-critical migration expectations.
- Production rollback keeps additive schema and redeploys prior code.

## Game content

For a new action, quest or arc:

- define canonical prerequisites/effects;
- provide deterministic fallback narration;
- use stable IDs;
- keep rewards bounded;
- test every branch and replay;
- preserve tone from `GAME_DESIGN.md`;
- avoid hidden AI authority.

## Telegram and social changes

Any Telegram/social PR must specify:

- authenticated actor and owner;
- consent model;
- update and command idempotency;
- outbox/delivery behavior;
- rate limits and budgets;
- private/public response fields;
- kill switch;
- production E2E gate with real accounts/bots.

Do not enable a risky flag merely because code merged.

## Security reporting

Do not open a public issue containing:

- bot tokens;
- webhook secrets;
- API keys;
- Telegram initData;
- OAuth verifier/state;
- decrypted credentials;
- private user messages or media.

Disable the narrowest affected feature and use a private owner/operator channel for sensitive evidence.

## Documentation

Update docs in the same PR when a change modifies:

- player behavior;
- game tone or design rules;
- an endpoint or response model;
- persistence/idempotency rules;
- privacy or consent;
- flags or environment variables;
- testing/release gates;
- operations and recovery.

Mark planned behavior clearly. Do not document a planned feature as shipped.
