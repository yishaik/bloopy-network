import { timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { z } from "zod";
import { enrichStory, providerKind, type NarrativeContext, type NarrativeMetadata, type StoredAIProfile } from "./ai.js";
import { getAIUsageStatus, reserveAIRequest } from "./ai-policy.js";
import { parseUnsafeStartParam, resolveRequestUser } from "./auth.js";
import { renderAvatar } from "./avatar.js";
import { config } from "./config.js";
import { open } from "./crypto.js";
import { db, withTransaction } from "./db.js";
import { applyStoryArcChoice, ensureActiveStoryArc, getInventory, updateDoorStoryNarrative } from "./door-game.js";
import { AppError } from "./errors.js";
import { assertOnboardingComplete, bootstrapPlayer, buyShopItem, completeOnboarding, getDashboard, performAction, pickSocialTarget, recordEncounter, saveAIProfile, selectWakeChoice } from "./game.js";
import {
  approvedMemoryPacket,
  completeDailyReturn,
  correctMemory,
  deleteMemory,
  latestPersonalityChange,
  listMemories,
  recordPlayerActivity,
  updateDailyReturnNarrative
} from "./memory.js";
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
import { configureManagerWebhook, dispatchOutbox, handleManagedBotUpdate, handleManagerUpdate, managedBotCreationLink, migrateManagedWebhooks, startBotConversation, type TelegramUpdate } from "./telegram.js";
import type { AvatarGenome, StoryCard } from "./types.js";
import { cleanupProcessedWork, processDueEvents } from "./worker.js";

const app=Fastify({logger:{level:config.NODE_ENV==="production"?"info":"debug"},trustProxy:true,bodyLimit:262_144});
const root=join(dirname(fileURLToPath(import.meta.url)),"..","public");
await app.register(cors,{origin:false});
await app.register(rateLimit,{max:120,timeWindow:"1 minute",keyGenerator:(request)=>{
  // Key authenticated traffic by ip+claimed user so one busy chat cannot drain a shared proxy IP bucket.
  const initData=request.headers["x-telegram-init-data"];
  if(typeof initData==="string") {
    try {
      const raw=new URLSearchParams(initData).get("user");
      const id=raw?(JSON.parse(raw) as {id?:number}).id:undefined;
      if(typeof id==="number") return `${request.ip}:${id}`;
    } catch { /* fall through to plain ip */ }
  }
  return request.ip;
}});
await app.register(fastifyStatic,{root,prefix:"/"});

function secureEquals(candidate:unknown,expected:string):boolean {
  if(typeof candidate!=="string"||!candidate||!expected) return false;
  const left=Buffer.from(candidate);
  const right=Buffer.from(expected);
  return left.length===right.length&&timingSafeEqual(left,right);
}

app.get("/health",async()=>{await db.query("SELECT 1");return {ok:true,service:"bloopy-network",version:"0.9.1"};});

function initDataFrom(headers:Record<string,string|string[]|undefined>):string|undefined {
  return typeof headers["x-telegram-init-data"]==="string"?headers["x-telegram-init-data"]:undefined;
}

async function authenticatedPlayer(headers:Record<string,string|string[]|undefined>) {
  const user=await resolveRequestUser(initDataFrom(headers));
  return withTransaction((client)=>bootstrapPlayer(client,user));
}

async function loadAIProfile(playerId:string):Promise<StoredAIProfile|null> {
  const result=await db.query("SELECT base_url,model,encrypted_api_key FROM ai_profiles WHERE player_id=$1 AND enabled=true AND connection_status='active'",[playerId]);
  return result.rows[0]??null;
}

async function logNarrative(playerId:string,creatureId:string,sceneId:string,metadata:NarrativeMetadata) {
  await withTransaction(async(client)=>{
    await client.query(`INSERT INTO ai_generation_logs (player_id,creature_id,scene_id,provider,model,prompt_version,used_ai,fallback_reason,latency_ms,input_chars,output_chars,prompt_tokens,completion_tokens,estimated_cost_microusd)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[
      playerId,creatureId,sceneId,metadata.provider,metadata.model??null,metadata.promptVersion,metadata.usedAI,metadata.fallbackReason??null,
      metadata.latencyMs,metadata.inputChars,metadata.outputChars,metadata.promptTokens??null,metadata.completionTokens??null,metadata.estimatedCostMicrousd
    ]);
    await client.query(`INSERT INTO analytics_events (player_id,creature_id,event_name,properties) VALUES ($1,$2,$3,$4)`,[playerId,creatureId,metadata.usedAI?"ai_enrichment_used":"ai_fallback_used",JSON.stringify({sceneId,provider:metadata.provider,model:metadata.model,promptVersion:metadata.promptVersion,reason:metadata.fallbackReason,latencyMs:metadata.latencyMs,promptTokens:metadata.promptTokens,completionTokens:metadata.completionTokens,estimatedCostMicrousd:metadata.estimatedCostMicrousd})]);
  });
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
  const initData=initDataFrom(request.headers);
  const user=await resolveRequestUser(initData);
  const {player}=await withTransaction((client)=>bootstrapPlayer(client,user));
  return withTransaction(async(client)=>{
    let dashboard=await getDashboard(client,player.id);
    await recordPlayerActivity(client,player.id,dashboard.creature.id);
    const completed=dashboard.onboarding.status==="complete";
    let encounter=null;
    const startParam=initData?parseUnsafeStartParam(initData):null;
    if(startParam?.startsWith("meet_")&&completed) {
      encounter=await recordEncounter(client,player.id,{id:dashboard.creature.id,name:dashboard.creature.name,slug:dashboard.creature.slug},startParam.slice(5).toLowerCase());
      if(encounter) dashboard=await getDashboard(client,player.id);
    }
    const local=await localDateForPlayer(client,player.id);
    const storyArc=completed?await ensureActiveStoryArc(client,player.id,dashboard.creature.id):null;
    const dailyReturn=completed?await ensureDailyReturnForDate(client,player.id,dashboard.creature.id,local.date):null;
    if(dailyReturn)await markDailyReturnOpened(client,player.id,dashboard.creature.id,dailyReturn.id);
    const [inventory,memories,personalityChange,profile,notifications,openrouter]=await Promise.all([
      getInventory(client,dashboard.creature.id),listMemories(client,dashboard.creature.id),latestPersonalityChange(client,dashboard.creature.id),
      client.query("SELECT 1 FROM ai_profiles WHERE player_id=$1 AND enabled=true AND connection_status='active'",[player.id]),
      getNotificationPreferences(client,player.id),getOpenRouterConnection(client,player.id)
    ]);
    const ai=await getAIUsageStatus(client,player.id,Boolean(profile.rowCount));
    return {...dashboard,storyArc,dailyReturn,inventory,memories,personalityChange,ai,notifications,openrouter,managerBotUsername:config.TELEGRAM_MANAGER_BOT_USERNAME??null,encounter};
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

async function handleArcChoice(arcId:string,headers:Record<string,string|string[]|undefined>,body:{beatId:string;choiceId:string}) {
  const {creature,player}=await authenticatedPlayer(headers);
  await withTransaction((client)=>assertOnboardingComplete(client,creature.id));
  const result=await withTransaction((client)=>applyStoryArcChoice(client,player.id,creature.id,{arcId,...body}));
  if(!result.replayed&&result.storyEntryId&&result.narrative) {
    // Canonical text is already committed; AI polish is best-effort and must never fail the request (issue #25).
    try {
      const narrative=await enrichForPlayer(player.id,creature.id,creature.personality.voice,result.storyArc.story,{...result.narrative,priority:"high"});
      if(narrative.metadata.usedAI) {
        await withTransaction((client)=>updateDoorStoryNarrative(client,result.storyEntryId as string,narrative.story.title,narrative.story.body));
        result.storyArc.story=narrative.story;
      }
    } catch(error) {
      app.log.warn({error},"arc narrative enrichment failed; serving canonical text");
    }
  }
  return result;
}

const arcChoiceBody=z.object({beatId:z.string().regex(/^[a-z0-9_-]{2,80}$/),choiceId:z.string().regex(/^[a-z0-9_-]{2,80}$/)});

app.post("/api/story/arc/choice",{config:{rateLimit:{max:30,timeWindow:"1 minute"}}},async(request)=>{
  const body=arcChoiceBody.extend({arcId:z.string().regex(/^[a-z0-9-]{2,60}$/)}).parse(request.body);
  return handleArcChoice(body.arcId,request.headers,{beatId:body.beatId,choiceId:body.choiceId});
});

// Legacy path kept for Mini App clients cached before the second arc shipped.
app.post("/api/story/impossible-door/choice",{config:{rateLimit:{max:30,timeWindow:"1 minute"}}},async(request)=>{
  const body=arcChoiceBody.parse(request.body);
  return handleArcChoice("impossible-door",request.headers,body);
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

app.post("/api/actions",{config:{rateLimit:{max:20,timeWindow:"1 minute"}}},async(request)=>{
  const body=z.object({action:z.enum(["explore","rest","talk","help","social"])}).parse(request.body);
  const {creature,player}=await authenticatedPlayer(request.headers);
  await withTransaction((client)=>assertOnboardingComplete(client,creature.id));
  const socialTarget=body.action==="social"?await pickSocialTarget(db,creature.id):null;
  const memoryFacts=await withTransaction((client)=>approvedMemoryPacket(client,creature.id));
  const baseStory=buildStory(body.action,creature.name,creature.personality,Date.now(),socialTarget?.name);
  const sceneId=`game_action:${body.action}`;
  const narrative=await enrichForPlayer(player.id,creature.id,creature.personality.voice,baseStory,{
    sceneId,
    priority:"routine",
    canonicalFacts:[`${creature.name} is the player's creature.`,`The action is ${body.action}.`,...memoryFacts.map((summary)=>`Approved memory: ${summary}`)],
    allowedReferences:[creature.name,"Numa","Dr. Sock","Momo",...memoryFacts]
  });
  return withTransaction((client)=>performAction(client,creature.id,body.action,narrative.story,socialTarget?.slug));
});

app.post("/api/shop/buy",async(request)=>{
  const body=z.object({itemId:z.enum(["warm_snack","accessory_swap"])}).parse(request.body);
  const {creature,player}=await authenticatedPlayer(request.headers);
  return withTransaction((client)=>buyShopItem(client,player.id,creature.id,body.itemId));
});

app.get("/api/creatures/:id/avatar.svg",async(request,reply)=>{const params=z.object({id:z.string().uuid()}).parse(request.params);const result=await db.query("SELECT name,genome FROM creatures WHERE id=$1",[params.id]);if(!result.rowCount)return reply.code(404).send({error:"not found"});reply.header("content-type","image/svg+xml").header("cache-control","public, max-age=300");return renderAvatar(result.rows[0].genome as AvatarGenome,result.rows[0].name);});
app.get("/api/bots/spawn-link",async(request)=>{const {creature,player}=await authenticatedPlayer(request.headers);await withTransaction((client)=>assertOnboardingComplete(client,creature.id));return {url:managedBotCreationLink(creature.name,Number(player.telegram_user_id))};});
app.post("/api/settings/ai",async(request)=>{const body=z.object({baseUrl:z.string().url(),model:z.string().min(1).max(120),apiKey:z.string().min(1).max(500)}).parse(request.body);const {player}=await authenticatedPlayer(request.headers);await withTransaction((client)=>saveAIProfile(client,player.id,body));return {ok:true};});

app.post("/api/admin/bots/converse",{config:{rateLimit:{max:30,timeWindow:"1 minute"}}},async(request,reply)=>{
  if(!config.ADMIN_API_KEY||!secureEquals(request.headers["x-admin-key"],config.ADMIN_API_KEY))return reply.code(401).send({error:"unauthorized"});
  const body=z.object({sourceBotId:z.number().int(),targetUsername:z.string().min(5)}).parse(request.body);
  const interactionId=await withTransaction((client)=>startBotConversation(client,body.sourceBotId,body.targetUsername));
  return {interactionId};
});

app.get("/api/admin/metrics",{config:{rateLimit:{max:30,timeWindow:"1 minute"}}},async(request,reply)=>{
  if(!config.ADMIN_API_KEY||!secureEquals(request.headers["x-admin-key"],config.ADMIN_API_KEY))return reply.code(401).send({error:"unauthorized"});
  const [outbox,workerLag,ai,events]=await Promise.all([
    db.query("SELECT status,count(*)::int AS count FROM outbox GROUP BY status"),
    db.query("SELECT count(*)::int AS due_pending,COALESCE(EXTRACT(EPOCH FROM (now()-min(due_at)))::int,0) AS oldest_due_seconds FROM world_events WHERE status='pending' AND due_at<=now()"),
    db.query("SELECT used_ai,count(*)::int AS count,COALESCE(avg(latency_ms),0)::int AS avg_latency_ms FROM ai_generation_logs WHERE created_at>now()-interval '24 hours' GROUP BY used_ai"),
    db.query("SELECT event_name,count(*)::int AS count FROM analytics_events WHERE created_at>now()-interval '24 hours' GROUP BY event_name ORDER BY count DESC LIMIT 30")
  ]);
  return {outbox:outbox.rows,worker:workerLag.rows[0],ai24h:ai.rows,events24h:events.rows};
});

async function processManagedUpdate(botId:number,tokenCipher:string,update:TelegramUpdate) {
  if(typeof update?.update_id!=="number") return {ok:true};
  await withTransaction(async(client)=>{
    const claimed=await client.query(`INSERT INTO telegram_updates (source,update_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,[`managed:${botId}`,update.update_id]);
    if(!claimed.rowCount) return;
    await handleManagedBotUpdate(client,botId,open(tokenCipher),update);
  });
  return {ok:true};
}

app.post("/telegram/manager",{config:{rateLimit:{max:300,timeWindow:"1 minute"}}},async(request,reply)=>{
  if(!secureEquals(request.headers["x-telegram-bot-api-secret-token"],config.TELEGRAM_WEBHOOK_SECRET))return reply.code(401).send({ok:false});
  const update=request.body as TelegramUpdate;
  if(typeof update?.update_id!=="number") return {ok:true};
  await withTransaction(async(client)=>{
    const claimed=await client.query(`INSERT INTO telegram_updates (source,update_id) VALUES ('manager',$1) ON CONFLICT DO NOTHING`,[update.update_id]);
    if(!claimed.rowCount) return;
    await handleManagerUpdate(client,update);
  });
  return {ok:true};
});

app.post("/telegram/managed/:botId",{config:{rateLimit:{max:300,timeWindow:"1 minute"}}},async(request,reply)=>{
  const params=z.object({botId:z.coerce.number().int()}).parse(request.params);
  const registry=await db.query("SELECT token_cipher,webhook_secret FROM managed_bots WHERE bot_id=$1 AND enabled=true",[params.botId]);
  if(!registry.rowCount||!secureEquals(request.headers["x-telegram-bot-api-secret-token"],registry.rows[0].webhook_secret))return reply.code(401).send({ok:false});
  return processManagedUpdate(params.botId,registry.rows[0].token_cipher,request.body as TelegramUpdate);
});

// Legacy path-secret webhooks; kept while boot-time migrateManagedWebhooks re-registers older bots (issue #21).
app.post("/telegram/managed/:botId/:secret",{config:{rateLimit:{max:300,timeWindow:"1 minute"}}},async(request,reply)=>{
  const params=z.object({botId:z.coerce.number().int(),secret:z.string().min(20)}).parse(request.params);
  const registry=await db.query("SELECT token_cipher,webhook_secret FROM managed_bots WHERE bot_id=$1 AND enabled=true",[params.botId]);
  if(!registry.rowCount||!secureEquals(params.secret,registry.rows[0].webhook_secret))return reply.code(401).send({ok:false});
  return processManagedUpdate(params.botId,registry.rows[0].token_cipher,request.body as TelegramUpdate);
});

app.setErrorHandler((error,_request,reply)=>{
  if(error instanceof AppError) {
    if(error.httpStatus>=500) app.log.error(error); else app.log.info({code:error.code},"request rejected");
    return reply.code(error.httpStatus).send({error:error.userMessage,code:error.code});
  }
  if(error instanceof z.ZodError) return reply.code(400).send({error:"That request didn't look quite right. Try again?",code:"bad_input"});
  const statusCode=(error as {statusCode?:number}).statusCode;
  if(typeof statusCode==="number"&&statusCode>=400&&statusCode<500) return reply.code(statusCode).send({error:statusCode===429?"Too many things at once — the creature needs a breath.":"That request didn't look quite right.",code:`http_${statusCode}`});
  app.log.error(error);
  return reply.code(500).send({error:"Something wobbled on our side. Try again in a moment.",code:"internal"});
});

await migrate();
await configureManagerWebhook().catch((error)=>app.log.error(error));
if(config.PUBLIC_BASE_URL.startsWith("https://")) await migrateManagedWebhooks(db).catch((error)=>app.log.error(error));
let workerTick=0;
const workerTimer=setInterval(()=>{
  workerTick+=1;
  const runCleanup=workerTick%40===0;
  void withTransaction(async(client)=>{
    await scheduleDueDailyReturnNotifications(client);
    await processDueEvents(client);
    await dispatchOutbox(client);
    if(runCleanup) await cleanupProcessedWork(client);
  }).catch((error)=>app.log.error(error));
},15_000);
workerTimer.unref();
await app.listen({host:"0.0.0.0",port:config.PORT});
