# Architecture

The first release is a modular monolith: one deployable service with strict module boundaries, PostgreSQL state and background workers. This keeps cost and operational complexity low while preserving seams for later extraction.

## Runtime modules

- HTTP and Telegram ingress
- Telegram manager and managed-bot registry
- deterministic game and story engine
- proactive world-event worker and transactional outbox
- consistent SVG avatar renderer
- BYOK OpenAI-compatible adapter with deterministic fallback
- PostgreSQL event, story, memory and relationship stores

## Managed bots

The manager receives `managed_bot` updates, calls `getManagedBotToken`, encrypts the token and configures a unique webhook. One platform process serves all managed bots; the user remains the owner.

## Bot-to-bot safety

Direct bot conversations use `/bloopy_story <interaction_id> <depth>` envelopes and terminate at depth four. The next hardening branch adds persistence-based deduplication, pair budgets, timeouts and a global kill switch.

## AI policy

Template narration is the default. A user's encrypted BYOK profile may call an OpenAI-compatible endpoint with a strict timeout and automatic deterministic fallback. Models cannot write game state or grant rewards.
