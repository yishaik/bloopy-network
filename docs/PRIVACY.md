# Privacy

Plain-language reference for what Bloopy Network stores, why, and how a player gets it back or
removes it. This is the source text for the player-facing privacy notice; adapt the wording for
whatever surface you publish it on, but do not describe behaviour the code does not have.

Last reviewed against the code at release 0.12.0.

## What is stored

**Because the game cannot work without it**

- Your Telegram user id, display name and language, so your creature is yours across sessions.
- Your creature: name, appearance genome, personality, level, energy, stars, mood, location.
- What you did: authored choices, story entries, quests, inventory, relationships, story flags.
- Memories your creature keeps, which you can read, correct and delete individually.
- Daily activity dates, used for the daily-return loop.

**Only if you turn it on**

- Notification preferences: timezone, delivery time and quiet hours.
- An AI connection: a provider URL, a model name, and an API key **encrypted at rest**. Bloopy never
  shows a stored key back to you or anyone else.
- A managed Telegram bot for your creature: its bot id, username, an encrypted token, and the chats
  you explicitly approved.

**Operational records**

- Telegram updates in flight and queued outbound messages, kept until processed and then cleared on
  a retention schedule.
- Security events (for example a rejected bot access attempt), kept for abuse investigation.
- Analytics events recording that something happened — an action, a completed quest — not the text
  of your stories.
- Support requests you send with `/support`, including the text you wrote, so a human can answer
  them. They are included in your export and removed when you delete your account.

## What is never stored

- Your phone number, contacts, or Telegram messages outside a chat with a Bloopy bot.
- Your location.
- Payment details. Stars are in-game currency with no monetary value.
- Any credential in readable form. API keys, bot tokens, webhook secrets and OAuth verifiers are
  sealed with an application key held outside the database.

## Who can see it

- **You**, through the Mini App and your export.
- **Other players**, only what you deliberately share: your creature's name, level and evolution on
  a share card, and the fact that two creatures met if you exchange a meet link. Private memories,
  story text and your Telegram identity are never shown to another player.
- **The operator**, who can reach the database for support and incident response.
- **Model providers**, only if you connect one, and only the constrained scene text sent for
  narration — never your credentials, your Telegram identity or your private memories.

A share card is a public page. It is keyed by an opaque random token, not by your creature's
internal slug, because that slug contains your Telegram user id. Anyone with the link can see the
card; nobody can work backwards from it to you.

## Your controls, in the app

Open Bloopy → **Your data**.

| Control | What happens |
|---|---|
| **Download my data** | A JSON file with your account, creature, choices, stories, memories, quests, inventory, relationships, preferences and AI connection metadata. It contains no keys, tokens or secrets. |
| **Start over with a new creature** | Type `RESET`. Deletes the creature and everything scoped to it, revokes any creature bot, keeps your account. A new creature is waiting next time you open Bloopy, under a new share link — links you shared for the old creature stop working. |
| **Delete my account** | Type `DELETE`. Removes the account, creature, stories, memories, preferences, support requests, stored credentials and any creature bot. Queued messages to you are cancelled. Security records are kept for abuse investigation with your identifier removed. |

Both destructive actions require typing the exact word. Neither can be undone, and neither returns
any of the deleted content in its response.

Deletion is not a lockout: if you later open Bloopy from Telegram again, you start over as a new
player with a new creature. Nothing from before is recovered.

Resetting does not reset your referral history. That is deliberate — otherwise a reset would be a
way to farm the one-time invite reward.

## Manual requests

While self-service is the primary path, requests through the support channel in
[`docs/SUPPORT.md`](SUPPORT.md) are honoured too:

1. Verify the request comes from the Telegram account it concerns. Do not act on a request that
   names another player's creature.
2. For export, run `exportPlayerData` for that player and send the JSON only to the verified
   account. Never paste it into an issue, a PR or a shared channel.
3. For deletion, run `deleteAccount`. It performs the same sweep as the in-app control.
4. Record the outcome in your support log. `account_lifecycle_events` records that a lifecycle
   action happened and when, deliberately without a reversible link to the person.

Target: acknowledge within 3 days, complete within 30.

## Retention

| Data | Kept |
|---|---|
| Creature, stories, memories, progression | Until you reset, delete, or ask us to |
| Processed Telegram updates | `PROCESSED_UPDATE_RETENTION_DAYS`, 7 by default |
| Delivered outbound messages | Cleared with the same sweep |
| Security events | Retained for abuse investigation; identifiers removed on deletion |
| Analytics events | Removed with your account |
| Support requests | Until closed and no longer needed; removed with your account |
| Backups | Per [`docs/BACKUP_RESTORE.md`](BACKUP_RESTORE.md); a restore crossing a deletion requires re-applying it |

## Children

Bloopy is not directed at children under 13, and the game asks for no personal information beyond
what Telegram provides. If you believe a child's data is stored here, use the support channel and it
will be removed.

## Changes

Material changes to what is collected or who can see it are announced through the manager bot before
they take effect, not applied quietly.
