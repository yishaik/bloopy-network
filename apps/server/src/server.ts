import { timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { z } from "zod";
import { assertConfirmation, deleteAccount, exportPlayerData, resetCreature, resolveAccountScope } from "./account.js";
import { enrichStory, providerKind, type NarrativeContext, type NarrativeMetadata, type StoredAIProfile } from "./ai.js";
import { getAIUsageStatus, reserveAIRequest } from "./ai-policy.js";
import { parseUnsafeStartParam, resolveRequestUser } from "./auth.js";
import { renderAvatar } from "./avatar.js";
import { config } from "./config.js";
import {
  enqueueTelegramUpdate,
  listProblemDeliveries,
  mutationsAllowed,
  processOutboxBatch,
  processTelegramIngressBatch,
  readinessSnapshot,
  recoverExpiredLeases,
  replayOutboxItem,
  setRuntimeControl,
  type RuntimeControlKey
} from "./delivery-runtime.js";
import { db, withTransaction } from "./db.js";
import { applyStoryArcChoice, ensureActiveStoryArc, getInventory, updateDoorStoryNarrative } from "./door-game.js";
import { AppError } from "./errors.js";
import { assertOnboardingComplete, bootstrapPlayer, buyShopItem, completeOnboarding, getDashboard, performAction, pickSocialTarget, recordEncounter, saveAIProfile, selectWakeChoice } from "./game.js";
import { approvedMemoryPacket, completeDailyReturn, correctMemory, deleteMemory, latestPersonalityChange, listMemories, recordPlayerActivity, updateDailyReturnNarrative } from "./memory.js";
import { migrate } from "./migrate.js";
import { ensureDailyReturnForDate, getNotificationPreferences, localDateForPlayer, markDailyReturnOpened, saveNotificationPreferences, scheduleDueDailyReturnNotifications } from "./notifications.js";
import { beginOpenRouterConnection, claimOpenRouterState, completeOpenRouterConnection, disconnectOpenRouter, exchangeOpenRouterCode, failOpenRouterConnection, getOpenRouterConnection, inspectOpenRouterKey, markOpenRouterInvalid, recordOpenRouterVerification, selectOpenRouterMode, verifyOpenRouterConnection } from "./openrouter.js";
import { attributeReferral, loadShareCard, meetLink, renderProfileCard, renderSharePage, renderStoryCard, shareSummary, shareUrl } from "./share.js";
import { buildStory } from "./story.js";
import { listOwnedManagedBots, setManagedBotInteractionConsent, upsertManagedBotAccessRule } from "./telegram-control.js";
import { configureManagerWebhook, managedBotCreationLink, migrateManagedWebhooks, revokeManagedBot, rotateManagedBotToken, startBotConversation, type TelegramUpdate } from "./telegram.js";
import type { AvatarGenome, StoryCard } from "./types.js";
import { replayProcessedUpdate, verificationSnapshot } from "./verification.js";
import { SERVICE_NAME, SERVICE_VERSION } from "./version.js";
import { cleanupProcessedWork, processDueEvents } from "./worker.js";

const app=Fastify({logger:{level:config.NODE_ENV==="production"?"info":"debug"},trustProxy:true,bodyLimit:262_144});
const root=join(dirname(fileURLToPath(import.meta.url)),"..","public");
await app.register(cors,{origin:false});
await app.register(rateLimit,{max:120,timeWindow:"1 minute",keyGenerator:(request)=>{
  const initData=request.headers["x-telegram-init-data"];
  if(typeof initData==="string"){
    try{const raw=new URLSearchParams(initData).get("user");const id=raw?(JSON.parse(raw) as {id?:number}).id:undefined;if(typeof id==="number")return `${request.ip}:${id}`;}catch{/* fall through */}
  }
  return request.ip;
}});
await app.register(fastifyStatic,{root,prefix:"/"});

function secureEquals(candidate:unknown,expected:string):boolean{if(typeof candidate!=="string"||!candidate||!expected)return false;const left=Buffer.from(candidate);const right=Buffer.from(expected);return left.length===right.length&&timingSafeEqual(left,right)}
function initDataFrom(headers:Record<string,string|string[]|undefined>):string|undefined{return typeof headers["x-telegram-init-data"]==="string"?headers["x-telegram-init-data"]:undefined}
function isAdmin(headers:Record<string,string|string[]|undefined>):boolean{return Boolean(config.ADMIN_API_KEY&&secureEquals(headers["x-admin-key"],config.ADMIN_API_KEY))}
async function authenticatedPlayer(headers:Record<string,string|string[]|undefined>){const user=await resolveRequestUser(initDataFrom(headers));return withTransaction((client)=>bootstrapPlayer(client,user))}

app.addHook("preHandler",async(request,reply)=>{
  if(!["POST","PUT","PATCH","DELETE"].includes(request.method))return;
  if(!request.url.startsWith("/api/")||request.url.startsWith("/api/admin/runtime/")||request.url.startsWith("/api/admin/outbox/"))return;
  const allowed=await withTransaction((client)=>mutationsAllowed(client));
  if(!allowed)return reply.code(503).send({error:"Bloopy is in safe read-only mode while the world steadies itself.",code:"degraded_mode"});
});

app.get("/livez",async()=>({ok:true,service:SERVICE_NAME,version:SERVICE_VERSION}));
app.get("/readyz",async(_request,reply)=>{try{const snapshot=await withTransaction((client)=>readinessSnapshot(client));return snapshot.ready?{...snapshot,version:SERVICE_VERSION}:reply.code(503).send({...snapshot,version:SERVICE_VERSION});}catch(error){app.log.error(error);return reply.code(503).send({ready:false,version:SERVICE_VERSION,error:"database_unavailable"});}});
app.get("/health",async()=>{await db.query("SELECT 1");return {ok:true,service:SERVICE_NAME,version:SERVICE_VERSION};});

async function loadAIProfile(playerId:string):Promise<StoredAIProfile|null>{const result=await db.query("SELECT base_url,model,encrypted_api_key FROM ai_profiles WHERE player_id=$1 AND enabled=true AND connection_status='active'",[playerId]);return result.rows[0]??null}
async function logNarrative(playerId:string,creatureId:string,sceneId:string,metadata:NarrativeMetadata){await withTransaction(async(client)=>{await client.query(`INSERT INTO ai_generation_logs (player_id,creature_id,scene_id,provider,model,prompt_version,used_ai,fallback_reason,latency_ms,input_chars,output_chars,prompt_tokens,completion_tokens,estimated_cost_microusd) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[playerId,creatureId,sceneId,metadata.provider,metadata.model??null,metadata.promptVersion,metadata.usedAI,metadata.fallbackReason??null,metadata.latencyMs,metadata.inputChars,metadata.outputChars,metadata.promptTokens??null,metadata.completionTokens??null,metadata.estimatedCostMicrousd]);await client.query(`INSERT INTO analytics_events (player_id,creature_id,event_name,properties) VALUES ($1,$2,$3,$4)`,[playerId,creatureId,metadata.usedAI?"ai_enrichment_used":"ai_fallback_used",JSON.stringify({sceneId,provider:metadata.provider,model:metadata.model,promptVersion:metadata.promptVersion,reason:metadata.fallbackReason,latencyMs:metadata.latencyMs,promptTokens:metadata.promptTokens,completionTokens:metadata.completionTokens,estimatedCostMicrousd:metadata.estimatedCostMicrousd})]);})}
async function enrichForPlayer(playerId:string,creatureId:string,voice:string,story:StoryCard,context:NarrativeContext){const profile=await loadAIProfile(playerId);const kind=providerKind(profile);let skipReason:string|undefined;if(kind!=="none"){const date=new Date().toISOString().slice(0,10);const decision=await withTransaction((client)=>reserveAIRequest(client,playerId,kind,{priority:context.priority??"routine",sampleKey:`${playerId}:${context.sceneId}:${date}`}));if(!decision.allowed)skipReason=`policy_${decision.reason??"denied"}`;}const narrative=await enrichStory(profile,story,voice,context,skipReason?{skipReason}:{});await logNarrative(playerId,creatureId,context.sceneId,narrative.metadata).catch((error)=>app.log.warn({error,sceneId:context.sceneId},"AI telemetry failed"));return narrative}

app.get("/auth/openrouter/callback",{logLevel:"silent",config:{rateLimit:{max:30,timeWindow:"10 minutes"}}},async(request,reply)=>{const query=z.object({state:z.string().min(40).max(100),code:z.string().min(8).max(500)}).safeParse(request.query);const destination=new URL(config.PUBLIC_BASE_URL);if(!query.success){destination.searchParams.set("openrouter","error");destination.searchParams.set("reason","invalid_callback");return reply.redirect(destination.toString());}let claim:Awaited<ReturnType<typeof claimOpenRouterState>>|null=null;try{claim=await withTransaction((client)=>claimOpenRouterState(client,query.data.state));const exchange=await exchangeOpenRouterCode(query.data.code,claim.verifier);const keyInfo=await inspectOpenRouterKey(exchange.key);await withTransaction((client)=>completeOpenRouterConnection(client,claim as NonNullable<typeof claim>,exchange,keyInfo));destination.searchParams.set("openrouter","connected");return reply.redirect(destination.toString());}catch(error){if(claim)await withTransaction((client)=>failOpenRouterConnection(client,claim!.stateHash,"exchange_or_verify_failed")).catch(()=>undefined);app.log.warn({event:"openrouter_oauth_failed",hasClaim:Boolean(claim),error:error instanceof Error?error.message:"unknown"},"OpenRouter OAuth failed");destination.searchParams.set("openrouter","error");destination.searchParams.set("reason",claim?"connection_failed":"expired_state");return reply.redirect(destination.toString());}});

app.get("/api/bootstrap",async(request)=>{const initData=initDataFrom(request.headers);const user=await resolveRequestUser(initData);const {player}=await withTransaction((client)=>bootstrapPlayer(client,user));return withTransaction(async(client)=>{let dashboard=await getDashboard(client,player.id);await recordPlayerActivity(client,player.id,dashboard.creature.id);const completed=dashboard.onboarding.status==="complete";let encounter=null;const startParam=initData?parseUnsafeStartParam(initData):null;const meetRef=startParam?.startsWith("meet_")?startParam.slice(5).toLowerCase():null;if(meetRef){if(completed){encounter=await recordEncounter(client,player.id,{id:dashboard.creature.id,name:dashboard.creature.name,slug:dashboard.creature.slug},meetRef);if(encounter)dashboard=await getDashboard(client,player.id);}else{
  // A player who has not woken their creature yet is arriving for the first time; that is the only
  // moment a referral can be attributed. It pays out when their creature is actually alive.
  await attributeReferral(client,{referredPlayerId:player.id,referrerRef:meetRef});}}const local=await localDateForPlayer(client,player.id);const storyArc=completed?await ensureActiveStoryArc(client,player.id,dashboard.creature.id):null;const dailyReturn=completed?await ensureDailyReturnForDate(client,player.id,dashboard.creature.id,local.date):null;if(dailyReturn)await markDailyReturnOpened(client,player.id,dashboard.creature.id,dailyReturn.id);const [inventory,memories,personalityChange,profile,notifications,openrouter]=await Promise.all([getInventory(client,dashboard.creature.id),listMemories(client,dashboard.creature.id),latestPersonalityChange(client,dashboard.creature.id),client.query("SELECT 1 FROM ai_profiles WHERE player_id=$1 AND enabled=true AND connection_status='active'",[player.id]),getNotificationPreferences(client,player.id),getOpenRouterConnection(client,player.id)]);const ai=await getAIUsageStatus(client,player.id,Boolean(profile.rowCount));return {...dashboard,storyArc,dailyReturn,inventory,memories,personalityChange,ai,notifications,openrouter,managerBotUsername:config.TELEGRAM_MANAGER_BOT_USERNAME??null,encounter};});});

// Public share surfaces. Keyed by an opaque token rather than the slug, which encodes the owner's
// Telegram user id, and rendered from a fixed set of non-private fields.
const shareParams=z.object({token:z.string().regex(/^[a-f0-9]{8,40}$/)});
async function shareView(token:string){return withTransaction((client)=>loadShareCard(client,token));}
const shareRoute={config:{rateLimit:{max:60,timeWindow:"1 minute"}}};

app.get("/share/c/:token",shareRoute,async(request,reply)=>{
  const params=shareParams.safeParse(request.params);
  const view=params.success?await shareView(params.data.token):null;
  if(!view)return reply.code(404).type("text/html; charset=utf-8").send("<!doctype html><meta charset=\"UTF-8\"><title>Not found</title><p>This creature card is no longer available.</p>");
  return reply.type("text/html; charset=utf-8").header("cache-control","public, max-age=300").send(renderSharePage(view,config.TELEGRAM_MANAGER_BOT_USERNAME));
});
app.get("/share/c/:token/profile.svg",shareRoute,async(request,reply)=>{
  const params=shareParams.safeParse(request.params);
  const view=params.success?await shareView(params.data.token):null;
  if(!view)return reply.code(404).send({error:"not found"});
  return reply.type("image/svg+xml").header("cache-control","public, max-age=300").send(renderProfileCard(view));
});
app.get("/share/c/:token/story.svg",shareRoute,async(request,reply)=>{
  const params=shareParams.safeParse(request.params);
  const view=params.success?await shareView(params.data.token):null;
  if(!view)return reply.code(404).send({error:"not found"});
  return reply.type("image/svg+xml").header("cache-control","public, max-age=300").send(renderStoryCard(view));
});
// The text-only representation every card renders, for clients that cannot show an image at all.
app.get("/share/c/:token/summary.txt",shareRoute,async(request,reply)=>{
  const params=shareParams.safeParse(request.params);
  const view=params.success?await shareView(params.data.token):null;
  if(!view)return reply.code(404).type("text/plain; charset=utf-8").send("This creature card is no longer available.\n");
  return reply.type("text/plain; charset=utf-8").header("cache-control","public, max-age=300").send(`${shareSummary(view)}\n${meetLink(view,config.TELEGRAM_MANAGER_BOT_USERNAME)}\n`);
});

app.get("/api/share",async(request)=>{
  const {creature}=await authenticatedPlayer(request.headers);
  const token=await db.query("SELECT share_token FROM creatures WHERE id=$1",[creature.id]);
  const view=await shareView(String(token.rows[0].share_token));
  if(!view)return {ready:false};
  return {ready:true,url:shareUrl(view),meetUrl:meetLink(view,config.TELEGRAM_MANAGER_BOT_USERNAME),summary:shareSummary(view)};
});

app.post("/api/settings/openrouter/connect",{config:{rateLimit:{max:5,timeWindow:"10 minutes"}}},async(request)=>{const {player}=await authenticatedPlayer(request.headers);return withTransaction((client)=>beginOpenRouterConnection(client,player.id));});
app.post("/api/settings/openrouter/model",async(request)=>{const body=z.object({mode:z.enum(["balanced","creative","smart"])}).parse(request.body);const {player}=await authenticatedPlayer(request.headers);return withTransaction((client)=>selectOpenRouterMode(client,player.id,body.mode));});
app.post("/api/settings/openrouter/verify",{config:{rateLimit:{max:5,timeWindow:"10 minutes"}}},async(request,reply)=>{const {player}=await authenticatedPlayer(request.headers);const stored=await withTransaction((client)=>verifyOpenRouterConnection(client,player.id));try{const keyInfo=await inspectOpenRouterKey(stored.key);return withTransaction((client)=>recordOpenRouterVerification(client,player.id,keyInfo));}catch(error){await withTransaction((client)=>markOpenRouterInvalid(client,player.id));app.log.warn({event:"openrouter_verify_failed",playerId:player.id,error:error instanceof Error?error.message:"unknown"},"OpenRouter verification failed");return reply.code(502).send({error:"OpenRouter connection is no longer valid"});}});
app.delete("/api/settings/openrouter",async(request)=>{const {player}=await authenticatedPlayer(request.headers);return {disconnected:await withTransaction((client)=>disconnectOpenRouter(client,player.id))};});
app.post("/api/settings/notifications",async(request)=>{const body=z.object({enabled:z.boolean(),timezone:z.string().min(1).max(80),deliveryTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),quietStart:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),quietEnd:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)}).parse(request.body);const {creature,player}=await authenticatedPlayer(request.headers);return withTransaction((client)=>saveNotificationPreferences(client,player.id,creature.id,body));});
app.post("/api/onboarding/wake",async(request)=>{const body=z.object({choice:z.enum(["gentle","noise","snack"])}).parse(request.body);const {creature,player}=await authenticatedPlayer(request.headers);return withTransaction((client)=>selectWakeChoice(client,player.id,creature.id,body.choice));});
app.post("/api/onboarding/identity",async(request)=>{const body=z.object({name:z.string().min(1).max(80),marker:z.enum(["moon","star","dot"])}).parse(request.body);const {creature,player}=await authenticatedPlayer(request.headers);return withTransaction((client)=>completeOnboarding(client,player.id,creature.id,body));});

async function handleArcChoice(arcId:string,headers:Record<string,string|string[]|undefined>,body:{beatId:string;choiceId:string}){const {creature,player}=await authenticatedPlayer(headers);await withTransaction((client)=>assertOnboardingComplete(client,creature.id));const result=await withTransaction((client)=>applyStoryArcChoice(client,player.id,creature.id,{arcId,...body}));if(!result.replayed&&result.storyEntryId&&result.narrative){try{const narrative=await enrichForPlayer(player.id,creature.id,creature.personality.voice,result.storyArc.story,{...result.narrative,priority:"high"});if(narrative.metadata.usedAI){await withTransaction((client)=>updateDoorStoryNarrative(client,result.storyEntryId as string,narrative.story.title,narrative.story.body));result.storyArc.story=narrative.story;}}catch(error){app.log.warn({error},"arc narrative enrichment failed; serving canonical text");}}return result;}
const arcChoiceBody=z.object({beatId:z.string().regex(/^[a-z0-9_-]{2,80}$/),choiceId:z.string().regex(/^[a-z0-9_-]{2,80}$/)});
app.post("/api/story/arc/choice",{config:{rateLimit:{max:30,timeWindow:"1 minute"}}},async(request)=>{const body=arcChoiceBody.extend({arcId:z.string().regex(/^[a-z0-9-]{2,60}$/)}).parse(request.body);return handleArcChoice(body.arcId,request.headers,{beatId:body.beatId,choiceId:body.choiceId});});
app.post("/api/story/impossible-door/choice",{config:{rateLimit:{max:30,timeWindow:"1 minute"}}},async(request)=>{const body=arcChoiceBody.parse(request.body);return handleArcChoice("impossible-door",request.headers,body);});
app.post("/api/daily-return/:id/choice",async(request)=>{const params=z.object({id:z.string().uuid()}).parse(request.params);const body=z.object({choice:z.enum(["hold_close","tell_someone","set_down"])}).parse(request.body);const {creature,player}=await authenticatedPlayer(request.headers);await withTransaction((client)=>assertOnboardingComplete(client,creature.id));const result=await withTransaction((client)=>completeDailyReturn(client,player.id,creature.id,params.id,body.choice));if(!result.replayed&&result.storyEntryId){const memories=await withTransaction((client)=>approvedMemoryPacket(client,creature.id));const narrative=await enrichForPlayer(player.id,creature.id,creature.personality.voice,result.story,{sceneId:`daily_return:${params.id}:${body.choice}`,priority:"high",canonicalFacts:[`The daily-return choice was ${body.choice}.`,...memories.map((summary)=>`Approved memory: ${summary}`)],allowedReferences:[creature.name,"Numa","Dr. Sock","Momo",...memories]});await withTransaction((client)=>updateDailyReturnNarrative(client,params.id,result.storyEntryId as string,narrative.story));result.story=narrative.story;result.dailyReturn.result={...result.dailyReturn.result,story:narrative.story};}return result;});
app.post("/api/memories/:id/correct",async(request)=>{const params=z.object({id:z.string().uuid()}).parse(request.params);const body=z.object({summary:z.string().min(3).max(280)}).parse(request.body);const {creature,player}=await authenticatedPlayer(request.headers);return withTransaction((client)=>correctMemory(client,player.id,creature.id,params.id,body.summary));});
app.delete("/api/memories/:id",async(request)=>{const params=z.object({id:z.string().uuid()}).parse(request.params);const {creature,player}=await authenticatedPlayer(request.headers);await withTransaction((client)=>deleteMemory(client,player.id,creature.id,params.id));return {ok:true};});
app.post("/api/actions",{config:{rateLimit:{max:20,timeWindow:"1 minute"}}},async(request)=>{const body=z.object({action:z.enum(["explore","rest","talk","help","social"])}).parse(request.body);const {creature,player}=await authenticatedPlayer(request.headers);await withTransaction((client)=>assertOnboardingComplete(client,creature.id));const socialTarget=body.action==="social"?await pickSocialTarget(db,creature.id):null;const memoryFacts=await withTransaction((client)=>approvedMemoryPacket(client,creature.id));const baseStory=buildStory(body.action,creature.name,creature.personality,Date.now(),socialTarget?.name);const narrative=await enrichForPlayer(player.id,creature.id,creature.personality.voice,baseStory,{sceneId:`game_action:${body.action}`,priority:"routine",canonicalFacts:[`${creature.name} is the player's creature.`,`The action is ${body.action}.`,...memoryFacts.map((summary)=>`Approved memory: ${summary}`)],allowedReferences:[creature.name,"Numa","Dr. Sock","Momo",...memoryFacts]});return withTransaction((client)=>performAction(client,creature.id,body.action,narrative.story,socialTarget?.slug));});
app.post("/api/shop/buy",async(request)=>{const body=z.object({itemId:z.enum(["warm_snack","accessory_swap"])}).parse(request.body);const {creature,player}=await authenticatedPlayer(request.headers);return withTransaction((client)=>buyShopItem(client,player.id,creature.id,body.itemId));});
app.get("/api/creatures/:id/avatar.svg",async(request,reply)=>{const params=z.object({id:z.string().uuid()}).parse(request.params);const result=await db.query("SELECT name,genome FROM creatures WHERE id=$1",[params.id]);if(!result.rowCount)return reply.code(404).send({error:"not found"});reply.header("content-type","image/svg+xml").header("cache-control","public, max-age=300");return renderAvatar(result.rows[0].genome as AvatarGenome,result.rows[0].name);});
app.get("/api/bots/spawn-link",async(request)=>{const {creature,player}=await authenticatedPlayer(request.headers);await withTransaction((client)=>assertOnboardingComplete(client,creature.id));return {url:managedBotCreationLink(creature.name,Number(player.telegram_user_id))};});
app.post("/api/settings/ai",async(request)=>{const body=z.object({baseUrl:z.string().url(),model:z.string().min(1).max(120),apiKey:z.string().min(1).max(500)}).parse(request.body);const {player}=await authenticatedPlayer(request.headers);await withTransaction((client)=>saveAIProfile(client,player.id,body));return {ok:true};});

// Managed bots hold live Telegram webhooks, so they are revoked over the network before the rows
// that authorize them disappear. Failures are tolerated: once the registry row is gone the webhook
// endpoint rejects the bot anyway, and a blocked revoke must not trap a player in their own data.
async function revokeBotsForAccount(playerId:string,telegramUserId:number):Promise<string[]>{
  const scope=await withTransaction((client)=>resolveAccountScope(client,playerId));
  const revoked:string[]=[];
  for(const botId of scope.botIds){
    try{await revokeManagedBot(telegramUserId,Number(botId));revoked.push(botId);}
    catch(error){app.log.warn({event:"account_bot_revoke_failed",botId,error:error instanceof Error?error.message:"unknown"},"managed bot revoke failed during account lifecycle");}
  }
  return revoked;
}
const confirmationBody=z.object({confirm:z.string().min(1).max(40)});

app.get("/api/account/export",{config:{rateLimit:{max:5,timeWindow:"1 hour"}}},async(request,reply)=>{
  const {player}=await authenticatedPlayer(request.headers);
  const data=await withTransaction((client)=>exportPlayerData(client,player.id));
  return reply.header("content-type","application/json; charset=utf-8").header("content-disposition",`attachment; filename="bloopy-export.json"`).header("cache-control","no-store").send(JSON.stringify(data,null,2));
});

app.post("/api/account/creature/reset",{config:{rateLimit:{max:3,timeWindow:"1 hour"}}},async(request)=>{
  const body=confirmationBody.parse(request.body);
  assertConfirmation("reset",body.confirm);
  const {player}=await authenticatedPlayer(request.headers);
  await revokeBotsForAccount(player.id,Number(player.telegram_user_id));
  const result=await withTransaction((client)=>resetCreature(client,player.id));
  return {reset:result.reset,revokedBots:result.revokedBotIds.length};
});

app.post("/api/account/delete",{config:{rateLimit:{max:3,timeWindow:"1 hour"}}},async(request)=>{
  const body=confirmationBody.parse(request.body);
  assertConfirmation("delete",body.confirm);
  // Deliberately resolved without bootstrapping: a repeated delete must not re-create the account it
  // is about to remove, so a second call on an already-deleted account is a no-op success.
  const user=await resolveRequestUser(initDataFrom(request.headers));
  const existing=await db.query("SELECT id FROM players WHERE telegram_user_id=$1",[user.id]);
  if(!existing.rowCount)return {deleted:true,revokedBots:0};
  const playerId=String(existing.rows[0].id);
  const revoked=await revokeBotsForAccount(playerId,user.id);
  const result=await withTransaction((client)=>deleteAccount(client,playerId));
  return {deleted:result.deleted,revokedBots:revoked.length};
});

app.get("/api/bots/manage",async(request)=>{const {player}=await authenticatedPlayer(request.headers);return {bots:await withTransaction((client)=>listOwnedManagedBots(client,Number(player.telegram_user_id)))};});
app.post("/api/bots/:botId/interaction-consent",async(request)=>{const params=z.object({botId:z.coerce.number().int()}).parse(request.params);const body=z.object({enabled:z.boolean()}).parse(request.body);const {player}=await authenticatedPlayer(request.headers);await withTransaction((client)=>setManagedBotInteractionConsent(client,Number(player.telegram_user_id),params.botId,body.enabled));return {ok:true};});
app.put("/api/bots/:botId/access-rule",async(request)=>{const params=z.object({botId:z.coerce.number().int()}).parse(request.params);const body=z.object({chatId:z.number().int(),telegramUserId:z.number().int().optional(),chatType:z.enum(["private","group","supergroup"]),enabled:z.boolean()}).parse(request.body);const {player}=await authenticatedPlayer(request.headers);return withTransaction((client)=>upsertManagedBotAccessRule(client,Number(player.telegram_user_id),{botId:params.botId,...body}));});
app.post("/api/bots/:botId/rotate-token",{config:{rateLimit:{max:3,timeWindow:"1 hour"}}},async(request)=>{const params=z.object({botId:z.coerce.number().int()}).parse(request.params);const {player}=await authenticatedPlayer(request.headers);await rotateManagedBotToken(Number(player.telegram_user_id),params.botId);return {ok:true};});
app.delete("/api/bots/:botId",async(request)=>{const params=z.object({botId:z.coerce.number().int()}).parse(request.params);const {player}=await authenticatedPlayer(request.headers);await revokeManagedBot(Number(player.telegram_user_id),params.botId);return {ok:true};});

app.post("/api/admin/bots/converse",{config:{rateLimit:{max:30,timeWindow:"1 minute"}}},async(request,reply)=>{if(!isAdmin(request.headers))return reply.code(401).send({error:"unauthorized"});const body=z.object({sourceBotId:z.number().int(),targetUsername:z.string().min(5)}).parse(request.body);return {interactionId:await withTransaction((client)=>startBotConversation(client,body.sourceBotId,body.targetUsername))};});
app.get("/api/admin/metrics",{config:{rateLimit:{max:30,timeWindow:"1 minute"}}},async(request,reply)=>{if(!isAdmin(request.headers))return reply.code(401).send({error:"unauthorized"});const [outbox,updates,workerLag,ai,events,security,interactions,operational,migrations,lifecycle]=await Promise.all([db.query("SELECT status,count(*)::int AS count FROM outbox GROUP BY status"),db.query("SELECT status,count(*)::int AS count FROM telegram_updates GROUP BY status"),db.query("SELECT count(*)::int AS due_pending,COALESCE(EXTRACT(EPOCH FROM (now()-min(due_at)))::int,0) AS oldest_due_seconds FROM world_events WHERE status='pending' AND due_at<=now()"),db.query("SELECT used_ai,count(*)::int AS count,COALESCE(avg(latency_ms),0)::int AS avg_latency_ms FROM ai_generation_logs WHERE created_at>now()-interval '24 hours' GROUP BY used_ai"),db.query("SELECT event_name,count(*)::int AS count FROM analytics_events WHERE created_at>now()-interval '24 hours' GROUP BY event_name ORDER BY count DESC LIMIT 30"),db.query("SELECT event_type,count(*)::int AS count FROM security_events WHERE created_at>now()-interval '24 hours' GROUP BY event_type ORDER BY count DESC"),db.query("SELECT state,count(*)::int AS count FROM bot_interactions GROUP BY state"),db.query("SELECT event_type,count(*)::int AS count FROM operational_events WHERE created_at>now()-interval '24 hours' GROUP BY event_type ORDER BY count DESC"),db.query("SELECT count(*)::int AS count,max(filename) AS latest FROM schema_migrations"),db.query("SELECT event_type,count(*)::int AS count FROM account_lifecycle_events WHERE created_at>now()-interval '24 hours' GROUP BY event_type ORDER BY count DESC")]);return {version:SERVICE_VERSION,outbox:outbox.rows,telegramUpdates:updates.rows,worker:workerLag.rows[0],ai24h:ai.rows,events24h:events.rows,security24h:security.rows,botInteractions:interactions.rows,operational24h:operational.rows,accountLifecycle24h:lifecycle.rows,migrations:{applied:Number(migrations.rows[0].count),latest:migrations.rows[0].latest},controls:{telegramIngress:config.TELEGRAM_INGRESS_ENABLED,managedFleet:config.MANAGED_BOT_FLEET_ENABLED,botToBot:config.BOT_TO_BOT_ENABLED,outbox:config.OUTBOX_ENABLED,degraded:config.DEGRADED_MODE}};});
app.get("/api/admin/outbox/problems",async(request,reply)=>{if(!isAdmin(request.headers))return reply.code(401).send({error:"unauthorized"});const query=z.object({limit:z.coerce.number().int().min(1).max(500).default(100)}).parse(request.query);return {items:await withTransaction((client)=>listProblemDeliveries(client,query.limit))};});
app.post("/api/admin/outbox/:id/replay",async(request,reply)=>{if(!isAdmin(request.headers))return reply.code(401).send({error:"unauthorized"});const params=z.object({id:z.string().uuid()}).parse(request.params);return {replayed:await withTransaction((client)=>replayOutboxItem(client,params.id,"admin_api"))};});
app.post("/api/admin/runtime/controls/:key",async(request,reply)=>{if(!isAdmin(request.headers))return reply.code(401).send({error:"unauthorized"});const params=z.object({key:z.enum(["telegram_ingress","outbox_delivery","risky_mutations"])}).parse(request.params);const body=z.object({enabled:z.boolean(),reason:z.string().max(300).nullable().default(null)}).parse(request.body);await withTransaction((client)=>setRuntimeControl(client,params.key as RuntimeControlKey,body.enabled,body.reason,"admin_api"));return {ok:true};});
app.post("/api/admin/runtime/recover",async(request,reply)=>{if(!isAdmin(request.headers))return reply.code(401).send({error:"unauthorized"});return recoverExpiredLeases();});

// Support inbox. The manager bot records a /support request; without somewhere to read it the
// channel is a promise nobody keeps.
app.get("/api/admin/support",{config:{rateLimit:{max:60,timeWindow:"1 minute"}}},async(request,reply)=>{
  if(!isAdmin(request.headers))return reply.code(401).send({error:"unauthorized"});
  const query=z.object({status:z.enum(["open","acknowledged","closed","all"]).default("open"),limit:z.coerce.number().int().min(1).max(200).default(50)}).parse(request.query);
  const rows=await db.query(
    `SELECT id,status,message,chat_id,telegram_user_id,created_at,updated_at,closed_at,player_id IS NOT NULL AS has_account
     FROM support_requests ${query.status==="all"?"":"WHERE status=$2"} ORDER BY created_at DESC LIMIT $1`,
    query.status==="all"?[query.limit]:[query.limit,query.status]);
  return {items:rows.rows.map((row)=>({id:String(row.id),status:String(row.status),message:String(row.message),chatId:String(row.chat_id),telegramUserId:row.telegram_user_id===null?null:String(row.telegram_user_id),hasAccount:Boolean(row.has_account),createdAt:new Date(row.created_at).toISOString(),closedAt:row.closed_at?new Date(row.closed_at).toISOString():null}))};
});
app.post("/api/admin/support/:id",{config:{rateLimit:{max:60,timeWindow:"1 minute"}}},async(request,reply)=>{
  if(!isAdmin(request.headers))return reply.code(401).send({error:"unauthorized"});
  const params=z.object({id:z.string().uuid()}).parse(request.params);
  const body=z.object({status:z.enum(["open","acknowledged","closed"])}).parse(request.body);
  const updated=await db.query(`UPDATE support_requests SET status=$2,updated_at=now(),closed_at=CASE WHEN $2='closed' THEN now() ELSE NULL END WHERE id=$1 RETURNING id`,[params.id,body.status]);
  if(!updated.rowCount)return reply.code(404).send({error:"not found"});
  return {ok:true,status:body.status};
});

// Human verification gates (#17). Read-only state plus one safe probe, consumed by
// `npm run verify:gate`. Neither route exposes a token, webhook secret, Telegram user id or message.
app.get("/api/admin/verification",{config:{rateLimit:{max:60,timeWindow:"1 minute"}}},async(request,reply)=>{if(!isAdmin(request.headers))return reply.code(401).send({error:"unauthorized"});const query=z.object({windowMinutes:z.coerce.number().int().min(1).max(1440).default(60)}).parse(request.query);return withTransaction((client)=>verificationSnapshot(client,query.windowMinutes));});
app.post("/api/admin/verification/replay-update",{config:{rateLimit:{max:20,timeWindow:"1 minute"}}},async(request,reply)=>{if(!isAdmin(request.headers))return reply.code(401).send({error:"unauthorized"});const body=z.object({source:z.string().min(1).max(60),updateId:z.coerce.number().int()}).parse(request.body);return withTransaction((client)=>replayProcessedUpdate(client,body.source,body.updateId));});

async function enqueueWebhook(source:string,update:TelegramUpdate){if(typeof update?.update_id!=="number")return {ok:true,queued:false};const queued=await withTransaction((client)=>enqueueTelegramUpdate(client,source,update));return {ok:true,queued};}
app.post("/telegram/manager",{config:{rateLimit:{max:300,timeWindow:"1 minute"}}},async(request,reply)=>{if(!secureEquals(request.headers["x-telegram-bot-api-secret-token"],config.TELEGRAM_WEBHOOK_SECRET))return reply.code(401).send({ok:false});return enqueueWebhook("manager",request.body as TelegramUpdate);});
app.post("/telegram/managed/:botId",{config:{rateLimit:{max:300,timeWindow:"1 minute"}}},async(request,reply)=>{const params=z.object({botId:z.coerce.number().int()}).parse(request.params);const registry=await db.query("SELECT webhook_secret FROM managed_bots WHERE bot_id=$1 AND enabled=true AND revoked_at IS NULL",[params.botId]);if(!registry.rowCount||!secureEquals(request.headers["x-telegram-bot-api-secret-token"],registry.rows[0].webhook_secret))return reply.code(401).send({ok:false});if(!config.MANAGED_BOT_FLEET_ENABLED)return {ok:true,queued:false,paused:true};return enqueueWebhook(`managed:${params.botId}`,request.body as TelegramUpdate);});
app.post("/telegram/managed/:botId/:secret",{config:{rateLimit:{max:300,timeWindow:"1 minute"}}},async(request,reply)=>{const params=z.object({botId:z.coerce.number().int(),secret:z.string().min(20)}).parse(request.params);const registry=await db.query("SELECT webhook_secret FROM managed_bots WHERE bot_id=$1 AND enabled=true AND revoked_at IS NULL",[params.botId]);if(!registry.rowCount||!secureEquals(params.secret,registry.rows[0].webhook_secret))return reply.code(401).send({ok:false});if(!config.MANAGED_BOT_FLEET_ENABLED)return {ok:true,queued:false,paused:true};return enqueueWebhook(`managed:${params.botId}`,request.body as TelegramUpdate);});

app.setErrorHandler((error,_request,reply)=>{if(error instanceof AppError){if(error.httpStatus>=500)app.log.error(error);else app.log.info({code:error.code},"request rejected");return reply.code(error.httpStatus).send({error:error.userMessage,code:error.code});}if(error instanceof z.ZodError)return reply.code(400).send({error:"That request didn't look quite right. Try again?",code:"bad_input"});const statusCode=(error as {statusCode?:number}).statusCode;if(typeof statusCode==="number"&&statusCode>=400&&statusCode<500)return reply.code(statusCode).send({error:statusCode===429?"Too many things at once — the creature needs a breath.":"That request didn't look quite right.",code:`http_${statusCode}`});app.log.error(error);return reply.code(500).send({error:"Something wobbled on our side. Try again in a moment.",code:"internal"});});

await migrate();
await configureManagerWebhook().catch((error)=>app.log.error(error));
if(config.PUBLIC_BASE_URL.startsWith("https://"))await migrateManagedWebhooks(db).catch((error)=>app.log.error(error));
let workerTick=0;let workerBusy=false;
async function runWorkerTick(){if(workerBusy)return;workerBusy=true;try{workerTick+=1;const runCleanup=workerTick%40===0;await recoverExpiredLeases();await processTelegramIngressBatch();await withTransaction(async(client)=>{await scheduleDueDailyReturnNotifications(client);await processDueEvents(client);if(runCleanup)await cleanupProcessedWork(client);});await processOutboxBatch();}finally{workerBusy=false;}}
const workerTimer=setInterval(()=>{void runWorkerTick().catch((error)=>app.log.error(error));},5_000);workerTimer.unref();
await app.listen({host:"0.0.0.0",port:config.PORT});
