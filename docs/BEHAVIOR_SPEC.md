# Bloopy Network behavior specification

## Purpose

This document is the product-level acceptance contract for Bloopy Network. A feature is complete only when its player journey, persistence, authorization, failure handling, privacy, tests and operational controls satisfy this contract.

Status terms:

- **Shipped** — implemented on `main` and covered by automated checks.
- **Staged** — implemented but disabled/restricted until production verification.
- **Planned** — specified but not implemented.

## Global invariants

1. One Telegram account maps to one canonical player identity.
2. A creature remains recognizable across sessions and surfaces.
3. Canonical state changes only through validated deterministic domain logic.
4. Retries, duplicate updates and double taps do not duplicate canonical effects.
5. Optional AI cannot create legal choices, grant rewards or write canonical state.
6. Secrets and private identifiers never appear in public/player-safe output.
7. Risky Telegram/social surfaces default off until verified.
8. Leaving the game causes no punishment or valid-progress loss.
9. Destructive/privacy-sensitive actions are explicit and owner-authorized.
10. External delivery has an inspectable lifecycle state.
11. Public sharing uses explicit allowlisted fields and opaque tokens.
12. A player can export, reset and delete their data without support intervention.

## 1. Bootstrap and Character Genesis

**Status: shipped**

- Opening the manager bot/Mini App creates or resumes exactly one player and one creature.
- Concurrent bootstrap converges on the same records.
- The world is populated immediately.
- Wake, name and marker choices persist.
- Refresh resumes onboarding.
- Repeated completion does not duplicate rewards, memories or story.
- A referral is attributed only for a genuinely new player arriving before onboarding completion.
- Referral payout occurs once when onboarding completes and cannot be farmed through reset.
- Invalid names return friendly errors without validation internals.

Failure behavior:

- database failure creates no partial identity;
- duplicate requests return existing/replayed results;
- degraded mode allows safe reads and rejects risky writes clearly.

## 2. Creature identity and avatar

**Status: shipped foundation**

- A versioned genome is the canonical visual identity.
- The same genome renders a consistent SVG.
- Evolution adds bounded changes while preserving recognition.
- Public avatar/card content contains no private owner data.
- User text cannot inject executable SVG.
- Future generated images must remain constrained by the genome/reference identity.

## 3. Dashboard and persistence

**Status: shipped**

The dashboard presents canonical creature identity, mood, energy, XP, level, stars, quests, relationships, inventory, story/daily return, recent history, memories, notifications and AI connection state as relevant.

Closing/reopening Telegram must not reset progress. A refresh after a committed action shows the committed state.

## 4. Actions, energy and progression

**Status: shipped**

- Only declared actions are accepted.
- Costs/prerequisites are checked before mutation.
- Canonical effects commit transactionally.
- Command keys prevent duplicate effects.
- Energy regeneration is deterministic from persisted state/time.
- Concurrent actions cannot overspend energy.
- Quest completion and rewards occur once.
- Shop purchases verify balance/ownership transactionally.
- XP, stars, inventory and evolution persist.
- Deterministic story text always exists.
- AI failure never rolls back canonical state.

## 5. Authored story arcs

**Status: shipped engine and two arcs**

- Arcs activate only after prerequisites.
- Only legal choices for the current beat are returned.
- A choice applies once and resumes correctly after refresh.
- Route inheritance is explicit.
- Rewards are bounded and replay-safe.
- Every visible beat has deterministic fallback narration.
- AI may change presentation only after canonical facts are fixed.

## 6. Memories and personality

**Status: shipped**

- Players can view active relevant memories.
- Editable memories can be corrected or removed by the owner.
- Corrections preserve lineage/auditability.
- World canon is read-only.
- Raw Telegram text remains bounded private working memory and is excluded from normal AI context.
- AI receives only a small approved memory packet.
- Personality changes are gradual, bounded, explainable and replay-safe.
- Export includes player-safe memory state and excludes private credentials/security internals.
- Reset/deletion remove memory state according to account lifecycle rules.

## 7. Daily return and proactive notifications

**Status: shipped**

- At most one daily-return instance exists per creature/world/local date.
- Completion/reward occurs once.
- Notifications are off by default.
- Timezone, delivery time and quiet hours are owner-controlled.
- Messages are bounded and never guilt-based.
- Late/no-longer-relevant moments are skipped.
- Delivery does not own the reward.
- Ambiguous Telegram delivery becomes `uncertain` and is not automatically replayed.

## 8. Public sharing and referrals

**Status: shipped**

Public share surfaces:

- use an opaque share token rather than an owner-derived slug;
- expose only a fixed allowlist of public creature/story fields;
- provide HTML preview, profile SVG, story SVG and text summary;
- contain no scripts or remote assets where the shipped page promises self-containment;
- do not expose Telegram user ID, private memories, credentials or raw canonical state;
- return generic not-found behavior for invalid/old tokens.

Referral behavior:

- attribution binds to the durable referred player account;
- one referred account yields at most one payout;
- payout happens after onboarding completion;
- reset/delete/recreation cannot generate another payout for the same durable account;
- payout is transactional/idempotent.

## 9. Shared-link creature encounters

**Status: shipped foundation**

- A valid link can create a mutual encounter/relationship/story.
- The same logical encounter cannot repeatedly grant XP or duplicate edges.
- Both sides receive player-safe results.
- Old creature links do not silently point at a replacement creature after reset.

## 10. Account export, reset and deletion

**Status: shipped**

### Export

- `GET /api/account/export` returns deterministic JSON with explicit safe columns.
- Export includes player-owned game state and connection metadata needed for understanding the account.
- Export excludes plaintext/encrypted keys, bot tokens, webhook secrets, initData, raw OAuth verifier/state and security internals.
- Response is downloadable and `no-store`.

### Creature reset

- Requires typed `RESET` confirmation.
- Managed bots are revoked before canonical reset.
- Creature-scoped progression is removed transactionally.
- The Telegram player account remains.
- Next launch creates a fresh creature.
- New creature gets a new generation slug/share token.
- Old share/referral links resolve to nothing rather than the replacement.

### Account deletion

- Requires typed `DELETE` confirmation.
- Managed bots are revoked.
- AI/OpenRouter credentials and player-owned data are removed.
- Raw Telegram/update content tied to the deleted identity is removed where required.
- retained security/operational history is anonymized according to policy.
- repeated deletion is a no-op success and must not bootstrap/recreate the account.
- no orphan active notifications/interactions/resources remain.

## 11. Personal managed bots

**Status: staged**

- A supported manager-bot flow attaches a managed bot to one owner and creature.
- Managed token is retrieved server-side, encrypted and never returned.
- Unique webhook secret is configured.
- Owner private chat is allowed by default.
- Other users/groups require explicit owner allowlist rules.
- Unauthorized access is rejected without creature-state leakage.
- Owner can rotate token and revoke bot.
- Revoke disables webhook access and cancels active interactions.
- Fleet kill switch stops the surface.

The backend is not a finished broad-player feature until issue #59's management/consent UI exists.

## 12. Direct bot-to-bot meetings

**Status: staged backend; planned player UX (#58–#63)**

- Both owners explicitly consent.
- A normal player can create an opaque short-lived invitation without admin credentials.
- Invited owner sees public creature identity before accepting.
- Each side selects only a bot they own.
- Acceptance does not silently enable global consent.
- Start atomically rechecks invitation, ownership, bot health, consent, flags, budgets and expiry.
- One accepted invitation creates at most one interaction.
- Turns are signed, ordered, deduplicated and bounded by TTL/turn limit.
- Protocol envelopes are hidden from normal UI.
- Both owners see consistent progress and player-safe transcript/history.
- Bot output cannot grant canonical rewards.
- Uncertain delivery shows neutral support state, not player replay.
- Kill switch stops new meetings immediately.

## 13. Stranger matchmaking

**Status: planned (#64)**

- Separately opt-in; joining is consent for one attempt.
- Server selects compatible stranger; no public directory/arbitrary targeting.
- Uses only non-sensitive signals such as language, world, progression band, availability and cooldown.
- Owners remain pseudonymous.
- No phone, owner Telegram identity, private memory, contacts or social graph is exposed.
- Two queue entries are claimed atomically and create one match/interaction.
- Cancelled/expired entries cannot match.
- Match-time consent/flags/budgets/health/blocks are rechecked.
- Either owner can block future matching or submit a bounded report.
- Persistent creature relationship requires independent mutual opt-in.
- Dedicated matchmaking flag defaults off.

## 14. Media reactions

**Status: planned (#43)**

- Photos, voice notes, video and links enter a bounded typed pipeline.
- Output is a short in-character observation plus curated choices.
- Raw media is not permanent memory by default.
- Size/type/timeout/privacy/moderation limits are enforced.
- External content cannot inject canonical instructions.
- Failure returns a friendly fallback and normal game remains available.

## 15. Optional AI and Connected Mind

**Status: shipped foundation**

- Base game works without AI.
- OpenRouter OAuth uses server-side PKCE and encrypted credentials.
- Player selects curated modes.
- Calls are budgeted, timed out and logged without secrets.
- Prompt contains canonical facts, allowed references and bounded memory.
- Output is validated/moderated.
- Failure uses deterministic fallback.

Model output cannot directly mutate canonical rows, grant rewards, choose players/matches, bypass consent or call Telegram outside the outbox.

## 16. World Packs

**Status: planned (#15)**

- Packs declare validated content/rules, not arbitrary executable code.
- World state is namespaced.
- Switching worlds cannot corrupt another world.
- Invalid packs fail before activation.
- Every required scene has deterministic fallback.
- Packs cannot write SQL/call external services/bypass canonical APIs.

## 17. Errors and outages

Player-facing errors are short, actionable, typed and free of stack traces, SQL, Zod internals and secrets.

Degraded mode:

- preserves safe reads where possible;
- clearly rejects risky writes;
- discourages retry spam;
- remains inspectable through readiness/metrics.

Delivery:

- known transient failures retry with bounds;
- permanent failures dead-letter;
- ambiguous delivery becomes uncertain;
- uncertain is never automatic replay;
- operator replay is explicit/audited.

## 18. Accessibility and localization

- Core flows fit narrow Telegram viewports.
- Controls have accessible names/keyboard behavior.
- Status changes are semantically announced.
- Reduced motion and readable contrast are supported.
- Color is not the only signal.
- Copy is concise/translation-friendly.
- Times use player locale/timezone.
- RTL can be supported without redesigning data contracts.

## 19. Performance and operations

- Webhooks validate, persist and return quickly.
- Network calls stay outside long transactions.
- Worker batches are bounded and non-overlapping.
- AI has strict timeout/fallback.
- Queue pressure affects readiness before silent loss.
- Release preflight verifies version, flags, queues and migration ledger.
- Backup/restore drill validates recoverability.
- Risky features have kill switches.

Operators can inspect update/outbox states, worker lag, AI usage, security/operational events, bot interactions, migration ledger and account-lifecycle events without raw secrets/private content.

## Definition of done

A player-facing feature is done only when:

1. journey and status (shipped/staged/planned) are documented;
2. ownership/authorization are explicit;
3. mutations are transactional/idempotent;
4. secrets/private fields are excluded;
5. loading/empty/disabled/success/failure states exist;
6. unit/integration/DB smoke tests pass as relevant;
7. replay/concurrency/negative authorization are tested;
8. flag, metric and rollback exist for risky behavior;
9. player, developer, API and operations docs are updated;
10. real Telegram production evidence exists for Telegram-dependent behavior.
