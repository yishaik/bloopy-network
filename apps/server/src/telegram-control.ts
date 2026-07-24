import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { config } from "./config.js";
import { AppError } from "./errors.js";

export type ManagedChatType="private"|"group"|"supergroup";

export interface ManagedBotRegistry {
  botId:number;
  ownerTelegramUserId:number;
  creatureId:string;
  username:string|null;
  tokenCipher:string;
  webhookSecret:string;
  creatureName:string;
  personality:Record<string,unknown>;
  allowBotInteractions:boolean;
}

export interface BotInteractionEnvelope {
  interactionId:string;
  turn:number;
  signature:string;
}

function registryView(row:Record<string,unknown>):ManagedBotRegistry {
  return {
    botId:Number(row.bot_id),
    ownerTelegramUserId:Number(row.owner_telegram_user_id),
    creatureId:String(row.creature_id),
    username:row.username?String(row.username):null,
    tokenCipher:String(row.token_cipher),
    webhookSecret:String(row.webhook_secret),
    creatureName:String(row.creature_name),
    personality:(row.personality??{}) as Record<string,unknown>,
    allowBotInteractions:Boolean(row.allow_bot_interactions)
  };
}

function interactionSecret():Buffer {
  return Buffer.from(config.APP_ENCRYPTION_KEY,"base64");
}

function signValue(value:string):string {
  return createHmac("sha256",interactionSecret()).update(value).digest("base64url");
}

function safeEqual(left:string,right:string):boolean {
  const a=Buffer.from(left);
  const b=Buffer.from(right);
  return a.length===b.length&&timingSafeEqual(a,b);
}

export function signBotInteractionTurn(interactionId:string,turn:number,senderBotId:number,receiverBotId:number):string {
  return signValue(`${interactionId}:${turn}:${senderBotId}:${receiverBotId}`);
}

export function formatBotInteractionEnvelope(interactionId:string,turn:number,senderBotId:number,receiverBotId:number):string {
  return `/bloopy_story ${interactionId} ${turn} ${signBotInteractionTurn(interactionId,turn,senderBotId,receiverBotId)}`;
}

export function parseBotInteractionEnvelope(text:string):BotInteractionEnvelope|null {
  const match=text.trim().match(/^\/bloopy_story\s+([0-9a-f-]{36})\s+(\d{1,2})\s+([A-Za-z0-9_-]{40,60})$/i);
  if(!match)return null;
  const turn=Number(match[2]);
  if(!Number.isInteger(turn)||turn<0||turn>8)return null;
  return {interactionId:String(match[1]).toLowerCase(),turn,signature:String(match[3])};
}

async function recordSecurityEvent(client:pg.PoolClient,eventType:string,input:{botId?:number;telegramUserId?:number;chatId?:number;details?:Record<string,unknown>}):Promise<void> {
  await client.query(`INSERT INTO security_events (event_type,bot_id,telegram_user_id,chat_id,details) VALUES ($1,$2,$3,$4,$5)`,[
    eventType,input.botId??null,input.telegramUserId??null,input.chatId??null,JSON.stringify(input.details??{})
  ]);
}

export async function loadManagedBot(client:pg.PoolClient,botId:number,forUpdate=false):Promise<ManagedBotRegistry|null> {
  const result=await client.query(`SELECT mb.*,c.name AS creature_name,c.personality
    FROM managed_bots mb JOIN creatures c ON c.id=mb.creature_id
    WHERE mb.bot_id=$1 AND mb.enabled=true AND mb.revoked_at IS NULL${forUpdate?" FOR UPDATE OF mb":""}`,[botId]);
  return result.rows[0]?registryView(result.rows[0]):null;
}

export async function authorizeManagedHuman(client:pg.PoolClient,input:{botId:number;telegramUserId:number;chatId:number;chatType:string}):Promise<ManagedBotRegistry|null> {
  if(!config.MANAGED_BOT_FLEET_ENABLED) {
    await recordSecurityEvent(client,"managed_fleet_disabled",{botId:input.botId,telegramUserId:input.telegramUserId,chatId:input.chatId});
    return null;
  }
  const bot=await loadManagedBot(client,input.botId);
  if(!bot)return null;
  const chatType=(input.chatType==="group"||input.chatType==="supergroup"?input.chatType:"private") as ManagedChatType;
  const ownerPrivate=chatType==="private"&&input.telegramUserId===bot.ownerTelegramUserId&&input.chatId===input.telegramUserId;
  if(ownerPrivate)return bot;
  const allowed=await client.query(`SELECT 1 FROM managed_bot_access_rules
    WHERE bot_id=$1 AND chat_id=$2 AND enabled=true
      AND (telegram_user_id IS NULL OR telegram_user_id=$3)
      AND chat_type=$4 LIMIT 1`,[input.botId,input.chatId,input.telegramUserId,chatType]);
  if(allowed.rowCount)return bot;
  await recordSecurityEvent(client,"managed_bot_access_rejected",{
    botId:input.botId,telegramUserId:input.telegramUserId,chatId:input.chatId,
    details:{chatType,ownerMatch:input.telegramUserId===bot.ownerTelegramUserId}
  });
  return null;
}

async function ownedBot(client:pg.PoolClient,ownerTelegramUserId:number,botId:number,forUpdate=false):Promise<ManagedBotRegistry> {
  const bot=await loadManagedBot(client,botId,forUpdate);
  if(!bot||bot.ownerTelegramUserId!==ownerTelegramUserId)throw new AppError("managed_bot_not_owned",404,"That managed bot is not attached to your creature.");
  return bot;
}

export async function listOwnedManagedBots(client:pg.PoolClient,ownerTelegramUserId:number) {
  const result=await client.query(`SELECT mb.bot_id,mb.username,mb.enabled,mb.access_policy,mb.allow_bot_interactions,mb.token_version,
      mb.last_webhook_at,mb.last_outbound_at,mb.last_token_rotated_at,mb.revoked_at,c.name AS creature_name,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'chatId',r.chat_id,'telegramUserId',r.telegram_user_id,'chatType',r.chat_type,'enabled',r.enabled) ORDER BY r.created_at) FROM managed_bot_access_rules r WHERE r.bot_id=mb.bot_id),'[]'::jsonb) AS rules
    FROM managed_bots mb JOIN creatures c ON c.id=mb.creature_id
    WHERE mb.owner_telegram_user_id=$1 ORDER BY mb.created_at DESC`,[ownerTelegramUserId]);
  return result.rows.map((row)=>({
    botId:Number(row.bot_id),username:row.username?String(row.username):null,enabled:Boolean(row.enabled),creatureName:String(row.creature_name),
    accessPolicy:String(row.access_policy),allowBotInteractions:Boolean(row.allow_bot_interactions),tokenVersion:Number(row.token_version),
    lastWebhookAt:row.last_webhook_at?new Date(row.last_webhook_at).toISOString():null,
    lastOutboundAt:row.last_outbound_at?new Date(row.last_outbound_at).toISOString():null,
    lastTokenRotatedAt:row.last_token_rotated_at?new Date(row.last_token_rotated_at).toISOString():null,
    revokedAt:row.revoked_at?new Date(row.revoked_at).toISOString():null,rules:row.rules??[]
  }));
}

export async function setManagedBotInteractionConsent(client:pg.PoolClient,ownerTelegramUserId:number,botId:number,enabled:boolean):Promise<void> {
  await ownedBot(client,ownerTelegramUserId,botId,true);
  await client.query(`UPDATE managed_bots SET allow_bot_interactions=$2,updated_at=now() WHERE bot_id=$1`,[botId,enabled]);
  await client.query(`INSERT INTO analytics_events (event_name,properties) VALUES ('managed_bot_interaction_consent',$1)`,[JSON.stringify({botId,enabled})]);
}

export async function upsertManagedBotAccessRule(client:pg.PoolClient,ownerTelegramUserId:number,input:{botId:number;chatId:number;telegramUserId?:number;chatType:ManagedChatType;enabled:boolean}) {
  await ownedBot(client,ownerTelegramUserId,input.botId,true);
  if(input.chatType==="private"&&!input.telegramUserId)throw new AppError("private_rule_requires_user",400,"A private-chat rule needs the Telegram user ID it belongs to.");
  const result=await client.query(`INSERT INTO managed_bot_access_rules (bot_id,chat_id,telegram_user_id,chat_type,enabled,created_by_owner_telegram_user_id)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (bot_id,chat_id,telegram_user_id) DO UPDATE SET chat_type=EXCLUDED.chat_type,enabled=EXCLUDED.enabled,updated_at=now()
    RETURNING id,bot_id,chat_id,telegram_user_id,chat_type,enabled`,[
      input.botId,input.chatId,input.telegramUserId??null,input.chatType,input.enabled,ownerTelegramUserId
    ]);
  await client.query(`UPDATE managed_bots SET access_policy='allowlist',updated_at=now() WHERE bot_id=$1`,[input.botId]);
  return result.rows[0];
}

export async function prepareManagedBotOperation(client:pg.PoolClient,ownerTelegramUserId:number,botId:number):Promise<ManagedBotRegistry> {
  return ownedBot(client,ownerTelegramUserId,botId,true);
}

export async function finalizeManagedBotRotation(client:pg.PoolClient,ownerTelegramUserId:number,botId:number,tokenCipher:string,webhookSecret:string):Promise<void> {
  await ownedBot(client,ownerTelegramUserId,botId,true);
  await client.query(`UPDATE managed_bots SET token_cipher=$3,webhook_secret=$4,token_version=token_version+1,last_token_rotated_at=now(),enabled=true,revoked_at=NULL,updated_at=now() WHERE bot_id=$1 AND owner_telegram_user_id=$2`,[
    botId,ownerTelegramUserId,tokenCipher,webhookSecret
  ]);
  await client.query(`INSERT INTO security_events (event_type,bot_id,telegram_user_id,details) VALUES ('managed_bot_token_rotated',$1,$2,$3)`,[botId,ownerTelegramUserId,JSON.stringify({})]);
}

export async function finalizeManagedBotRevocation(client:pg.PoolClient,ownerTelegramUserId:number,botId:number):Promise<void> {
  await ownedBot(client,ownerTelegramUserId,botId,true);
  await client.query(`UPDATE managed_bots SET enabled=false,allow_bot_interactions=false,revoked_at=now(),updated_at=now() WHERE bot_id=$1 AND owner_telegram_user_id=$2`,[botId,ownerTelegramUserId]);
  await client.query(`UPDATE bot_interactions SET state='cancelled',termination_reason='bot_revoked',completed_at=now(),updated_at=now() WHERE state='active' AND (source_bot_id=$1 OR target_bot_id=$1)`,[botId]);
  await client.query(`INSERT INTO security_events (event_type,bot_id,telegram_user_id,details) VALUES ('managed_bot_revoked',$1,$2,$3)`,[botId,ownerTelegramUserId,JSON.stringify({})]);
}

function interactionText(creatureName:string,turn:number):string {
  const lines=[
    `${creatureName}: I found a door under a teaspoon. It is humming in a very administrative way.`,
    `${creatureName}: I checked the teaspoon. It has no permit, but it does have excellent posture.`,
    `${creatureName}: We should leave one polite note and retreat before the furniture chooses sides.`,
    `${creatureName}: Agreed. I am recording this as a successful diplomatic encounter.`
  ];
  return lines[Math.min(turn,lines.length-1)] as string;
}

export async function createBotInteraction(client:pg.PoolClient,input:{sourceBotId:number;targetUsername:string}):Promise<{interactionId:string}> {
  if(!config.BOT_TO_BOT_ENABLED)throw new AppError("bot_interactions_disabled",409,"Creature-to-creature bot meetings are paused right now.");
  const source=await loadManagedBot(client,input.sourceBotId,true);
  const normalized=input.targetUsername.replace(/^@/,"").toLowerCase();
  const targetResult=await client.query(`SELECT mb.*,c.name AS creature_name,c.personality FROM managed_bots mb JOIN creatures c ON c.id=mb.creature_id
    WHERE lower(mb.username)=lower($1) AND mb.enabled=true AND mb.revoked_at IS NULL FOR UPDATE OF mb`,[normalized]);
  const target=targetResult.rows[0]?registryView(targetResult.rows[0]):null;
  if(!source||!target)throw new AppError("managed_bot_not_found",404,"Both creatures need an active managed bot before they can meet this way.");
  if(source.botId===target.botId)throw new AppError("bot_cannot_meet_itself",400,"A creature cannot start a bot meeting with itself.");
  if(!source.allowBotInteractions||!target.allowBotInteractions)throw new AppError("bot_interaction_consent_required",409,"Both creature owners must enable bot-to-bot meetings first.");
  const pairBudget=await client.query(`SELECT count(*)::int AS count FROM bot_interactions WHERE created_at>now()-interval '1 hour' AND ((source_bot_id=$1 AND target_bot_id=$2) OR (source_bot_id=$2 AND target_bot_id=$1))`,[source.botId,target.botId]);
  if(Number(pairBudget.rows[0]?.count)>=config.BOT_INTERACTION_PAIR_HOURLY_LIMIT)throw new AppError("bot_pair_budget_exhausted",429,"Those two creatures have talked enough for this hour.");
  const ownerBudget=await client.query(`SELECT count(*)::int AS count FROM bot_interactions WHERE created_at>now()-interval '24 hours' AND source_owner_telegram_user_id=$1`,[source.ownerTelegramUserId]);
  if(Number(ownerBudget.rows[0]?.count)>=config.BOT_INTERACTION_OWNER_DAILY_LIMIT)throw new AppError("bot_owner_budget_exhausted",429,"Your creature has reached its bot-meeting limit for today.");
  const inserted=await client.query(`INSERT INTO bot_interactions (source_bot_id,target_bot_id,source_owner_telegram_user_id,target_owner_telegram_user_id,source_username,target_username,max_turns,expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,now()+($8||' seconds')::interval) RETURNING id`,[
      source.botId,target.botId,source.ownerTelegramUserId,target.ownerTelegramUserId,source.username??String(source.botId),target.username??String(target.botId),config.BOT_INTERACTION_MAX_TURNS,config.BOT_INTERACTION_TTL_SECONDS
    ]);
  const interactionId=String(inserted.rows[0].id);
  const envelope=formatBotInteractionEnvelope(interactionId,0,source.botId,target.botId);
  await client.query(`INSERT INTO outbox (bot_id,chat_id,payload,source_key) VALUES ($1,$2,$3,$4) ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING`,[
    source.botId,`@${target.username}`,JSON.stringify({method:"sendMessage",text:`${interactionText(source.creatureName,0)}\n\n${envelope}`}),`bot-interaction:${interactionId}:0`
  ]);
  return {interactionId};
}

export async function processBotInteractionTurn(client:pg.PoolClient,input:{receiverBotId:number;senderBotId:number;senderUsername?:string;text:string}):Promise<{accepted:boolean;completed:boolean}> {
  const envelope=parseBotInteractionEnvelope(input.text);
  if(!envelope) {
    if(input.text.trim().startsWith("/bloopy_story"))await recordSecurityEvent(client,"bot_interaction_invalid_envelope",{botId:input.receiverBotId,details:{senderBotId:input.senderBotId}});
    return {accepted:false,completed:false};
  }
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[envelope.interactionId]);
  const result=await client.query(`SELECT bi.*,source.name AS source_name,target.name AS target_name
    FROM bot_interactions bi
    JOIN managed_bots source_bot ON source_bot.bot_id=bi.source_bot_id
    JOIN creatures source ON source.id=source_bot.creature_id
    JOIN managed_bots target_bot ON target_bot.bot_id=bi.target_bot_id
    JOIN creatures target ON target.id=target_bot.creature_id
    WHERE bi.id=$1 FOR UPDATE OF bi`,[envelope.interactionId]);
  const interaction=result.rows[0];
  if(!interaction) {
    await recordSecurityEvent(client,"bot_interaction_unknown",{botId:input.receiverBotId,details:{senderBotId:input.senderBotId}});
    return {accepted:false,completed:false};
  }
  if(!config.BOT_TO_BOT_ENABLED||interaction.state!=="active")return {accepted:false,completed:interaction.state==="completed"};
  if(new Date(interaction.expires_at).getTime()<=Date.now()) {
    await client.query(`UPDATE bot_interactions SET state='expired',termination_reason='ttl',completed_at=now(),updated_at=now() WHERE id=$1`,[interaction.id]);
    return {accepted:false,completed:true};
  }
  const turn=Number(interaction.turn_count);
  const expectedSender=turn%2===0?Number(interaction.source_bot_id):Number(interaction.target_bot_id);
  const expectedReceiver=turn%2===0?Number(interaction.target_bot_id):Number(interaction.source_bot_id);
  const expectedSignature=signBotInteractionTurn(String(interaction.id),turn,expectedSender,expectedReceiver);
  if(envelope.turn!==turn||input.senderBotId!==expectedSender||input.receiverBotId!==expectedReceiver||!safeEqual(envelope.signature,expectedSignature)) {
    await recordSecurityEvent(client,"bot_interaction_auth_rejected",{botId:input.receiverBotId,details:{senderBotId:input.senderBotId,interactionId:envelope.interactionId,turn:envelope.turn}});
    return {accepted:false,completed:false};
  }
  const digest=createHash("sha256").update(input.text).digest("hex");
  const dedupeKey=`${interaction.id}:${turn}:${expectedSender}`;
  const inserted=await client.query(`INSERT INTO bot_interaction_turns (interaction_id,turn_index,sender_bot_id,receiver_bot_id,dedupe_key,message_digest)
    VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,[interaction.id,turn,expectedSender,expectedReceiver,dedupeKey,digest]);
  if(!inserted.rowCount)return {accepted:true,completed:false};
  const nextTurn=turn+1;
  if(nextTurn>=Number(interaction.max_turns)) {
    await client.query(`UPDATE bot_interactions SET turn_count=$2,state='completed',termination_reason='turn_budget',completed_at=now(),updated_at=now() WHERE id=$1`,[interaction.id,nextTurn]);
    return {accepted:true,completed:true};
  }
  await client.query(`UPDATE bot_interactions SET turn_count=$2,updated_at=now() WHERE id=$1`,[interaction.id,nextTurn]);
  const replySender=input.receiverBotId;
  const replyReceiver=input.senderBotId;
  const replyName=turn%2===0?String(interaction.target_name):String(interaction.source_name);
  const replyUsername=turn%2===0?String(interaction.source_username):String(interaction.target_username);
  const nextEnvelope=formatBotInteractionEnvelope(String(interaction.id),nextTurn,replySender,replyReceiver);
  await client.query(`INSERT INTO outbox (bot_id,chat_id,payload,source_key) VALUES ($1,$2,$3,$4) ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING`,[
    replySender,`@${replyUsername}`,JSON.stringify({method:"sendMessage",text:`${interactionText(replyName,nextTurn)}\n\n${nextEnvelope}`}),`bot-interaction:${interaction.id}:${nextTurn}`
  ]);
  return {accepted:true,completed:false};
}
