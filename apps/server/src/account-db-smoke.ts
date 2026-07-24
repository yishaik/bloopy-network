import { randomUUID } from "node:crypto";
import { assertConfirmation, deleteAccount, exportPlayerData, resetCreature, subjectRef } from "./account.js";
import { seal } from "./crypto.js";
import { db } from "./db.js";
import { AppError } from "./errors.js";
import { attributeReferral, rewardPendingReferral } from "./share.js";

function assert(condition:unknown,message:string):asserts condition{if(!condition)throw new Error(message)}

const personality=JSON.stringify({archetype:"gentle_explorer",voice:"earnest_whimsy",curiosity:0.72,courage:0.48,empathy:0.67,mischief:0.49,sociability:0.62});
const genome=JSON.stringify({body:"round",primary:"#aaaaaa",secondary:"#bbbbbb",eyes:"wide",mark:"moon",accessory:"leaf",evolution:1});

/** Every table that holds player- or creature-scoped rows, with the column that names the owner. */
const CREATURE_SCOPED=["onboarding_states","story_flags","player_choices","story_entries","memories","quest_instances","world_events","inventory_ledger","story_arc_instances","daily_return_instances","personality_events","memory_audit_events","managed_bots"] as const;
const PLAYER_SCOPED=["ai_profiles","ai_daily_usage","notification_preferences","player_daily_activity","openrouter_oauth_states"] as const;

async function countLeftovers(client:import("pg").PoolClient,creatureIds:string[],playerId:string):Promise<string[]>{
  const leftovers:string[]=[];
  for(const table of CREATURE_SCOPED){
    const result=await client.query(`SELECT count(*)::int AS count FROM ${table} WHERE creature_id = ANY($1::uuid[])`,[creatureIds]);
    if(Number(result.rows[0].count)>0)leftovers.push(`${table}(creature)`);
  }
  for(const table of PLAYER_SCOPED){
    const result=await client.query(`SELECT count(*)::int AS count FROM ${table} WHERE player_id=$1`,[playerId]);
    if(Number(result.rows[0].count)>0)leftovers.push(`${table}(player)`);
  }
  for(const [table,column] of [["relationships","source_creature_id"],["relationships","target_creature_id"],["game_events","aggregate_id"],["analytics_events","creature_id"],["ai_generation_logs","creature_id"],["outbox","creature_id"]] as const){
    const result=await client.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${column} = ANY($1::uuid[])`,[creatureIds]);
    if(Number(result.rows[0].count)>0)leftovers.push(`${table}.${column}`);
  }
  return leftovers;
}

async function seedAccount(client:import("pg").PoolClient,telegramUserId:number,name:string,botId:number,onboarded=true){
  const player=(await client.query(`INSERT INTO players (telegram_user_id,display_name,locale) VALUES ($1,$2,'en') RETURNING id`,[telegramUserId,name])).rows[0];
  const creature=(await client.query(`INSERT INTO creatures (player_id,slug,name,kind,personality,genome,energy,stars,mood,current_location) VALUES ($1,$2,$3,'player',$4,$5,82,14,'curious','cardboard_nest') RETURNING id`,[player.id,`account-${randomUUID()}`,name,personality,genome])).rows[0];
  await client.query(`INSERT INTO onboarding_states (creature_id,status,wake_choice,visual_marker,completed_at) VALUES ($1,$2,'gentle','moon',$3)`,[creature.id,onboarded?"complete":"identity",onboarded?new Date():null]);
  await client.query(`INSERT INTO player_choices (creature_id,scene_id,choice_id,choice_payload) VALUES ($1,'genesis_wake','gentle','{}')`,[creature.id]);
  await client.query(`INSERT INTO story_flags (creature_id,flag_key,flag_value) VALUES ($1,'genesis_identity','"set"')`,[creature.id]);
  await client.query(`INSERT INTO story_entries (creature_id,title,body,choices,reward) VALUES ($1,'A first morning','The nest is warm.','[]','{}')`,[creature.id]);
  const memory=(await client.query(`INSERT INTO memories (creature_id,source_type,summary,importance,is_private) VALUES ($1,'genesis','Woken gently.',0.8,true) RETURNING id`,[creature.id])).rows[0];
  await client.query(`INSERT INTO quest_instances (quest_id,creature_id,status,progress) VALUES ('first-window',$1,'active','{"seen":false}')`,[creature.id]);
  await client.query(`INSERT INTO world_events (creature_id,event_type,payload,due_at) VALUES ($1,'proactive_story','{}',now()+interval '1 hour')`,[creature.id]);
  await client.query(`INSERT INTO inventory_ledger (creature_id,item_id,delta,source_key,metadata) VALUES ($1,'warm_button',1,$2,'{}')`,[creature.id,`seed:${randomUUID()}`]);
  await client.query(`INSERT INTO story_arc_instances (creature_id,arc_id,arc_version,current_beat,state) VALUES ($1,'impossible-door',1,'beat_1','{}')`,[creature.id]);
  await client.query(`INSERT INTO daily_return_instances (creature_id,return_date,title,body,choices) VALUES ($1,current_date,'Today','A thought.','[]')`,[creature.id]);
  await client.query(`INSERT INTO personality_events (creature_id,source_key,source_type,trait_deltas,personality_before,personality_after,mood_before,mood_after,explanation) VALUES ($1,$2,'daily_return','{}',$3,$3,'curious','cozy','Shifted a little.')`,[creature.id,`seed:${randomUUID()}`,personality]);
  await client.query(`INSERT INTO memory_audit_events (creature_id,memory_id,event_type,actor_type,details) VALUES ($1,$2,'created','engine','{}')`,[creature.id,memory.id]);
  await client.query(`INSERT INTO game_events (aggregate_id,event_type,payload) VALUES ($1,'player_action','{"action":"talk"}')`,[creature.id]);
  await client.query(`INSERT INTO analytics_events (player_id,creature_id,event_name,properties) VALUES ($1,$2,'onboarding_completed','{}')`,[player.id,creature.id]);
  await client.query(`INSERT INTO ai_generation_logs (player_id,creature_id,scene_id,provider,prompt_version,used_ai,latency_ms,input_chars,output_chars) VALUES ($1,$2,'scene','authored','v1',false,10,100,100)`,[player.id,creature.id]);
  await client.query(`INSERT INTO ai_profiles (player_id,base_url,model,encrypted_api_key) VALUES ($1,'https://provider.example/v1','test-model',$2)`,[player.id,seal("super-secret-api-key")]);
  await client.query(`INSERT INTO ai_daily_usage (player_id,usage_date,provider,request_count) VALUES ($1,current_date,'byok',3)`,[player.id]);
  await client.query(`INSERT INTO notification_preferences (player_id,enabled,timezone,delivery_time,quiet_start,quiet_end,next_delivery_at) VALUES ($1,true,'UTC','10:00','22:00','08:00',now())`,[player.id]);
  await client.query(`INSERT INTO player_daily_activity (player_id,activity_date,open_count) VALUES ($1,current_date,2)`,[player.id]);
  await client.query(`INSERT INTO openrouter_oauth_states (state_hash,player_id,verifier_cipher,callback_url,expires_at) VALUES ($1,$2,$3,'https://example.test/cb',now()+interval '10 minutes')`,[randomUUID(),player.id,seal("verifier-secret")]);
  await client.query(`INSERT INTO managed_bots (bot_id,owner_telegram_user_id,creature_id,username,token_cipher,webhook_secret) VALUES ($1,$2,$3,$4,$5,'webhook-secret-value-1234')`,[botId,telegramUserId,creature.id,`Bot${botId}`,seal("bot-token-secret")]);
  await client.query(`INSERT INTO managed_bot_access_rules (bot_id,chat_id,telegram_user_id,chat_type,created_by_owner_telegram_user_id) VALUES ($1,-100999,$2,'supergroup',$2)`,[botId,telegramUserId]);
  await client.query(`INSERT INTO outbox (bot_id,chat_id,payload,source_key,player_id,creature_id) VALUES ($1,$2,'{"method":"sendMessage","text":"private message text"}',$3,$4,$5)`,[botId,String(telegramUserId),`seed:${randomUUID()}`,player.id,creature.id]);
  await client.query(`INSERT INTO telegram_updates (source,update_id,payload,status) VALUES ('manager',$1,$2,'completed')`,[Math.floor(Math.random()*2_000_000_000),JSON.stringify({update_id:1,message:{message_id:1,text:"a private note",chat:{id:telegramUserId,type:"private"},from:{id:telegramUserId,first_name:name}}})]);
  await client.query(`INSERT INTO security_events (event_type,bot_id,telegram_user_id,chat_id,details) VALUES ('managed_bot_access_rejected',$1,$2,$2,'{}')`,[botId,telegramUserId]);
  return {playerId:String(player.id),creatureId:String(creature.id)};
}

async function main(){
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    const ownerA=Number(`62${String(Date.now()).slice(-8)}`);const ownerB=ownerA+1;
    const a=await seedAccount(client,ownerA,"Piko",720000001);
    const b=await seedAccount(client,ownerB,"Luma",720000002);
    await client.query(`INSERT INTO relationships (source_creature_id,target_creature_id,trust,affection,rivalry,last_event) VALUES ($1,$2,4,5,0,'link_meeting'),($2,$1,4,5,0,'link_meeting')`,[a.creatureId,b.creatureId]);

    // --- confirmation gate -------------------------------------------------------------------
    for(const [action,wrong] of [["reset","reset"],["delete","Delete"],["delete",""]] as const){
      let rejected=false;
      try{assertConfirmation(action,wrong)}catch(error){rejected=error instanceof AppError&&error.code==="confirmation_mismatch"}
      assert(rejected,`confirmation "${wrong}" was accepted for ${action}`);
    }
    assertConfirmation("reset"," RESET ");assertConfirmation("delete","DELETE");

    // --- export ------------------------------------------------------------------------------
    const exported=await exportPlayerData(client,a.playerId);
    const serialized=JSON.stringify(exported);
    assert(exported.schemaVersion==="1.0.0","export is missing its schema version");
    assert(typeof exported.exportedAt==="string","export is missing its timestamp");
    assert((exported.creatures as unknown[]).length===1,"export did not include the creature");
    assert((exported.stories as unknown[]).length===1,"export did not include authored stories");
    assert((exported.memories as unknown[]).length===1,"export did not include active memories");
    assert((exported.managedBots as unknown[]).length===1,"export did not include managed bot metadata");
    assert(Boolean(exported.notificationPreferences),"export did not include notification preferences");
    assert(Boolean(exported.aiConnection),"export did not include AI connection metadata");
    for(const secret of ["super-secret-api-key","bot-token-secret","verifier-secret","webhook-secret-value-1234","encrypted_api_key","token_cipher","webhook_secret","verifier_cipher"]){
      assert(!serialized.includes(secret),`export leaked "${secret}"`);
    }
    const otherExport=JSON.stringify(await exportPlayerData(client,b.playerId));
    assert(!otherExport.includes(a.creatureId),"one player's export contained another player's creature");
    // Scoped to this run's subjects: the table is shared, and a smoke test must not depend on
    // starting from an empty database.
    const auditedExports=await client.query(`SELECT count(*)::int AS count FROM account_lifecycle_events WHERE event_type='data_exported' AND subject_ref = ANY($1::text[])`,[[subjectRef(ownerA),subjectRef(ownerB)]]);
    assert(Number(auditedExports.rows[0].count)===2,"exports were not audited");

    // --- referral attribution is one-time and reset-proof --------------------------------------
    const newcomer=await seedAccount(client,ownerA+2,"Wren",720000003,false);
    const refs=await client.query("SELECT id,share_token,slug FROM creatures WHERE id = ANY($1::uuid[])",[[a.creatureId,b.creatureId,newcomer.creatureId]]);
    const tokenOf=(id:string)=>String(refs.rows.find((row)=>String(row.id)===id).share_token);
    const slugOf=(id:string)=>String(refs.rows.find((row)=>String(row.id)===id).slug);
    assert(!(await attributeReferral(client,{referredPlayerId:b.playerId,referrerRef:tokenOf(a.creatureId)})),"an already-onboarded player was attributed as a new recruit");
    assert(await attributeReferral(client,{referredPlayerId:newcomer.playerId,referrerRef:tokenOf(a.creatureId)}),"a valid referral was not attributed");
    assert(!(await attributeReferral(client,{referredPlayerId:newcomer.playerId,referrerRef:tokenOf(a.creatureId)})),"referral attribution was recorded twice for one player");
    assert(!(await attributeReferral(client,{referredPlayerId:newcomer.playerId,referrerRef:tokenOf(newcomer.creatureId)})),"a player was allowed to refer themselves");
    // Links shared before opaque tokens existed still resolve, without exposing the slug publicly.
    const legacy=await seedAccount(client,ownerA+3,"Fen",720000004,false);
    assert(await attributeReferral(client,{referredPlayerId:legacy.playerId,referrerRef:slugOf(a.creatureId)}),"a legacy slug-based meet link was not attributed");
    const starsBefore=Number((await client.query("SELECT stars FROM creatures WHERE id=$1",[a.creatureId])).rows[0].stars);
    const firstReward=await rewardPendingReferral(client,newcomer.playerId,newcomer.creatureId);
    assert(firstReward?.referrerCreatureId===a.creatureId,"referral reward did not resolve the referrer");
    const starsAfter=Number((await client.query("SELECT stars FROM creatures WHERE id=$1",[a.creatureId])).rows[0].stars);
    assert(starsAfter===starsBefore+3,"referral reward did not pay the referrer exactly once");
    assert((await rewardPendingReferral(client,newcomer.playerId,newcomer.creatureId))===null,"referral reward paid out twice");
    assert(Number((await client.query("SELECT stars FROM creatures WHERE id=$1",[a.creatureId])).rows[0].stars)===starsAfter,"a replayed referral reward granted extra stars");
    // The attribution has to outlive a reset on either side, or a reset becomes a reward farm.
    await resetCreature(client,newcomer.playerId);
    const newcomerTombstone=await client.query("SELECT rewarded FROM referrals WHERE referred_player_id=$1",[newcomer.playerId]);
    assert(newcomerTombstone.rowCount===1&&newcomerTombstone.rows[0].rewarded===true,"resetting the referred creature erased the referral tombstone");
    assert((await rewardPendingReferral(client,newcomer.playerId,newcomer.creatureId))===null,"a reset let the referred player re-earn the referral reward");

    // --- creature reset ------------------------------------------------------------------------
    const resetResult=await resetCreature(client,a.playerId);
    assert(resetResult.reset&&resetResult.revokedBotIds.length===1,"reset did not report the revoked bot");
    const resetLeftovers=await countLeftovers(client,[a.creatureId],"00000000-0000-0000-0000-000000000000");
    assert(resetLeftovers.length===0,`reset left creature-scoped rows behind: ${resetLeftovers.join(", ")}`);
    const survivingPlayer=await client.query("SELECT creature_generation FROM players WHERE id=$1",[a.playerId]);
    assert(survivingPlayer.rowCount===1,"reset deleted the Telegram account");
    assert(Number(survivingPlayer.rows[0].creature_generation)===2,"reset did not advance the creature generation");
    const survivingPrefs=await client.query("SELECT next_delivery_at FROM notification_preferences WHERE player_id=$1",[a.playerId]);
    assert(survivingPrefs.rowCount===1&&survivingPrefs.rows[0].next_delivery_at===null,"reset did not keep and unschedule notification preferences");
    const referrerTombstone=await client.query("SELECT referrer_creature_id FROM referrals WHERE referred_player_id=$1",[legacy.playerId]);
    assert(referrerTombstone.rowCount===1&&referrerTombstone.rows[0].referrer_creature_id===null,"resetting the referrer erased the attribution instead of detaching it");
    const repeatReset=await resetCreature(client,a.playerId);
    assert(!repeatReset.reset,"a second reset with no creature did not no-op");

    // --- account deletion ----------------------------------------------------------------------
    const deleteResult=await deleteAccount(client,b.playerId);
    assert(deleteResult.deleted&&deleteResult.revokedBotIds.length===1,"deletion did not report the revoked bot");
    const deleteLeftovers=await countLeftovers(client,[b.creatureId],b.playerId);
    assert(deleteLeftovers.length===0,`deletion left rows behind: ${deleteLeftovers.join(", ")}`);
    assert((await client.query("SELECT 1 FROM players WHERE id=$1",[b.playerId])).rowCount===0,"deletion left the account row");
    assert((await client.query("SELECT 1 FROM creatures WHERE id=$1",[b.creatureId])).rowCount===0,"deletion left the creature row");
    assert((await client.query("SELECT 1 FROM managed_bots WHERE bot_id=720000002")).rowCount===0,"deletion left the managed bot and its token");
    assert((await client.query("SELECT 1 FROM managed_bot_access_rules WHERE bot_id=720000002")).rowCount===0,"deletion left managed bot access rules");
    assert((await client.query("SELECT 1 FROM outbox WHERE bot_id=720000002")).rowCount===0,"deletion left queued Telegram messages");
    assert((await client.query("SELECT 1 FROM telegram_updates WHERE payload->'message'->'from'->>'id'=$1",[String(ownerB)])).rowCount===0,"deletion left raw Telegram payloads containing the user");
    const anonymized=await client.query("SELECT count(*)::int AS count FROM security_events WHERE telegram_user_id=$1",[ownerB]);
    assert(Number(anonymized.rows[0].count)===0,"deletion left the Telegram id on security events");
    const retainedAudit=await client.query("SELECT count(*)::int AS count FROM security_events WHERE bot_id=720000002 AND telegram_user_id IS NULL");
    assert(Number(retainedAudit.rows[0].count)===1,"security events were dropped instead of anonymized");
    // Relationship edges pointing at the deleted creature must not survive as orphans on the peer.
    assert((await client.query("SELECT 1 FROM relationships WHERE target_creature_id=$1 OR source_creature_id=$1",[b.creatureId])).rowCount===0,"deletion left dangling relationship edges");
    const deletedAudit=await client.query(`SELECT details FROM account_lifecycle_events WHERE event_type='account_deleted' AND subject_ref=$1`,[subjectRef(ownerB)]);
    assert(deletedAudit.rowCount===1,"deletion was not audited");
    assert(!JSON.stringify(deletedAudit.rows[0].details).includes(String(ownerB)),"the deletion audit retained the Telegram id");
    const repeatDelete=await deleteAccount(client,b.playerId).then(()=>"resolved").catch((error)=>error instanceof AppError&&error.code==="player_not_found"?"not_found":"unexpected");
    assert(repeatDelete==="not_found","a repeated deletion of a removed account did not resolve cleanly");

    await client.query("ROLLBACK");
    console.log("Account lifecycle database smoke test passed");
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error}finally{client.release();await db.end()}
}
main().catch((error)=>{console.error(error);process.exitCode=1});
