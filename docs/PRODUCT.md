# Bloopy Network product vision

## One-line description

Bloopy Network is a proactive Telegram-native creature game in which every player adopts a persistent character with a stable visual identity, evolving personality, memories, relationships, authored adventures and safe social encounters.

## Mission

Create a creature that feels alive across days and months without pretending to be human, demanding constant attention or depending on expensive AI inference.

Telegram is part of the game world:

- the manager bot introduces and launches the experience;
- the Mini App shows the persistent world and controls;
- optional notifications deliver meaningful moments;
- public cards let players share a safe creature/story view;
- a personal managed bot can give the creature its own Telegram identity;
- creatures can meet through bounded server-mediated conversations;
- future matchmaking can create safe pseudonymous encounters between strangers.

## Product promise

The player should be able to say:

> “This is my creature. It remembers our story, changes slowly, surprises me and sometimes comes back with stories from other creatures.”

That promise depends on:

1. **Continuity** — state, identity and relationships persist.
2. **Agency** — choices produce understandable canonical consequences.
3. **Surprise** — authored and optional AI-enhanced moments remain varied.
4. **Safety** — social, delivery and AI behavior stay bounded and owner-controlled.
5. **Control** — players can understand, export, reset or delete their data.

## What Bloopy is not

Bloopy is not:

- a generic assistant;
- an unrestricted AI companion;
- a productivity tool wearing a mascot;
- a virtual pet that punishes inactivity;
- a stat spreadsheet with decorative prose;
- an autonomous agent allowed to alter arbitrary state;
- a public directory for contacting unknown Telegram users.

## Core product principles

### The creature is a character, not a settings profile

Onboarding is Character Genesis. The player makes story choices and names a creature instead of configuring prompts and tools.

### The world is populated from the first session

Recurring characters, locations, quests and mysteries exist immediately.

### Canonical gameplay is deterministic

The game engine owns:

- legal choices and prerequisites;
- energy costs;
- XP, stars and items;
- quests and relationships;
- story routes and flags;
- memory/personality mutations;
- referral eligibility and payout;
- social and interaction lifecycle state.

Optional AI may improve narration but cannot become game authority.

### Identity stays recognizable

Visual evolution is based on a versioned genome. Growth adds detail while preserving the creature players recognize.

### Proactive does not mean manipulative

The creature may initiate stories, requests or notifications, but must not use guilt, fake emergencies, streak threats or escalating spam.

### Sharing is public-safe by construction

Public share cards use an opaque token and a fixed allowlist of non-private creature fields. They do not expose owner Telegram IDs, credentials, private memories or internal game state.

### Social play is layered and consent-based

Social features progress from lower-risk to higher-risk:

1. NPC relationships;
2. shared-link creature encounters/referrals;
3. direct managed-bot meetings between known players;
4. pseudonymous stranger matchmaking;
5. future networks, groups and collaborative adventures.

Each layer requires explicit consent, privacy boundaries, abuse controls and staged rollout.

### The base game works without paid AI

Authored deterministic content is always available. Connected Mind and compatible BYOK providers are optional enhancements.

### Low cost is a product constraint

The system remains sustainable through a modular monolith, PostgreSQL, bounded workers, authored content, optional user-funded inference, strict budgets and deterministic fallback.

## Player experience

## First session

1. Open the manager bot or Mini App.
2. Discover something asleep in a cardboard nest.
3. Choose how it wakes.
4. Name it and choose a visual marker.
5. Meet recurring world characters.
6. Perform a first action and receive a persistent result.
7. Leave with a clear reason to return later.

## Returning session

1. See the same creature and current state.
2. Notice a daily moment, story beat or small change.
3. Make one meaningful choice.
4. Progress a quest, relationship, memory or arc.
5. Leave without penalty.

## Long-term relationship

Over weeks and months, the creature should accumulate:

- authored story history;
- visible evolution;
- recurring relationships;
- meaningful items;
- corrected and player-controlled memories;
- personality tendencies shaped gradually by play;
- encounter history with other creatures;
- progress across one or more World Packs.

## Current shipped foundation — release 0.12

- Character Genesis;
- persistent creature identity and genome avatar;
- normal actions and energy regeneration;
- XP, levels, stars, shop and inventory;
- quests and relationships;
- evolution tiers;
- The Impossible Door;
- The Letter From Tomorrow;
- memory view/correction/deletion;
- daily-return moments and opt-in notifications;
- shared-link player encounters;
- opaque public profile/story cards and text fallback;
- one-time referral attribution and payout;
- self-service JSON export;
- typed-confirmation creature reset;
- typed-confirmation account deletion and credential cleanup;
- encrypted OpenRouter OAuth and compatible BYOK narration;
- durable Telegram ingress/outbox reliability;
- managed-bot ownership/control-plane foundation;
- bounded signed bot-interaction engine;
- release preflight, backup and verified restore tooling.

## Staged capabilities

Implemented but gated by production verification:

- creation and operation of personal managed bots;
- approved user/group access;
- token rotation and revoke;
- two-owner bot-to-bot interactions.

A backend implementation is not a finished product flow until normal players can manage consent, invite, accept, follow and review meetings without admin APIs.

## Planned product layers

### Player-facing bot meetings

Issues #58–#63 define:

- managed-bot hub;
- meeting consent UI;
- direct invitations;
- player-scoped meeting API;
- active transcript/history UI;
- notifications and two-account production E2E.

### Stranger matchmaking

Issue #64 defines a separate opt-in queue where the server pairs compatible creatures without exposing owners' private Telegram identities.

### Media reactions

Issue #43 defines bounded reactions to photos, voice notes, video and links after the relevant delivery/privacy gates are verified.

### World Packs

Issue #15 defines a reusable validated content architecture for multiple narrative worlds without arbitrary content code writing canonical state.

## Data-control behavior

Players can currently:

- export an explicitly allowlisted JSON representation of their account/game state;
- reset creature progression while keeping the Telegram player account;
- delete the account and stored AI credentials;
- revoke managed bots as part of reset/deletion;
- rely on new creature generation/share identities after reset so old links do not silently target a replacement.

Exports never include bot tokens, API keys, webhook secrets, raw OAuth verifier/state, Telegram initData or security internals.

## Final product behavior

When mature, Bloopy should provide:

- a complete Telegram-native onboarding and return loop;
- months of coherent persistent identity;
- multiple authored worlds;
- a consistent evolving avatar;
- editable memories and gradual personality growth;
- optional proactive messages with quiet hours;
- safe share cards and referrals;
- personal creature bots under owner control;
- direct invitations between known creatures;
- safe stranger matchmaking with blocks/reports;
- bounded media reactions;
- optional constrained AI narration;
- export, reset and deletion controls;
- instant operational kill switches for risky surfaces;
- deterministic gameplay that remains available when every AI provider is offline.

The normative end-state contract is in [Behavior specification](./BEHAVIOR_SPEC.md).

## Success metrics

Prefer metrics reflecting voluntary attachment and healthy operation:

- onboarding completion;
- D1/D7 meaningful return;
- story-arc completion;
- memory control use;
- quest and relationship progression;
- share-card use and valid referral conversion;
- successful export/reset/deletion;
- opt-in notification open without opt-out spikes;
- successful shared/direct/matched encounters;
- mutual “remember this creature” rate;
- low duplicate-effect and delivery-failure rates;
- deterministic fallback success;
- block/report rates and response time.

Do not optimize primarily for notification sends, raw time spent, compulsive rapid tapping, number of AI calls, streak anxiety or unbounded message volume.

## Documentation map

- [Game design](./GAME_DESIGN.md)
- [Player guide](./PLAYER_GUIDE.md)
- [Behavior specification](./BEHAVIOR_SPEC.md)
- [Bot meetings](./BOT_MEETINGS.md)
- [Architecture](./ARCHITECTURE.md)
- [Privacy and safety](./PRIVACY_AND_SAFETY.md)
