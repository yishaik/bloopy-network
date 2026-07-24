import { randomBytes } from "node:crypto";
import type pg from "pg";
import { performActionOnce } from "./command-idempotency.js";
import { config } from "./config.js";
import { open, seal } from "./crypto.js";
import { db, withTransaction } from "./db.js";
import { AppError } from "./errors.js";
import { bootstrapPlayer, getOnboardingState, recordEncounter } from "./game.js";
import {
  authorizeManagedHuman,
  createBotInteraction,
  finalizeManagedBotRevocation,
  finalizeManagedBotRotation,
  prepareManagedBotOperation,
  processBotInteractionTurn
} from "./telegram-control.js";
import type { TelegramUser } from "./types.js";

export interface TelegramUpdate {
  update_id:number;
  message?:{
    message_id:number;
    text?:string;
    chat:{id:number;type:string};
    from?:TelegramUser;
    managed_bot_created?:{bot:TelegramUser};
  };
  managed_bot?:{user:TelegramUser;bot:TelegramUser};
}

interface TelegramResponse<T> {ok:boolean;result?:T;description?:string;error_code?:number;parameters?:{retry_after?:number}}

export async function botCall<T>(token:string,method:string,payload:Record<string,unknown>):Promise<T> {
  const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(10_000)
  });
  const data=await response.json() as TelegramResponse<T>;
  if(!data.ok||data.result===undefined) {
    const error=new Error(data.description??`Telegram ${method} failed`) as Error&{status?:number;retryAfter?:number};
    error.status=data.error_code??response.status;
    error.retryAfter=data.parameters?.retry_after;
    throw error;
  }
  return data.result;
}

export function managedBotCreationLink(creatureName:string,userId:number):string {
  if(!config.TELEGRAM_MANAGER_BOT_USERNAME)throw new AppError("manager_bot_username_missing",503,"Managed bot creation is temporarily unavailable.");
  const suffix=Math.abs(userId).toString().slice(-6);
  return `https://t.me/newbot/${config.TELEGRAM_MANAGER_BOT_USERNAME}/Bloopy_${suffix}_bot?name=${encodeURIComponent(creatureName)}`;
}

async function configureManagedBot(token:string,botId:number,webhookSecret:string):Promise<void> {
  await botCall(token,"setWebhook",{url:`${config.PUBLIC_BASE_URL}/telegram/managed/${botId}`,secret_token:webhookSecret,allowed_updates:["message"],drop_pending_updates:true});
  await botCall(token,"setMyCommands",{commands:[{command:"start",description:"Wake up your creature"},{command:"adventure",description:"Start a small adventure"},{command:"meet",description:"Meet another creature"}]});
  await botCall(token,"setChatMenuButton",{menu_button:{type:"web_app",text:"Open my world",web_app:{url:config.PUBLIC_BASE_URL}}});
}

async function enqueueTelegram(client:pg.PoolClient,input:{botId?:number;chatId:number|string;payload:Record<string,unknown>;sourceKey:string;playerId?:string;creatureId?:string}):Promise<void> {
  await client.query(`INSERT INTO outbox (bot_id,chat_id,payload,source_key,player_id,creature_id)
    VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING`,[
      input.botId??null,String(input.chatId),JSON.stringify(input.payload),input.sourceKey,input.playerId??null,input.creatureId??null
    ]);
}

async function registerManagedBot(client:pg.PoolClient,update:NonNullable<TelegramUpdate["managed_bot"]>):Promise<void> {
  if(!config.MANAGED_BOT_FLEET_ENABLED)throw new AppError("managed_fleet_disabled",409,"Managed creature bots are paused right now.");
  if(!config.TELEGRAM_MANAGER_BOT_TOKEN)throw new AppError("manager_bot_token_missing",503,"Managed bot setup is temporarily unavailable.");
  const token=await botCall<string>(config.TELEGRAM_MANAGER_BOT_TOKEN,"getManagedBotToken",{user_id:update.bot.id});
  const ownerResult=await client.query("SELECT id FROM players WHERE telegram_user_id=$1",[update.user.id]);
  const player=ownerResult.rows[0];
  if(!player)throw new AppError("managed_owner_missing",409,"Open Bloopy and create your creature before attaching a managed bot.");
  const creatureResult=await client.query(`SELECT c.id FROM creatures c JOIN onboarding_states os ON os.creature_id=c.id AND os.status='complete' WHERE c.player_id=$1 AND c.kind='player' LIMIT 1`,[player.id]);
  const creature=creatureResult.rows[0];
  if(!creature)throw new AppError("managed_creature_incomplete",409,"Finish creating the creature before giving it a bot.");
  const webhookSecret=randomBytes(24).toString("base64url");
  await client.query(`INSERT INTO managed_bots (bot_id,owner_telegram_user_id,creature_id,username,token_cipher,webhook_secret,enabled,revoked_at)
    VALUES ($1,$2,$3,$4,$5,$6,true,NULL)
    ON CONFLICT (bot_id) DO UPDATE SET owner_telegram_user_id=EXCLUDED.owner_telegram_user_id,creature_id=EXCLUDED.creature_id,username=EXCLUDED.username,
      token_cipher=EXCLUDED.token_cipher,webhook_secret=EXCLUDED.webhook_secret,enabled=true,revoked_at=NULL,updated_at=now()`,[
      update.bot.id,update.user.id,creature.id,update.bot.username??null,seal(token),webhookSecret
    ]);
  await configureManagedBot(token,update.bot.id,webhookSecret);
  await client.query(`UPDATE managed_bots SET last_webhook_at=now(),updated_at=now() WHERE bot_id=$1`,[update.bot.id]);
  await enqueueTelegram(client,{botId:update.bot.id,chatId:update.user.id,sourceKey:`managed-bot-welcome:${update.bot.id}`,creatureId:creature.id,payload:{method:"sendMessage",text:"I have my own room in Telegram now. Only you can control it in private chat unless you explicitly approve another chat."}});
}

export async function handleManagerUpdate(client:pg.PoolClient,update:TelegramUpdate):Promise<void> {
  if(!config.TELEGRAM_MANAGER_BOT_TOKEN||!config.TELEGRAM_INGRESS_ENABLED)return;
  if(update.managed_bot){await registerManagedBot(client,update.managed_bot);return;}
  const message=update.message;
  if(!message?.from||message.from.is_bot)return;
  const {player,creature}=await bootstrapPlayer(client,message.from);
  const onboarding=await getOnboardingState(client,creature.id);
  const text=message.text??"";
  const reply=(suffix:string,payload:Record<string,unknown>)=>enqueueTelegram(client,{chatId:message.chat.id,playerId:player.id,creatureId:creature.id,sourceKey:`telegram-reply:manager:${update.update_id}:${suffix}`,payload});
  if(text.startsWith("/start")){
    if(onboarding.status!=="complete"){
      await reply("start-onboarding",{method:"sendMessage",text:"There is something asleep inside a cardboard nest. It needs you to decide how this story begins.",reply_markup:{inline_keyboard:[[{text:"Open the nest",web_app:{url:config.PUBLIC_BASE_URL}}]]}});return;
    }
    let greeting=`${creature.name} is awake and has already misplaced something important.`;
    const startPayload=text.split(/\s+/)[1];
    if(startPayload?.startsWith("meet_")){
      const met=await recordEncounter(client,player.id,{id:creature.id,name:creature.name,slug:creature.slug},startPayload.slice(5).toLowerCase());
      if(met)greeting=`${creature.name} and ${met.metName} are now officially acquainted.\n\n${greeting}`;
    }
    const buttons:Array<Record<string,unknown>>=[{text:"Open the world",web_app:{url:config.PUBLIC_BASE_URL}}];
    if(config.MANAGED_BOT_FLEET_ENABLED&&config.TELEGRAM_MANAGER_BOT_USERNAME)buttons.push({text:"Give it a bot",url:managedBotCreationLink(creature.name,message.from.id)});
    await reply("start",{method:"sendMessage",text:greeting,reply_markup:{inline_keyboard:[buttons]}});return;
  }
  if(onboarding.status!=="complete"){
    await reply("onboarding-required",{method:"sendMessage",text:"Your creature is still waiting inside the nest. Open Bloopy and finish waking it first.",reply_markup:{inline_keyboard:[[{text:"Open the nest",web_app:{url:config.PUBLIC_BASE_URL}}]]}});return;
  }
  if(text.startsWith("/spawn")){
    if(!config.MANAGED_BOT_FLEET_ENABLED){await reply("fleet-paused",{method:"sendMessage",text:"Managed creature bots are paused right now. Your creature and Mini App are still available."});return;}
    await reply("spawn",{method:"sendMessage",text:"Create a personal Telegram bot for your creature:",reply_markup:{keyboard:[[{text:"Create my creature bot",request_managed_bot:{request_id:Math.floor(Math.random()*2_000_000_000),suggested_name:creature.name,suggested_username:`Bloopy_${message.from.id.toString().slice(-6)}_bot`}}]],resize_keyboard:true,one_time_keyboard:true}});return;
  }
  const action=text.includes("friend")||text.includes("meet")?"social":text.includes("sleep")?"rest":"talk";
  const result=await performActionOnce(client,{creatureId:creature.id,action,commandKey:`telegram:manager:${update.update_id}`});
  await reply("action",{method:"sendMessage",text:`*${result.story.title}*\n\n${result.story.body}`,parse_mode:"Markdown"});
  await client.query(`INSERT INTO memories (creature_id,source_type,summary,importance,is_private,command_key) VALUES ($1,'telegram_text',$2,0.25,true,$3) ON CONFLICT (command_key) WHERE command_key IS NOT NULL DO NOTHING`,[
    creature.id,text.slice(0,400),`telegram-memory:manager:${update.update_id}`
  ]);
}

export async function handleManagedBotUpdate(client:pg.PoolClient,botId:number,update:TelegramUpdate):Promise<void> {
  const message=update.message;
  if(!message?.from||!message.text)return;
  await client.query(`UPDATE managed_bots SET last_webhook_at=now(),updated_at=now() WHERE bot_id=$1`,[botId]);
  if(message.from.is_bot){
    await processBotInteractionTurn(client,{receiverBotId:botId,senderBotId:message.from.id,senderUsername:message.from.username,text:message.text});
    return;
  }
  const registry=await authorizeManagedHuman(client,{botId,telegramUserId:message.from.id,chatId:message.chat.id,chatType:message.chat.type});
  if(!registry)return;
  const action=message.text.includes("/meet")?"social":message.text.includes("/adventure")?"explore":"talk";
  const result=await performActionOnce(client,{creatureId:registry.creatureId,action,commandKey:`telegram:managed:${botId}:${update.update_id}`});
  await enqueueTelegram(client,{botId,chatId:message.chat.id,creatureId:registry.creatureId,sourceKey:`telegram-reply:managed:${botId}:${update.update_id}`,payload:{method:"sendMessage",text:`${result.story.title}\n\n${result.story.body}`}});
}

export async function startBotConversation(client:pg.PoolClient,sourceBotId:number,targetUsername:string):Promise<string> {
  return (await createBotInteraction(client,{sourceBotId,targetUsername})).interactionId;
}

export async function rotateManagedBotToken(ownerTelegramUserId:number,botId:number):Promise<void> {
  if(!config.TELEGRAM_MANAGER_BOT_TOKEN)throw new AppError("manager_bot_token_missing",503,"Managed bot token rotation is temporarily unavailable.");
  await withTransaction((client)=>prepareManagedBotOperation(client,ownerTelegramUserId,botId));
  const token=await botCall<string>(config.TELEGRAM_MANAGER_BOT_TOKEN,"replaceManagedBotToken",{user_id:botId});
  const webhookSecret=randomBytes(24).toString("base64url");
  await withTransaction((client)=>finalizeManagedBotRotation(client,ownerTelegramUserId,botId,seal(token),webhookSecret));
  await configureManagedBot(token,botId,webhookSecret);
  await db.query(`UPDATE managed_bots SET last_webhook_at=now(),updated_at=now() WHERE bot_id=$1`,[botId]);
}

export async function revokeManagedBot(ownerTelegramUserId:number,botId:number):Promise<void> {
  const bot=await withTransaction((client)=>prepareManagedBotOperation(client,ownerTelegramUserId,botId));
  await botCall(open(bot.tokenCipher),"deleteWebhook",{drop_pending_updates:true}).catch(()=>undefined);
  await withTransaction((client)=>finalizeManagedBotRevocation(client,ownerTelegramUserId,botId));
}

export async function migrateManagedWebhooks(runner:pg.Pool):Promise<void> {
  if(!config.MANAGED_BOT_FLEET_ENABLED)return;
  const bots=await runner.query("SELECT bot_id,token_cipher,webhook_secret FROM managed_bots WHERE enabled=true AND revoked_at IS NULL");
  for(const bot of bots.rows){
    try{await configureManagedBot(open(bot.token_cipher),Number(bot.bot_id),String(bot.webhook_secret));await runner.query(`UPDATE managed_bots SET last_webhook_at=now() WHERE bot_id=$1`,[bot.bot_id]);}
    catch(error){console.error({error,botId:bot.bot_id},"managed webhook migration failed");}
  }
}

export async function configureManagerWebhook():Promise<void> {
  if(!config.TELEGRAM_MANAGER_BOT_TOKEN||!config.PUBLIC_BASE_URL.startsWith("https://")||!config.TELEGRAM_INGRESS_ENABLED)return;
  await botCall(config.TELEGRAM_MANAGER_BOT_TOKEN,"setWebhook",{url:`${config.PUBLIC_BASE_URL}/telegram/manager`,secret_token:config.TELEGRAM_WEBHOOK_SECRET,allowed_updates:["message","managed_bot"],drop_pending_updates:false});
  await botCall(config.TELEGRAM_MANAGER_BOT_TOKEN,"setMyCommands",{commands:[{command:"start",description:"Adopt your creature"},{command:"spawn",description:"Give your creature its own bot"}]});
  await botCall(config.TELEGRAM_MANAGER_BOT_TOKEN,"setChatMenuButton",{menu_button:{type:"web_app",text:"Open Bloopy",web_app:{url:config.PUBLIC_BASE_URL}}});
}

export async function dispatchOutbox(client:pg.PoolClient):Promise<number> {
  if(!config.OUTBOX_ENABLED||!config.TELEGRAM_MANAGER_BOT_TOKEN)return 0;
  const result=await client.query(`SELECT * FROM outbox WHERE status='pending' AND available_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 50`);
  for(const row of result.rows){
    try{
      let token=config.TELEGRAM_MANAGER_BOT_TOKEN;
      if(row.bot_id){
        const managed=await client.query(`SELECT token_cipher FROM managed_bots WHERE bot_id=$1 AND enabled=true AND revoked_at IS NULL`,[row.bot_id]);
        if(!managed.rowCount)throw new Error("managed bot is disabled or revoked");
        token=open(String(managed.rows[0].token_cipher));
      }
      const payload=row.payload as Record<string,unknown>&{method?:string};
      const {method,...body}=payload;
      const telegramResult=await botCall<{message_id?:number}>(token,method??"sendMessage",{chat_id:row.chat_id,...body});
      await client.query(`UPDATE outbox SET status='sent',attempts=attempts+1,sent_at=now(),last_error=NULL WHERE id=$1`,[row.id]);
      if(row.bot_id)await client.query(`UPDATE managed_bots SET last_outbound_at=now(),updated_at=now() WHERE bot_id=$1`,[row.bot_id]);
      if(row.daily_return_id){
        await client.query(`UPDATE daily_return_instances SET notification_sent_at=COALESCE(notification_sent_at,now()),updated_at=now() WHERE id=$1`,[row.daily_return_id]);
        if(row.player_id&&row.creature_id)await client.query(`INSERT INTO analytics_events (player_id,creature_id,event_name,properties) VALUES ($1,$2,'daily_return_notification_delivered',$3)`,[row.player_id,row.creature_id,JSON.stringify({dailyReturnId:row.daily_return_id,messageId:telegramResult.message_id??null})]);
      }
    }catch(error){
      const message=(error instanceof Error?error.message:"Telegram delivery failed").slice(0,500);
      await client.query(`UPDATE outbox SET attempts=attempts+1,status=CASE WHEN attempts+1>=7 THEN 'failed' ELSE 'pending' END,available_at=now()+(interval '1 second'*(60*POWER(2,LEAST(attempts,5))+floor(random()*30))),last_error=$2 WHERE id=$1`,[row.id,message]);
      console.error({error,outboxId:row.id},"outbox delivery failed");
    }
  }
  return result.rowCount??0;
}
