# Bloopy staged alpha testing

This is the release gate for inviting additional testers while keeping unverified Telegram and social surfaces isolated.

## Status language

- **Current gate** means the checks apply to code available in the repository now.
- **Planned gate** means the product flow must be implemented before the checks can run.
- Passing automated CI never enables a risky production flag by itself.

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
- stranger matchmaking until the planned Phase 4;
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

A complete player-facing managed-bot hub is tracked separately. Backend verification does not by itself make every management action suitable for broad players.

## Phase 3A — two-owner protocol verification

Prerequisites:

- two real managed bots;
- two distinct Telegram owner accounts;
- Phase 2 passed for both bots.

Temporary configuration:

- `MANAGED_BOT_FLEET_ENABLED=true`;
- `BOT_TO_BOT_ENABLED=true`.

Required protocol checks:

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

Passing Phase 3A verifies the low-level production protocol and permits closing the reliability-only portion of #17.

## Phase 3B — direct player-facing meeting flow (planned)

Tracked by issues #58–#63.

Prerequisites:

- Phase 3A passes;
- managed-bot hub and consent UI exist;
- direct invitation and acceptance exist;
- player-scoped start/status/history APIs exist;
- meeting notifications/recovery UI exist.

Required checks with two owners:

1. both owners enable consent through the Mini App;
2. owner A creates a short-lived invitation;
3. owner B sees the public creature identity and accepts with a bot they own;
4. only an owning participant can start;
5. repeated start taps create one interaction;
6. both Mini Apps show consistent progress;
7. protocol text/signatures are never rendered;
8. both owners receive at most one completion notification;
9. both can review a player-safe transcript/history;
10. consent revocation, expiry, limits and disabled flags have clear UI states;
11. uncertain delivery does not expose an automatic player replay;
12. no private owner identity or secret reaches the other player.

Direct meetings may expand only after stable metrics and no unexplained queue failures.

## Phase 4 — stranger matchmaking (planned)

Tracked by issue #64. This phase is separate from direct invitations and uses a dedicated feature flag such as:

```text
BOT_MATCHMAKING_ENABLED=false
```

Prerequisites:

- Phase 3B direct meetings are stable;
- one-active-queue-entry invariant is implemented;
- atomic matching and idempotency tests pass;
- block/report/no-repeat controls exist;
- owner identity remains pseudonymous;
- cohort allowlist and suspension controls exist;
- operators can inspect privacy-safe queue/match metrics.

### Phase 4A — deterministic and controlled verification

Use at least four real accounts and bots.

Verify:

1. only an owner can queue their bot;
2. queue join is explicit and cancellable;
3. two workers cannot create duplicate matches;
4. cancelled/expired entries are not matched;
5. language/world/progression compatibility works;
6. repeat-pair cooldown works;
7. a block in either direction prevents rematching;
8. consent/flag/budget changes before match are rechecked;
9. completion notification is bounded and deduplicated;
10. no human Telegram identity or private memory is exposed;
11. mutual “remember this creature” requires both owners;
12. report creates an opaque support reference;
13. disabling the matchmaking flag stops new matches immediately.

### Phase 4B — allowlisted stranger cohort

- begin with a small reviewed cohort;
- treat participants as strangers in the matcher even if operators know them;
- review reports manually;
- monitor queue time, match completion, block/report rate and delivery states;
- stop expansion on identity leakage, harassment, duplicate matches or unexplained uncertain delivery.

### Phase 4C — broader rollout

Broader enablement requires:

- stable safety and delivery metrics;
- documented moderation/report operations;
- deletion/retention policy for queue, match, transcript and report data;
- player-facing privacy explanation;
- incident/kill-switch drill.

## Media testing dependency

Media reactions (#43) may proceed after the relevant ingress, delivery, ownership and privacy guarantees are verified. Media needs its own type/size/retention/moderation rollout; completing bot-to-bot verification does not automatically approve media ingestion.

## Invite message guidance

Tell Phase 1 testers:

- this is a private alpha;
- do not send sensitive information;
- media reactions and personal bots may not be enabled yet;
- report the exact step, approximate time and a screenshot when something fails;
- do not share the bot publicly without permission.

For managed-bot/social testers also explain:

- which features are temporarily enabled;
- that bot meetings are bounded and may be disabled quickly;
- not to paste protocol text, tokens or private messages into GitHub;
- how to block/report or contact support.

## Bug report template

```markdown
### What I was doing

### What I expected

### What happened

### Approximate time and timezone

### Telegram / device type

### Screenshot or screen recording

### Did retrying cause a duplicate reward, story or message?

### Opaque meeting/support reference, if shown
```

Do not ask testers to paste Telegram tokens, OpenRouter keys, initData, webhook secrets, signed envelopes or full private messages into GitHub.
