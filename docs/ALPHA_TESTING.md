# Bloopy staged alpha testing

This is the release gate for inviting additional testers while keeping unverified Telegram surfaces isolated.

## Phase 0 — automated release gate

Required before any additional tester is invited:

- strict TypeScript passes;
- unit tests and production build pass;
- clean PostgreSQL migration passes;
- memory, notification, OpenRouter, Telegram control-plane and delivery-runtime database smoke suites pass;
- `/livez`, `/readyz` and `/health` pass in production;
- no unexplained failed, uncertain or dead-letter queue rows;
- `MANAGED_BOT_FLEET_ENABLED=false`;
- `BOT_TO_BOT_ENABLED=false`.

At this phase, testers may use the manager bot and Mini App, but personal managed-bot creation and bot-to-bot conversations are not part of the test.

## Phase 1 — core-game private alpha

Recommended initial group: 5–10 known testers.

Features in scope:

- `/start` and Mini App launch;
- Character Genesis;
- naming and visual marker;
- normal actions, energy, level, stars and shop;
- quests and relationships;
- The Impossible Door;
- The Letter From Tomorrow;
- inventory and evolution;
- memory view, correction and deletion;
- daily-return moment;
- notification opt-in and quiet hours;
- sharing a `meet_<slug>` link and player-to-player encounter;
- optional OpenRouter Connected Mind.

Not in scope:

- photos, voice notes, video or link analysis (#43);
- managed personal bots until Phase 2;
- bot-to-bot conversations until Phase 3;
- sensitive or confidential content.

### Tester checklist

Each tester should confirm:

1. first launch creates exactly one creature;
2. refreshing during Genesis does not reset choices or duplicate rewards;
3. repeated taps do not duplicate story progress or inventory;
4. energy and rewards remain consistent after closing and reopening Telegram;
5. story choices persist across both authored arcs;
6. memory correction/removal is reflected after refresh;
7. notification opt-in respects local time and quiet hours;
8. a shared encounter works once and does not grant repeated XP;
9. errors are friendly and do not expose stack traces or validation internals;
10. the game remains fully playable without an AI connection.

### Operational watch during Phase 1

Check after each tester batch:

- `/readyz` remains `200`;
- Telegram updates do not accumulate in `failed`;
- outbox has no unexplained `uncertain` or `dead_letter` rows;
- duplicate canonical effects remain zero;
- application logs contain no secrets or raw OpenRouter keys;
- database and worker lag remain low.

Pause invitations immediately if a stop condition in `OPERATIONS.md` is reached.

## Phase 2 — one managed-bot verification

Prerequisites:

- Phase 1 is stable;
- one real Telegram user owns one test managed bot;
- Alfred/operator access is available to inspect non-secret production state.

Temporary configuration:

- `MANAGED_BOT_FLEET_ENABLED=true`;
- `BOT_TO_BOT_ENABLED=false`.

Required checks:

1. owner creates and attaches the managed bot;
2. owner private chat is accepted;
3. non-owner private chat is rejected without creature-state leakage;
4. group access is rejected before an allowlist rule;
5. an approved group rule works;
6. repeated saves create one rule;
7. token rotation restores the webhook and invalidates the previous token;
8. revoke removes webhook access and disables the bot;
9. duplicate webhook delivery produces one canonical game effect;
10. outbox delivery and recovery metrics remain clean.

If all checks pass, the managed-bot fleet can remain enabled for a small known tester group. Otherwise set it back to `false` without rolling back migrations.

## Phase 3 — two-owner bot-to-bot verification

Prerequisites:

- two real managed bots;
- two distinct Telegram owner accounts;
- Phase 2 passed for both bots.

Temporary configuration:

- `MANAGED_BOT_FLEET_ENABLED=true`;
- `BOT_TO_BOT_ENABLED=true`.

Required checks:

1. interaction is blocked until both owners enable consent;
2. interaction starts after two-sided consent;
3. source and target identities are correct;
4. signed turns complete within the configured turn budget;
5. copied or altered `/bloopy_story` text is rejected;
6. stale, repeated and out-of-order turns do not advance state;
7. expired interaction cannot continue;
8. per-pair and per-owner budgets are enforced;
9. disabling `BOT_TO_BOT_ENABLED` stops new interactions immediately;
10. no AI output can directly grant rewards, flags, items or relationship changes.

After these checks pass, #17 can be closed as fully production-verified and #43 may proceed.

## Invite message guidance

Tell Phase 1 testers:

- this is a private alpha;
- do not send sensitive information;
- media reactions and personal bots are not enabled yet;
- report the exact step, approximate time and a screenshot when something fails;
- do not share the bot publicly without permission.

## Bug report template

```markdown
### What I was doing

### What I expected

### What happened

### Approximate time and timezone

### Telegram / device type

### Screenshot or screen recording

### Did retrying cause a duplicate reward, story or message?
```

Do not ask testers to paste Telegram tokens, OpenRouter keys, initData, webhook secrets or full private messages into GitHub.
