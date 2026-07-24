#!/usr/bin/env node
// Interactive runner for the human verification gates in issue #17.
//
//   ADMIN_API_KEY=… npm run verify:gate -- --base-url https://your-deployment --gate b
//   ADMIN_API_KEY=… npm run verify:gate -- --base-url https://your-deployment --gate c
//
// Gates B and C need real managed bots owned by real Telegram accounts, so the *actions* stay
// manual. What this removes is the eyeballing: after each action it asserts the consequence against
// production state and prints PASS or FAIL with the reason. At the end it emits a non-secret
// evidence block to paste into #17.
//
// Every check reads. The one exception is the duplicate-webhook probe, which re-offers an
// already-received update to the ingress — the correct outcome is that nothing is inserted, which is
// precisely the property under test.

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

function parseArgs(argv) {
  const args = { baseUrl: process.env.BLOOPY_BASE_URL ?? "", gate: "b", windowMinutes: 60, sourceBot: "", targetBot: "", assertOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].split("=");
    const value = inline ?? argv[index + 1];
    const consume = () => { if (inline === undefined) index += 1; return value; };
    if (flag === "--base-url") args.baseUrl = consume();
    else if (flag === "--gate") args.gate = consume()?.toLowerCase();
    else if (flag === "--window-minutes") args.windowMinutes = Number(consume());
    else if (flag === "--bot" || flag === "--source-bot") args.sourceBot = consume();
    else if (flag === "--target-bot") args.targetBot = consume();
    else if (flag === "--assert-only") args.assertOnly = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const adminKey = process.env.ADMIN_API_KEY;
if (!args.baseUrl || !adminKey || !["b", "c"].includes(args.gate)) {
  console.error("usage: ADMIN_API_KEY=… verify-gate --base-url https://… --gate b|c [--bot ID] [--target-bot ID] [--assert-only]");
  console.error("       --assert-only re-checks every gate step against current state without prompting");
  process.exit(2);
}

// Prompting only makes sense at a terminal. Piped or redirected input runs assert-only, so the gate
// can be re-verified later, or scripted, without an ERR_USE_AFTER_CLOSE when stdin reaches EOF.
const interactive = Boolean(stdin.isTTY) && !args.assertOnly;
const rl = interactive ? createInterface({ input: stdin, output: stdout }) : null;
// If the operator closes input (ctrl-D) partway through, the remaining steps are unevaluated, not
// passed — record that rather than throwing ERR_USE_AFTER_CLOSE out of the runner.
let inputClosed = false;
rl?.on("close", () => { inputClosed = true; });
const results = [];
const bold = (text) => `[1m${text}[0m`;

async function api(path, init = {}) {
  const response = await fetch(new URL(path, args.baseUrl), {
    ...init,
    headers: { "x-admin-key": adminKey, ...(init.body ? { "content-type": "application/json" } : {}) },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

const snapshot = () => api(`/api/admin/verification?windowMinutes=${args.windowMinutes}`);
const botById = (state, id) => state.bots.find((bot) => bot.botId === String(id));

/**
 * Runs one gate check: print the manual action, snapshot the world, wait, then assert what changed.
 *
 * The assertion receives (after, before) so a check can ask "did this action create something new",
 * which is the only honest way to test a step whose evidence is an event type that may already exist.
 */
async function step(title, instruction, assertion, options = {}) {
  console.log(`\n${bold(`▸ ${title}`)}`);
  if (instruction) for (const line of instruction) console.log(`   ${line}`);
  // A delta step asserts what the operator's action *changed*. With no pause between the two
  // snapshots there is no change to see, so it is reported unevaluated rather than failed.
  if (options.delta && !interactive) {
    results.push({ status: "SKIP", title, detail: "delta check — needs an interactive run around the action" });
    console.log("   SKIP delta check — needs an interactive run around the action");
    return;
  }
  const before = await snapshot();
  if (interactive) {
    if (inputClosed) {
      results.push({ status: "SKIP", title, detail: "input closed before this step ran" });
      console.log("   SKIP input closed");
      return;
    }
    const answer = await rl.question("   press enter when done (or type skip) > ").catch(() => "skip");
    if (answer.trim().toLowerCase() === "skip") {
      results.push({ status: "SKIP", title, detail: "skipped by operator" });
      console.log("   SKIP");
      return;
    }
  } else {
    console.log("   (assert-only: checking current state)");
  }
  try {
    const detail = await assertion(await snapshot(), before);
    results.push({ status: "PASS", title, detail: detail ?? "" });
    console.log(`   [32mPASS[0m ${detail ?? ""}`);
  } catch (error) {
    results.push({ status: "FAIL", title, detail: error.message });
    console.log(`   [31mFAIL[0m ${error.message}`);
  }
}

const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function askBotId(label, preset) {
  const state = await snapshot();
  if (!state.bots.length) { console.error("\nNo managed bots are registered yet. Create one with /spawn first."); process.exit(1); }
  console.log(`\nRegistered managed bots:`);
  for (const bot of state.bots) console.log(`   ${bot.botId}  @${bot.username ?? "unknown"}  creature "${bot.creatureName}"  ${bot.enabled ? "enabled" : "disabled"}`);
  if (preset) {
    assert(botById(state, preset), `bot ${preset} is not registered`);
    console.log(`\n${label} bot: ${preset}`);
    return String(preset);
  }
  if (!interactive) {
    console.error(`\nassert-only mode needs the bot named up front: pass --bot ID${args.gate === "c" ? " and --target-bot ID" : ""}`);
    process.exit(2);
  }
  const answer = (await rl.question(`\n${label} bot id > `)).trim();
  assert(botById(state, answer), `bot ${answer} is not registered`);
  return answer;
}

/** Counts a security event type for a bot, so a step can assert "this rejection was recorded". */
const securityCount = (state, type, botId) =>
  state.securityEvents.filter((event) => event.eventType === type && (botId === undefined || event.botId === String(botId)))
    .reduce((total, event) => total + event.count, 0);

async function gateB() {
  console.log(bold("\n#17 gate B — one managed bot\n"));
  console.log("Requires MANAGED_BOT_FLEET_ENABLED=true and BOT_TO_BOT_ENABLED=false,");
  console.log("one real managed bot, its owner's account, and a second account acting as a non-owner.\n");
  const botId = await askBotId("Bot under test", args.sourceBot);

  await step("owner private chat accepted",
    ["From the OWNER's account, send the bot a message in private chat (for example /adventure)."],
    (state) => {
      const bot = botById(state, botId);
      assert(bot.lastWebhookAt, "no webhook has ever reached this bot");
      const updates = state.updates.filter((update) => update.source === `managed:${botId}` && update.status === "completed");
      assert(updates.length, "no completed update from this bot in the window");
      const latest = updates[0];
      assert(latest.canonicalEffects <= 1, `update ${latest.updateId} produced ${latest.canonicalEffects} canonical effects; expected at most one`);
      assert(latest.replies <= 1, `update ${latest.updateId} produced ${latest.replies} replies; expected at most one`);
      return `update ${latest.updateId}: ${latest.canonicalEffects} canonical effect, ${latest.replies} reply`;
    });

  await step("non-owner rejected without leaking private state",
    ["From the NON-OWNER's account, message the same bot in private chat.",
     "Confirm by eye that the reply reveals nothing about the owner's creature."],
    (state, before) => {
      const rejections = securityCount(state, "managed_bot_access_rejected", botId);
      const added = rejections - securityCount(before, "managed_bot_access_rejected", botId);
      assert(added > 0, "no new managed_bot_access_rejected event was recorded for this bot");
      return `${added} new access rejection(s) recorded (${rejections} in window)`;
    }, { delta: true });

  await step("owner group access rejected before an allowlist rule exists",
    ["Add the bot to a group and send it a message from the OWNER's account.",
     "It must NOT respond: owner identity alone does not authorize a group."],
    (state, before) => {
      const bot = botById(state, botId);
      assert(!bot.accessRules.some((rule) => rule.chatType !== "private" && rule.enabled), "an enabled group rule already exists; remove it and retry this step");
      assert(securityCount(state, "managed_bot_access_rejected", botId) > securityCount(before, "managed_bot_access_rejected", botId), "no new rejection recorded for the group attempt");
      return "group access rejected with no allowlist rule present";
    }, { delta: true });

  await step("approved group rule works and stays a single rule",
    ["In the Mini App, approve that group for the bot.",
     "Save the SAME rule twice, then send another group message."],
    (state) => {
      const bot = botById(state, botId);
      const groupRules = bot.accessRules.filter((rule) => rule.chatType !== "private");
      assert(groupRules.length >= 1, "no group access rule was created");
      const enabled = groupRules.filter((rule) => rule.enabled);
      assert(enabled.length === 1, `expected exactly one enabled group rule, found ${enabled.length} — a repeated save duplicated it`);
      assert(bot.accessPolicy === "allowlist", `access policy is ${bot.accessPolicy}, expected allowlist`);
      return `one enabled group rule for chat ${enabled[0].chatId}, policy allowlist`;
    });

  await step("duplicate webhook produces one canonical effect and one reply",
    ["Nothing to do by hand — the probe re-offers the most recent update to the ingress,",
     "exactly as a Telegram retry would. A correct system inserts nothing."],
    async (state) => {
      const candidates = state.updates.filter((update) => update.source === `managed:${botId}` && update.status === "completed");
      assert(candidates.length, "no completed update available to replay");
      const target = candidates[0];
      const probe = await api("/api/admin/verification/replay-update", { method: "POST", body: JSON.stringify({ source: `managed:${botId}`, updateId: Number(target.updateId) }) });
      assert(probe.deduplicated, `the ingress accepted a duplicate of update ${target.updateId} — dedup is broken`);
      assert(probe.canonicalEffects <= 1, `update ${target.updateId} now has ${probe.canonicalEffects} canonical effects`);
      assert(probe.replies <= 1, `update ${target.updateId} now has ${probe.replies} replies`);
      return `update ${target.updateId} deduplicated; still ${probe.canonicalEffects} effect / ${probe.replies} reply`;
    });

  await step("token rotation invalidates the previous token",
    ["In the Mini App, rotate the bot's token.",
     "Then message the bot again from the OWNER's account to confirm the webhook still works."],
    (state, before) => {
      const bot = botById(state, botId);
      const previous = botById(before, botId).tokenVersion;
      assert(bot.tokenVersion > previous, `token version is still ${bot.tokenVersion}; rotation did not take effect`);
      assert(bot.enabled && !bot.revokedAt, "the bot is not enabled after rotation");
      assert(bot.lastWebhookAt && bot.lastWebhookAt > botById(before, botId).lastWebhookAt, "no webhook arrived after rotation; the webhook was not restored");
      return `token version ${previous} → ${bot.tokenVersion}, webhook restored`;
    }, { delta: true });

  await step("revoke disables the bot and its webhook access",
    ["In the Mini App, revoke the bot. Then message it once more; it must not respond."],
    (state) => {
      const bot = botById(state, botId);
      assert(!bot.enabled, "the bot is still enabled after revoke");
      assert(bot.revokedAt, "revoked_at was not set");
      assert(!bot.allowBotInteractions, "bot-to-bot consent survived revoke");
      return `revoked at ${bot.revokedAt}`;
    });

  await step("queues stayed clean throughout", [],
    (state) => {
      const { failedUpdates, uncertain, deadLetters, failedDeliveries } = state.queue;
      assert(failedUpdates === 0 && uncertain === 0 && deadLetters === 0 && failedDeliveries === 0,
        `failed updates ${failedUpdates}, uncertain ${uncertain}, dead letters ${deadLetters}, failed deliveries ${failedDeliveries}`);
      return "no failed, uncertain or dead-lettered work";
    });
}

async function gateC() {
  console.log(bold("\n#17 gate C — two-owner bot meetings\n"));
  console.log("Requires MANAGED_BOT_FLEET_ENABLED=true and BOT_TO_BOT_ENABLED=true,");
  console.log("and two managed bots owned by two distinct Telegram accounts, both through gate B.\n");
  const sourceBotId = await askBotId("Source (initiating)", args.sourceBot);
  const targetBotId = await askBotId("Target", args.targetBot);
  if (sourceBotId === targetBotId) {
    console.error("\ngate C needs two distinct bots owned by two distinct Telegram accounts.");
    process.exit(2);
  }
  const target = botById(await snapshot(), targetBotId);

  await step("a meeting is blocked until BOTH owners consent",
    ["Turn meeting consent OFF for at least one of the two bots in its owner's Mini App.",
     `Then attempt to start a meeting:`,
     `  curl -X POST "${args.baseUrl}/api/admin/bots/converse" -H "x-admin-key: $ADMIN_API_KEY" \\`,
     `       -H 'content-type: application/json' -d '{"sourceBotId":${sourceBotId},"targetUsername":"${target?.username ?? "TARGET"}"}'`,
     "It must fail with bot_interaction_consent_required."],
    (state, before) => {
      const source = botById(state, sourceBotId);
      const other = botById(state, targetBotId);
      assert(!source.allowBotInteractions || !other.allowBotInteractions, "both bots still have consent enabled; turn one off and retry");
      const started = state.interactions.filter((interaction) => interaction.sourceBotId === String(sourceBotId) && interaction.createdAt > before.observedAt);
      assert(started.length === 0, "an interaction was created despite missing consent");
      return "no interaction created without two-sided consent";
    }, { delta: true });

  await step("a signed meeting completes within the turn budget",
    ["Enable meeting consent for BOTH bots, then start a meeting with the same curl command."],
    (state) => {
      const interaction = state.interactions.find((entry) => entry.sourceBotId === String(sourceBotId) && entry.targetBotId === String(targetBotId));
      assert(interaction, "no interaction was created between these two bots");
      assert(interaction.state === "completed", `interaction is ${interaction.state}${interaction.terminationReason ? ` (${interaction.terminationReason})` : ""}, expected completed`);
      assert(interaction.turnCount === interaction.maxTurns, `turn count ${interaction.turnCount}, expected the ${interaction.maxTurns}-turn budget`);
      assert(interaction.recordedTurns === interaction.turnCount, `${interaction.recordedTurns} turns recorded for turn count ${interaction.turnCount} — replay or loss`);
      return `interaction ${interaction.id.slice(0, 8)} completed in ${interaction.turnCount}/${interaction.maxTurns} turns (${interaction.terminationReason})`;
    });

  await step("a forged or replayed envelope is rejected",
    ["From either bot's chat, send a message copying the /bloopy_story envelope from the",
     "completed meeting, with any character of the signature changed."],
    (state, before) => {
      const forgeries = (snap) => securityCount(snap, "bot_interaction_auth_rejected") + securityCount(snap, "bot_interaction_invalid_envelope") + securityCount(snap, "bot_interaction_unknown");
      const rejected = forgeries(state);
      assert(rejected > forgeries(before), "no new forgery/replay rejection was recorded");
      const interaction = state.interactions.find((entry) => entry.sourceBotId === String(sourceBotId) && entry.targetBotId === String(targetBotId));
      assert(!interaction || interaction.recordedTurns <= interaction.maxTurns, "a forged turn advanced the interaction past its budget");
      return `${rejected} forged/stale envelope rejection(s) recorded, no extra turn accepted`;
    }, { delta: true });

  await step("pair and owner budgets are enforced",
    ["Start meetings repeatedly between the same two bots until one is refused",
     "with bot_pair_budget_exhausted or bot_owner_budget_exhausted."],
    (state) => {
      const pair = state.interactions.filter((entry) =>
        (entry.sourceBotId === String(sourceBotId) && entry.targetBotId === String(targetBotId)) ||
        (entry.sourceBotId === String(targetBotId) && entry.targetBotId === String(sourceBotId)));
      assert(pair.length > 0, "no interactions recorded for this pair");
      return `${pair.length} interaction(s) in the window before the budget refused another`;
    });

  await step("the kill switch blocks new meetings immediately",
    ["Set BOT_TO_BOT_ENABLED=false (or pause it) and attempt one more meeting.",
     "It must fail with bot_interactions_disabled."],
    (state, before) => {
      const created = state.interactions.filter((entry) => entry.createdAt > before.observedAt);
      assert(created.length === 0, `${created.length} interaction(s) were created after the kill switch was flipped`);
      return "no interaction created with the kill switch off";
    }, { delta: true });

  await step("queues stayed clean throughout", [],
    (state) => {
      const { failedUpdates, uncertain, deadLetters, failedDeliveries } = state.queue;
      assert(failedUpdates === 0 && uncertain === 0 && deadLetters === 0 && failedDeliveries === 0,
        `failed updates ${failedUpdates}, uncertain ${uncertain}, dead letters ${deadLetters}, failed deliveries ${failedDeliveries}`);
      return "no failed, uncertain or dead-lettered work";
    });
}

try {
  if (args.gate === "b") await gateB(); else await gateC();
} finally {
  rl?.close();
}

const failed = results.filter((entry) => entry.status === "FAIL");
const skipped = results.filter((entry) => entry.status === "SKIP");
console.log(`\n${bold("Evidence for issue #17")} — paste this into the gate comment:\n`);
console.log("```text");
console.log(`gate ${args.gate.toUpperCase()} — ${args.baseUrl} — ${new Date().toISOString()}`);
for (const entry of results) console.log(`[${entry.status}] ${entry.title}${entry.detail ? ` — ${entry.detail}` : ""}`);
console.log(`${results.filter((entry) => entry.status === "PASS").length} passed, ${failed.length} failed, ${skipped.length} skipped`);
console.log("```");
if (failed.length) {
  console.log(`\n[31mGate ${args.gate.toUpperCase()} did not pass.[0m Do not widen access. See docs/GO_LIVE.md.\n`);
  process.exitCode = 1;
} else if (skipped.length) {
  console.log(`\nGate ${args.gate.toUpperCase()} has skipped steps — it is not signed off until every step passes.\n`);
  process.exitCode = 1;
} else {
  console.log(`\n[32mGate ${args.gate.toUpperCase()} passed.[0m\n`);
}
