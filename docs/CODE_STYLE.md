# Bloopy Network code style

## Purpose

Code style in Bloopy is not only formatting. It encodes product and reliability rules.

The most important conventions are:

- canonical state is deterministic;
- ownership is derived server-side;
- mutations are transactional and idempotent;
- external network calls stay outside long transactions;
- errors are typed and player-safe;
- risky behavior has flags, metrics and rollback controls;
- AI is presentation, never authority.

## TypeScript

### Compiler and modules

- Use strict TypeScript.
- Use ESM imports with `.js` suffixes in source imports where required by the compiled runtime.
- Avoid `any`. Prefer `unknown` at trust boundaries and validate/narrow immediately.
- Export types for public module contracts.
- Keep domain types close to the module that owns them unless shared broadly.

### Functions

- Prefer small named functions for domain operations.
- Use explicit input objects when a function has more than two conceptual parameters.
- Return domain-shaped results rather than raw database rows.
- Keep side effects visible in names: `create`, `apply`, `enqueue`, `record`, `load`, `authorize`, `finalize`.
- Do not hide network calls inside innocent-looking helpers used in transactions.

Preferred:

```ts
export async function createMeetingInvitation(
  client: pg.PoolClient,
  input: CreateMeetingInvitationInput
): Promise<MeetingInvitation> {
  // validated canonical database work only
}
```

Avoid:

```ts
async function doThing(a: any, b: any) {
  // database, Telegram and AI work mixed together
}
```

### Naming

- Types/interfaces/classes: `PascalCase`.
- Functions/variables: `camelCase`.
- Database columns and SQL aliases: `snake_case`.
- Environment variables: `SCREAMING_SNAKE_CASE`.
- Stable error/event/action codes: lowercase `snake_case`.
- Story, quest and item IDs: lowercase `kebab-case` or `snake_case` according to the existing subsystem; never change a persisted identifier casually.
- Boolean names should read as predicates: `enabled`, `isReady`, `allowBotInteractions`, `migrationsReady`.

### Constants

Use named constants for values that express a rule. Configuration belongs in `config.ts` when operators may need to change it.

Do not scatter literal retry counts, TTLs, limits or feature switches across modules.

## Module boundaries

Each module should own one coherent area.

- HTTP routing authenticates, validates and composes.
- Domain modules own canonical rules.
- Telegram modules own protocol translation and delivery intent.
- Delivery runtime owns queue lifecycle.
- AI modules own narration only.
- Operations modules own metrics and controls.
- Frontend code owns rendering and interaction state, not canonical rules.

Do not add large domain implementations directly to `server.ts`. A route should usually call a domain function.

## Validation

Validate all untrusted input with Zod or an equivalent explicit schema:

- request body;
- route params;
- query params;
- environment variables;
- external provider responses where relevant;
- content-pack definitions.

Validation should happen before canonical mutation.

Player-facing responses must not include raw Zod issue arrays or internal schema details.

## Authentication and ownership

- Resolve player identity from validated Telegram initData.
- Derive owner IDs on the server.
- Never accept an authoritative `playerId`, `ownerTelegramUserId` or internal bot ID from an untrusted client when it can be derived.
- Query owner-scoped resources through ownership joins or explicit owner checks.
- Add negative tests for cross-owner reads and writes.
- Use constant-time comparison for secrets.

## Database access

### Queries

- Use parameterized SQL only.
- List columns explicitly for sensitive or public response queries.
- Convert raw rows into domain views before returning them.
- Keep SQL near the domain module that owns the behavior.
- Add indexes for queue claims, ownership lookups and active-state queries introduced by a migration.

### Transactions

A transaction should be short and contain only work that must be atomic.

Inside a canonical transaction:

- load and lock relevant state;
- validate prerequisites;
- claim idempotency;
- apply canonical effects;
- record directly related events;
- commit.

Outside the transaction:

- Telegram API calls;
- OpenRouter/AI calls;
- media downloads and parsing;
- slow third-party requests;
- rendering that does not affect canonical state.

If a network result must be persisted, use claim/execute/finalize phases.

### Locking

- Use row locks for a specific mutable record.
- Use PostgreSQL advisory transaction locks for logical IDs that span rows.
- Lock in a stable order when touching two entities to avoid deadlocks.
- Document why a lock is needed.
- Never hold a lock while calling an external service.

## Idempotency

Idempotency is mandatory for any retryable mutation.

A good key is:

- stable for the same logical command;
- unique across different commands;
- derived from trusted context;
- persisted under a unique constraint.

Use `INSERT ... ON CONFLICT` or a dedicated command table to claim work. A conflict should return the prior result or a safe replay response.

Do not use only frontend button disabling as duplicate protection.

## Migrations

- Migrations are immutable once applied.
- Use a new ordered filename.
- Prefer additive schema changes.
- Backfill existing rows before enforcing restrictive constraints.
- Give existing rows deterministic safe defaults.
- Add check constraints for lifecycle states where practical.
- Add partial indexes for active queue states.
- Do not assume production schema rollback.
- Update operations and readiness checks when a migration becomes release-critical.

## Lifecycle states

Use explicit state machines for asynchronous or multi-step work.

Examples:

- Telegram ingress: `received`, `processing`, `retryable`, `completed`, `failed`.
- Outbox: `pending`, `sending`, `retryable`, `sent`, `uncertain`, `dead_letter`.
- Invitations: `pending`, `accepted`, `declined`, `expired`, `cancelled`, `consumed`.
- Meetings: `ready`, `queued`, `active`, `completed`, `expired`, `cancelled`, `failed`.

Rules:

- validate transitions;
- persist timestamps and reason codes;
- make terminal states explicit;
- make retries state-aware;
- do not overload one boolean to represent a complex lifecycle.

## Error handling

Expected domain failures use `AppError`.

An `AppError` needs:

- stable code;
- HTTP status;
- player-safe message.

Example:

```ts
throw new AppError(
  "meeting_consent_required",
  409,
  "Both creature owners need to allow meetings first."
);
```

Do not:

- expose SQL errors;
- expose stack traces;
- expose provider response bodies containing secrets;
- infer error type by matching arbitrary message strings;
- return different ownership errors that reveal another player's private resource.

Unexpected errors should be logged with safe structured context and returned as a generic internal error.

## Telegram code

- Verify webhook secrets before enqueueing updates.
- Persist updates before processing.
- Return webhooks quickly.
- Process canonical effects through the ingress worker.
- Use command keys for actions.
- Enqueue replies through the durable outbox.
- Store bot tokens encrypted.
- Never place webhook secrets in URLs for new routes.
- Treat messages from bots differently from messages from humans.
- Verify bot-to-bot signatures, sender, receiver, turn and TTL.
- Do not show protocol envelopes to players.

## External delivery

Classify delivery failures intentionally:

- known transient: retry with bounded backoff;
- rate limit: respect provider retry information;
- known permanent: dead-letter;
- ambiguous timeout/network result: uncertain;
- expired sending lease: uncertain.

Never automatically retry `uncertain` Telegram sends.

## AI code

- Canonical facts are constructed before the model call.
- Prompts use approved references and bounded memory.
- Provider URL and credentials are validated and protected against SSRF.
- Calls have strict timeouts and output limits.
- Usage is budgeted.
- Output is validated and moderated.
- Deterministic fallback is mandatory.
- AI cannot issue SQL, invoke canonical domain functions or select another player.

Keep AI metadata separate from player-visible prose.

## Security and privacy

Sensitive data includes:

- bot tokens;
- webhook secrets;
- app encryption key;
- admin API key;
- AI API keys;
- OpenRouter OAuth state/verifier;
- Telegram initData;
- private owner IDs when not required by the player response;
- raw private messages and media.

Rules:

- encrypt credentials at rest;
- redact secrets in logs;
- never include them in analytics;
- return minimal player-safe views;
- avoid storing raw content when a bounded derived form is sufficient;
- define retention and deletion behavior for new stored content.

## Logging

Use structured logs.

Include:

- stable event name;
- safe entity reference or opaque ID;
- error code/class;
- duration or attempt count;
- non-secret state.

Avoid:

- raw request bodies;
- Telegram initData;
- tokens and keys;
- full private text;
- decrypted credentials;
- provider authorization headers.

## Analytics

Analytics events must be idempotent when tied to a canonical effect.

Use stable event names such as:

- `meeting_invitation_created`;
- `meeting_started`;
- `daily_return_completed`;
- `ai_enrichment_used`;
- `managed_bot_interaction_consent`.

Properties should be small, typed and privacy-safe.

## Frontend JavaScript and UI

- Treat API data as untrusted and render text safely.
- Do not inject player or AI content with `innerHTML`.
- Keep state transitions explicit.
- Disable buttons during submission for UX, but assume requests can still repeat.
- Show a clear state for loading, empty, disabled, offline, retryable and terminal failures.
- Do not show raw internal identifiers.
- Use relative time only when the exact timestamp remains available for accessibility/support.
- Stop polling on terminal state or when the Mini App is backgrounded.
- Respect safe areas and reduced motion.
- Keep UI copy concise and free of technical jargon.

## CSS and visual consistency

- Use shared design tokens for spacing, type, surfaces and semantic states.
- Prefer responsive layout over device-specific branches.
- Avoid fixed heights for text-heavy cards.
- Maintain readable contrast.
- Use animation to clarify state, not to obstruct or pressure.
- Ensure the creature avatar remains the visual anchor.

## Tests

### Unit tests

Cover pure rules, parsers, validation, moderation and deterministic engines.

### Integration/DB smoke tests

Cover transactions, constraints, ownership, replay, concurrency and lifecycle transitions.

### Required negative tests

For any social/private feature, test:

- wrong owner;
- disabled flag;
- revoked resource;
- expired state;
- repeated request;
- concurrent request;
- altered identifier or signature;
- budget/limit exceeded;
- private-field leakage.

### Test data

- Use obviously fake tokens and users.
- Never use production credentials.
- Keep time deterministic where possible.
- Clean up or wrap DB smoke data transactionally.

See [Testing](./TESTING.md).

## Comments and documentation

Comments should explain why, not restate syntax.

Good comment:

```ts
// Telegram may have accepted a timed-out send, so automatic replay could spam the player.
```

Weak comment:

```ts
// Set status to uncertain.
```

Document complex state machines and security boundaries close to the code and in the handbook.

## Formatting

The repository currently relies on TypeScript compilation and review rather than a mandatory formatter/linter configuration.

Until automated formatting is added:

- use two-space indentation in JSON/YAML and conventional readable TypeScript formatting;
- avoid compressed one-line implementations in new code;
- keep lines reasonably readable;
- use trailing commas in multiline structures where TypeScript permits;
- keep SQL templates formatted by clause;
- separate unrelated domain operations with blank lines;
- preserve nearby style when editing legacy code, but improve readability when touching a block substantially.

A future formatter/linter PR should be mechanical and separate from behavior changes.

## Anti-patterns

Do not introduce:

- canonical decisions based on model prose;
- network calls inside long transactions;
- unbounded recursive bot conversations;
- public enumeration of players or bots;
- client-supplied ownership authority;
- retries without idempotency;
- new lifecycle behavior represented by ambiguous booleans;
- secrets in URLs or logs;
- destructive migrations without a migration plan;
- silent catch blocks for canonical failures;
- player flows that require admin APIs;
- feature enablement without a kill switch and production gate.
