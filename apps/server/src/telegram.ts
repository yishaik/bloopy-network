import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { config } from "./config.js";
import { open, seal } from "./crypto.js";
import { bootstrapPlayer, getOnboardingState, performAction } from "./game.js";
import { parseBotConversation } from "./story.js";
import type { TelegramUser } from "./types.js";

export interface TelegramUpdate {
  update_id: number;
  message?: { message_id:number; text?:string; chat:{id:number;type:string}; from?:TelegramUser; managed_bot_created?:{bot:TelegramUser} };
  managed_bot?: { user:TelegramUser; bot:TelegramUser };
}

async function botCall<T>(token:string, method:string, payload:Record<string,unknown>):Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(payload) });
  const data = await response.json() as {ok:boolean;result?:T;description?:string};
  if (!data.ok || data.result===undefined) throw new Error(data.description??`Telegram ${method} failed`);
  return data.result;
}

export function managedBotCreationLink(creatureName:string,userId:number):string {
  if (!config.TELEGRAM_MANAGER_BOT_USERNAME) throw new Error("manager bot username is not configured");
  const suffix=Math.abs(userId).toString().slice(-6);
  return `https://t.me/newbot/${config.TELEGRAM_MANAGER_BOT_USERNAME}/Bloopy_${suffix}_bot?name=${encodeURIComponent(creatureName)}`;
}

async function registerManagedBot(client:pg.PoolClient,update:NonNullable<TelegramUpdate["managed_bot"]>) {
  if (!config.TELEGRAM_MANAGER_BOT_TOKEN) throw new Error("manager bot token missing");
  const token=await botCall<string>(config.TELEGRAM_MANAGER_BOT_TOKEN,"getManagedBotToken",{user_id:update.bot.id});
  const ownerResult=await client.query("SELECT id FROM players WHERE telegram_user_id=$1",[update.user.id]);
  const player=ownerResult.rows[0];
  if (!player) throw new Error("managed bot owner has not started the game");
  const creatureResult=await client.query(`SELECT c.id FROM creatures c JOIN onboarding_states os ON os.creature_id=c.id AND os.status='complete' WHERE c.player_id=$1 AND c.kind='player' LIMIT 1`,[player.id]);
  const creature=creatureResult.rows[0];
  if (!creature) throw new Error("finish creating the creature before giving it a bot");
  const webhookSecret=randomBytes(24).toString("base64url");
  await client.query(`INSERT INTO managed_bots (bot_id,owner_telegram_user_id,creature_id,username,token_cipher,webhook_secret) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (bot_id) DO UPDATE SET username=EXCLUDED.username,token_cipher=EXCLUDED.token_cipher,webhook_secret=EXCLUDED.webhook_secret,enabled=true,updated_at=now()`,[update.bot.id,update.user.id,creature.id,update.bot.username??null,seal(token),webhookSecret]);
  await botCall(token,"setWebhook",{url:`${config.PUBLIC_BASE_URL}/telegram/managed/${update.bot.id}/${webhookSecret}`,allowed_updates:["message"],drop_pending_updates:true});
  await botCall(token,"setMyCommands",{commands:[{command:"start",description:"Wake up your creature"},{command:"adventure",description:"Start a small adventure"},{command:"meet",description:"Meet another creature"}]});
  await botCall(token,"setChatMenuButton",{menu_button:{type:"web_app",text:"Open my world",web_app:{url:config.PUBLIC_BASE_URL}}});
  return token;
}

export async function handleManagerUpdate(client:pg.PoolClient,update:TelegramUpdate):Promise<void> {
  if (!config.TELEGRAM_MANAGER_BOT_TOKEN) return;
  if (update.managed_bot) {
    const token=await registerManagedBot(client,update.managed_bot);
    await botCall(token,"sendMessage",{chat_id:update.managed_bot.user.id,text:"I have my own room in Telegram now. This feels official. Slightly dangerous, but official."});
    return;
  }
  const message=update.message;
  if (!message?.from || message.from.is_bot) return;
  const {creature}=await bootstrapPlayer(client,message.from);
  const onboarding=await getOnboardingState(client,creature.id);
  const text=message.text??"";
  if (text.startsWith("/start")) {
    if(onboarding.status!=="complete") {
      await botCall(config.TELEGRAM_MANAGER_BOT_TOKEN,"sendMessage",{chat_id:message.chat.id,text:"There is something asleep inside a cardboard nest. It needs you to decide how this story begins.",reply_markup:{inline_keyboard:[[{text:"Open the nest",web_app:{url:config.PUBLIC_BASE_URL}}]]}});
      return;
    }
    await botCall(config.TELEGRAM_MANAGER_BOT_TOKEN,"sendMessage",{chat_id:message.chat.id,text:`${creature.name} is awake and has already misplaced something important.`,reply_markup:{inline_keyboard:[[{text:"Open the world",web_app:{url:config.PUBLIC_BASE_URL}},{text:"Give it a bot",url:managedBotCreationLink(creature.name,message.from.id)}]]}});
    return;
  }
  if (onboarding.status!=="complete") {
    await botCall(config.TELEGRAM_MANAGER_BOT_TOKEN,"sendMessage",{chat_id:message.chat.id,text:"Your creature is still waiting inside the nest. Open Bloopy and finish waking it first.",reply_markup:{inline_keyboard:[[{text:"Open the nest",web_app:{url:config.PUBLIC_BASE_URL}}]]}});
    return;
  }
  if (text.startsWith("/spawn")) {
    await botCall(config.TELEGRAM_MANAGER_BOT_TOKEN,"sendMessage",{chat_id:message.chat.id,text:"Create a personal Telegram bot for your creature:",reply_markup:{keyboard:[[{text:"Create my creature bot",request_managed_bot:{request_id:Math.floor(Math.random()*2_000_000_000),suggested_name:creature.name,suggested_username:`Bloopy_${message.from.id.toString().slice(-6)}_bot`}}]],resize_keyboard:true,one_time_keyboard:true}});
    return;
  }
  const action=text.includes("friend")||text.includes("meet")?"social":text.includes("sleep")?"rest":"talk";
  const result=await performAction(client,creature.id,action);
  await botCall(config.TELEGRAM_MANAGER_BOT_TOKEN,"sendMessage",{chat_id:message.chat.id,text:`*${result.story.title}*\n\n${result.story.body}`,parse_mode:"Markdown"});
  await client.query(`INSERT INTO memories (creature_id,source_type,summary,importance,is_private) VALUES ($1,'telegram_text',$2,0.25,true)`,[creature.id,text.slice(0,400)]);
}

export async function handleManagedBotUpdate(client:pg.PoolClient,botId:number,token:string,update:TelegramUpdate):Promise<void> {
  const message=update.message;
  if (!message?.from || !message.text) return;
  const registryResult=await client.query(`SELECT mb.*,c.name,c.personality FROM managed_bots mb JOIN creatures c ON c.id=mb.creature_id WHERE mb.bot_id=$1 AND mb.enabled=true`,[botId]);
  const registry=registryResult.rows[0];
  if (!registry) return;
  if (message.from.is_bot) {
    const command=parseBotConversation(message.text);
    if (!command || command.depth>=4 || !message.from.username) return;
    const reply=command.depth%2===0?`${registry.name}: I found a door under a teaspoon. Your turn to explain why it is humming.`:`${registry.name}: I accept this explanation, but only provisionally.`;
    await botCall(token,"sendMessage",{chat_id:`@${message.from.username}`,text:`${reply}\n\n/bloopy_story ${command.interactionId} ${command.depth+1}`});
    return;
  }
  const action=message.text.includes("/meet")?"social":message.text.includes("/adventure")?"explore":"talk";
  const result=await performAction(client,registry.creature_id,action);
  await botCall(token,"sendMessage",{chat_id:message.chat.id,text:`${result.story.title}\n\n${result.story.body}`});
}

export async function startBotConversation(client:pg.PoolClient,sourceBotId:number,targetUsername:string):Promise<string> {
  const source=await client.query("SELECT token_cipher FROM managed_bots WHERE bot_id=$1 AND enabled=true",[sourceBotId]);
  if (!source.rowCount) throw new Error("source bot not found");
  const interactionId=randomUUID().replaceAll("-","");
  await botCall(open(source.rows[0].token_cipher),"sendMessage",{chat_id:`@${targetUsername.replace(/^@/,"")}`,text:`/bloopy_story ${interactionId} 0`});
  return interactionId;
}

export async function configureManagerWebhook():Promise<void> {
  if (!config.TELEGRAM_MANAGER_BOT_TOKEN || !config.PUBLIC_BASE_URL.startsWith("https://")) return;
  await botCall(config.TELEGRAM_MANAGER_BOT_TOKEN,"setWebhook",{url:`${config.PUBLIC_BASE_URL}/telegram/manager`,secret_token:config.TELEGRAM_WEBHOOK_SECRET,allowed_updates:["message","managed_bot"],drop_pending_updates:false});
  await botCall(config.TELEGRAM_MANAGER_BOT_TOKEN,"setMyCommands",{commands:[{command:"start",description:"Adopt your creature"},{command:"spawn",description:"Give your creature its own bot"}]});
  await botCall(config.TELEGRAM_MANAGER_BOT_TOKEN,"setChatMenuButton",{menu_button:{type:"web_app",text:"Open Bloopy",web_app:{url:config.PUBLIC_BASE_URL}}});
}

export async function dispatchOutbox(client:pg.PoolClient):Promise<number> {
  if (!config.TELEGRAM_MANAGER_BOT_TOKEN) return 0;
  const result=await client.query(`SELECT * FROM outbox WHERE status='pending' AND available_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 50`);
  for (const row of result.rows) {
    try {
      const payload=row.payload as Record<string,unknown>&{method?:string};
      const {method,...body}=payload;
      await botCall(config.TELEGRAM_MANAGER_BOT_TOKEN,method??"sendMessage",{chat_id:row.chat_id,...body});
      await client.query("UPDATE outbox SET status='sent',attempts=attempts+1,sent_at=now(),last_error=NULL WHERE id=$1",[row.id]);
      if(row.daily_return_id) {
        await client.query(`UPDATE daily_return_instances SET notification_sent_at=COALESCE(notification_sent_at,now()),updated_at=now() WHERE id=$1`,[row.daily_return_id]);
        if(row.player_id&&row.creature_id)await client.query(`INSERT INTO analytics_events (player_id,creature_id,event_name,properties) VALUES ($1,$2,'daily_return_notification_delivered',$3)`,[row.player_id,row.creature_id,JSON.stringify({dailyReturnId:row.daily_return_id})]);
      }
    } catch (error) {
      const message=(error instanceof Error?error.message:"Telegram delivery failed").slice(0,500);
      await client.query(`UPDATE outbox SET attempts=attempts+1,status=CASE WHEN attempts+1>=5 THEN 'failed' ELSE 'pending' END,available_at=now()+interval '2 minutes',last_error=$2 WHERE id=$1`,[row.id,message]);
      console.error({error,outboxId:row.id},"outbox delivery failed");
    }
  }
  return result.rowCount??0;
}
