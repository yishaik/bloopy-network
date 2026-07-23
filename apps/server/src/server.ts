import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { z } from "zod";
import { enrichStory, providerKind, type NarrativeContext, type NarrativeMetadata, type StoredAIProfile } from "./ai.js";
import { getAIUsageStatus, reserveAIRequest } from "./ai-policy.js";
import { resolveRequestUser } from "./auth.js";
import { renderAvatar } from "./avatar.js";
import { config } from "./config.js";
import { db, withTransaction } from "./db.js";
import { applyImpossibleDoorChoice, ensureImpossibleDoorArc, getInventory, updateDoorStoryNarrative } from "./door-game.js";
import { assertOnboardingComplete, bootstrapPlayer, completeOnboarding, getDashboard, performAction, saveAIProfile, selectWakeChoice } from "./game.js";
import { approvedMemoryPacket, completeDailyReturn, correctMemory, deleteMemory, latestPersonalityChange, listMemories, recordPlayerActivity, updateDailyReturnNarrative } from "./memory.js";
import { migrate } from "./migrate.js";
import { ensureDailyReturnForDate, getNotificationPreferences, localDateForPlayer, markDailyReturnOpened, saveNotificationPreferences, scheduleDueDailyReturnNotifications } from "./notifications.js";
import {
  beginOpenRouterConnection,
  claimOpenRouterState,
  completeOpenRouterConnection,
  disconnectOpenRouter,
  exchangeOpenRouterCode,
  failOpenRouterConnection,
  getOpenRouterConnection,
  inspectOpenRouterKey,
  markOpenRouterInvalid,
  recordOpenRouterVerification,
  selectOpenRouterMode,
  verifyOpenRouterConnection
} from "./openrouter.js";
import { buildStory } from "./story.js";
import { configureManagerWebhook, dispatchOutbox, handleManagedBotUpdate, handleManagerUpdate, managedBotCreationLink, startBotConversation, type TelegramUpdate } from "./telegram.js";
import type { AvatarGenome, StoryCard } from "./types.js";
import { processDueEvents } from "./worker.js";

const app=Fastify({logger:{level:config.NODE_ENV==="production"?"info":"debug"}});
const root=join(dirname(fileURLToPath(import.meta.url)),"..","public");
await app.register(cors,{origin:false});
await app.register(rateLimit,{max:120,timeWindow:"1 minute"});
await app.register(fastifyStatic,{root,prefix:"/"});

app.get("/health",async()=>{await db.query("SELECT 1");return {ok:true,service:"bloopy-network",version:"0.8.0"};});

async function authenticatedPlayer(headers:Record<string,string|string[]|undefined>) {
  const initData=typeof headers["x-telegram-init-data"]==="string"?headers["x-telegram-init-data"]:undefined;
  const user=resolveRequestUser(initData);
  return withTransaction((client)=>bootstrapPlayer(client,user));
}

async function loadAIProfile(playerId:string):Promise<StoredAIProfile|null> {
  const result=await db.query("SELECT base_url,model,encrypted_api_key FROM ai_profiles WHERE player_id=$1 AND enabled=true AND connection_status='active'",[playerId]);
  return result.rows[0]??null;
}

async function logNarrative(playerId:string,creatureId:string,sceneId:string,metadata:NarrativeMetadata) {
  await db.query(`INSERT INTO ai_generation_logs (player_id,creature_id,scene_id,provider,model,prompt_version,used_ai,fallback_reason,latency_ms,input_chars,output_chars,prompt_tokens,completion_tokens,estimated_cost_microusd)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[
    playerId,creatureId,sceneId,metadata.provider,metadata.model??null,metadata.promptVersion,metadata.usedAI,metadata.fallbackReason??null,
    metadata.latencyMs,metadata.inputChars,metadata.outputChars,metadata.promptTokens??null,metadata.completionTokens??null,metadata.estimatedCostMicrousd
  ]);
  await db.query(`INSERT INTO analytics_events (player_id,creature_id,event_name,properties) VALUES ($1,$2,$3,$4)`,[playerId,creatureId,metadata.usedAI?"ai_enrichment_used":"ai_fallback_used",JSON.stringify({sceneId,provider:metadata.provider,model:metadata.model,promptVersion:metadata.promptVersion,reason:metadata.fallbackReason,latencyMs:metadata.latencyMs,promptTokens:metadata.promptTokens,completionTokens:metadata.completionTokens,estimatedCostMicrousd:metadata.estimatedCostMicrousd})]);
}

async function enrichForPlayer(playerId:string,creatureId:string,voice:string,story:StoryCard,context:NarrativeContext) {
  const profile=await loadAIProfile(playerId);
  const kind=providerKind(profile);
  let skipReason:string|undefined;
  if(kind!=="none") {
    const date=new Date().toISOString().slice(0,10);
    const decision=await withTransaction((client)=>reserveAIRequest(client,playerId,kind,{priority:context.priority??"routine",sampleKey:`${playerId}:${context.sceneId}:${date}`}));
    if(!decision.allowed)skipReason=`policy_${decision.reason??"denied"}`;
  }
  const narrative=await enrichStory(profile,story,voice,context,skipReason?{skipReason}:{});
  await logNarrative(playerId,creatureId,context.sceneId,narrative.metadata).catch((error)=>app.log.warn({error,sceneId:context.sceneId},"AI telemetry failed"));
  return narrative;
}

app.get("/auth/openrouter/callback",{logLevel:"silent",config:{rateLimit:{max:30,timeWindow:"10 minutes"}}},async(request,reply)=>{
  const query=z.object({state:z.string().min(40).max(100),code:z.string().min(8).max(500)}).safeParse(request.query);
  const destination=new URL(config.PUBLIC_BASE_URL);
  if(!query.success){destination.searchParams.set("openrouter","error");destination.searchParams.set("reason","invalid_callback");return reply.redirect(destination.toString());}
  let claim:Awaited<ReturnType<typeof claimOpenRouterState>>|null=null;
  try {
    claim=await withTransaction((client)=>claimOpenRouterState(client,query.data.state));
    const exchange=await exchangeOpenRouterCode(query.data.code,claim.verifier);
    const keyInfo=await inspectOpenRouterKey(exchange.key);
    await withTransaction((client)=>completeOpenRouterConnection(client,claim as NonNullable<typeof claim>,exchange,keyInfo));
    destination.searchParams.set("openrouter","connected");
    return reply.redirect(destination.toString());
  } catch(error) {
    if(claim)await withTransaction((client)=>failOpenRouterConnection(client,claim!.stateHash,"exchange_or_verify_failed")).catch(()=>undefined);
    app.log.warn({event:"openrouter_oauth_failed",hasClaim:Boolean(claim),error:error instanceof Error?error.message:"unknown"},"OpenRouter OAuth failed");
    destination.searchParams.set("openrouter","error");destination.searchParams.set("reason",claim?"connection_failed":"expired_state");
    return reply.redirect(destination.toString());
  }
});

app.get("/api/bootstrap",async(request)=>{
  const {player}=await authenticatedPlayer(request.headers);
  return withTransaction(async(client)=>{
    const dashboard=await getDashboard(client,player.id);
    await recordPlayerActivity(client,player.id,dashboard.creature.id);
    const completed=dashboard.onboarding.status==="complete";
    const local=await localDateForPlayer(client,player.id);
    const storyArc=completed?await ensureImpossibleDoorArc(client,player.id,dashboard.creature.id):null;
    const dailyReturn=completed?await ensureDailyReturnForDate(client,player.id,dashboard.creature.id,local.date):null;
    if(dailyReturn)await markDailyReturnOpened(client,player.id,dashboard.creature.id,dailyReturn.id);
    const [inventory,memories,personalityChange,profile,notifications,openrouter]=await Promise.all([
      getInventory(client,dashboard.creature.id),listMemories(client,dashboard.creature.id),latestPersonalityChange(client,dashboard.creature.id),
      client.query("SELECT 1 FROM ai_profiles WHERE player_id=$1 AND enabled=true AND connection_status='active'",[player.id]),
      getNotificationPreferences(client,player.id),getOpenRouterConnection(client,player.id)
    ]);
    const ai=await getAIUsageStatus(client,player.id,Boolean(profile.rowCount));
    return {...dashboard,storyArc,dailyReturn,inventory,memories,personalityChange,ai,notifications,openrouter};
  });
});

app.post("/api/settings/openrouter/connect",{config:{rateLimit:{max:5,timeWindow:"10 minutes"}}},async(request)=>{
  const {player}=await authenticatedPlayer(request.headers);
  return withTransaction((client)=>beginOpenRouterConnection(client,player.id));
});

app.post("/api/settings/openrouter/model",async(request)=>{
  const body=z.object({mode:z.enum(["balanced","creative","smart"])}).parse(request.body);
  const {player}=await authenticatedPlayer(request.headers);
  return withTransaction((client)=>selectOpenRouterMode(client,player.id,body.mode));
});

app.post("/api/settings/openrouter/verify",{config:{rateLimit:{max:5,timeWindow:"10 minutes"}}},async(request,reply)=>{
  const {player}=await authenticatedPlayer(request.headers);
  const stored=await withTransaction((client)=>verifyOpenRouterConnection(client,player.id));
  try {
    const keyInfo=await inspectOpenRouterKey(stored.key);
    return withTransaction((client)=>recordOpenRouterVerification(client,player.id,keyInfo));
  } catch(error) {
    await withTransaction((client)=>markOpenRouterInvalid(client,player.id));
    app.log.warn({event:"openrouter_verify_failed",playerId:player.id,error:error instanceof Error?error.message:"unknown"},"OpenRouter verification failed");
    return reply.code(502).send({error:"OpenRouter connection is no longer valid"});
  }
});

app.delete("/api/settings/openrouter",async(request)=>{
  const {player}=await authenticatedPlayer(request.headers);
  return {disconnected:await withTransaction((client)=>disconnectOpenRouter(client,player.id))};
});

app.post("/api/settings/notifications",async(request)=>{
  const body=z.object({enabled:z.boolean(),timezone:z.string().min(1).max(80),deliveryTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),quietStart:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),quietEnd:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)}).parse(request.body);
  const {creature,player}=await authenticatedPlayer(request.headers);
  return withTransaction((client)=>saveNotificationPreferences(client,player.id,creature.id,body));
});

app.post("/api/onboarding/wake",async(request)=>{const body=z.object({choice:z.enum(["gentle","noise","snack"])}).parse(request.body);const {creature,player}=await authenticatedPlayer(request.headers);return withTransaction((client)=>selectWakeChoice(client,player.id,creature.id,body.choice));});
app.post("/api/onboarding/identity",async(request)=>{const body=z.object({name:z.string().min(1).max(80),marker:z.enum(["moon","star","dot"])}).parse(request.body);const {creature,player}=await authenticatedPlayer(request.headers);return withTransaction((client)=>completeOnboarding(client,player.id,creature.id,body));});

app.post("/api/story/impossible-door/choice",async(request)=>{
  const body=z.object({beatId:z.string().regex(/^[a-z0-9_-]{2,80}$/),choiceId:z.string().regex(/^[a-z0-9_-]{2,80}$/)}).parse(request.body);
  const {creature,player}=await authenticatedPlayer(request.headers);await withTransaction((client)=>assertOnboardingComplete(client,creature.id));
  const result=await withTransaction((client)=>applyImpossibleDoorChoice(client,player.id,creature.id,body));
  if(!result.replayed&&result.storyEntryId&&result.narrative){const narrative=await enrichForPlayer(player.id,creature.id,creature.personality.voice,result.storyArc.story,{...result.narrative,priority:"high"});await withTransaction((client)=>updateDoorStoryNarrative(client,result.storyEntryId as string,narrative.story.title,narrative.story.body));result.storyArc.story=narrative.story;}
  return result;
});

app.post("/api/daily-return/:id/choice",async(request)=>{
  const params=z.object({id:z.string().uuid()}).parse(request.params);const body=z.object({choice:z.enum(["hold_close","tell_someone","set_down"])}).parse(request.body);
  const {creature,player}=await authenticatedPlayer(request.headers);await withTransaction((client)=>assertOnboardingComplete(client,creature.id));
  const result=await withTransaction((client)=>completeDailyReturn(client,player.id,creature.id,params.id,body.choice));
  if(!result.replayed&&result.storyEntryId){const memories=await withTransaction((client)=>approvedMemoryPacket(client,creature.id));const narrative=await enrichForPlayer(player.id,creature.id,creature.personality.voice,result.story,{sceneId:`daily_return:${params.id}:${body.choice}`,priority:"high",canonicalFacts:[`The daily-return choice was ${body.choice}.`,...memories.map((summary)=>`Approved memory: ${summary}`)],allowedReferences:[creature.name,"Numa","Dr. Sock","Momo",...memories]});await withTransaction((client)=>updateDailyReturnNarrative(client,params.id,result.storyEntryId as string,narrative.story));result.story=narrative.story;result.dailyReturn.result={...result.dailyReturn.result,story:narrative.story};}
  return result;
});

app.post("/api/memories/:id/correct",async(request)=>{const params=z.object({id:z.string().uuid()}).parse(request.params);const body=z.object({summary:z.string().min(3).max(280)}).parse(request.body);const {creature,player}=await authenticatedPlayer(request.headers);return withTransaction((client)=>correctMemory(client,player.id,creature.id,params.id,body.summary));});
app.delete("/api/memories/:id",async(request)=>{const params=z.object({id:z.string().uuid()}).parse(request.params);const {creature,player}=await authenticatedPlayer(request.headers);await withTransaction((client)=>deleteMemory(client,player.id,creature.id,params.id));return {ok:true};});

app.post("/api/actions",async(request)=>{
  const body=z.object({action:z.enum(["explore","rest","talk","help","social"])}).parse(request.body);const {creature,player}=await authenticatedPlayer(request.headers);await withTransaction((client)=>assertOnboardingComplete(client,creature.id));
  const memoryFacts=await withTransaction((client)=>approvedMemoryPacket(client,creature.id));const baseStory=buildStory(body.action,creature.name,creature.personality,Date.now());const sceneId=`game_action:${body.action}`;
  const narrative=await enrichForPlayer(player.id,creature.id,creature.personality.voice,baseStory,{sceneId,priority:"routine",canonicalFacts:[`${creature.name} is the player's creature.`,`The action is ${body.action}.`,...memoryFacts.map((summary)=>`Approved memory: ${summary}`)],allowedReferences:[creature.name,"Numa","Dr. Sock","Momo",...memoryFacts]});
  return withTransaction((client)=>performAction(client,creature.id,body.action,narrative.story));
});

app.get("/api/creatures/:id/avatar.svg",async(request,reply)=>{const params=z.object({id:z.string().uuid()}).parse(request.params);const result=await db.query("SELECT name,genome FROM creatures WHERE id=$1",[params.id]);if(!result.rowCount)return reply.code(404).send({error:"not found"});reply.header("content-type","image/svg+xml").header("cache-control","public, max-age=300");return renderAvatar(result.rows[0].genome as AvatarGenome,result.rows[0].name);});
app.get("/api/bots/spawn-link",async(request)=>{const {creature,player}=await authenticatedPlayer(request.headers);await withTransaction((client)=>assertOnboardingComplete(client,creature.id));return {url:managedBotCreationLink(creature.name,Number(player.telegram_user_id))};});
app.post("/api/settings/ai",async(request)=>{const body=z.object({baseUrl:z.string().url(),model:z.string().min(1).max(120),apiKey:z.string().min(1).max(500)}).parse(request.body);const {player}=await authenticatedPlayer(request.headers);await withTransaction((client)=>saveAIProfile(client,player.id,body));return {ok:true};});
app.post("/api/admin/bots/converse",async(request,reply)=>{const adminKey=request.headers["x-admin-key"];if(!process.env.ADMIN_API_KEY||adminKey!==process.env.ADMIN_API_KEY)return reply.code(401).send({error:"unauthorized"});const body=z.object({sourceBotId:z.number().int(),targetUsername:z.string().min(5)}).parse(request.body);const interactionId=await withTransaction((client)=>startBotConversation(client,body.sourceBotId,body.targetUsername));return {interactionId};});
app.post("/telegram/manager",async(request,reply)=>{if(request.headers["x-telegram-bot-api-secret-token"]!==config.TELEGRAM_WEBHOOK_SECRET)return reply.code(401).send({ok:false});await withTransaction((client)=>handleManagerUpdate(client,request.body as TelegramUpdate));return {ok:true};});
app.post("/telegram/managed/:botId/:secret",async(request,reply)=>{const params=z.object({botId:z.coerce.number().int(),secret:z.string().min(20)}).parse(request.params);const registry=await db.query("SELECT token_cipher,webhook_secret FROM managed_bots WHERE bot_id=$1 AND enabled=true",[params.botId]);if(!registry.rowCount||registry.rows[0].webhook_secret!==params.secret)return reply.code(401).send({ok:false});const {open}=await import("./crypto.js");await withTransaction((client)=>handleManagedBotUpdate(client,params.botId,open(registry.rows[0].token_cipher),request.body as TelegramUpdate));return {ok:true};});

app.setErrorHandler((error,_request,reply)=>{
  app.log.error(error);const message=error instanceof Error?error.message:"unknown error";
  const conflict=message.includes("already selected")||message.includes("must be completed")||message.includes("must be selected first")||message.includes("already moved on")||message.includes("already complete")||message.includes("already corrected")||message.includes("already deleted")||message.includes("already completed")||message.includes("already used")||message.includes("not enough");
  const badInput=message.startsWith("name ")||message.startsWith("memory correction")||message.includes("unsupported characters")||message.includes("choice is not available")||message.includes("world memories cannot")||message.includes("timezone")||message.includes("quiet hours")||message.includes("HH:mm")||message.includes("local return date")||message.includes("OAuth state")||message.includes("OpenRouter mode");
  const notFound=message.includes("not found")||message.includes("not connected");
  const status=error instanceof z.ZodError||badInput?400:message.includes("auth")||message.includes("signature")?401:notFound?404:conflict?409:500;
  reply.code(status).send({error:status===500?"internal error":message});
});

await migrate();
await configureManagerWebhook().catch((error)=>app.log.error(error));
const workerTimer=setInterval(()=>{void withTransaction(async(client)=>{await scheduleDueDailyReturnNotifications(client);await processDueEvents(client);await dispatchOutbox(client);}).catch((error)=>app.log.error(error));},15_000);
workerTimer.unref();
await app.listen({host:"0.0.0.0",port:config.PORT});
