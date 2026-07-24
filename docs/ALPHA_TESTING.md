# Bloopy staged alpha testing

This document defines the release gates for inviting testers while keeping unverified Telegram and social surfaces isolated.

The ordered launch runbook is [`GO_LIVE.md`](./GO_LIVE.md). The Phase-1 roster, tester journey and stop conditions are in [`PHASE1_ALPHA.md`](./PHASE1_ALPHA.md).

Passing automated CI never enables a risky production flag by itself.

## Phase 0 — automated and operational release gate

Required before inviting additional testers:

- strict TypeScript passes;
- unit tests and production build pass;
- clean PostgreSQL migration passes;
- all six DB smoke suites pass:
  - memory;
  - notifications;
  - OpenRouter;
  - Telegram control plane;
  - delivery runtime;
  - account lifecycle;
- backup and verified restore drill passes;
- `npm run release:check -- --base-url https://… --phase 1` passes with no skipped checks;
- `/livez`, `/readyz` and `/health` pass in production;
- migration ledger matches the deployed release;
- no unexplained failed, uncertain or dead-letter queue rows;
- `MANAGED_BOT_FLEET_ENABLED=false`;
- `BOT_TO_BOT_ENABLED=false`.

At this phase testers use only the manager bot and Mini App.

## Phase 1 — core-game private alpha

Recommended initial group: 5–10 known testers.

### In scope

- `/start` and Mini App launch;
- Character Genesis;
- persistent identity/avatar;
- actions, energy, XP, levels, stars and shop;
- quests, relationships, inventory and evolution;
- The Impossible Door;
- The Letter From Tomorrow;
- memory view/correction/deletion;
- daily return and notification settings;
- shared `meet_<ref>` encounter;
- shareable profile/story/text cards;
- one-time referral attribution;
- data export, creature reset and account deletion;
- optional OpenRouter Connected Mind.

### Not in scope

- photos, voice notes, video or link analysis (#43);
- managed personal bots until Phase 2;
- bot-to-bot conversations until Phase 3;
- stranger matchmaking until Phase 4;
- sensitive/confidential content.

### Tester checklist

1. first launch creates exactly one creature;
2. refresh during Genesis resumes without duplicate rewards;
3. repeated taps do not duplicate story/progression/inventory;
4. energy/rewards persist after closing/reopening Telegram;
5. both authored arcs persist and resume;
6. memory correction/removal survives refresh;
7. notifications respect local time and quiet hours;
8. a shared encounter works once without repeated XP;
9. share cards expose only public creature data;
10. referral payout happens once for a genuinely new player;
11. export contains readable data and no credentials/secrets;
12. reset creates a new creature/share identity and old links do not target it;
13. repeated deletion succeeds without recreating the account;
14. errors are friendly and free of stack/validation internals;
15. the game remains fully playable without AI.

### Operational watch

After each tester batch confirm:

- `/readyz` remains `200`;
- release preflight still passes;
- Telegram updates do not accumulate in `failed`;
- outbox has no unexplained `uncertain`/`dead_letter` rows;
- duplicate canonical effects remain zero;
- logs contain no secrets, initData or raw OpenRouter keys;
- database/worker lag remains low;
- account lifecycle actions produce expected anonymized audit state;
- backup/restore procedure remains valid.

Pause invitations on any stop condition in [`OPERATIONS.md`](./OPERATIONS.md) or [`PHASE1_ALPHA.md`](./PHASE1_ALPHA.md).

## Phase 2 — one managed-bot verification

Prerequisites:

- Phase 1 stable;
- one real Telegram user with one test managed bot;
- operator access to non-secret production metrics/verification.

Temporary configuration:

```text
MANAGED_BOT_FLEET_ENABLED=true
BOT_TO_BOT_ENABLED=false
```

Required checks:

1. owner creates/attaches the managed bot;
2. owner private chat accepted;
3. non-owner private chat rejected without state leakage;
4. group rejected before allowlist;
5. approved group works;
6. repeated rule save remains one rule;
7. duplicate webhook produces one canonical effect/reply;
8. token rotation invalidates old token and restores webhook;
9. revoke removes webhook access and disables the bot;
10. reset/delete revokes the bot and leaves no active authorization;
11. queue/metrics remain clean;
12. turning fleet flag off stops new managed-bot processing safely.

If checks fail, return the fleet flag to `false` without rolling back additive migrations.

## Phase 3A — two-owner bot-to-bot protocol verification

Prerequisites:

- two real managed bots;
- two distinct Telegram owner accounts;
- Phase 2 passed for both.

Temporary configuration:

```text
MANAGED_BOT_FLEET_ENABLED=true
BOT_TO_BOT_ENABLED=true
```

Required protocol checks:

1. blocked until both owners consent;
2. starts after two-sided consent;
3. source/target identities correct;
4. signed turns complete within budget;
5. copied/altered `/bloopy_story` rejected;
6. stale/repeated/out-of-order turns do not advance;
7. expired interaction cannot continue;
8. pair/owner budgets enforced;
9. revoke cancels affected active interactions;
10. kill switch blocks new interactions immediately;
11. model output cannot grant canonical rewards/state;
12. no unexplained queue failures or uncertain delivery.

Passing Phase 3A verifies the low-level production protocol and supports completion of #17's reliability gate.

## Phase 3B — direct player-facing meetings (planned)

Tracked by issues #58–#63.

Prerequisites:

- Phase 3A passes;
- managed-bot hub/consent UI exists;
- direct invitation/acceptance exists;
- owner-scoped start/status/history API exists;
- meeting progress/transcript/recovery UI exists;
- bounded notifications exist.

Required E2E checks with two owners:

1. both enable consent in the Mini App;
2. owner A creates a short-lived invitation;
3. owner B sees public creature identity and accepts with an owned bot;
4. no private owner identity is exposed;
5. only a participant can start;
6. repeated starts create one interaction;
7. both Mini Apps show consistent state/turn count;
8. internal signatures/envelopes never render;
9. both receive at most one completion notification;
10. both can review player-safe transcript/history;
11. expiry, decline, cancel, consent revoke, limits and disabled flags have clear states;
12. uncertain delivery does not offer normal-player replay;
13. block/support references contain no sensitive internals;
14. disabling bot-to-bot stops new meetings without corrupting history.

Direct meetings expand only after stable metrics and no unexplained delivery/security events.

## Phase 4 — stranger matchmaking (planned)

Tracked by #64 and controlled by a dedicated flag such as:

```text
BOT_MATCHMAKING_ENABLED=false
```

This phase is separate from direct invitations.

### Prerequisites

- Phase 3B stable;
- one active queue entry per bot;
- atomic matching and interaction idempotency;
- queue expiry/cancellation;
- block, report and no-repeat controls;
- pseudonymous public response model;
- cohort allowlist/suspension controls;
- privacy-safe queue/match metrics;
- documented retention/deletion for queue, match, transcript and report data.

### Phase 4A — controlled four-account verification

Use at least four real Telegram accounts/bots.

Verify:

1. only owner can queue/cancel their bot;
2. joining is explicit and cancellable;
3. two workers cannot create duplicate matches;
4. expired/cancelled entries cannot match;
5. language/world/progression compatibility works;
6. same pair is avoided during cooldown;
7. block in either direction prevents rematch;
8. consent/flag/budget/health changes are rechecked at match time;
9. completion notification is bounded/deduplicated;
10. no owner Telegram identity/private memory/social graph is exposed;
11. mutual “remember this creature” requires both owners;
12. report yields an opaque support reference;
13. disabling matchmaking blocks new matches immediately;
14. no duplicate encounters or unexplained queue failures remain.

### Phase 4B — allowlisted stranger cohort

- use a small reviewed cohort;
- matcher treats participants as strangers even if operators know them;
- review reports manually;
- monitor search duration, completion, block/report rate and delivery states;
- stop expansion on identity leakage, harassment, duplicate matches or unexplained uncertain delivery.

### Phase 4C — broader rollout

Requires stable safety/delivery metrics, documented moderation/report operations, player-facing privacy copy and a tested kill-switch/incident drill.

## Media testing dependency

Media reactions (#43) require their own type, size, moderation, retention and privacy rollout. Completing bot-to-bot verification does not automatically approve media ingestion.

## Tester guidance

Tell Phase-1 testers:

- this is a private alpha;
- do not send sensitive information;
- risky bot/media features may be disabled;
- report exact step/time/device and a safe screenshot;
- do not share the bot publicly without permission.

For social testers also explain temporary flags, bounded meetings, block/report behavior and how to contact the monitored support channel.

## Bug report template

```markdown
### What I was doing

### What I expected

### What happened

### Approximate time and timezone

### Telegram / device type

### Screenshot or screen recording

### Did retrying cause a duplicate reward, story or message?

### Opaque support / meeting reference, if shown
```

Never ask testers to paste tokens, API keys, initData, webhook secrets, signed envelopes or full private messages into GitHub.
