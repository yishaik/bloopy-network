# Support

A player needs one obvious way to reach a human. The broad-release gate in
[`docs/GO_LIVE.md`](GO_LIVE.md) is not met until this page names a real, monitored channel.

## Set this up before inviting anyone

Replace the placeholders below with the real values. Leaving them as placeholders means the support
gate is **not** met.

| Channel | Value | Used for |
|---|---|---|
| Telegram | `@BLOOPY_SUPPORT_HANDLE` | First line for players |
| Email | `support@BLOOPY_DOMAIN` | Privacy, export and deletion requests |
| Issues | `github.com/yishaik/bloopy-network/issues` | Bugs from testers who have an account |

Publish the Telegram handle in the manager bot's `/start` reply and in the Mini App before Phase 1
invitations go out.

## What a player should be told

> Something wrong, or want your data? Message **@BLOOPY_SUPPORT_HANDLE**. You can also download,
> reset or delete everything yourself in Bloopy under **Your data**.

Point at self-service first. It is faster for them and safer for us: nobody has to prove who they
are to a human to get their own data.

## Handling requests

### Bug reports

Use the findings template in [`docs/PHASE1_ALPHA.md`](PHASE1_ALPHA.md). The question that matters
most is *did retrying create a duplicate reward, story or message?* — a yes is a P0, because
idempotency is a guarantee, not a nice-to-have.

### Data requests

Follow [`docs/PRIVACY.md`](PRIVACY.md). Verify the request comes from the Telegram account it
concerns before acting on it, and never send an export anywhere but back to that verified account.

### Reports about another player

Bloopy's player-to-player surface is deliberately narrow: shared meet links, and bot meetings that
both owners consented to. If a report involves a managed bot:

1. Get the reporter's own account and the approximate time. Do not ask for message screenshots
   containing third parties unless they are necessary.
2. Check `security_events` and `bot_interactions` around that window through `/api/admin/metrics`.
3. Contain first — revoke the offending managed bot, or flip `BOT_TO_BOT_ENABLED` off — then
   investigate. The kill switches exist to be used.

## Severity and response

| Severity | Examples | Response |
|---|---|---|
| **P0** | Duplicate rewards or stories; one player's private state visible to another; auth or onboarding creating duplicate creatures | Stop new invitations immediately, consider `DEGRADED_MODE=true`, fix before anything else |
| **P1** | A blocked player journey; notifications firing during quiet hours; repeated delivery failures | Same day |
| **P2** | Cosmetic, copy, or a single non-blocking oddity | Next release |

The stop conditions in [`docs/PHASE1_ALPHA.md`](PHASE1_ALPHA.md) are the same list from the other
direction: if one is met, pause invitations first and diagnose second.

## Never put in a ticket, an issue or a PR

Telegram bot tokens, `APP_ENCRYPTION_KEY`, webhook secrets, `ADMIN_API_KEY`, OpenRouter or other API
keys, raw `initData`, phone numbers, or the contents of a player's private messages. If a player
sends one, ask them to rotate it and do not repeat it back.
