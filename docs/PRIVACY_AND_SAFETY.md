# Bloopy Network privacy and safety

## Purpose

Bloopy stores persistent game state and integrates with Telegram and optional AI providers. This document defines the product and engineering boundaries required to keep that experience private, safe and understandable.

This is a product/engineering specification, not a substitute for a formal legal privacy policy or terms of service before public launch.

## Safety principles

1. Collect only data required for the game and its operations.
2. Keep player identity separate from public creature identity.
3. Never expose secrets to browsers, other players, logs or analytics.
4. Make social participation and notifications opt-in.
5. Use deterministic authorization and canonical rules instead of trusting model output.
6. Give players correction, deletion, block and report controls.
7. Default risky surfaces off until production verification and abuse controls are ready.
8. Prefer bounded summaries over retaining raw private content.

## Data categories

## Public creature data

May be shown to another player in an encounter or share card:

- creature public name;
- creature avatar;
- selected public cosmetic/evolution details;
- world-safe public descriptors;
- moderated encounter summary or transcript content;
- public managed-bot username only when required by the Telegram interaction design.

Public creature data must not reveal the owner's private Telegram identity.

## Private player and game data

Visible only to the authenticated owner and authorized system components:

- Telegram user ID and display metadata required for authentication;
- creature canonical state;
- inventory, quests, relationships and story history;
- memories and corrections;
- notification preferences and timezone;
- AI connection status and usage metadata;
- managed-bot ownership and access rules;
- invitations, meetings, blocks and reports involving the player's bots.

## Secrets and credentials

Never exposed to players or public logs:

- `APP_ENCRYPTION_KEY`;
- `TELEGRAM_MANAGER_BOT_TOKEN`;
- managed-bot tokens;
- webhook secrets;
- `ADMIN_API_KEY`;
- platform AI keys;
- player BYOK/OpenRouter keys;
- raw OAuth state and PKCE verifier;
- Telegram Mini App initData;
- HMAC bot-interaction signatures.

Credentials must be encrypted at rest where stored and decrypted only in the minimal server-side execution path that needs them.

## Operational and security data

Restricted to operators:

- queue lifecycle states;
- delivery errors and attempt counts;
- security-event categories;
- runtime-control changes;
- opaque support references;
- provider latency and usage metadata.

Operational views should avoid raw private messages and full external payloads unless a tightly controlled incident process explicitly requires them.

## Telegram identity boundary

The authenticated Telegram account owns the player identity.

Rules:

- owner identity is derived from validated initData or trusted webhook context;
- the client cannot declare a different owner ID;
- managed bots are bound to an owner and creature server-side;
- non-owner access is rejected before private creature state is loaded into a response;
- another player's Telegram user ID, phone number, username or profile photo is not exposed through game APIs.

## Managed-bot privacy

A personal managed bot is not automatically public.

Default access:

- owner private chat is allowed;
- other private users are denied;
- groups are denied;
- explicit owner-created rules may allow a user/group;
- access attempts are audited without including private creature content.

Token rotation and revoke are owner-only. Revocation disables future bot interactions and should cancel active interactions safely.

## Bot-to-bot meetings

A meeting shares creature-level fiction, not owner-level identity.

Requirements:

- both owners consent;
- each participant uses only a bot they own;
- invitations are opaque and short-lived;
- signed protocol envelopes are hidden from players;
- the conversation is bounded by TTL and turn limit;
- player-visible content is moderated;
- model output cannot reveal private memories or grant rewards;
- history is visible only to owners whose bots participated.

## Stranger matchmaking

Stranger matching is separately opt-in and pseudonymous.

The product must not provide:

- a public directory of players;
- arbitrary lookup/targeting of strangers;
- location-based discovery;
- matching based on sensitive inferred traits;
- exposure of contacts, groups or social graph;
- automatic human-to-human direct messaging.

The server may use limited non-sensitive compatibility signals:

- supported language;
- active world;
- progression band;
- encounter mood selected by the player;
- availability;
- repeat-pair cooldown;
- block and safety status.

After an encounter:

- either owner can block future pairing;
- either owner can submit a bounded report;
- a creature relationship forms only after independent mutual opt-in;
- mutual opt-in does not automatically reveal human identity.

## Memories

Memory should be selective and transparent.

Rules:

- world canon is distinguished from player-editable memory;
- players can correct or delete relevant memories;
- raw Telegram text is not promoted automatically into durable identity memory;
- working/raw content has bounded retention;
- AI receives only an approved small memory packet;
- another player's private memories are never included in an encounter prompt.

## AI provider boundaries

Optional AI receives the minimum context required to render a scene.

Prompts may include:

- canonical scene facts;
- creature voice/personality values;
- approved character references;
- a bounded approved memory packet;
- safety and output-format constraints.

Prompts must not include:

- credentials;
- raw Telegram initData;
- unrelated database records;
- another owner's private identity;
- full private history by default;
- internal moderation/security details.

AI output is untrusted. Validate, constrain and moderate it before display.

## Media processing

Planned image, voice, video and link support requires a separate bounded pipeline.

Requirements:

- explicit supported types and size limits;
- timeouts and provider limits;
- no permanent retention by default;
- no face recognition, sensitive-trait inference or identity lookup;
- external pages/media cannot inject instructions into canonical logic;
- derived summaries are separated from raw content;
- player controls determine whether a meaningful result becomes memory;
- deletion/retention behavior is documented before rollout.

## Content safety

Player-visible names and generated/enriched narration should be normalized and moderated.

Moderation should cover at least:

- profanity appropriate to the product audience;
- impersonation/system-name abuse;
- sexual content;
- graphic violence;
- hate or targeted harassment;
- self-harm encouragement;
- attempts to expose secrets or technical protocol text;
- malicious URLs/HTML where not allowed.

Moderation must not silently mutate canonical rewards or rules. It may replace unsafe presentation with a deterministic safe fallback.

## Reports and blocks

A block is not the same as a report.

### Block / Not again

- immediately prevents future automatic pairing for the relevant pair;
- requires no allegation or free-text explanation;
- is enforced in both matching directions;
- does not reveal which owner blocked whom.

### Report

- uses bounded categories;
- creates an opaque support reference;
- includes only the minimum evidence necessary for review;
- is rate-limited;
- does not publish private content to GitHub;
- supports suspension from matchmaking or risky features.

## Notifications

- off by default where optional;
- respect timezone and quiet hours;
- no turn-by-turn social spam;
- no guilt, fear or fake urgency;
- deep-link only to an authenticated relevant screen;
- no private content in lock-screen copy beyond what the player explicitly enabled;
- opt-out stops future schedules.

## Logging and analytics

Never log or place in analytics:

- tokens, keys or secrets;
- initData;
- OAuth verifier/state;
- authorization headers;
- full raw private messages;
- full media files;
- HMAC signatures;
- another owner's private identifier in a player analytics view.

Use:

- stable event names;
- opaque IDs;
- state/error categories;
- counts, durations and bounded metadata;
- redacted provider information.

## Data export

A future self-service export should include readable player-owned game state:

- account and creature identity;
- choices and story history;
- inventory, quests and relationships;
- active memories and corrections;
- notification preferences;
- AI connection metadata without credentials;
- managed-bot public metadata and consent state;
- meeting/match history visible to the player.

It must not export:

- plaintext or encrypted API keys;
- bot tokens;
- webhook secrets;
- raw OAuth state/verifier;
- initData;
- private security-event internals;
- another owner's private identity.

## Reset and deletion

Self-service reset/deletion is planned in issue #56.

### Creature reset

Should:

- require explicit typed confirmation;
- revoke/detach managed bots first;
- remove creature-scoped progression transactionally;
- cancel scheduled work and active interactions;
- preserve the Telegram player account when reset—not delete—is chosen;
- create a fresh creature safely on next launch.

### Account deletion

Should:

- require a final warning and confirmation;
- revoke managed bots;
- delete AI/OpenRouter credentials;
- remove player-owned creatures and private data;
- remove or anonymize analytics identifiers according to policy;
- prevent orphaned invitations, queue entries and interactions;
- retain only legally/operationally required minimal records with documented retention.

## Retention

Current operational retention includes bounded processed-update and sent-outbox cleanup. New features must define retention before merging.

At minimum define retention for:

- raw Telegram text;
- media;
- invitation tokens;
- completed meeting transcripts;
- matchmaking queue entries;
- reports and support evidence;
- analytics identifiers;
- security events.

Use the shortest period compatible with player experience, abuse handling and operations.

## Incident response

If privacy or authorization behavior is uncertain:

1. disable the narrowest risky feature flag/runtime control;
2. preserve evidence without copying secrets into public channels;
3. stop new invitations/matches or managed-bot ingress if relevant;
4. inspect metrics and restricted logs;
5. revoke compromised credentials;
6. communicate using non-secret incident references;
7. fix, test and document the root cause before re-enabling.

See [Operations](./OPERATIONS.md).

## Safety release checklist

Before enabling a social or media feature:

- [ ] explicit consent exists;
- [ ] ownership is tested negatively;
- [ ] public/private response fields are documented;
- [ ] blocks and reports exist where strangers are involved;
- [ ] moderation and safe fallback exist;
- [ ] rate limits and budgets exist;
- [ ] feature and runtime kill switches exist;
- [ ] secrets are absent from logs/analytics/browser payloads;
- [ ] export/delete/retention impact is understood;
- [ ] E2E verification uses real Telegram resources;
- [ ] rollout begins with an allowlisted cohort;
- [ ] operators know the pause and rollback procedure.
