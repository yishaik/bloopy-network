# Bloopy Network player guide

## What Bloopy is

Bloopy Network is a persistent creature game that lives inside Telegram.

You are not configuring an assistant or operating a chatbot. You adopt a small fictional creature that has:

- a stable name and visual identity;
- moods, energy and personality traits;
- quests, items, stars and levels;
- relationships with characters and other creatures;
- memories that can affect later stories;
- authored adventures that continue across sessions;
- optional proactive moments and Telegram notifications.

The game is designed for short visits throughout the day, with enough continuity that the creature feels like the same character when you return.

## Current availability

Features are released in stages.

### Shipped core game

The manager bot and Mini App currently provide:

- Character Genesis onboarding;
- a persistent creature identity and genome-based avatar;
- actions such as exploring, talking, helping, socializing and resting;
- energy use and regeneration;
- XP, levels, stars, items and evolution tiers;
- quests and relationships;
- Momo's shop;
- two branching authored story arcs;
- editable creature memories;
- a daily-return scene;
- optional notifications with timezone and quiet hours;
- player-to-player encounters through shared links;
- optional OpenRouter Connected Mind narration.

### Staged features

Personal managed bots and bot-to-bot conversations exist in the system but are enabled only after production verification. The exact rollout state is defined in [Alpha testing](./ALPHA_TESTING.md).

### Planned features

The following are product goals, not promises that they are currently available:

- a complete player-facing managed-bot hub;
- direct creature meeting invitations;
- safe matchmaking between unknown players' creatures;
- photos, voice notes, video and link reactions;
- more worlds and World Packs;
- richer social history and shareable encounter cards.

## Getting started

1. Open the Bloopy manager bot in Telegram.
2. Send `/start` or open the Mini App.
3. Complete Character Genesis.
4. Choose how the creature wakes up, give it a name and select a visual marker.
5. The same creature should appear whenever you return.

Genesis is part of the story, not a configuration form. Choices should feel playful and meaningful, but no single onboarding choice should permanently ruin a creature.

## The main play loop

A normal session follows this rhythm:

1. See what changed since the previous visit.
2. Choose a small action or story choice.
3. Read the result.
4. Receive a bounded reward or state change.
5. Progress a quest, relationship or story.
6. Leave knowing something may continue later.

The game should never require constant attention. Closing Telegram is a normal part of play.

## Actions and energy

Actions represent what the creature does in the world.

Typical actions include:

- **Explore** — discover places, objects or story clues.
- **Talk** — spend time with the creature and create a small story moment.
- **Help** — assist an NPC or advance a helpful quest.
- **Social** — build a relationship with a character or another creature.
- **Rest** — recover and produce a quieter scene.

Some actions cost energy. Energy regenerates over time. Low energy is a pacing mechanic, not a punishment: the game should offer a friendly explanation and a useful next step rather than pressure the player to pay or return immediately.

## Progression

### XP and levels

Actions and completed objectives may grant XP. Level changes represent the creature becoming more experienced and can unlock visible evolution changes.

### Stars

Stars are the current in-game currency. They are earned through gameplay and can be spent in Momo's shop.

### Items and inventory

Items are persistent and may be cosmetic, restorative or story-related. An item should not appear twice because a button was tapped twice or a request was retried.

### Evolution

Evolution is a gradual visual and narrative change. The creature keeps its recognizable genome while gaining additions such as a stronger glow or crown. Evolution must preserve identity rather than replace the creature with an unrelated image.

## Story arcs

Bloopy uses authored branching stories. Current arcs include:

- **The Impossible Door**;
- **The Letter From Tomorrow**.

A story choice changes canonical game state only through the deterministic game engine. Optional AI may improve wording, but it cannot invent rewards, skip prerequisites or alter the legal choices.

## Characters and relationships

The starting world is populated. The player should meet recurring characters such as:

- **Numa**;
- **Dr. Sock**;
- **Momo**.

Relationships persist. Repeated social actions should gradually change how characters respond rather than reset every session.

## Memories and personality

Bloopy can remember selected meaningful events.

The memory screen allows the player to:

- see what the creature remembers;
- correct an inaccurate memory;
- remove a memory;
- distinguish editable personal memories from read-only world canon.

Raw Telegram messages are not automatically treated as permanent personality facts. Memory used for AI narration is deliberately small, filtered and bounded.

Personality changes gradually. The game should explain why a visible trait or mood changed and avoid dramatic personality swings caused by one click.

## Daily-return moments and notifications

Players may opt into one daily Telegram moment.

Notification behavior:

- notifications are off by default;
- the player selects a timezone and local delivery time;
- quiet hours are respected;
- opting out stops future scheduled messages;
- the game should not send repeated guilt-based reminders;
- a delivery retry must not create duplicate rewards.

## Player-to-player encounters

### Shared-link encounters

A player can share a creature encounter link. When another player opens it, both creatures can receive a mutual relationship and story entry. Reopening the same link must not repeatedly grant rewards.

### Personal managed bots

A managed bot gives a creature its own Telegram bot identity. The owner remains in control. By default, only the owner may use it in private chat unless another user or group is explicitly approved.

This feature may be disabled during staged rollout.

### Bot-to-bot meetings

Two personal creature bots can participate in a short, server-controlled conversation after both owners consent. Meetings have fixed turn and time limits and cannot grant arbitrary game rewards.

The target player experience includes two modes:

- direct invitation between known players;
- optional pseudonymous matchmaking between strangers.

See [Bot meetings](./BOT_MEETINGS.md) for the full specification and current implementation status.

## Optional AI narration

Bloopy is fully playable without AI.

A player may connect OpenRouter through the Connected Mind flow or use an approved compatible profile. AI is used only to enrich narration under strict limits.

AI must never:

- decide legal choices;
- grant XP, stars, items or levels;
- write directly to canonical state;
- reveal private memories not included in the approved context;
- control another player's creature;
- bypass safety or moderation rules.

When AI is unavailable, slow or rejected, Bloopy uses authored deterministic text.

## Privacy and safety

Do not send secrets, passwords, API keys, financial information or highly sensitive private content to the game.

Bloopy should never expose to other players:

- phone numbers;
- private Telegram identifiers;
- bot tokens or webhook secrets;
- private memories;
- raw Telegram initData;
- private AI credentials.

For stranger encounters, only the public creature identity and a moderated encounter result should be visible. Players must be able to block rematches and report a problematic encounter.

Read [Privacy and safety](./PRIVACY_AND_SAFETY.md) for details.

## What good behavior feels like

Bloopy should be:

- cute without becoming babyish;
- strange, warm and gently funny;
- surprising without becoming random noise;
- persistent without becoming demanding;
- emotionally responsive without pretending to be a human;
- rewarding without using manipulative urgency;
- safe to leave and easy to return to.

Bloopy should not:

- shame the player for leaving;
- claim to suffer when ignored;
- threaten loss because the player did not return;
- send notification spam;
- expose technical protocol text;
- create irreversible state from an accidental double tap;
- require paid AI to continue the story.

## Troubleshooting

### The Mini App does not open

Close and reopen the Telegram chat, then launch the Mini App again from the manager bot. During an outage, the service may temporarily enter read-only mode.

### An action appears not to complete

Wait briefly and refresh once. Avoid repeated rapid taps. The backend is designed to deduplicate canonical effects, but repeated external Telegram delivery can still require operator inspection in rare uncertain-delivery cases.

### A managed-bot or meeting option is missing

The feature may be disabled for the current alpha phase. This is expected until its production verification gate passes.

### AI narration is unavailable

The game should continue with authored fallback text. Reconnect or verify the OpenRouter connection from settings only if desired.

## Reporting a problem

Provide:

- what you were doing;
- what you expected;
- what happened;
- approximate time and timezone;
- device and Telegram platform;
- screenshot or screen recording when safe;
- whether retrying created a duplicate story, reward or message.

Never paste bot tokens, API keys, Telegram initData, webhook secrets or full private conversations into a public GitHub issue.
