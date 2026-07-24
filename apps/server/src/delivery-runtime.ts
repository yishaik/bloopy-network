import { randomBytes } from "node:crypto";
import type pg from "pg";
import { config } from "./config.js";
import { open, seal } from "./crypto.js";
import { db, withTransaction } from "./db.js";
import { AppError } from "./errors.js";
import { botCall, configureManagedBot, handleManagedBotUpdate, handleManagerUpdate, type TelegramUpdate } from "./telegram.js";

export type RuntimeControlKey="telegram_ingress"|"outbox_delivery"|"risky_mutations";
interface TelegramJob{source:string;updateId:number;payload:TelegramUpdate;leaseToken:string;attempts:number}
interface OutboxJob{id:string;botId:number|null;chatId:string;payload:Record<string,unknown>;claimToken:string;attempts:number;playerId:string|null;creatureId:string|null;dailyReturnId:string|null;claimedAt:Date}

function errorText(error:unknown):string{return (error instanceof Error?error.message:"unknown error").slice(0,500)}
function backoffSeconds(attempts:number):number{return Math.min(1800,Math.max(5,15*2**Math.min(Math.max(0,attempts-1),6)))+Math.floor(Math.random()*10)}

export async function runtimeControlEnabled(client:pg.PoolClient,key:RuntimeControlKey):Promise<boolean>{
  const result=await client.query(`SELECT enabled FROM runtime_controls WHERE control_key=$1`,[key]);
  return result.rowCount?Boolean(result.rows[0].enabled):true;
}

export async function setRuntimeControl(client:pg.PoolClient,key:RuntimeControlKey,enabled:boolean,reason:string|null,updatedBy:string):Promise<void>{
  await client.query(`INSERT INTO runtime_controls (control_key,enabled,reason,updated_by) VALUES ($1,$2,$3,$4)
    ON CONFLICT (control_key) DO UPDATE SET enabled=EXCLUDED.enabled,reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,updated_at=now()`,[key,enabled,reason,updatedBy]);
  await client.query(`INSERT INTO operational_events (event_type,source_key,details) VALUES ('runtime_control_changed',$1,$2)`,[key,JSON.stringify({enabled,reason,updatedBy})]);
}

export async function enqueueTelegramUpdate(client:pg.PoolClient,source:string,update:TelegramUpdate):Promise<boolean>{
  const ingressEnabled=config.TELEGRAM_INGRESS_ENABLED&&await runtimeControlEnabled(client,"telegram_ingress");
  if(!ingressEnabled)return false;
  const inserted=await client.query(`INSERT INTO telegram_updates (source,update_id,payload,status,available_at,updated_at)
    VALUES ($1,$2,$3,'received',now(),now()) ON CONFLICT (source,update_id) DO NOTHING RETURNING update_id`,[source,update.update_id,JSON.stringify(update)]);
  return Boolean(inserted.rowCount);
}

async function claimTelegramUpdates():Promise<TelegramJob[]>{
  return withTransaction(async(client)=>{
    const claimed=await client.query(`WITH candidates AS (
      SELECT source,update_id FROM telegram_updates
      WHERE (status IN ('received','retryable') AND available_at<=now())
         OR (status='processing' AND lease_expires_at<=now())
      ORDER BY received_at FOR UPDATE SKIP LOCKED LIMIT $1
    )
    UPDATE telegram_updates t SET status='processing',attempts=t.attempts+1,lease_token=gen_random_uuid(),
      lease_expires_at=now()+($2||' seconds')::interval,last_error=NULL,updated_at=now()
    FROM candidates c WHERE t.source=c.source AND t.update_id=c.update_id
    RETURNING t.source,t.update_id,t.payload,t.lease_token,t.attempts`,[config.TELEGRAM_UPDATE_BATCH_SIZE,config.TELEGRAM_UPDATE_LEASE_SECONDS]);
    return claimed.rows.map((row)=>({source:String(row.source),updateId:Number(row.update_id),payload:row.payload as TelegramUpdate,leaseToken:String(row.lease_token),attempts:Number(row.attempts)}));
  });
}

async function finalizeTelegramUpdate(job:TelegramJob,error?:unknown):Promise<void>{
  await withTransaction(async(client)=>{
    if(!error){
      await client.query(`UPDATE telegram_updates SET status='completed',lease_token=NULL,lease_expires_at=NULL,completed_at=now(),updated_at=now()
        WHERE source=$1 AND update_id=$2 AND lease_token=$3`,[job.source,job.updateId,job.leaseToken]);
      return;
    }
    const permanent=error instanceof AppError&&error.httpStatus>=400&&error.httpStatus<500&&error.httpStatus!==409&&error.httpStatus!==429;
    const exhausted=job.attempts>=config.TELEGRAM_UPDATE_MAX_ATTEMPTS;
    const status=permanent||exhausted?"failed":"retryable";
    await client.query(`UPDATE telegram_updates SET status=$4,lease_token=NULL,lease_expires_at=NULL,last_error=$5,
      available_at=CASE WHEN $4='retryable' THEN now()+($6||' seconds')::interval ELSE available_at END,
      completed_at=CASE WHEN $4='failed' THEN now() ELSE completed_at END,updated_at=now()
      WHERE source=$1 AND update_id=$2 AND lease_token=$3`,[job.source,job.updateId,job.leaseToken,status,errorText(error),backoffSeconds(job.attempts)]);
    await client.query(`INSERT INTO operational_events (event_type,source_key,details) VALUES ('telegram_update_failed',$1,$2)`,[
      `${job.source}:${job.updateId}`,JSON.stringify({status,attempts:job.attempts,error:errorText(error)})
    ]);
  });
}

async function prepareManagedRegistration(update:NonNullable<TelegramUpdate["managed_bot"]>){
  return withTransaction(async(client)=>{
    if(!config.MANAGED_BOT_FLEET_ENABLED)throw new AppError("managed_fleet_disabled",409,"Managed creature bots are paused right now.");
    const player=(await client.query(`SELECT id FROM players WHERE telegram_user_id=$1`,[update.user.id])).rows[0];
    if(!player)throw new AppError("managed_owner_missing",409,"Open Bloopy and create your creature before attaching a managed bot.");
    const creature=(await client.query(`SELECT c.id FROM creatures c JOIN onboarding_states os ON os.creature_id=c.id AND os.status='complete'
      WHERE c.player_id=$1 AND c.kind='player' LIMIT 1`,[player.id])).rows[0];
    if(!creature)throw new AppError("managed_creature_incomplete",409,"Finish creating the creature before giving it a bot.");
    return {playerId:String(player.id),creatureId:String(creature.id)};
  });
}

async function processManagedRegistration(update:NonNullable<TelegramUpdate["managed_bot"]>):Promise<void>{
  if(!config.TELEGRAM_MANAGER_BOT_TOKEN)throw new AppError("manager_bot_token_missing",503,"Managed bot setup is temporarily unavailable.");
  const prepared=await prepareManagedRegistration(update);
  const token=await botCall<string>(config.TELEGRAM_MANAGER_BOT_TOKEN,"getManagedBotToken",{user_id:update.bot.id});
  const webhookSecret=randomBytes(24).toString("base64url");
  await withTransaction(async(client)=>{
    await client.query(`INSERT INTO managed_bots (bot_id,owner_telegram_user_id,creature_id,username,token_cipher,webhook_secret,enabled,revoked_at)
      VALUES ($1,$2,$3,$4,$5,$6,true,NULL)
      ON CONFLICT (bot_id) DO UPDATE SET owner_telegram_user_id=EXCLUDED.owner_telegram_user_id,creature_id=EXCLUDED.creature_id,
        username=EXCLUDED.username,token_cipher=EXCLUDED.token_cipher,webhook_secret=EXCLUDED.webhook_secret,enabled=true,revoked_at=NULL,updated_at=now()`,[
        update.bot.id,update.user.id,prepared.creatureId,update.bot.username??null,seal(token),webhookSecret
      ]);
  });
  await configureManagedBot(token,update.bot.id,webhookSecret);
  await withTransaction(async(client)=>{
    await client.query(`UPDATE managed_bots SET last_webhook_at=now(),updated_at=now() WHERE bot_id=$1`,[update.bot.id]);
    await client.query(`INSERT INTO outbox (bot_id,chat_id,payload,source_key,player_id,creature_id) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING`,[
      update.bot.id,String(update.user.id),JSON.stringify({method:"sendMessage",text:"I have my own room in Telegram now. Only you can control it in private chat unless you explicitly approve another chat."}),
      `managed-bot-welcome:${update.bot.id}`,prepared.playerId,prepared.creatureId
    ]);
  });
}

async function processTelegramJob(job:TelegramJob):Promise<void>{
  if(job.source==="manager"){
    if(job.payload.managed_bot){await processManagedRegistration(job.payload.managed_bot);return;}
    await withTransaction((client)=>handleManagerUpdate(client,job.payload));return;
  }
  const match=job.source.match(/^managed:(\d+)$/);
  if(!match)throw new AppError("telegram_source_invalid",400,"Unknown Telegram update source.");
  await withTransaction((client)=>handleManagedBotUpdate(client,Number(match[1]),job.payload));
}

export async function processTelegramIngressBatch():Promise<number>{
  const jobs=await claimTelegramUpdates();
  for(const job of jobs){
    try{await processTelegramJob(job);await finalizeTelegramUpdate(job);}
    catch(error){await finalizeTelegramUpdate(job,error);}
  }
  return jobs.length;
}

function outboxRow(row:Record<string,unknown>):OutboxJob{return {
  id:String(row.id),botId:row.bot_id===null?null:Number(row.bot_id),chatId:String(row.chat_id),payload:row.payload as Record<string,unknown>,
  claimToken:String(row.claim_token),attempts:Number(row.attempts),playerId:row.player_id?String(row.player_id):null,
  creatureId:row.creature_id?String(row.creature_id):null,dailyReturnId:row.daily_return_id?String(row.daily_return_id):null,claimedAt:new Date(String(row.claimed_at))
}}

export async function recoverExpiredLeases():Promise<{updates:number;outbox:number}>{
  return withTransaction(async(client)=>{
    const updates=await client.query(`UPDATE telegram_updates SET status='retryable',lease_token=NULL,lease_expires_at=NULL,
      available_at=now(),last_error=COALESCE(last_error,'processing lease expired'),updated_at=now()
      WHERE status='processing' AND lease_expires_at<=now() RETURNING update_id`);
    const outbox=await client.query(`UPDATE outbox SET status='uncertain',claim_token=NULL,lease_expires_at=NULL,
      error_class='lease_expired_after_dispatch',last_error=COALESCE(last_error,'delivery lease expired after claim')
      WHERE status='sending' AND lease_expires_at<=now() RETURNING id`);
    if(outbox.rowCount)await client.query(`INSERT INTO operational_events (event_type,details) VALUES ('outbox_uncertain_recovered',$1)`,[JSON.stringify({count:outbox.rowCount})]);
    return {updates:updates.rowCount??0,outbox:outbox.rowCount??0};
  });
}

async function claimOutbox():Promise<OutboxJob[]>{
  return withTransaction(async(client)=>{
    if(!config.OUTBOX_ENABLED||!config.TELEGRAM_MANAGER_BOT_TOKEN||!await runtimeControlEnabled(client,"outbox_delivery"))return [];
    const result=await client.query(`WITH candidates AS (
      SELECT id FROM outbox WHERE status IN ('pending','retryable') AND available_at<=now()
      ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT $1
    )
    UPDATE outbox o SET status='sending',attempts=o.attempts+1,claim_token=gen_random_uuid(),claimed_at=now(),last_attempt_at=now(),
      lease_expires_at=now()+($2||' seconds')::interval,last_error=NULL,error_class=NULL
    FROM candidates c WHERE o.id=c.id RETURNING o.*`,[config.OUTBOX_BATCH_SIZE,config.OUTBOX_LEASE_SECONDS]);
    return result.rows.map(outboxRow);
  });
}

function classifyDeliveryError(error:unknown,attempts:number):{status:"retryable"|"uncertain"|"dead_letter";errorClass:string;delaySeconds:number}{
  const typed=error as {status?:number;retryAfter?:number;name?:string};
  const status=typed.status;
  if(status===429)return {status:"retryable",errorClass:"telegram_rate_limit",delaySeconds:Math.max(1,typed.retryAfter??backoffSeconds(attempts))};
  if(typeof status==="number"&&[400,401,403,404].includes(status))return {status:"dead_letter",errorClass:`telegram_${status}`,delaySeconds:0};
  if(typeof status==="number"&&status>=500)return attempts>=config.OUTBOX_MAX_ATTEMPTS?{status:"dead_letter",errorClass:"telegram_5xx_exhausted",delaySeconds:0}:{status:"retryable",errorClass:"telegram_5xx",delaySeconds:backoffSeconds(attempts)};
  if(typed.name==="AbortError"||typed.name==="TimeoutError"||error instanceof TypeError)return {status:"uncertain",errorClass:"network_result_unknown",delaySeconds:0};
  return attempts>=config.OUTBOX_MAX_ATTEMPTS?{status:"dead_letter",errorClass:"retry_exhausted",delaySeconds:0}:{status:"retryable",errorClass:"delivery_error",delaySeconds:backoffSeconds(attempts)};
}

async function deliveryToken(job:OutboxJob):Promise<string>{
  if(!job.botId){if(!config.TELEGRAM_MANAGER_BOT_TOKEN)throw new AppError("manager_bot_token_missing",503,"Telegram delivery is unavailable.");return config.TELEGRAM_MANAGER_BOT_TOKEN;}
  const managed=await db.query(`SELECT token_cipher FROM managed_bots WHERE bot_id=$1 AND enabled=true AND revoked_at IS NULL`,[job.botId]);
  if(!managed.rowCount){const error=new Error("managed bot is disabled or revoked") as Error&{status:number};error.status=403;throw error;}
  return open(String(managed.rows[0].token_cipher));
}

async function finalizeOutboxSuccess(job:OutboxJob,result:{message_id?:number},latencyMs:number):Promise<void>{
  await withTransaction(async(client)=>{
    const updated=await client.query(`UPDATE outbox SET status='sent',claim_token=NULL,lease_expires_at=NULL,sent_at=COALESCE(sent_at,now()),
      completed_at=now(),telegram_message_id=$4,delivery_latency_ms=$5,last_error=NULL,error_class=NULL
      WHERE id=$1 AND status='sending' AND claim_token=$2 RETURNING daily_return_id`,[job.id,job.claimToken,null,result.message_id??null,latencyMs]);
    if(!updated.rowCount)return;
    if(job.botId)await client.query(`UPDATE managed_bots SET last_outbound_at=now(),updated_at=now() WHERE bot_id=$1`,[job.botId]);
    if(job.dailyReturnId){
      await client.query(`UPDATE daily_return_instances SET notification_sent_at=COALESCE(notification_sent_at,now()),updated_at=now() WHERE id=$1`,[job.dailyReturnId]);
      if(job.playerId&&job.creatureId)await client.query(`INSERT INTO analytics_events (player_id,creature_id,event_name,properties) VALUES ($1,$2,'daily_return_notification_delivered',$3)`,[job.playerId,job.creatureId,JSON.stringify({dailyReturnId:job.dailyReturnId,messageId:result.message_id??null})]);
    }
  });
}

async function finalizeOutboxFailure(job:OutboxJob,error:unknown,latencyMs:number):Promise<void>{
  const classification=classifyDeliveryError(error,job.attempts);
  await withTransaction(async(client)=>{
    await client.query(`UPDATE outbox SET status=$4,claim_token=NULL,lease_expires_at=NULL,last_error=$5,error_class=$6,delivery_latency_ms=$7,
      available_at=CASE WHEN $4='retryable' THEN now()+($8||' seconds')::interval ELSE available_at END,
      completed_at=CASE WHEN $4 IN ('uncertain','dead_letter') THEN now() ELSE completed_at END
      WHERE id=$1 AND status='sending' AND claim_token=$2`,[job.id,job.claimToken,null,classification.status,errorText(error),classification.errorClass,latencyMs,classification.delaySeconds]);
    await client.query(`INSERT INTO operational_events (event_type,source_key,details) VALUES ('outbox_delivery_failed',$1,$2)`,[job.id,JSON.stringify({status:classification.status,errorClass:classification.errorClass,attempts:job.attempts,latencyMs})]);
  });
}

export async function processOutboxBatch():Promise<number>{
  const jobs=await claimOutbox();
  for(const job of jobs){
    const started=Date.now();
    try{
      const token=await deliveryToken(job);const payload=job.payload as Record<string,unknown>&{method?:string};const {method,...body}=payload;
      const result=await botCall<{message_id?:number}>(token,method??"sendMessage",{chat_id:job.chatId,...body});
      await finalizeOutboxSuccess(job,result,Date.now()-started);
    }catch(error){await finalizeOutboxFailure(job,error,Date.now()-started);}
  }
  return jobs.length;
}

export async function listProblemDeliveries(client:pg.PoolClient,limit=100){
  const result=await client.query(`SELECT id,bot_id,chat_id,status,attempts,available_at,last_error,error_class,last_attempt_at,completed_at,created_at
    FROM outbox WHERE status IN ('retryable','uncertain','dead_letter','failed') ORDER BY created_at DESC LIMIT $1`,[Math.max(1,Math.min(limit,500))]);
  return result.rows;
}

export async function replayOutboxItem(client:pg.PoolClient,id:string,operator:string):Promise<boolean>{
  const updated=await client.query(`UPDATE outbox SET status='pending',attempts=0,available_at=now(),claim_token=NULL,lease_expires_at=NULL,
    completed_at=NULL,last_error=NULL,error_class=NULL WHERE id=$1 AND status IN ('uncertain','dead_letter','failed') RETURNING id`,[id]);
  if(updated.rowCount)await client.query(`INSERT INTO operational_events (event_type,source_key,details) VALUES ('outbox_manual_replay',$1,$2)`,[id,JSON.stringify({operator})]);
  return Boolean(updated.rowCount);
}

export async function readinessSnapshot(client:pg.PoolClient){
  const [migration,updates,outbox,controls]=await Promise.all([
    client.query(`SELECT 1 FROM schema_migrations WHERE filename='019_telegram_delivery_runtime.sql'`),
    client.query(`SELECT count(*)::int AS count,COALESCE(EXTRACT(EPOCH FROM (now()-min(received_at)))::int,0) AS oldest_seconds FROM telegram_updates WHERE status IN ('received','retryable','processing')`),
    client.query(`SELECT count(*)::int AS count,COALESCE(EXTRACT(EPOCH FROM (now()-min(created_at)))::int,0) AS oldest_seconds FROM outbox WHERE status IN ('pending','retryable','sending')`),
    client.query(`SELECT control_key,enabled,reason FROM runtime_controls ORDER BY control_key`)
  ]);
  const updateCount=Number(updates.rows[0]?.count??0);const outboxCount=Number(outbox.rows[0]?.count??0);
  const ready=Boolean(migration.rowCount)&&updateCount<=config.READY_MAX_UPDATE_BACKLOG&&outboxCount<=config.READY_MAX_OUTBOX_BACKLOG;
  return {ready,degraded:config.DEGRADED_MODE||!controls.rows.find((row)=>row.control_key==="risky_mutations")?.enabled,
    migrationsReady:Boolean(migration.rowCount),updates:{count:updateCount,oldestSeconds:Number(updates.rows[0]?.oldest_seconds??0)},
    outbox:{count:outboxCount,oldestSeconds:Number(outbox.rows[0]?.oldest_seconds??0)},controls:controls.rows};
}

export async function mutationsAllowed(client:pg.PoolClient):Promise<boolean>{return !config.DEGRADED_MODE&&await runtimeControlEnabled(client,"risky_mutations")}
