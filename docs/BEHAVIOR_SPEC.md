# Bloopy Network behavior specification

## Purpose

This document defines the product-level behavior Bloopy Network must exhibit when complete. It is an acceptance contract shared by product, design, engineering, QA and operations.

It distinguishes:

- behavior that is already shipped;
- behavior that is staged behind production gates;
- behavior that is planned and still requires implementation.

A feature is not complete because a screen exists. It is complete only when the player-visible behavior, persistence, authorization, failure handling, privacy boundaries, tests and operational controls all satisfy this contract.

## Global invariants

These rules apply everywhere.

1. **One player owns one canonical player identity per Telegram account.**
2. **A creature remains recognizable across sessions, devices and delivery surfaces.**
3. **Canonical state changes only through validated deterministic application logic.**
4. **Retries, duplicate updates and double taps do not duplicate canonical effects.**
5. **Optional AI cannot create choices, grant rewards or write canonical state.**
6. **No secret or private identifier appears in player responses, public logs or shareable content.**
7. **Risky social and Telegram surfaces are disabled by default until verified.**
8. **A player can leave without penalty and return without losing valid progress.**
9. **Every destructive or privacy-sensitive action is explicit and owner-authorized.**
10. **Every external delivery has an inspectable operational state.**

## Status vocabulary

- **Shipped** — implemented on `main` and covered by automated checks.
- **Staged** — implemented but disabled or restricted until production verification.
- **Planned** — specified but not yet implemented.

## 1. First launch and Character Genesis

**Status: shipped**

### Expected behavior

- Opening the manager bot or Mini App creates or resumes exactly one player and one player creature.
- Concurrent or repeated bootstrap requests converge on the same records.
- The player begins in a populated world rather than an empty dashboard.
- Genesis presents story choices for waking, naming and marking the creature.
- The selected name and visual marker persist.
- Refreshing during onboarding resumes the current step.
- Completing onboarding more than once does not duplicate rewards, memories or story entries.
- Invalid names receive a friendly error without internal validation details.

### Failure behavior

- If the database is unavailable, return a curated service error and do not create partial identity records.
- If a request is duplicated, return the existing result.
- If the app is in read-only degraded mode, allow safe reads but reject risky onboarding writes with an understandable message.

## 2. Creature identity and avatar

**Status: shipped foundation; planned expansion**

### Expected behavior

- The avatar is rendered from a versioned genome.
- The same genome produces a visually consistent creature.
- Evolution adds bounded visual changes while preserving recognizability.
- Public avatar responses contain no private player information.
- Future image-generation workflows, if added, must use the genome and approved reference state to preserve consistency.

### Prohibited behavior

- Replacing the creature with an unrelated generated image.
- Encoding secrets or private metadata into avatar URLs or SVG content.
- Allowing user text to inject executable SVG markup.

## 3. Dashboard and persistence

**Status: shipped**

### Expected behavior

The dashboard should present the current canonical state:

- creature identity and avatar;
- mood, energy, XP, level and stars;
- active quests and relationships;
- inventory;
- current story or daily-return opportunity;
- recent story history;
- memories and notification state where relevant.

Closing and reopening Telegram must not reset valid progress. Refreshing after an action must display the committed state.

## 4. Normal actions

**Status: shipped**

### Expected behavior

- Only declared actions are accepted.
- Energy costs and prerequisites are validated before canonical mutation.
- The action, reward, quest progress, relationship progress, story entry and analytics commit transactionally where they belong to the same canonical effect.
- A command/idempotency key prevents duplicate effects.
- A deterministic story is always available.
- Optional AI enrichment happens outside the canonical decision path.

### Failure behavior

- Insufficient energy produces a friendly, actionable response.
- AI failure returns deterministic text without rolling back committed game state.
- A client retry returns the same canonical result when possible.

## 5. Energy and time

**Status: shipped**

### Expected behavior

- Energy regeneration is derived deterministically from persisted state and elapsed time.
- Reading state may apply lazy regeneration without creating repeated rewards.
- Energy never becomes negative because of concurrent actions.
- Rest remains available as a meaningful low-pressure action.

## 6. Quests, rewards and economy

**Status: shipped foundation**

### Expected behavior

- Quest progress is tied to explicit canonical events.
- Completion occurs once.
- XP, stars and items are granted once.
- The shop verifies ownership, balance, inventory rules and price transactionally.
- Purchases remain visible after refresh.
- Evolution tiers follow declared progression rules.

### Planned behavior

- More quests and story-aware items.
- World-scoped economies where a World Pack defines them.
- Clearer reward previews and inventory use flows.

## 7. Authored story arcs

**Status: shipped engine and two arcs**

### Expected behavior

- An arc activates only when prerequisites are satisfied.
- The server provides only legal choices for the current beat.
- A choice applies canonical effects once and advances predictably.
- Refreshing resumes the current beat or completed state.
- Previous route and relationship decisions may be inherited explicitly.
- AI may rewrite the presentation only after canonical facts are fixed.
- Every arc has deterministic fallback narration.

### Content requirements

- Each beat is understandable in a short Telegram session.
- Choices differ meaningfully in tone, relationship or route.
- Rewards are declared and bounded.
- No hidden prompt output becomes authoritative game state.

## 8. Memories and personality

**Status: shipped foundation**

### Expected behavior

- Players can view active memories that affect continuity.
- Editable memories can be corrected or removed by the owning player.
- Corrections preserve lineage and auditability.
- World canon is read-only.
- Raw Telegram text remains private working memory with bounded retention unless explicitly promoted through safe rules.
- AI receives only a small approved memory packet.
- Personality changes are bounded, explainable and replay-safe.

### Planned behavior

- More visible memory provenance.
- Better explanation of which future scenes may use a memory.
- Export and deletion integration.

## 9. Daily return and proactive moments

**Status: shipped foundation**

### Expected behavior

- At most one daily-return instance exists for a creature, world and local date.
- The player receives a small meaningful choice.
- Completion and reward are idempotent.
- Scheduled notifications are off by default.
- Timezone and quiet hours are owner-controlled.
- The system sends bounded messages and never guilt-trips the player.
- Notification delivery does not own the reward; opening or choosing through canonical endpoints does.

### Failure behavior

- Late or no-longer-relevant daily moments are skipped rather than spammed.
- An ambiguous Telegram delivery becomes `uncertain` and is not automatically replayed.

## 10. Shared-link player encounters

**Status: shipped foundation**

### Expected behavior

- A share link contains an opaque/public creature slug, not a private player identifier.
- Opening the link creates a mutual encounter only when both creatures are valid.
- The same encounter link cannot repeatedly grant XP or duplicate relationship edges.
- Both sides receive player-safe story results.

## 11. Personal managed bots

**Status: staged**

### Expected behavior

- A player can create or attach a personal Telegram bot through the supported manager-bot flow.
- The system retrieves the managed token server-side, encrypts it and configures a unique webhook.
- The token is never returned to the browser or written to public logs.
- The personal bot is bound to exactly one owning Telegram account and one creature.
- Owner private chat is allowed by default.
- Other private users and groups require explicit allowlist rules.
- Non-owner access is rejected without leaking creature state.
- The owner can rotate the token and revoke the bot.
- Revocation disables webhook access and future interactions.
- A global fleet flag can stop the entire surface.

### Player-facing completion requirement

The staged backend is not a complete product feature until the managed-bot hub, consent controls and recovery UI described in issue #59 are available.

## 12. Direct bot-to-bot meetings

**Status: staged backend; planned player UX**

### Expected behavior

- Both owners explicitly enable bot meetings.
- A normal player can create a direct invitation without admin credentials.
- The invitation is short-lived, opaque and single-purpose.
- The invited owner sees the public creature identity before accepting.
- Each participant selects only a bot they own.
- Acceptance does not silently enable permanent consent.
- Starting rechecks ownership, bot state, consent, feature flags, budgets and expiry.
- One accepted invitation creates at most one interaction.
- Turns are signed, ordered, deduplicated and limited by TTL and maximum-turn budget.
- Protocol envelopes are never shown in normal UI.
- Both owners can follow progress and review a moderated transcript or summary.
- Bot output cannot grant canonical rewards.

### Failure behavior

- Expired, altered, replayed or consumed invitations are rejected safely.
- Consent changes before start block the meeting.
- Delivery uncertainty produces a neutral support state, not a blind replay button.
- Disabling the kill switch stops new meetings immediately.

## 13. Stranger matchmaking

**Status: planned — issue #64**

### Expected behavior

- Matchmaking is separately opt-in.
- A player joins a short-lived queue for one encounter.
- The server—not the player—selects a compatible stranger.
- There is no public directory or arbitrary targeting of unknown users.
- Matchmaking uses non-sensitive signals such as language, world compatibility, progression band, availability and repeat-pair cooldown.
- Owners remain pseudonymous.
- No owner Telegram identity, phone number, private memory or social graph is exposed.
- Two queue entries are claimed atomically and create exactly one interaction.
- Either owner can block future rematches.
- A separate report flow creates an opaque support reference.
- A persistent creature relationship forms only after independent mutual opt-in.

### Operational behavior

- A dedicated feature flag defaults to off.
- Cohort allowlists and suspension controls are available before wider rollout.
- Queue expiry, cancellation and worker restart do not create duplicate matches.

## 14. Media reactions

**Status: planned — issue #43**

### Expected behavior

- Photos, voice notes, video and links enter a bounded media-processing pipeline.
- The player receives a short in-character observation and curated follow-up choices.
- Media is not permanently remembered by default.
- Processing respects size, type, timeout, privacy and moderation limits.
- External content cannot inject instructions into canonical game logic.
- Failed processing returns a friendly fallback without blocking normal play.

## 15. Optional AI and Connected Mind

**Status: shipped foundation**

### Expected behavior

- The base game works without an AI connection.
- OpenRouter OAuth uses server-side PKCE and encrypted credentials.
- The player selects only curated modes.
- AI requests are budgeted, timed out and logged without secret values.
- The prompt contains canonical facts, allowed references and a bounded approved memory packet.
- Output is moderated and constrained before display.
- AI failure uses deterministic authored fallback.

### Hard boundary

Model output cannot directly:

- insert or update canonical game rows;
- grant XP, stars, items or quest completion;
- choose another player or matchmaking result;
- bypass consent or access rules;
- call Telegram independently of the durable outbox.

## 16. World Packs

**Status: planned — issue #15**

### Expected behavior

- A World Pack declares content and rules through validated data rather than arbitrary runtime code.
- World-specific scenes, quests, locations, items and relationships remain namespaced.
- The same player and managed-bot identity may participate in multiple worlds.
- Switching worlds cannot corrupt another world's progress.
- A malformed World Pack fails validation before activation.
- Deterministic fallback content exists for every required scene.

## 17. Notifications

### Expected behavior

- Notification categories are explicit and owner-controlled.
- Delivery time and quiet hours are respected.
- Source keys prevent duplicate scheduled notifications.
- Turn-by-turn bot-meeting spam is prohibited.
- Notifications deep-link to a real relevant screen.
- Opt-out is immediate for future schedules.

## 18. Error and outage behavior

### Player-facing errors

Errors should be:

- short;
- specific enough to suggest a next action;
- free of stack traces, SQL, Zod internals and secret values;
- associated with a stable typed error code for support.

### Degraded mode

When risky writes are disabled:

- safe reads remain available where possible;
- the UI clearly says the world is temporarily read-only;
- no client is encouraged to spam retries;
- operators can inspect readiness and queue state.

### Telegram delivery states

- retryable known failures may retry with bounded backoff;
- permanent failures dead-letter;
- ambiguous delivery becomes uncertain;
- uncertain delivery is never automatically replayed;
- operator replay is explicit and audited.

## 19. Privacy, deletion and export

**Status: partial foundation; planned self-service UI**

### Expected behavior

- Players can understand what data is stored.
- Export excludes secrets, encrypted credentials and security internals.
- Reset and deletion require explicit confirmation.
- Managed bots are revoked or detached safely before account deletion.
- AI credentials are deleted.
- Creature-scoped data is removed transactionally or anonymized according to policy.
- Deletion does not leave orphaned active interactions or scheduled notifications.

## 20. Accessibility and localization

### Expected behavior

- Core flows work on narrow Telegram Mini App screens.
- Interactive elements have accessible names and keyboard behavior.
- Status changes are announced semantically.
- Reduced motion is respected.
- Color is not the only signal.
- Copy is short and structured for translation.
- Dates and times use the player's locale/timezone where relevant.
- RTL languages can be supported without restructuring the product.

## 21. Performance expectations

- Webhooks validate, persist and return quickly.
- Network calls do not run inside long database transactions.
- Worker batches are bounded and non-overlapping.
- Dashboard reads remain responsive at alpha scale.
- AI timeouts are shorter than the patience threshold for a normal action and always have fallback.
- Queue backlogs affect readiness before they become silent data loss.

## 22. Observability

Operators must be able to inspect:

- update counts by lifecycle state;
- outbox counts by lifecycle state;
- worker lag and queue age;
- AI use, fallback and latency;
- security events;
- bot interactions and matchmaking states;
- operational control changes;
- privacy-safe product funnels.

Metrics must not contain raw private messages, tokens, initData, API keys or full media contents.

## Definition of done for a player-facing feature

A feature is done only when:

1. the player journey is documented;
2. ownership and authorization are explicit;
3. canonical mutations are transactional and idempotent;
4. secrets and private fields are excluded from responses;
5. expected, empty, loading, disabled and failure states exist;
6. unit and integration tests pass;
7. a database smoke test covers the critical state transition when applicable;
8. operations have a flag, metric and rollback path for risky behavior;
9. the relevant player and developer docs are updated;
10. production verification evidence is recorded for Telegram-dependent behavior.
