# Bloopy Network privacy and safety

## Purpose

Bloopy stores persistent game state and integrates with Telegram and optional AI providers. This document defines the product and engineering boundaries required to keep that experience private, safe and understandable.

This is a product/engineering specification, not a substitute for a formal legal privacy policy or terms of service. The current player-facing data summary is [`PRIVACY.md`](./PRIVACY.md).

## Safety principles

1. Collect only data required for gameplay and operations.
2. Keep private player identity separate from public creature identity.
3. Never expose secrets to browsers, other players, public logs or analytics.
4. Make notifications and risky social participation opt-in.
5. Use deterministic authorization and canonical rules instead of trusting model output.
6. Give players correction, export, reset, deletion, block and report controls.
7. Default risky surfaces off until production verification and abuse controls are ready.
8. Prefer bounded summaries over retaining raw private content.

## Data categories

### Public creature data

May be shown in a public share card or encounter:

- creature public name;
- avatar and selected public cosmetics/evolution;
- world-safe public descriptors;
- selected public story summary;
- moderated encounter summary/transcript;
- public managed-bot username only where the product requires it.

Public share routes use opaque tokens and an explicit allowlist of fields. They must not reveal the owner's Telegram ID or private game data.

### Private player and game data

Visible only to the authenticated owner and authorized system components:

- Telegram identity data needed for authentication;
- creature canonical state;
- inventory, quests, relationships and story history;
- memories/corrections;
- notification timezone/preferences;
- AI connection status and usage metadata;
- managed-bot ownership/access rules;
- invitations, meetings, blocks and reports involving the player's bots;
- account lifecycle state.

### Secrets and credentials

Never exposed to players/public logs:

- `APP_ENCRYPTION_KEY`;
- manager/managed bot tokens;
- webhook secrets;
- `ADMIN_API_KEY`;
- platform or player AI keys;
- raw OAuth state/PKCE verifier;
- Telegram Mini App initData;
- HMAC bot-interaction signatures.

Credentials are encrypted at rest where stored and decrypted only in the minimal server-side execution path that needs them.

### Operational and security data

Restricted to operators:

- queue lifecycle states;
- delivery error classes/attempts;
- security-event categories;
- runtime-control changes;
- migration/release verification;
- opaque support references;
- account-lifecycle audit events;
- provider latency/usage metadata.

Operational views should avoid raw private messages and full external payloads.

## Telegram identity boundary

- owner identity is derived from validated initData or trusted webhook context;
- the client cannot declare another owner ID;
- managed bots bind to one owner and creature server-side;
- non-owner access is rejected before private creature state is returned;
- another player's Telegram user ID, phone number, username or profile photo is not exposed through game APIs.

## Public sharing and referrals

Shipped public share surfaces include HTML, SVG profile/story cards and text summary.

Rules:

- public URLs use an opaque share token;
- the token is regenerated with a new creature generation after reset;
- old links do not silently point to a replacement creature;
- share pages contain no private owner identity, credentials or private memories;
- public rendering is deterministic and fixed-field;
- referral attribution binds to the durable referred player account;
- one referred account produces at most one payout;
- reset cannot be used to farm referrals.

## Managed-bot privacy

A personal managed bot is not automatically public.

Default access:

- owner private chat allowed;
- other private users denied;
- groups denied;
- explicit owner-created rules may allow a user/group;
- rejected attempts are audited without private creature content.

Token rotation/revoke are owner-only. Revocation disables webhook access and cancels active interactions safely.

## Bot-to-bot meetings

A meeting shares creature-level fiction, not owner-level identity.

Requirements:

- both owners consent;
- participants use only bots they own;
- invitations are opaque/short-lived;
- protocol envelopes remain hidden;
- conversation is bounded by TTL/turn limit;
- player-visible content is moderated;
- model output cannot reveal private memories or grant rewards;
- history is visible only to participating owners.

## Stranger matchmaking

Stranger matching is separately opt-in and pseudonymous.

The product must not provide:

- public player/bot directory;
- arbitrary stranger targeting;
- location-based discovery;
- sensitive-trait inference;
- contact/group/social-graph exposure;
- automatic human-to-human messaging.

Allowed compatibility signals are limited to non-sensitive product state such as language, active world, progression band, selected mood, availability, cooldown, blocks and safety status.

After an encounter:

- either owner can block future pairing;
- either can submit a bounded report;
- a creature relationship forms only after independent mutual opt-in;
- mutual opt-in does not automatically reveal human identity.

## Memories

- world canon is distinct from player-editable memory;
- owners can correct/delete relevant memories;
- raw Telegram text is not automatically permanent identity memory;
- working/raw content has bounded retention;
- AI receives only an approved small memory packet;
- another player's private memories never enter an encounter prompt;
- export contains safe readable memory data, not secrets/internal history;
- reset/deletion removes memory state under account lifecycle rules.

## AI provider boundaries

Optional AI receives only the minimum required context:

- canonical scene facts;
- creature voice/personality;
- approved references;
- bounded approved memory;
- safety/output constraints.

Prompts must not include credentials, initData, unrelated rows, another owner's identity, full private history or internal security details.

AI output is untrusted and must be validated, constrained and moderated before display.

## Media processing

Planned image/voice/video/link support requires:

- explicit supported types/sizes;
- timeouts and provider limits;
- no permanent retention by default;
- no face recognition, identity lookup or sensitive-trait inference;
- prompt-injection isolation from canonical logic;
- separation of raw content from derived summaries;
- player choice before promoting a result to memory;
- documented retention/deletion before rollout.

## Content safety

Names and generated/enriched narration should be normalized/moderated for:

- profanity appropriate to audience;
- impersonation/system-name abuse;
- sexual/graphic violent content;
- hate/targeted harassment;
- self-harm encouragement;
- secret/protocol exposure attempts;
- malicious URLs/HTML where disallowed.

Unsafe presentation uses deterministic safe fallback and never mutates canonical rewards/rules.

## Blocks and reports

### Block / Not again

- prevents future automatic pairing for the pair;
- requires no allegation/free text;
- enforced in both directions;
- does not reveal who blocked whom.

### Report

- bounded categories;
- opaque support reference;
- minimum evidence necessary;
- rate-limited;
- no public GitHub dump of private content;
- supports suspension from matchmaking/risky features.

## Notifications

- optional and off by default;
- respect timezone/quiet hours;
- no turn-by-turn social spam;
- no guilt/fear/fake urgency;
- deep-link only to authenticated relevant screens;
- minimal lock-screen private content;
- opt-out stops future schedules.

## Logging and analytics

Never log or put in analytics:

- tokens/keys/secrets;
- initData;
- OAuth verifier/state;
- authorization headers;
- full raw private messages/media;
- HMAC signatures;
- another owner's private identifier in player analytics.

Use stable event names, opaque IDs, state/error categories, counts/durations and redacted provider metadata.

## Shipped data export

`GET /api/account/export` produces deterministic JSON using explicitly listed columns.

It may include:

- player/creature identity;
- choices/story history;
- inventory, quests and relationships;
- active memories/corrections;
- notification preferences;
- safe AI connection metadata;
- managed-bot public/consent metadata;
- player-visible interaction state as supported.

It never includes plaintext/encrypted API keys, bot tokens, webhook secrets, raw OAuth state/verifier, initData, private security internals or another owner's identity.

## Shipped creature reset

Reset requires typed `RESET` confirmation.

Behavior:

- revoke managed bots over the network first;
- transactionally remove creature-scoped progression;
- cancel/remove related scheduled/private state;
- preserve Telegram player account;
- create fresh creature on next launch;
- use new generation slug/share token;
- ensure old links do not target replacement.

## Shipped account deletion

Deletion requires typed `DELETE` confirmation.

Behavior:

- revoke managed bots;
- delete AI/OpenRouter credentials;
- remove player-owned creatures/private data;
- clean raw Telegram payloads and non-FK records tied to the identity where required;
- anonymize security history that must survive for abuse protection;
- prevent orphaned active work;
- make repeated deletion a no-op success without recreating account.

## Retention

Current operations include bounded processed-update and sent-outbox cleanup plus account deletion cleanup/anonymization.

Every new feature must define retention for raw Telegram text, media, invitation tokens, transcripts, matchmaking entries, reports, analytics identifiers and security events.

Use the shortest period compatible with player experience, abuse handling and operations.

## Incident response

If privacy/authorization is uncertain:

1. disable the narrowest risky flag/control;
2. preserve evidence without copying secrets publicly;
3. stop new invites/matches or managed ingress if relevant;
4. inspect restricted metrics/logs;
5. revoke compromised credentials;
6. communicate with non-secret references;
7. fix, test and document before re-enable.

See [Operations](./OPERATIONS.md) and [Support](./SUPPORT.md).

## Safety release checklist

Before enabling a social/media feature:

- [ ] explicit consent;
- [ ] negative ownership tests;
- [ ] documented public/private response fields;
- [ ] block/report for strangers;
- [ ] moderation/fallback;
- [ ] rate limits/budgets;
- [ ] feature/runtime kill switches;
- [ ] no secrets in logs/analytics/browser;
- [ ] export/reset/delete/retention impact understood;
- [ ] real Telegram E2E;
- [ ] allowlisted rollout;
- [ ] operator pause/rollback procedure.
