import { createHmac } from "node:crypto";
import type pg from "pg";
import { config } from "./config.js";
import { AppError } from "./errors.js";

export const EXPORT_SCHEMA_VERSION = "1.0.0";

export type LifecycleAction = "reset" | "delete";

// The word the player has to type back. Deliberately not the creature's name: a name can be
// autofilled or guessed from the screen, and the point of the gate is a deliberate keystroke.
const CONFIRMATION_PHRASES: Record<LifecycleAction, string> = { reset: "RESET", delete: "DELETE" };

export function assertConfirmation(action: LifecycleAction, confirmation: string): void {
  if (confirmation.trim() !== CONFIRMATION_PHRASES[action]) {
    throw new AppError("confirmation_mismatch", 400, `Type ${CONFIRMATION_PHRASES[action]} exactly to confirm. Nothing has been changed.`);
  }
}

// A one-way reference so lifecycle auditing survives the deletion it records without keeping a way
// back to the person. Never log or export the Telegram id itself alongside it.
export function subjectRef(telegramUserId: number | string | null): string {
  return createHmac("sha256", Buffer.from(config.APP_ENCRYPTION_KEY, "base64")).update(`account:${telegramUserId ?? "unknown"}`).digest("base64url").slice(0, 32);
}

async function recordLifecycleEvent(client: pg.PoolClient, eventType: "data_exported" | "creature_reset" | "account_deleted", telegramUserId: number | string | null, details: Record<string, unknown> = {}): Promise<void> {
  await client.query(`INSERT INTO account_lifecycle_events (event_type,subject_ref,details) VALUES ($1,$2,$3)`, [eventType, subjectRef(telegramUserId), JSON.stringify(details)]);
}

export interface AccountScope {
  playerId: string;
  telegramUserId: string | null;
  creatureIds: string[];
  botIds: string[];
}

/** Everything owned by one account, resolved once and reused by export, reset and deletion. */
export async function resolveAccountScope(client: pg.PoolClient, playerId: string, lockPlayer = false): Promise<AccountScope> {
  const player = await client.query(`SELECT id,telegram_user_id FROM players WHERE id=$1${lockPlayer ? " FOR UPDATE" : ""}`, [playerId]);
  if (!player.rowCount) throw new AppError("player_not_found", 404, "There is no Bloopy account here to work with.");
  const creatures = await client.query("SELECT id FROM creatures WHERE player_id=$1 AND kind='player' ORDER BY created_at", [playerId]);
  const creatureIds = creatures.rows.map((row) => String(row.id));
  const bots = creatureIds.length
    ? await client.query("SELECT bot_id FROM managed_bots WHERE creature_id = ANY($1::uuid[]) ORDER BY bot_id", [creatureIds])
    : { rows: [] as Array<{ bot_id: string }> };
  return {
    playerId,
    telegramUserId: player.rows[0].telegram_user_id === null ? null : String(player.rows[0].telegram_user_id),
    creatureIds,
    botIds: bots.rows.map((row) => String(row.bot_id))
  };
}

const iso = (value: unknown): string | null => (value ? new Date(value as string).toISOString() : null);

/**
 * A readable, deterministic snapshot of everything the player authored or accumulated.
 *
 * Secrets are excluded by construction rather than by filtering: every column is named explicitly,
 * so a future migration that adds a credential column cannot leak it into an export by default.
 */
export async function exportPlayerData(client: pg.PoolClient, playerId: string): Promise<Record<string, unknown>> {
  const scope = await resolveAccountScope(client, playerId);
  const ids = scope.creatureIds;
  const forCreatures = async (sql: string, params: unknown[] = []) => (ids.length ? (await client.query(sql, [ids, ...params])).rows : []);

  // Sequential by design: a PoolClient serves one query at a time, and an export is a cold path
  // where a stable, ordered read matters more than latency.
  const player = await client.query("SELECT id,telegram_user_id,display_name,locale,creature_generation,created_at,updated_at FROM players WHERE id=$1", [playerId]);
  const creatures = await forCreatures("SELECT id,slug,name,kind,personality,genome,level,xp,energy,stars,mood,current_location,created_at,updated_at FROM creatures WHERE id = ANY($1::uuid[]) ORDER BY created_at");
  const onboarding = await forCreatures("SELECT creature_id,status,wake_choice,visual_marker,started_at,completed_at FROM onboarding_states WHERE creature_id = ANY($1::uuid[]) ORDER BY creature_id");
  const choices = await forCreatures("SELECT creature_id,scene_id,choice_id,choice_payload,created_at FROM player_choices WHERE creature_id = ANY($1::uuid[]) ORDER BY created_at,scene_id");
  const arcs = await forCreatures("SELECT id,creature_id,arc_id,arc_version,status,current_beat,route,state,started_at,completed_at FROM story_arc_instances WHERE creature_id = ANY($1::uuid[]) ORDER BY started_at,arc_id");
  const arcChoices = await forCreatures("SELECT ac.instance_id,ac.beat_id,ac.choice_id,ac.result_beat,ac.choice_payload,ac.created_at FROM story_arc_choices ac JOIN story_arc_instances ai ON ai.id=ac.instance_id WHERE ai.creature_id = ANY($1::uuid[]) ORDER BY ac.created_at,ac.beat_id");
  const stories = await forCreatures("SELECT creature_id,title,body,choices,reward,beat_id,created_at FROM story_entries WHERE creature_id = ANY($1::uuid[]) ORDER BY created_at,title");
  const flags = await forCreatures("SELECT creature_id,flag_key,flag_value,created_at,updated_at FROM story_flags WHERE creature_id = ANY($1::uuid[]) ORDER BY creature_id,flag_key");
  const memories = await forCreatures("SELECT creature_id,tier,summary,source_type,privacy_level,canonical_status,importance,world_id,created_at,updated_at FROM memories WHERE creature_id = ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY created_at,summary");
  const quests = await forCreatures("SELECT qi.creature_id,qi.quest_id,q.title,qi.status,qi.progress,qi.created_at,qi.updated_at FROM quest_instances qi JOIN quests q ON q.id=qi.quest_id WHERE qi.creature_id = ANY($1::uuid[]) ORDER BY qi.created_at,qi.quest_id");
  const relationships = await forCreatures("SELECT r.source_creature_id,c.name AS target_name,c.kind AS target_kind,r.trust,r.affection,r.rivalry,r.last_event,r.updated_at FROM relationships r JOIN creatures c ON c.id=r.target_creature_id WHERE r.source_creature_id = ANY($1::uuid[]) ORDER BY c.name");
  const inventory = await forCreatures("SELECT l.creature_id,l.item_id,i.name,SUM(l.delta)::integer AS quantity FROM inventory_ledger l JOIN item_catalog i ON i.id=l.item_id WHERE l.creature_id = ANY($1::uuid[]) GROUP BY l.creature_id,l.item_id,i.name HAVING SUM(l.delta)>0 ORDER BY l.item_id");
  const dailyReturns = await forCreatures("SELECT creature_id,return_date,status,title,body,choice_id,result,created_at,completed_at FROM daily_return_instances WHERE creature_id = ANY($1::uuid[]) ORDER BY return_date");
  const personality = await forCreatures("SELECT creature_id,source_type,trait_deltas,mood_before,mood_after,explanation,created_at FROM personality_events WHERE creature_id = ANY($1::uuid[]) ORDER BY created_at");
  const notifications = await client.query("SELECT enabled,timezone,delivery_time,quiet_start,quiet_end,next_delivery_at,updated_at FROM notification_preferences WHERE player_id=$1", [playerId]);
  // Credential columns (encrypted_api_key, external_user_id) are intentionally never selected.
  const aiProfile = await client.query("SELECT source,base_url,model,enabled,connection_status,connected_at,last_verified_at,disconnected_at FROM ai_profiles WHERE player_id=$1", [playerId]);
  // Token cipher and webhook secret are intentionally never selected.
  const bots = await forCreatures("SELECT bot_id,username,enabled,access_policy,allow_bot_interactions,token_version,created_at,revoked_at FROM managed_bots WHERE creature_id = ANY($1::uuid[]) ORDER BY bot_id");
  const referralsGiven = await forCreatures("SELECT count(*)::int AS count FROM referrals WHERE referrer_creature_id = ANY($1::uuid[]) AND rewarded=true");
  const referredBy = await client.query("SELECT source,created_at FROM referrals WHERE referred_player_id=$1", [playerId]);
  const activity = await client.query("SELECT activity_date,open_count,first_open_at,last_open_at FROM player_daily_activity WHERE player_id=$1 ORDER BY activity_date", [playerId]);

  const account = player.rows[0];
  await recordLifecycleEvent(client, "data_exported", scope.telegramUserId, { creatures: ids.length });

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    notice: "This export contains your own Bloopy data. It never contains API keys, bot tokens, webhook secrets or Telegram sign-in data.",
    account: {
      telegramUserId: account.telegram_user_id === null ? null : String(account.telegram_user_id),
      displayName: account.display_name,
      locale: account.locale,
      creatureGeneration: Number(account.creature_generation),
      createdAt: iso(account.created_at),
      updatedAt: iso(account.updated_at)
    },
    creatures: creatures.map((row) => ({ ...row, id: String(row.id), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), created_at: undefined, updated_at: undefined })),
    onboarding,
    authoredChoices: choices,
    storyArcs: arcs,
    storyArcChoices: arcChoices,
    stories,
    storyFlags: flags,
    memories,
    quests,
    relationships,
    inventory,
    dailyReturns,
    personalityChanges: personality,
    notificationPreferences: notifications.rows[0] ?? null,
    aiConnection: aiProfile.rows[0] ?? null,
    managedBots: bots,
    referrals: { rewardedInvites: Number(referralsGiven[0]?.count ?? 0), referredBy: referredBy.rows[0] ?? null },
    dailyActivity: activity.rows
  };
}

/**
 * Removes everything scoped to the given creatures that the schema's cascades do not reach.
 *
 * Three tables key off a player or creature without a foreign key — game_events by aggregate_id,
 * telegram_updates by the raw Telegram payload, and the SET NULL analytics tables, which would keep
 * message text and slugs behind a null identifier. Each is swept explicitly.
 */
async function purgeUnlinkedData(client: pg.PoolClient, scope: AccountScope, creatureIds: string[]): Promise<void> {
  if (creatureIds.length) {
    await client.query("DELETE FROM game_events WHERE aggregate_id = ANY($1::uuid[])", [creatureIds]);
    await client.query("DELETE FROM analytics_events WHERE creature_id = ANY($1::uuid[])", [creatureIds]);
    await client.query("DELETE FROM ai_generation_logs WHERE creature_id = ANY($1::uuid[])", [creatureIds]);
    await client.query("DELETE FROM outbox WHERE creature_id = ANY($1::uuid[])", [creatureIds]);
  }
  if (scope.botIds.length) await client.query("DELETE FROM outbox WHERE bot_id = ANY($1::bigint[])", [scope.botIds]);
}

export interface CreatureResetResult { reset: boolean; revokedBotIds: string[] }

/**
 * Deletes the player-owned creature and every creature-scoped row, keeping the Telegram account.
 * The next `/api/bootstrap` adopts a fresh creature under a new generation slug, so links shared for
 * the old creature cannot silently resolve to the new one.
 */
export async function resetCreature(client: pg.PoolClient, playerId: string): Promise<CreatureResetResult> {
  const scope = await resolveAccountScope(client, playerId, true);
  if (!scope.creatureIds.length) return { reset: false, revokedBotIds: [] };
  await purgeUnlinkedData(client, scope, scope.creatureIds);
  await client.query("DELETE FROM creatures WHERE id = ANY($1::uuid[])", [scope.creatureIds]);
  // Referral rows survive as a tombstone on the player, so a reset cannot farm first-invite rewards.
  await client.query("UPDATE players SET creature_generation=creature_generation+1,updated_at=now() WHERE id=$1", [playerId]);
  await client.query("UPDATE notification_preferences SET next_delivery_at=NULL,updated_at=now() WHERE player_id=$1", [playerId]);
  await recordLifecycleEvent(client, "creature_reset", scope.telegramUserId, { creatures: scope.creatureIds.length, bots: scope.botIds.length });
  return { reset: true, revokedBotIds: scope.botIds };
}

export interface AccountDeletionResult { deleted: boolean; revokedBotIds: string[] }

/** Removes the account and everything attached to it, anonymizing what must be retained. */
export async function deleteAccount(client: pg.PoolClient, playerId: string): Promise<AccountDeletionResult> {
  const scope = await resolveAccountScope(client, playerId, true);
  await purgeUnlinkedData(client, scope, scope.creatureIds);
  await client.query("DELETE FROM analytics_events WHERE player_id=$1", [playerId]);
  await client.query("DELETE FROM ai_generation_logs WHERE player_id=$1", [playerId]);
  await client.query("DELETE FROM outbox WHERE player_id=$1", [playerId]);
  if (scope.telegramUserId !== null) {
    // Raw Telegram payloads carry the sender's profile and message text; queued work for the account
    // is cancelled rather than replayed at an address that no longer belongs to anyone.
    await client.query("DELETE FROM telegram_updates WHERE payload->'message'->'from'->>'id'=$1 OR payload->'managed_bot'->'user'->>'id'=$1", [scope.telegramUserId]);
    await client.query("DELETE FROM outbox WHERE chat_id=$1 AND status IN ('pending','retryable','uncertain','dead_letter','failed')", [scope.telegramUserId]);
    // Security events are kept for abuse investigation but lose the identifier that names a person.
    await client.query("UPDATE security_events SET telegram_user_id=NULL WHERE telegram_user_id=$1", [scope.telegramUserId]);
    await client.query("UPDATE managed_bot_access_rules SET telegram_user_id=NULL WHERE telegram_user_id=$1", [scope.telegramUserId]);
  }
  const deleted = await client.query("DELETE FROM players WHERE id=$1 RETURNING id", [playerId]);
  await recordLifecycleEvent(client, "account_deleted", scope.telegramUserId, { creatures: scope.creatureIds.length, bots: scope.botIds.length });
  return { deleted: Boolean(deleted.rowCount), revokedBotIds: scope.botIds };
}
