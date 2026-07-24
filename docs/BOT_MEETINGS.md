# Bot meetings and creature matchmaking

## Purpose

This document explains the current secure bot-to-bot foundation and the intended player experience for meetings between creatures.

There are two product modes:

1. **Direct invitation** — two players already know how to reach each other and share an invitation.
2. **Stranger matchmaking** — two players independently opt into a server-selected pseudonymous encounter.

Both modes use the same bounded interaction engine. They differ in discovery, consent, privacy expectations and abuse controls.

## Status

### Shipped/staged backend

The backend currently includes:

- managed-bot ownership;
- owner-only private access by default;
- explicit chat allowlists;
- owner-controlled bot-interaction consent;
- signed bot-interaction envelopes;
- replay and forgery rejection;
- persisted interaction state;
- TTL and turn budget;
- per-pair and per-owner limits;
- durable ingress and outbox delivery;
- feature kill switches and operational metrics.

The current interaction start path is an admin endpoint. That is sufficient for verification, not a finished player experience.

### Planned player experience

Tracked by:

- issue #58 — player-facing bot meeting epic;
- issue #59 — managed-bot hub and consent UI;
- issue #60 — direct invitations and mutual acceptance;
- issue #61 — player-scoped meeting lifecycle API;
- issue #62 — active meeting, transcript and history UI;
- issue #63 — notifications, recovery and two-account E2E;
- issue #64 — stranger matchmaking.

## Product fantasy

The meeting should feel like two creatures encountered each other while living their own small lives.

Players should not see:

- protocol commands;
- HMAC signatures;
- internal bot IDs;
- queue rows;
- raw Telegram updates;
- another owner's private account identity.

Players should see:

- the two creatures;
- why/how the meeting began;
- short readable dialogue or a story summary;
- progress and completion state;
- safe next actions.

## Shared invariants

Every meeting must satisfy:

- each participating bot is active and owned by a real authenticated player;
- both owners consent to bot meetings;
- feature flags permit the interaction;
- the meeting is bounded by TTL and maximum turns;
- the exact sender, receiver and turn are authenticated;
- repeated or altered messages do not advance state;
- a meeting creates no arbitrary canonical reward;
- player-visible content is moderated;
- failure and delivery states are inspectable;
- ownership and private Telegram identity remain protected.

## Direct invitation flow

## 1. Enable meetings

Each owner opens the managed-bot hub and enables:

> Allow meetings with other creatures

Consent is off by default. Enabling consent does not start a meeting and does not expose the bot in a public directory.

## 2. Create an invitation

Player A:

1. opens **Meet another creature**;
2. selects an eligible bot they own;
3. chooses **Invite someone I know**;
4. creates a short-lived invitation;
5. shares the Telegram deep link or QR code.

The invitation contains an opaque token/ID. It must not expose authoritative internal bot or owner identifiers.

## 3. Open and accept

Player B opens the invitation and sees:

- inviting creature name and avatar;
- selected public bot identity where appropriate;
- meeting turn limit and approximate duration;
- a privacy explanation;
- a selector for an eligible bot owned by Player B;
- accept and decline actions.

Acceptance is explicit and replay-safe. It does not silently enable global consent if consent is currently off.

## 4. Start

An owning participant starts the accepted meeting.

At start time the server atomically rechecks:

- invitation state and expiry;
- both bot owners;
- both bots active/not revoked;
- consent on both bots;
- feature flags;
- pair and owner budgets;
- no existing interaction for the invitation.

Repeated start requests return the same meeting.

## 5. Follow progress

Both owners can open the meeting screen.

Player-safe states:

- `ready`;
- `queued`;
- `active`;
- `completed`;
- `expired`;
- `cancelled`;
- `failed`.

The UI may show “2 of 4 turns” and which creature is speaking. It must not show signed envelope text.

## 6. Completion

Both owners can review:

- ordered creature dialogue or a safe summary;
- completion reason in natural language;
- creature avatars and names;
- actions to invite again, share a safe card or return to the world.

## Stranger matchmaking flow

## 1. Join intentionally

The player chooses:

> Find someone new

or

> Send my creature wandering

The player selects one eligible managed bot and joins a short-lived queue for one encounter.

Joining is consent for one matching attempt. It must not silently turn on permanent stranger availability.

## 2. Explain privacy

Before joining, explain:

- the other owner is initially anonymous;
- only public creature identity is shared;
- the encounter is time/turn limited;
- private memories and human Telegram identity are not shared;
- the player may leave the queue;
- the player may block future rematches or report afterward.

## 3. Match server-side

The server pairs compatible queue entries atomically.

Initial compatibility signals may include:

- supported language;
- active World Pack;
- progression band;
- availability;
- recent-pair cooldown;
- optional encounter mood.

Do not use:

- location;
- phone/contact data;
- shared groups;
- sensitive inferred traits;
- a browsable public directory.

## 4. Recheck eligibility

At match time:

- entries are unexpired and not cancelled;
- both players still own the bots;
- bots are active;
- bot meeting and stranger-matching consent remain valid;
- feature flags are enabled;
- budgets/cooldowns permit the pair;
- no block exists in either direction;
- neither account is suspended from matchmaking.

Two queue entries create exactly one match and one interaction.

## 5. Run the bounded encounter

The existing signed interaction protocol runs the meeting. Owners do not need to remain online.

A bounded notification may announce completion. Do not send one notification per turn.

## 6. Post-encounter choices

Each owner independently chooses:

- **Remember this creature** — opt into a future creature relationship/direct invitations;
- **Not again** — block this pair from automatic matching;
- **Report** — submit a bounded safety category and support reference.

A relationship forms only after mutual independent opt-in. It does not reveal human identity automatically.

## Interaction protocol

Each bot-to-bot message includes an internal envelope conceptually containing:

- interaction ID;
- turn index;
- signature bound to sender and receiver.

The receiver verifies:

- interaction exists and is active;
- TTL has not expired;
- sender and receiver are expected for the current turn;
- turn index is exact;
- signature is valid;
- deduplication key has not already been processed.

If valid, the turn is recorded once. If the turn budget remains, a response is enqueued through the durable outbox. Otherwise, the interaction completes.

Protocol details are not player-facing content.

## Content generation

The first safe version may use authored deterministic dialogue.

Optional AI may later enrich a turn using:

- public creature identities;
- declared personality voice;
- canonical encounter facts;
- a small public-safe relationship context.

It must not receive:

- private owner data;
- private creature memories;
- raw unrelated Telegram messages;
- arbitrary database context.

AI output cannot grant rewards or change interaction participants.

## Data model guidance

### Direct invitations

A persistent invitation should bind:

- opaque ID/token hash;
- source bot and owner;
- optional bound target owner/bot after open/accept;
- expiry;
- state;
- idempotency key;
- resulting interaction ID;
- created/opened/accepted/declined/cancelled/consumed timestamps.

### Player-safe meetings

Expose only:

- opaque meeting ID;
- public creature views;
- state;
- current/max turns;
- timestamps;
- curated reason/error code;
- safe transcript/summary;
- permitted actions for the current owner.

### Matchmaking

Suggested records:

- owner-controlled matchmaking preferences;
- one active queue entry per bot;
- atomic match record linking two queue entries;
- resulting interaction ID;
- pair blocks;
- reports;
- cooldown/trust metadata based only on in-product behavior.

## Failure behavior

### Consent missing

Explain that both owners must enable meetings. Do not reveal the other owner's private settings beyond the minimum needed to proceed.

### Feature disabled

Show that meetings are temporarily unavailable while the creature and core game remain usable.

### Invitation expired

Offer creation of a new invitation. Do not revive the old token.

### Limit reached

Explain when the creature can try again in broad terms. Do not expose abuse-control internals.

### Bot unavailable/revoked

Require owner action in the managed-bot hub.

### Retryable delivery

Show a neutral sending state while the server retries within bounds.

### Uncertain delivery

Show “The message may have crossed; support may need to check.” Do not offer an automatic replay button to normal players.

### Queue expires with no match

Return the creature safely and allow a later attempt. Do not promise an exact waiting time.

## Notifications

Useful notifications:

- direct invitation received;
- invitation accepted/declined;
- meeting completed;
- match found/completed;
- owner action required;
- invitation/search expired.

Rules:

- respect preferences and quiet hours where applicable;
- use durable unique source keys;
- deep-link to the authenticated relevant screen;
- no protocol content;
- no turn-by-turn spam;
- no private stranger identity in lock-screen text.

## Abuse controls

Before stranger rollout:

- pair blocks;
- report categories;
- rate limits;
- join/cancel cooldowns;
- no-repeat pair window;
- owner/day and pair/hour budgets;
- cohort allowlist;
- matchmaking suspension;
- global kill switch;
- moderation of shareable content;
- operator metrics and review path.

## Feature flags

Current relevant flags:

```text
MANAGED_BOT_FLEET_ENABLED=false
BOT_TO_BOT_ENABLED=false
```

Planned:

```text
BOT_MATCHMAKING_ENABLED=false
```

The matchmaking flag is separate so direct known-player meetings can ship before strangers are enabled.

## Rollout

### Direct meetings

1. automated DB/CI verification;
2. one managed-bot ownership gate;
3. two owners/two bots via admin verification;
4. player-facing direct invitation E2E;
5. small known-user cohort;
6. broader direct invitations.

### Stranger matchmaking

1. deterministic queue/match simulation;
2. owner-controlled multi-account test;
3. allowlisted known-user pool where players are treated as strangers by the matcher;
4. at least four real accounts testing concurrent pairing, cancellation and no-repeat;
5. small stranger cohort with manual report review;
6. broader rollout only after stable safety/delivery metrics.

## Definition of done

Direct meetings are complete when a normal player can enable consent, invite, accept, start, follow and review a meeting without admin help.

Stranger matchmaking is complete when a normal player can opt into one safe encounter, be paired atomically with an unknown compatible creature, complete the encounter without private identity leakage and use block/report/mutual-remember controls.
