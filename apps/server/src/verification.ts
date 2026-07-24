import type pg from "pg";
import { AppError } from "./errors.js";

/**
 * Read-only production state for the human verification gates in issue #17.
 *
 * Gates B and C cannot be automated — they need real managed bots owned by real Telegram accounts —
 * but the *consequences* of each manual step are observable in the database. This module exposes
 * exactly the non-secret state `scripts/verify-gate.mjs` needs to assert those consequences, so a
 * gate is passed by an assertion rather than by someone reading a screen and deciding it looked right.
 *
 * Nothing here returns a token, a webhook secret, a Telegram user id or message content.
 */

export interface AccessRuleView { chatId: number | null; chatType: string; scopedToUser: boolean; enabled: boolean }
export interface ManagedBotView {
  botId: string;
  username: string | null;
  creatureName: string;
  enabled: boolean;
  revokedAt: string | null;
  tokenVersion: number;
  accessPolicy: string;
  allowBotInteractions: boolean;
  accessRules: AccessRuleView[];
  lastWebhookAt: string | null;
  lastOutboundAt: string | null;
}

const iso = (value: unknown): string | null => (value ? new Date(value as string).toISOString() : null);

async function managedBots(client: pg.PoolClient): Promise<ManagedBotView[]> {
  // Deliberately omits token_cipher, webhook_secret and owner_telegram_user_id.
  const result = await client.query(`
    SELECT mb.bot_id,mb.username,mb.enabled,mb.revoked_at,mb.token_version,mb.access_policy,mb.allow_bot_interactions,
           mb.last_webhook_at,mb.last_outbound_at,c.name AS creature_name,
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
             'chatType',r.chat_type,
             -- A private rule's chat id is the player's Telegram user id, so it is withheld; a group
             -- id is what the operator needs to confirm the allowlist entry they just created.
             'chatId',CASE WHEN r.chat_type='private' THEN NULL ELSE r.chat_id END,
             'scopedToUser',r.telegram_user_id IS NOT NULL,
             'enabled',r.enabled) ORDER BY r.created_at)
             FROM managed_bot_access_rules r WHERE r.bot_id=mb.bot_id),'[]'::jsonb) AS rules
    FROM managed_bots mb JOIN creatures c ON c.id=mb.creature_id
    ORDER BY mb.created_at`);
  return result.rows.map((row) => ({
    botId: String(row.bot_id),
    username: row.username ? String(row.username) : null,
    creatureName: String(row.creature_name),
    enabled: Boolean(row.enabled),
    revokedAt: iso(row.revoked_at),
    tokenVersion: Number(row.token_version),
    accessPolicy: String(row.access_policy),
    allowBotInteractions: Boolean(row.allow_bot_interactions),
    accessRules: (row.rules ?? []) as AccessRuleView[],
    lastWebhookAt: iso(row.last_webhook_at),
    lastOutboundAt: iso(row.last_outbound_at)
  }));
}

export async function verificationSnapshot(client: pg.PoolClient, windowMinutes = 60) {
  const window = Math.max(1, Math.min(windowMinutes, 1440));
  const bots = await managedBots(client);

  const security = await client.query(
    `SELECT event_type,bot_id,count(*)::int AS count,max(created_at) AS latest
     FROM security_events WHERE created_at > now() - ($1||' minutes')::interval
     GROUP BY event_type,bot_id ORDER BY max(created_at) DESC`, [window]);

  const interactions = await client.query(
    `SELECT id,source_bot_id,target_bot_id,state,turn_count,max_turns,termination_reason,expires_at,created_at,completed_at,
            (SELECT count(*)::int FROM bot_interaction_turns t WHERE t.interaction_id=bi.id) AS recorded_turns
     FROM bot_interactions bi WHERE created_at > now() - ($1||' minutes')::interval
     ORDER BY created_at DESC LIMIT 20`, [window]);

  // One row per update the ingress accepted, with the canonical effects it produced. A duplicate
  // webhook that slipped through dedup would show as a second update with the same effect counts
  // rising; a duplicated canonical effect would show as effects > 1 for a single update.
  const updates = await client.query(
    `SELECT t.source,t.update_id,t.status,t.attempts,t.received_at,t.completed_at,
            (SELECT count(*)::int FROM game_events g WHERE g.command_key IN ('telegram:manager:'||t.update_id,'telegram:managed:'||split_part(t.source,':',2)||':'||t.update_id)) AS canonical_effects,
            (SELECT count(*)::int FROM outbox o WHERE o.source_key LIKE 'telegram-reply:%:'||t.update_id OR o.source_key LIKE 'telegram-reply:%:'||t.update_id||':%') AS replies
     FROM telegram_updates t WHERE t.received_at > now() - ($1||' minutes')::interval
     ORDER BY t.received_at DESC LIMIT 50`, [window]);

  const queue = await client.query(
    `SELECT (SELECT count(*)::int FROM telegram_updates WHERE status='failed') AS failed_updates,
            (SELECT count(*)::int FROM outbox WHERE status='uncertain') AS uncertain,
            (SELECT count(*)::int FROM outbox WHERE status='dead_letter') AS dead_letters,
            (SELECT count(*)::int FROM outbox WHERE status='failed') AS failed_deliveries`);

  return {
    windowMinutes: window,
    observedAt: new Date().toISOString(),
    bots,
    securityEvents: security.rows.map((row) => ({ eventType: String(row.event_type), botId: row.bot_id === null ? null : String(row.bot_id), count: Number(row.count), latest: iso(row.latest) })),
    interactions: interactions.rows.map((row) => ({
      id: String(row.id), sourceBotId: String(row.source_bot_id), targetBotId: String(row.target_bot_id),
      state: String(row.state), turnCount: Number(row.turn_count), maxTurns: Number(row.max_turns),
      recordedTurns: Number(row.recorded_turns), terminationReason: row.termination_reason ? String(row.termination_reason) : null,
      expiresAt: iso(row.expires_at), createdAt: iso(row.created_at), completedAt: iso(row.completed_at)
    })),
    updates: updates.rows.map((row) => ({
      source: String(row.source), updateId: String(row.update_id), status: String(row.status), attempts: Number(row.attempts),
      canonicalEffects: Number(row.canonical_effects), replies: Number(row.replies),
      receivedAt: iso(row.received_at), completedAt: iso(row.completed_at)
    })),
    queue: {
      failedUpdates: Number(queue.rows[0].failed_updates),
      uncertain: Number(queue.rows[0].uncertain),
      deadLetters: Number(queue.rows[0].dead_letters),
      failedDeliveries: Number(queue.rows[0].failed_deliveries)
    }
  };
}

export interface ReplayProbeResult { found: boolean; deduplicated: boolean; canonicalEffects: number; replies: number }

/**
 * Re-offers an already-received update to the ingress, exactly as a Telegram webhook retry would.
 *
 * This is the one gate-B check nobody can perform by hand: Telegram only retries on its own
 * schedule. It is safe by construction — `telegram_updates` has a primary key on
 * `(source, update_id)`, so a correct system inserts nothing and reports `deduplicated: true`. If
 * dedup were broken this would surface it here, before real players, rather than in production.
 */
export async function replayProcessedUpdate(client: pg.PoolClient, source: string, updateId: number): Promise<ReplayProbeResult> {
  const existing = await client.query("SELECT source,update_id FROM telegram_updates WHERE source=$1 AND update_id=$2", [source, updateId]);
  if (!existing.rowCount) throw new AppError("update_not_found", 404, "That update is not in the ingress log, so there is nothing to replay.");
  const reinserted = await client.query(
    `INSERT INTO telegram_updates (source,update_id,payload,status,available_at,updated_at)
     SELECT source,update_id,payload,'received',now(),now() FROM telegram_updates WHERE source=$1 AND update_id=$2
     ON CONFLICT (source,update_id) DO NOTHING RETURNING update_id`, [source, updateId]);
  const effects = await client.query(
    `SELECT (SELECT count(*)::int FROM game_events g WHERE g.command_key IN ('telegram:manager:'||$2::text,'telegram:managed:'||split_part($1::text,':',2)||':'||$2::text)) AS canonical_effects,
            (SELECT count(*)::int FROM outbox o WHERE o.source_key LIKE 'telegram-reply:%:'||$2::text OR o.source_key LIKE 'telegram-reply:%:'||$2::text||':%') AS replies`,
    [source, String(updateId)]);
  await client.query(`INSERT INTO operational_events (event_type,source_key,details) VALUES ('verification_replay_probe',$1,$2)`,
    [`${source}:${updateId}`, JSON.stringify({ deduplicated: !reinserted.rowCount })]);
  return {
    found: true,
    deduplicated: !reinserted.rowCount,
    canonicalEffects: Number(effects.rows[0].canonical_effects),
    replies: Number(effects.rows[0].replies)
  };
}
