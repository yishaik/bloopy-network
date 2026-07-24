import { randomUUID } from "node:crypto";
import { performActionOnce } from "./command-idempotency.js";
import { seal } from "./crypto.js";
import { db } from "./db.js";
import { AppError } from "./errors.js";
import { authorizeManagedHuman,createBotInteraction,finalizeManagedBotRevocation,formatBotInteractionEnvelope,processBotInteractionTurn,setManagedBotInteractionConsent,upsertManagedBotAccessRule } from "./telegram-control.js";

function assert(condition:unknown,message:string):asserts condition{if(!condition)throw new Error(message)}
async function main(){
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    const ownerA=Number(`61${String(Date.now()).slice(-8)}`);const ownerB=ownerA+1;const stranger=ownerA+99;
    const playerA=(await client.query(`INSERT INTO players (telegram_user_id,display_name,locale) VALUES ($1,'Owner A','en') RETURNING id`,[ownerA])).rows[0];
    const playerB=(await client.query(`INSERT INTO players (telegram_user_id,display_name,locale) VALUES ($1,'Owner B','en') RETURNING id`,[ownerB])).rows[0];
    const personality=JSON.stringify({archetype:"gentle_explorer",voice:"earnest_whimsy",curiosity:0.72,courage:0.48,empathy:0.67,mischief:0.49,sociability:0.62});
    const genome=JSON.stringify({body:"round",primary:"#aaaaaa",secondary:"#bbbbbb",eyes:"wide",mark:"moon",accessory:"leaf",evolution:1});
    const creatureA=(await client.query(`INSERT INTO creatures (player_id,slug,name,kind,personality,genome,energy,mood,current_location) VALUES ($1,$2,'Piko','player',$3,$4,82,'curious','cardboard_nest') RETURNING id`,[playerA.id,`control-a-${randomUUID()}`,personality,genome])).rows[0];
    const creatureB=(await client.query(`INSERT INTO creatures (player_id,slug,name,kind,personality,genome,energy,mood,current_location) VALUES ($1,$2,'Luma','player',$3,$4,82,'curious','cardboard_nest') RETURNING id`,[playerB.id,`control-b-${randomUUID()}`,personality,genome])).rows[0];
    await client.query(`INSERT INTO onboarding_states (creature_id,status,completed_at) VALUES ($1,'complete',now()),($2,'complete',now())`,[creatureA.id,creatureB.id]);
    const botA=710000001;const botB=710000002;
    await client.query(`INSERT INTO managed_bots (bot_id,owner_telegram_user_id,creature_id,username,token_cipher,webhook_secret) VALUES ($1,$2,$3,'PikoControlBot',$4,'secret-a-1234567890'),($5,$6,$7,'LumaControlBot',$8,'secret-b-1234567890')`,[botA,ownerA,creatureA.id,seal("token-a"),botB,ownerB,creatureB.id,seal("token-b")]);
    assert(Boolean(await authorizeManagedHuman(client,{botId:botA,telegramUserId:ownerA,chatId:ownerA,chatType:"private"})),"owner private chat was rejected");
    assert(!(await authorizeManagedHuman(client,{botId:botA,telegramUserId:stranger,chatId:stranger,chatType:"private"})),"stranger private chat was authorized");
    assert(!(await authorizeManagedHuman(client,{botId:botA,telegramUserId:ownerA,chatId:-100123,chatType:"supergroup"})),"owner group access was implicit");
    await upsertManagedBotAccessRule(client,ownerA,{botId:botA,chatId:-100123,telegramUserId:undefined,chatType:"supergroup",enabled:true});
    await upsertManagedBotAccessRule(client,ownerA,{botId:botA,chatId:-100123,telegramUserId:undefined,chatType:"supergroup",enabled:true});
    const groupRuleCount=await client.query(`SELECT count(*)::int AS count FROM managed_bot_access_rules WHERE bot_id=$1 AND chat_id=$2 AND telegram_user_id IS NULL`,[botA,-100123]);
    assert(Number(groupRuleCount.rows[0].count)===1,"chat-wide access rule upsert created duplicate NULL-user rows");
    assert(Boolean(await authorizeManagedHuman(client,{botId:botA,telegramUserId:stranger,chatId:-100123,chatType:"supergroup"})),"approved group rule did not authorize the chat");
    const rejected=await client.query(`SELECT count(*)::int AS count FROM security_events WHERE event_type='managed_bot_access_rejected' AND bot_id=$1`,[botA]);
    assert(Number(rejected.rows[0].count)>=2,"authorization rejections were not audited");
    let consentBlocked=false;try{await createBotInteraction(client,{sourceBotId:botA,targetUsername:"LumaControlBot"})}catch(error){consentBlocked=error instanceof AppError&&error.code==="bot_interaction_consent_required"}
    assert(consentBlocked,"bot meeting started without two-sided consent");
    await setManagedBotInteractionConsent(client,ownerA,botA,true);await setManagedBotInteractionConsent(client,ownerB,botB,true);
    const interaction=await createBotInteraction(client,{sourceBotId:botA,targetUsername:"LumaControlBot"});
    const firstOutbox=(await client.query(`SELECT payload FROM outbox WHERE source_key=$1`,[`bot-interaction:${interaction.interactionId}:0`])).rows[0];
    assert(firstOutbox?.payload?.text,"initial signed interaction was not queued");
    const turn0=await processBotInteractionTurn(client,{receiverBotId:botB,senderBotId:botA,text:String(firstOutbox.payload.text)});assert(turn0.accepted&&!turn0.completed,"valid first interaction turn was rejected");
    const replay0=await processBotInteractionTurn(client,{receiverBotId:botB,senderBotId:botA,text:String(firstOutbox.payload.text)});assert(!replay0.accepted,"stale replay unexpectedly advanced the interaction");
    let currentReceiver=botA;let currentSender=botB;
    for(let turn=1;turn<4;turn++){const row=(await client.query(`SELECT payload FROM outbox WHERE source_key=$1`,[`bot-interaction:${interaction.interactionId}:${turn}`])).rows[0];assert(row?.payload?.text,`turn ${turn} was not queued`);const result=await processBotInteractionTurn(client,{receiverBotId:currentReceiver,senderBotId:currentSender,text:String(row.payload.text)});if(turn<3)assert(result.accepted&&!result.completed,`turn ${turn} ended too early`);else assert(result.accepted&&result.completed,"turn budget did not complete the interaction");[currentReceiver,currentSender]=[currentSender,currentReceiver]}
    const interactionState=await client.query(`SELECT state,turn_count FROM bot_interactions WHERE id=$1`,[interaction.interactionId]);assert(interactionState.rows[0].state==="completed"&&Number(interactionState.rows[0].turn_count)===4,"interaction state or turn count is wrong");
    const turns=await client.query(`SELECT count(*)::int AS count FROM bot_interaction_turns WHERE interaction_id=$1`,[interaction.interactionId]);assert(Number(turns.rows[0].count)===4,"interaction replay created duplicate or missing turns");
    const forged=formatBotInteractionEnvelope(interaction.interactionId,0,botB,botA);const forgedResult=await processBotInteractionTurn(client,{receiverBotId:botB,senderBotId:botA,text:forged});assert(!forgedResult.accepted,"forged sender/receiver envelope was accepted");
    const firstAction=await performActionOnce(client,{creatureId:creatureA.id,action:"talk",commandKey:"telegram-smoke-action"});
    const replayAction=await performActionOnce(client,{creatureId:creatureA.id,action:"talk",commandKey:"telegram-smoke-action"});
    assert(firstAction.story.title===replayAction.story.title&&firstAction.story.body===replayAction.story.body,"canonical replay changed the story");
    assert(firstAction.energy===replayAction.energy&&firstAction.xp===replayAction.xp&&firstAction.level===replayAction.level&&firstAction.stars===replayAction.stars&&firstAction.evolution===replayAction.evolution,"canonical replay changed progression values");
    assert(firstAction.questCompleted.join("|")===replayAction.questCompleted.join("|"),"canonical replay changed quest results");
    const actionCounts=await client.query(`SELECT (SELECT count(*) FROM game_events WHERE command_key='telegram-smoke-action') AS events,(SELECT count(*) FROM story_entries WHERE creature_id=$1) AS stories,(SELECT xp FROM creatures WHERE id=$1) AS xp`,[creatureA.id]);
    assert(Number(actionCounts.rows[0].events)===1,"canonical replay created duplicate game events");assert(Number(actionCounts.rows[0].stories)===1,"canonical replay created duplicate story entries");assert(Number(actionCounts.rows[0].xp)===3,"canonical replay granted XP more than once");
    await finalizeManagedBotRevocation(client,ownerA,botA);const revoked=await client.query(`SELECT enabled,revoked_at,allow_bot_interactions FROM managed_bots WHERE bot_id=$1`,[botA]);assert(!revoked.rows[0].enabled&&revoked.rows[0].revoked_at&&!revoked.rows[0].allow_bot_interactions,"revoke did not disable the managed bot");assert(!(await authorizeManagedHuman(client,{botId:botA,telegramUserId:ownerA,chatId:ownerA,chatType:"private"})),"revoked bot remained usable");
    await client.query("ROLLBACK");console.log("Telegram control-plane database smoke test passed");
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error}finally{client.release();await db.end()}
}
main().catch((error)=>{console.error(error);process.exitCode=1});
