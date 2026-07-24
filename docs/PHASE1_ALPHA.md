# Phase 1 — core-game private alpha

Coordination sheet for the first 5–10 known-user alpha. Tracked by issue #57.

Do not invite anyone while the deployment is unhealthy or gate A in [`docs/GO_LIVE.md`](GO_LIVE.md)
has not passed. The staged rollout rules live in [`docs/ALPHA_TESTING.md`](ALPHA_TESTING.md); this
page is the checklist you actually work through.

## Release configuration

```text
TELEGRAM_INGRESS_ENABLED=true
OUTBOX_ENABLED=true
DEGRADED_MODE=false
MANAGED_BOT_FLEET_ENABLED=false
BOT_TO_BOT_ENABLED=false
```

**In scope:** the complete core game — onboarding, actions, progression, quests, the shop, both
authored arcs, memories, the daily-return loop, notifications, meet links, share cards, and
self-service export/reset/delete.

**Not in scope:** personal managed bots, bot-to-bot conversations, photo/voice/video/link analysis,
and any public or uncontrolled sharing.

## Pre-invite checklist

- [ ] `npm run release:check -- --base-url https://… --phase 1` passes with `ADMIN_API_KEY` set and
      zero skipped checks
- [ ] deployed commit recorded: `________`
- [ ] `/health` version recorded: `________`
- [ ] manual gate-A items in [`docs/GO_LIVE.md`](GO_LIVE.md) ticked
- [ ] backup taken today and the restore drill passed
- [ ] `/support` tested end to end, and `GET /api/admin/support` is being checked daily — see [`SUPPORT.md`](SUPPORT.md)
- [ ] privacy copy reachable by a player
- [ ] tester guidance sent

## Roster

Track Telegram display names or GitHub handles only. Never paste phone numbers, `initData`, tokens
or private message content into this file.

| Tester | Invited | First launch | Both arcs | Daily return | Meet link | Data controls | Findings |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| Owner smoke | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |

Invite in waves — two testers, wait a day, then the rest. A problem found by two people is cheaper
than the same problem found by ten.

## The core journey

1. Open the manager bot and send `/start`.
2. Complete Character Genesis: wake choice, name, permanent mark.
3. Reopen the Mini App and confirm the creature and its identity persisted.
4. Take normal actions; watch energy fall and regenerate, and XP and levels rise.
5. Progress a quest to completion and spend stars at Momo's stall.
6. Play The Impossible Door to its end.
7. Continue into The Letter From Tomorrow.
8. Inspect a memory, correct one, remove one.
9. Opt into the daily-return notification with quiet hours set, and confirm nothing arrives inside
   them.
10. Share the creature card with another Phase-1 tester, follow their link, and confirm exactly one
    mutual encounter is recorded.
11. Optionally connect OpenRouter, then disconnect, and confirm the authored game is unaffected.
12. Send `/support something small is wrong` and confirm the bot says a human will read it.
13. Download the data export and check it reads like your own history and contains no keys.
14. On one throwaway account only: run **Start over** and confirm a fresh creature appears; then run
    **Delete my account** and confirm reopening starts from nothing.

Steps 13 and 14 exist because export and deletion have never been exercised by a real person. Do not
run step 14 on an account whose story you want to keep.

## Stop conditions

Pause new invitations immediately if any of these happens:

- `/readyz` returns 503;
- duplicate XP, stars, items, story choices or encounters;
- Telegram update failures increasing;
- unexplained uncertain or dead-lettered delivery;
- one player's private creature state visible to another;
- login or onboarding creating duplicate creatures;
- an export containing a credential, or reaching the wrong account;
- a reset or deletion leaving a partially-deleted account behind;
- production entering a restart loop.

Pausing costs an afternoon. Debugging in front of testers costs their goodwill.

## Findings template

```markdown
### Tester / device

### Approximate time and timezone

### What I was doing

### Expected

### Actual

### Did retrying create a duplicate reward, story or Telegram message?

### Screenshot or recording
```

Never include Telegram tokens, API keys, `initData`, webhook secrets or private message contents.

## Done when

- at least five testers have completed the core journey;
- every P0 and P1 finding is resolved or explicitly and knowingly mitigated;
- production queues are clean across a full week of use;
- at least one tester has completed the export/reset/delete path without leaving residue.

Managed-bot verification then proceeds as gate B in [`docs/GO_LIVE.md`](GO_LIVE.md).
