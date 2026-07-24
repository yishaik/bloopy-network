# Contributing to Bloopy Network

## Before you start

Read:

- [`docs/README.md`](docs/README.md)
- [`docs/PRODUCT.md`](docs/PRODUCT.md)
- [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md)
- [`docs/BEHAVIOR_SPEC.md`](docs/BEHAVIOR_SPEC.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/API.md`](docs/API.md)
- [`docs/CODE_STYLE.md`](docs/CODE_STYLE.md)
- [`docs/TESTING.md`](docs/TESTING.md)

Core constraints are product rules:

- deterministic canonical state;
- transactional/idempotent mutation;
- server-derived ownership;
- durable external delivery;
- optional AI without reward/state authority;
- explicit public/private data boundaries;
- self-service export/reset/delete;
- staged flags for managed bots, bot-to-bot and matchmaking;
- verified release and restore procedures.

## Issues

Use an issue for changes affecting player behavior, mechanics/story, schema, Telegram/social flows, privacy/security, production configuration or substantial architecture.

An implementation issue should describe:

- player goal/current gap;
- scope/non-scope;
- data/API changes;
- auth/privacy boundaries;
- idempotency/concurrency;
- expected failure states;
- flags/rollout/rollback;
- acceptance and tests;
- documentation changes.

Search existing roadmap, epics and bugs before creating a duplicate.

## Branches

Start a focused branch from current `main`:

```text
agent/<short-description>
```

Do not combine unrelated work.

## Local validation

```bash
npm install
npm run typecheck
npm test
npm run build
```

For database behavior:

```bash
docker compose up postgres -d
npm run migrate
npm run test:memory-db -w @bloopy/server
npm run test:notifications-db -w @bloopy/server
npm run test:openrouter-db -w @bloopy/server
npm run test:telegram-control-db -w @bloopy/server
npm run test:delivery-runtime-db -w @bloopy/server
npm run test:account-db
```

For schema/release/recovery changes:

```bash
npm run verify:restore
```

After deployment, use the appropriate preflight:

```bash
ADMIN_API_KEY=… npm run release:check -- --base-url https://deployment.example --phase 1
```

CI runs all current smoke suites and the backup/restore drill.

## Pull requests

Default to a draft PR while incomplete.

Describe:

- what and why;
- player/developer impact;
- migration/environment changes;
- security/privacy impact;
- validation performed;
- rollout/rollback;
- linked issues.

### PR checklist

- [ ] focused scope;
- [ ] typecheck, unit tests and build pass;
- [ ] clean migration and affected DB smokes pass;
- [ ] account lifecycle smoke passes when export/reset/delete or related schema changes;
- [ ] restore drill passes for schema/recovery changes;
- [ ] replay/concurrency behavior tested;
- [ ] cross-owner authorization tested;
- [ ] public/share/export field privacy tested;
- [ ] AI failure leaves canonical state intact;
- [ ] feature flag, metrics and rollback exist for risky behavior;
- [ ] release/preflight tooling updated when needed;
- [ ] player, API, developer and operations docs updated;
- [ ] no unresolved review thread before merge.

## Review priorities

Review in this order:

1. canonical correctness;
2. ownership/privacy/account lifecycle;
3. idempotency/concurrency;
4. external-delivery behavior;
5. player experience/accessibility;
6. tests/release/recovery;
7. maintainability/formatting.

A visually correct feature is unsafe if retries duplicate rewards, private fields leak, deletion leaves data behind or another owner can access it.

## Migrations

- Never rename/edit an applied migration.
- Use a new unique ordered file.
- Prefer additive changes.
- Backfill before constraints.
- Add indexes/checks deliberately.
- Update readiness and release ledger expectations.
- Verify backup/restore.
- Production rollback retains additive schema and redeploys prior code.

## Public sharing and account lifecycle

For public share/export work:

- use opaque public tokens;
- select public/export fields explicitly;
- never return whole rows and filter known secrets afterward;
- test invalid/old links and seeded secret values;
- invalidate old creature share identity after reset.

For reset/delete:

- require explicit confirmation;
- revoke external managed bots before removing registry authorization;
- clean non-FK/raw identity-bearing records;
- anonymize only documented retained security history;
- test repeated deletion and fresh bootstrap after reset.

## Game content

New actions, quests and arcs must define deterministic prerequisites/effects, stable IDs, bounded rewards, fallback narration and replay tests while preserving [`GAME_DESIGN.md`](docs/GAME_DESIGN.md).

## Telegram and social changes

Specify:

- authenticated actor/owner;
- consent;
- update/command idempotency;
- durable outbox behavior;
- limits/budgets;
- public/private fields;
- block/report where strangers are involved;
- kill switch;
- real-account/bot E2E gate.

Do not enable a risky flag merely because code merged.

## Security reporting

Never put tokens, secrets, API keys, initData, OAuth verifier/state, decrypted credentials or private messages/media in a public issue or PR.

Disable the narrowest affected feature and use a private owner/operator channel for sensitive evidence.

## Documentation

Update documentation in the same PR for player behavior, game design, endpoint/response models, persistence/idempotency, public/export/privacy fields, consent, flags, tests, release gates, backup/restore or operations.

Mark planned behavior clearly; never present it as shipped.
