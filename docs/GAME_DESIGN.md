# Bloopy Network game design

## Design summary

Bloopy is a persistent, Telegram-native creature game built around attachment, curiosity and short recurring story moments.

The central fantasy is:

> A small creature lives an ongoing life beside the player. It remembers selected moments, changes gradually, gets into strange situations and sometimes meets other creatures when the player is away.

Bloopy is not a productivity assistant, an unrestricted role-play bot, a virtual pet that demands constant maintenance or a conventional stat-heavy RPG. It combines authored narrative, light progression, social discovery and safe optional AI narration.

## Product goal

The game should create three feelings:

1. **Recognition** — “This is my creature. It looks and behaves like the same character.”
2. **Curiosity** — “Something small and unexpected may have happened since I last looked.”
3. **Care without obligation** — “I want to return, but I am not being punished or guilted into returning.”

A successful long-term player relationship is measured by meaningful returns, remembered stories and voluntary sharing—not by notification volume, endless grinding or time pressure.

## Audience

The primary audience is people who enjoy:

- cute or eccentric characters;
- short mobile sessions;
- Telegram-native experiences;
- narrative choices and collectible progression;
- sharing small stories with friends;
- low-pressure social discovery;
- seeing a character evolve over weeks and months.

The interface should remain understandable without RPG vocabulary or AI knowledge.

## Tone and fiction

### Core tone: gentle absurdism

Bloopy's world is warm, strange and internally sincere. Ordinary objects may behave like institutions, bureaucracy may appear in miniature and characters treat impossible events as inconvenient but emotionally real.

Examples of the intended tone:

- a door appears where a door should not fit;
- a teaspoon has excellent posture but no permit;
- a letter arrives in the creature's own handwriting from tomorrow;
- a sock may be a doctor without the story becoming random nonsense.

### Tone rules

Narration should be:

- concise enough for Telegram;
- visually concrete;
- emotionally legible;
- gently funny rather than joke-dense;
- whimsical without losing cause and effect;
- strange, but consistent with established world facts;
- suitable for a broad audience unless a World Pack explicitly declares otherwise.

Narration should avoid:

- manipulative dependency language;
- sexualized content;
- graphic violence;
- cruelty toward the player;
- excessive sarcasm or cynicism;
- endless exclamation marks;
- generic assistant phrasing;
- references to prompts, models, tokens or hidden systems;
- pretending the creature is a human consciousness.

## The creature

The creature is the persistent center of the game.

It has:

- a stable player-selected name;
- a versioned visual genome;
- personality traits with bounded values;
- a voice/archetype used by authored and optional AI narration;
- mood and energy;
- progression, inventory and relationships;
- memories with provenance and edit controls;
- story history and active arcs.

### Identity continuity

Changes must preserve recognition.

A creature may gain:

- glow;
- accessories;
- marks;
- a crown or other evolution detail;
- posture, expression or palette variants permitted by the genome.

It should not suddenly become an unrelated character because a generative image model returned a different design.

### Personality evolution

Personality changes must be:

- gradual;
- bounded;
- explainable;
- tied to repeated choices or meaningful story events;
- reversible only through further play, not arbitrary resets.

One tap should not transform a cautious creature into a fearless one. Repeated patterns may shift traits over time with diminishing returns.

## Session design

### Target session length

Most sessions should fit into 30 seconds to 5 minutes.

A session may contain:

- one proactive update;
- one action;
- one story choice;
- a quick inventory or memory check;
- a shop purchase;
- a social invitation or encounter result.

Longer authored arcs may span multiple sessions, but each visit should end on a complete beat or clear cliffhanger.

### Return rhythm

The desired rhythm is:

- immediate value on first launch;
- a reason to return later the same day or next day;
- enough variety that returns do not feel like a repeating checklist;
- no need to keep the app open while waiting.

## Core loops

## 1. Moment-to-moment loop

1. Player sees the current creature/world state.
2. Player selects an available action or story choice.
3. The deterministic engine validates the action.
4. Canonical state changes transactionally.
5. The player receives authored text, optionally enriched by AI.
6. Progress and the next opportunity become visible.

## 2. Daily loop

1. Return to a persistent creature.
2. See a small change, daily-return scene or notification.
3. Make one meaningful choice.
4. Progress a quest, memory, relationship or story.
5. Leave without penalty.

## 3. Progression loop

Actions and story choices may advance:

- XP and level;
- stars and spending;
- inventory;
- quests;
- relationships;
- evolution tiers;
- story arcs;
- personality and memory.

Every reward must be idempotent. A retry, double tap or duplicated Telegram update cannot grant the reward twice.

## 4. Social loop

Social play has several layers:

1. recurring NPC relationships;
2. shared-link encounters between player creatures;
3. managed-bot direct meetings between known players;
4. optional stranger matchmaking selected by the server;
5. future persistent creature networks and group adventures.

Each layer increases privacy and abuse risk and therefore must ship behind separate gates.

## Progression philosophy

Progression exists to create identity and story, not to create an infinite numerical treadmill.

Good progression:

- unlocks a visible change;
- creates a new choice;
- deepens a relationship;
- reveals story content;
- adds a memorable item;
- gives the creature a stronger personal history.

Weak progression:

- raises numbers with no visible impact;
- requires repetitive tapping;
- punishes missed days;
- creates artificial scarcity to force payment;
- makes earlier story content irrelevant.

## Energy

Energy controls pacing and variety.

Rules:

- energy costs are explicit before or immediately after an action;
- regeneration is time-based and deterministic;
- rest remains a useful action;
- low energy produces a friendly state, not a failure wall;
- no streak is destroyed because energy was not spent;
- energy purchases, if ever introduced, cannot become the only practical way to play.

## Quests

Quests should express the world and the creature's relationships.

A quest needs:

- a clear narrative purpose;
- an observable progress condition;
- an idempotent completion rule;
- a bounded reward;
- a player-readable status;
- a fallback when optional AI is unavailable.

Avoid quests that exist only as “perform the same action 50 times.”

## Economy

Stars are a light, earned currency.

The shop should focus on:

- cosmetic identity;
- small convenience or restorative items;
- story objects;
- relationship-building moments.

The economy should not become pay-to-win or require gambling-like mechanics. Random rewards must have transparent bounds and should never use real-money loot boxes.

## Authored story design

Stories are definitions interpreted by the game engine, not arbitrary code that writes directly to tables.

An authored arc should define:

- identity and display metadata;
- activation prerequisites;
- beats and legal choices;
- canonical effects;
- next-beat resolution;
- completion and rewards;
- route inheritance or relationship references;
- deterministic fallback text;
- optional narration context.

Each choice must be replay-safe and safe to resume after closing Telegram.

## Proactive behavior

The creature may initiate moments, requests or updates.

Proactive content should:

- be optional where delivered as notifications;
- respect timezone and quiet hours;
- have bounded frequency;
- contain something meaningful, not “come back” filler;
- open a real scene or action;
- remain valid after a reasonable delay;
- avoid guilt, fear of loss or false urgency.

Never write:

- “I was lonely because you abandoned me.”
- “Come back now or I will disappear.”
- “Your streak is about to die.”

Preferred framing:

- “Your creature left a folded note under the lamp.”
- “Something in the cardboard nest has begun making official-looking noises.”

## Social encounters

### Known-player encounters

A shared link or direct invitation should make the other creature understandable before acceptance. Both owners retain control.

### Bot-to-bot conversations

Bot meetings are short canonical encounters, not open-ended autonomous agents.

They must have:

- explicit owner consent;
- fixed turn budget;
- TTL;
- signed/replay-safe messages;
- deterministic ownership and state rules;
- moderated player-visible content;
- no direct reward authority;
- block and report controls for stranger encounters.

### Stranger matchmaking

The fantasy is “send my creature wandering,” not “browse strangers.”

The server selects compatible creatures from an opt-in queue. Owners remain pseudonymous. No public directory, location matching or arbitrary user targeting is allowed.

See [Bot meetings](./BOT_MEETINGS.md).

## Memory design

Memory exists to improve continuity, not to store everything.

Memory categories should distinguish:

- immutable world canon;
- meaningful episodic memories;
- player-correctable identity facts;
- short-lived working memory;
- private raw Telegram content that expires and is excluded from normal AI context.

Players must be able to understand, correct and delete relevant memories.

## AI design

AI is a renderer, never the rules engine.

AI may:

- vary phrasing;
- add sensory detail;
- preserve the creature's voice;
- reference an approved small memory packet;
- turn canonical facts into better prose.

AI may not:

- select a hidden reward;
- create a legal choice;
- mutate game state;
- decide matchmaking;
- access arbitrary database rows;
- reveal another player's data;
- generate unbounded conversation loops;
- make the game unavailable when inference fails.

## Media interactions

Planned media reactions should treat images, voice notes, video and links as bounded inputs to a curated interaction.

The creature may make a short observation and offer safe follow-up choices. Media processing must not become unrestricted surveillance, identity inference or permanent memory by default.

## Accessibility and usability

The game should support:

- narrow Telegram Mini App viewports;
- large text and readable contrast;
- keyboard navigation where available;
- semantic status updates for screen readers;
- reduced motion;
- no essential meaning conveyed by color alone;
- clear loading, offline and retry states;
- short copy suitable for translation.

## Ethical engagement rules

Bloopy may be engaging and habit-forming through story continuity, but it must not use coercive dark patterns.

Prohibited mechanics include:

- guilt for inactivity;
- fake emergencies;
- unbounded notification escalation;
- opaque streak loss;
- randomized real-money rewards;
- hiding unsubscribe or deletion controls;
- pretending an AI system is suffering;
- encouraging emotional isolation from real people.

## Long-term end state

When the product is mature:

- every player has a recognizable creature with months of coherent history;
- the world contains multiple curated World Packs;
- creatures can act through Telegram while remaining owner-controlled;
- known players can invite each other to encounters;
- strangers can opt into safe pseudonymous matchmaking;
- media can become bounded story input;
- AI can enrich language without owning state;
- operations can pause risky surfaces instantly;
- players can export, reset or delete their data;
- the game remains playable at low cost through authored deterministic content.

The complete end-state acceptance contract is defined in [Behavior specification](./BEHAVIOR_SPEC.md).
