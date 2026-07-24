import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import {
  enqueueTelegramUpdate,
  processOutboxBatch,
  processTelegramIngressBatch,
  readinessSnapshot,
  recoverExpiredLeases,
  replayOutboxItem,
  setRuntimeControl
} from "./delivery-runtime.js";
import type { TelegramUpdate } from "./telegram.js";

function assert(condition:unknown,message:string):asserts condition{if(!condition)throw new Error(message)}
async function insertOutbox(sourceKey:string){const result=await db.query(`INSERT INTO outbox (chat_id,payload,source_key) VALUES ('123',$1,$2) RETURNING id`,[JSON.stringify({method:"sendMessage",text:sourceKey}),sourceKey]);return String(result.rows[0].id)}
async function statusFor(id:string){return (await db.query(`SELECT status,attempts,telegram_message_id,error_class,last_error FROM outbox WHERE id=$1`,[id])).rows[0]}

async function main(){
  const originalFetch=globalThis.fetch;
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    const telegramId=Number(`62${String(Date.now()).slice(-8)}`);
    const player=(await client.query(`INSERT INTO players (telegram_user_id,display_name,locale) VALUES ($1,'Runtime Smoke','en') RETURNING id`,[telegramId])).rows[0];
    const creature=(await client.query(`INSERT INTO creatures (player_id,slug,name,kind,personality,genome,energy,mood,current_location) VALUES ($1,$2,'Runtime Piko','player',$3,$4,82,'curious','cardboard_nest') RETURNING id`,[
      player.id,`runtime-${randomUUID()}`,JSON.stringify({archetype:"gentle_explorer",voice:"earnest_whimsy",curiosity:0.72,courage:0.48,empathy:0.67,mischief:0.49,sociability:0.62}),JSON.stringify({body:"round",primary:"#aaaaaa",secondary:"#bbbbbb",eyes:"wide",mark:"moon",accessory:"leaf",evolution:1})
    ])).rows[0];
    await client.query(`INSERT INTO onboarding_states (creature_id,status,completed_at) VALUES ($1,'complete',now())`,[creature.id]);
    await client.query("COMMIT");

    const update:TelegramUpdate={update_id:991001,message:{message_id:1,text:"hello",chat:{id:telegramId,type:"private"},from:{id:telegramId,is_bot:false,first_name:"Runtime",language_code:"en"}}};
    assert(await (async()=>{const c=await db.connect();try{await c.query("BEGIN");const inserted=await enqueueTelegramUpdate(c,"manager",update);await c.query("COMMIT");return inserted;}finally{c.release();}})(),"first webhook was not persisted");
    assert(!await (async()=>{const c=await db.connect();try{await c.query("BEGIN");const inserted=await enqueueTelegramUpdate(c,"manager",update);await c.query("COMMIT");return inserted;}finally{c.release();}})(),"duplicate webhook was persisted twice");
    assert(await processTelegramIngressBatch()===1,"received update was not claimed and processed");
    assert(await processTelegramIngressBatch()===0,"completed update was claimed again");
    const updateState=await db.query(`SELECT status,attempts,completed_at FROM telegram_updates WHERE source='manager' AND update_id=$1`,[update.update_id]);
    assert(updateState.rows[0].status==="completed"&&Number(updateState.rows[0].attempts)===1&&updateState.rows[0].completed_at,"update did not finalize exactly once");
    const effects=await db.query(`SELECT (SELECT count(*) FROM game_events WHERE command_key=$1) AS events,(SELECT count(*) FROM outbox WHERE source_key=$2) AS replies,(SELECT xp FROM creatures WHERE id=$3) AS xp`,[`telegram:manager:${update.update_id}`,`telegram-reply:manager:${update.update_id}:action`,creature.id]);
    assert(Number(effects.rows[0].events)===1&&Number(effects.rows[0].replies)===1&&Number(effects.rows[0].xp)===3,"queued update did not produce one canonical effect and reply");

    globalThis.fetch=async()=>new Response(JSON.stringify({ok:true,result:{message_id:111}}),{status:200,headers:{"content-type":"application/json"}});
    const successId=await insertOutbox("runtime-success");await processOutboxBatch();let delivery=await statusFor(successId);
    assert(delivery.status==="sent"&&Number(delivery.attempts)===1&&Number(delivery.telegram_message_id)===111,"successful delivery did not finalize");

    globalThis.fetch=async()=>new Response(JSON.stringify({ok:false,error_code:429,description:"Too Many Requests",parameters:{retry_after:3}}),{status:200,headers:{"content-type":"application/json"}});
    const retryId=await insertOutbox("runtime-retry");await processOutboxBatch();delivery=await statusFor(retryId);
    assert(delivery.status==="retryable"&&delivery.error_class==="telegram_rate_limit","429 delivery was not made retryable");

    globalThis.fetch=async()=>new Response(JSON.stringify({ok:false,error_code:403,description:"Forbidden"}),{status:200,headers:{"content-type":"application/json"}});
    const deadId=await insertOutbox("runtime-dead");await processOutboxBatch();delivery=await statusFor(deadId);
    assert(delivery.status==="dead_letter"&&delivery.error_class==="telegram_403","permanent Telegram failure did not dead-letter");

    globalThis.fetch=async()=>{throw new DOMException("timed out","TimeoutError")};
    const uncertainId=await insertOutbox("runtime-uncertain");await processOutboxBatch();delivery=await statusFor(uncertainId);
    assert(delivery.status==="uncertain"&&delivery.error_class==="network_result_unknown","timeout was automatically retried instead of becoming uncertain");
    const replayClient=await db.connect();try{await replayClient.query("BEGIN");assert(await replayOutboxItem(replayClient,uncertainId,"smoke"),"explicit uncertain replay was rejected");await replayClient.query("COMMIT");}finally{replayClient.release();}
    delivery=await statusFor(uncertainId);assert(delivery.status==="pending"&&Number(delivery.attempts)===0,"explicit replay did not reset the uncertain item");

    const expired=(await db.query(`INSERT INTO outbox (chat_id,payload,source_key,status,attempts,claim_token,claimed_at,lease_expires_at) VALUES ('123',$1,'runtime-expired','sending',1,gen_random_uuid(),now()-interval '2 minutes',now()-interval '1 minute') RETURNING id`,[JSON.stringify({method:"sendMessage",text:"expired"})])).rows[0];
    const staleUpdate:TelegramUpdate={update_id:991002,message:{message_id:2,text:"sleep",chat:{id:telegramId,type:"private"},from:{id:telegramId,is_bot:false,first_name:"Runtime"}}};
    await db.query(`INSERT INTO telegram_updates (source,update_id,payload,status,attempts,lease_token,lease_expires_at) VALUES ('manager',$1,$2,'processing',1,gen_random_uuid(),now()-interval '1 minute')`,[staleUpdate.update_id,JSON.stringify(staleUpdate)]);
    const recovered=await recoverExpiredLeases();assert(recovered.outbox===1&&recovered.updates===1,"expired leases were not recovered separately");
    delivery=await statusFor(String(expired.id));assert(delivery.status==="uncertain"&&delivery.error_class==="lease_expired_after_dispatch","expired sending lease was retried automatically");
    const staleState=await db.query(`SELECT status FROM telegram_updates WHERE source='manager' AND update_id=$1`,[staleUpdate.update_id]);assert(staleState.rows[0].status==="retryable","expired update lease did not become retryable");

    const controlClient=await db.connect();try{await controlClient.query("BEGIN");await setRuntimeControl(controlClient,"outbox_delivery",false,"smoke pause","smoke");await controlClient.query("COMMIT");}finally{controlClient.release();}
    globalThis.fetch=async()=>new Response(JSON.stringify({ok:true,result:{message_id:222}}),{status:200,headers:{"content-type":"application/json"}});
    const pausedId=await insertOutbox("runtime-paused");assert(await processOutboxBatch()===0,"paused outbox still claimed work");delivery=await statusFor(pausedId);assert(delivery.status==="pending","paused outbox changed the row");
    const resumeClient=await db.connect();try{await resumeClient.query("BEGIN");await setRuntimeControl(resumeClient,"outbox_delivery",true,null,"smoke");await resumeClient.query("COMMIT");}finally{resumeClient.release();}

    const readyClient=await db.connect();try{await readyClient.query("BEGIN");const ready=await readinessSnapshot(readyClient);assert(ready.migrationsReady,"readiness did not detect migration 019");await readyClient.query("ROLLBACK");}finally{readyClient.release();}
    console.log("Telegram delivery runtime database smoke test passed");
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error}finally{globalThis.fetch=originalFetch;client.release();await db.end()}
}
main().catch((error)=>{console.error(error);process.exitCode=1});
