import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { z } from "zod";
import { enrichStory } from "./ai.js";
import { resolveRequestUser } from "./auth.js";
import { renderAvatar } from "./avatar.js";
import { config } from "./config.js";
import { db, withTransaction } from "./db.js";
import { bootstrapPlayer, getDashboard, performAction, saveAIProfile } from "./game.js";
import { migrate } from "./migrate.js";
import { buildStory } from "./story.js";
import { configureManagerWebhook, dispatchOutbox, handleManagedBotUpdate, handleManagerUpdate, managedBotCreationLink, startBotConversation, type TelegramUpdate } from "./telegram.js";
import type { AvatarGenome } from "./types.js";
import { processDueEvents } from "./worker.js";

const app=Fastify({logger:{level:config.NODE_ENV==="production"?"info":"debug"}});
const root=join(dirname(fileURLToPath(import.meta.url)),"..","public");
await app.register(cors,{origin:false});
await app.register(rateLimit,{max:120,timeWindow:"1 minute"});
await app.register(fastifyStatic,{root,prefix:"/"});

app.get("/health",async()=>{await db.query("SELECT 1");return {ok:true,service:"bloopy-network",version:"0.1.0"};});

async function authenticatedPlayer(headers:Record<string,string|string[]|undefined>) {
  const initData=typeof headers["x-telegram-init-data"]==="string"?headers["x-telegram-init-data"]:undefined;
  const user=resolveRequestUser(initData);
  return withTransaction((client)=>bootstrapPlayer(client,user));
}

app.get("/api/bootstrap",async(request)=>{const {player}=await authenticatedPlayer(request.headers);return withTransaction((client)=>getDashboard(client,player.id));});
app.post("/api/actions",async(request)=>{
  const body=z.object({action:z.enum(["explore","rest","talk","help","social"])}).parse(request.body);
  const {creature,player}=await authenticatedPlayer(request.headers);
  const profileResult=await db.query("SELECT base_url,model,encrypted_api_key FROM ai_profiles WHERE player_id=$1 AND enabled=true",[player.id]);
  const baseStory=buildStory(body.action,creature.name,creature.personality,Date.now());
  const story=await enrichStory(profileResult.rows[0]??null,baseStory,creature.personality.voice);
  return withTransaction((client)=>performAction(client,creature.id,body.action,story));
});
app.get("/api/creatures/:id/avatar.svg",async(request,reply)=>{const params=z.object({id:z.string().uuid()}).parse(request.params);const result=await db.query("SELECT name,genome FROM creatures WHERE id=$1",[params.id]);if(!result.rowCount)return reply.code(404).send({error:"not found"});reply.header("content-type","image/svg+xml").header("cache-control","public, max-age=300");return renderAvatar(result.rows[0].genome as AvatarGenome,result.rows[0].name);});
app.get("/api/bots/spawn-link",async(request)=>{const {creature,player}=await authenticatedPlayer(request.headers);return {url:managedBotCreationLink(creature.name,Number(player.telegram_user_id))};});
app.post("/api/settings/ai",async(request)=>{const body=z.object({baseUrl:z.string().url(),model:z.string().min(1).max(120),apiKey:z.string().min(1).max(500)}).parse(request.body);const {player}=await authenticatedPlayer(request.headers);await withTransaction((client)=>saveAIProfile(client,player.id,body));return {ok:true};});
app.post("/api/admin/bots/converse",async(request,reply)=>{const adminKey=request.headers["x-admin-key"];if(!process.env.ADMIN_API_KEY||adminKey!==process.env.ADMIN_API_KEY)return reply.code(401).send({error:"unauthorized"});const body=z.object({sourceBotId:z.number().int(),targetUsername:z.string().min(5)}).parse(request.body);const interactionId=await withTransaction((client)=>startBotConversation(client,body.sourceBotId,body.targetUsername));return {interactionId};});
app.post("/telegram/manager",async(request,reply)=>{if(request.headers["x-telegram-bot-api-secret-token"]!==config.TELEGRAM_WEBHOOK_SECRET)return reply.code(401).send({ok:false});await withTransaction((client)=>handleManagerUpdate(client,request.body as TelegramUpdate));return {ok:true};});
app.post("/telegram/managed/:botId/:secret",async(request,reply)=>{const params=z.object({botId:z.coerce.number().int(),secret:z.string().min(20)}).parse(request.params);const registry=await db.query("SELECT token_cipher,webhook_secret FROM managed_bots WHERE bot_id=$1 AND enabled=true",[params.botId]);if(!registry.rowCount||registry.rows[0].webhook_secret!==params.secret)return reply.code(401).send({ok:false});const {open}=await import("./crypto.js");await withTransaction((client)=>handleManagedBotUpdate(client,params.botId,open(registry.rows[0].token_cipher),request.body as TelegramUpdate));return {ok:true};});

app.setErrorHandler((error,_request,reply)=>{
  app.log.error(error);
  const message=error instanceof Error?error.message:"unknown error";
  const status=error instanceof z.ZodError?400:message.includes("auth")||message.includes("signature")?401:500;
  reply.code(status).send({error:status===500?"internal error":message});
});

await migrate();
await configureManagerWebhook().catch((error)=>app.log.error(error));
const workerTimer=setInterval(()=>{void withTransaction(async(client)=>{await processDueEvents(client);await dispatchOutbox(client);}).catch((error)=>app.log.error(error));},15_000);
workerTimer.unref();
await app.listen({host:"0.0.0.0",port:config.PORT});
