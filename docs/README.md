# Bloopy Network documentation

This directory is the canonical product, player, engineering and operations handbook for Bloopy Network.

Bloopy is a Telegram-native persistent creature game. Players adopt a creature with a stable identity, evolving personality, memories, relationships and authored adventures. Telegram is both the launcher and part of the fiction: the creature can live in the Mini App, message through the manager bot and, after staged verification, receive its own managed bot identity.

## Start here

### Players and testers

- [Player guide](./PLAYER_GUIDE.md) — how the game works, what each feature means and what to expect.
- [מדריך לשחקנים בעברית](./PLAYER_GUIDE_HE.md) — Hebrew player guide.
- [Product privacy summary](./PRIVACY.md) — current stored data, visibility and account controls.
- [Privacy and safety model](./PRIVACY_AND_SAFETY.md) — engineering/social safety boundaries and future-feature requirements.
- [Support](./SUPPORT.md) — support channels, severities and escalation.
- [Phase-1 alpha](./PHASE1_ALPHA.md) — tester roster, journey and stop conditions.
- [Alpha testing](./ALPHA_TESTING.md) — rollout phases and Telegram/social verification gates.

### Product and game design

- [Product vision](./PRODUCT.md) — mission, product principles, current scope and long-term direction.
- [Game design](./GAME_DESIGN.md) — tone, loops, progression, pacing, social play and anti-dark-pattern rules.
- [Behavior specification](./BEHAVIOR_SPEC.md) — the end-state contract for how Bloopy should behave when complete.
- [Bot meetings](./BOT_MEETINGS.md) — direct invitations, bot-to-bot conversations and stranger matchmaking.

### Developers

- [Architecture](./ARCHITECTURE.md) — system boundaries, data flow, persistence and reliability model.
- [Developer guide](./DEVELOPER_GUIDE.md) — local setup, repository orientation and common implementation workflows.
- [API reference](./API.md) — current HTTP routes, auth/error conventions and planned social APIs.
- [Code style](./CODE_STYLE.md) — TypeScript, SQL, API, transaction, error and frontend conventions.
- [Testing](./TESTING.md) — required test layers, database smoke suites and release gates.
- [Contributing](../CONTRIBUTING.md) — branch, issue, PR and review expectations.

### Launch and operations

- [Go live](./GO_LIVE.md) — ordered release runbook.
- [Production operations](./OPERATIONS.md) — Railway handoffs, health checks, runtime controls and recovery.
- [Backup and restore](./BACKUP_RESTORE.md) — backup commands and verified restore drill.
- [Railway deployment](./RAILWAY_DEPLOY.md) — platform-specific deployment notes.
- [Alpha testing](./ALPHA_TESTING.md) — staged production verification for manager bots, managed bots, direct meetings and future matchmaking.

## Documentation status labels

Every product-facing document distinguishes between:

- **Shipped** — implemented on `main` and covered by automated checks.
- **Staged** — implemented but disabled until a production verification gate passes.
- **Planned** — specified in issues or documentation but not yet implemented.

Do not describe planned behavior as available to players. Link the relevant GitHub issue when documenting planned work.

## Source of truth order

When documents appear to disagree, use this order:

1. executable code and migrations on `main`;
2. release and operational gates in `GO_LIVE.md`, `OPERATIONS.md` and `ALPHA_TESTING.md`;
3. current GitHub issues and accepted design decisions;
4. this documentation handbook;
5. old PR descriptions or chat history.

Update the handbook in the same PR whenever a change alters a player-visible rule, public API, migration contract, runtime flag, safety boundary or operational procedure.
