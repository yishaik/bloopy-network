import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import { config } from "./config.js";
import { open, seal } from "./crypto.js";
import { AppError } from "./errors.js";

export type OpenRouterMode="balanced"|"creative"|"smart";

export interface OpenRouterModelOption {
  mode:OpenRouterMode;
  label:string;
  description:string;
  model:string;
  costTier:"low"|"medium"|"premium";
}

export const OPENROUTER_MODELS:readonly OpenRouterModelOption[]=[
  {mode:"balanced",label:"Balanced",description:"Fast, economical narration for everyday moments.",model:"qwen/qwen3.5-9b",costTier:"low"},
  {mode:"creative",label:"Creative",description:"More expressive phrasing and character voice.",model:"google/gemini-3.1-flash-lite",costTier:"medium"},
  {mode:"smart",label:"Smart",description:"A premium model for players who explicitly choose stronger generation.",model:"openai/gpt-5.2",costTier:"premium"}
] as const;

const OPENROUTER_BASE_URL="https://openrouter.ai/api/v1";
const OAUTH_TTL_MINUTES=10;

export interface OpenRouterConnectionView {
  source:"none"|"manual"|"openrouter";
  connected:boolean;
  status:"none"|"active"|"invalid";
  mode:OpenRouterMode|null;
  model:string|null;
  externalUserId:string|null;
  connectedAt:string|null;
  lastVerifiedAt:string|null;
  keyInfo:null|{
    isFreeTier:boolean|null;
    limit:number|null;
    limitRemaining:number|null;
    expiresAt:string|null;
  };
  models:readonly OpenRouterModelOption[];
}

export interface ClaimedOpenRouterState {
  stateHash:string;
  playerId:string;
  verifier:string;
  callbackUrl:string;
}

export interface OpenRouterExchange {
  key:string;
  userId:string|null;
}

export interface OpenRouterKeyInfo {
  isFreeTier:boolean|null;
  limit:number|null;
  limitRemaining:number|null;
  expiresAt:string|null;
}

function iso(value:unknown):string|null {
  return value?new Date(String(value)).toISOString():null;
}

export function hashOAuthState(rawState:string):string {
  return createHash("sha256").update(rawState).digest("hex");
}

export function pkceChallenge(verifier:string):string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function modelForMode(mode:OpenRouterMode):OpenRouterModelOption {
  const option=OPENROUTER_MODELS.find((entry)=>entry.mode===mode);
  if(!option)throw new AppError("openrouter_mode_invalid",400,"That Connected Mind mode is not on the menu.");
  return option;
}

export async function beginOpenRouterConnection(client:pg.PoolClient,playerId:string):Promise<{url:string;expiresAt:string}> {
  const rawState=randomBytes(32).toString("base64url");
  const verifier=randomBytes(48).toString("base64url");
  const challenge=pkceChallenge(verifier);
  const stateHash=hashOAuthState(rawState);
  const callback=new URL("/auth/openrouter/callback",config.PUBLIC_BASE_URL);
  callback.searchParams.set("state",rawState);
  const expiresAt=new Date(Date.now()+OAUTH_TTL_MINUTES*60_000);

  await client.query(`UPDATE openrouter_oauth_states SET status='failed',error_code='superseded',updated_at=now() WHERE player_id=$1 AND status='pending'`,[playerId]);
  await client.query(`DELETE FROM openrouter_oauth_states WHERE expires_at<now()-interval '7 days' OR completed_at<now()-interval '7 days'`);
  await client.query(`INSERT INTO openrouter_oauth_states (state_hash,player_id,verifier_cipher,callback_url,expires_at) VALUES ($1,$2,$3,$4,$5)`,[
    stateHash,playerId,seal(verifier),callback.toString(),expiresAt.toISOString()
  ]);

  const auth=new URL("https://openrouter.ai/auth");
  auth.searchParams.set("callback_url",callback.toString());
  auth.searchParams.set("code_challenge",challenge);
  auth.searchParams.set("code_challenge_method","S256");
  return {url:auth.toString(),expiresAt:expiresAt.toISOString()};
}

export async function claimOpenRouterState(client:pg.PoolClient,rawState:string):Promise<ClaimedOpenRouterState> {
  if(!/^[A-Za-z0-9_-]{40,100}$/.test(rawState))throw new AppError("openrouter_state_invalid",400,"That authorization link is malformed.");
  const stateHash=hashOAuthState(rawState);
  const claimed=await client.query(`UPDATE openrouter_oauth_states SET status='exchanging',claimed_at=now(),updated_at=now()
    WHERE state_hash=$1 AND status='pending' AND expires_at>now()
    RETURNING player_id,verifier_cipher,callback_url`,[stateHash]);
  if(!claimed.rowCount)throw new AppError("openrouter_state_used",409,"That authorization link expired or was already used. Start the connection again.");
  return {stateHash,playerId:String(claimed.rows[0].player_id),verifier:open(String(claimed.rows[0].verifier_cipher)),callbackUrl:String(claimed.rows[0].callback_url)};
}

export async function exchangeOpenRouterCode(code:string,verifier:string):Promise<OpenRouterExchange> {
  if(code.length<8||code.length>500)throw new Error("invalid OpenRouter authorization code");
  const response=await fetch(`${OPENROUTER_BASE_URL}/auth/keys`,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({code,code_challenge_method:"S256",code_verifier:verifier}),
    signal:AbortSignal.timeout(10_000)
  });
  if(!response.ok)throw new Error(`OpenRouter exchange failed (${response.status})`);
  const payload=await response.json() as {key?:string;user_id?:string|null};
  if(!payload.key||!payload.key.startsWith("sk-or-"))throw new Error("OpenRouter exchange returned no usable credential");
  return {key:payload.key,userId:payload.user_id??null};
}

export async function inspectOpenRouterKey(apiKey:string):Promise<OpenRouterKeyInfo> {
  const response=await fetch(`${OPENROUTER_BASE_URL}/key`,{
    headers:{authorization:`Bearer ${apiKey}`,"http-referer":config.PUBLIC_BASE_URL,"x-openrouter-title":"Bloopy Network"},
    signal:AbortSignal.timeout(8_000)
  });
  if(!response.ok)throw new Error(`OpenRouter credential verification failed (${response.status})`);
  const payload=await response.json() as {data?:{is_free_tier?:boolean;limit?:number|null;limit_remaining?:number|null;expires_at?:string|null}};
  const data=payload.data??{};
  return {
    isFreeTier:typeof data.is_free_tier==="boolean"?data.is_free_tier:null,
    limit:typeof data.limit==="number"?data.limit:null,
    limitRemaining:typeof data.limit_remaining==="number"?data.limit_remaining:null,
    expiresAt:data.expires_at??null
  };
}

export async function completeOpenRouterConnection(client:pg.PoolClient,claim:ClaimedOpenRouterState,exchange:OpenRouterExchange,keyInfo:OpenRouterKeyInfo):Promise<void> {
  const selected=modelForMode("balanced");
  await client.query(`INSERT INTO ai_profiles (player_id,base_url,model,encrypted_api_key,enabled,source,external_user_id,connection_status,connection_metadata,connected_at,last_verified_at,disconnected_at)
    VALUES ($1,$2,$3,$4,true,'openrouter',$5,'active',$6,now(),now(),NULL)
    ON CONFLICT (player_id) DO UPDATE SET base_url=EXCLUDED.base_url,model=EXCLUDED.model,encrypted_api_key=EXCLUDED.encrypted_api_key,enabled=true,source='openrouter',external_user_id=EXCLUDED.external_user_id,connection_status='active',connection_metadata=EXCLUDED.connection_metadata,connected_at=now(),last_verified_at=now(),disconnected_at=NULL,updated_at=now()`,[
    claim.playerId,OPENROUTER_BASE_URL,selected.model,seal(exchange.key),exchange.userId,JSON.stringify({mode:selected.mode,keyInfo})
  ]);
  await client.query(`UPDATE openrouter_oauth_states SET status='completed',verifier_cipher='',completed_at=now(),updated_at=now() WHERE state_hash=$1 AND status='exchanging'`,[claim.stateHash]);
  await client.query(`INSERT INTO analytics_events (player_id,event_name,properties) VALUES ($1,'openrouter_connected',$2)`,[claim.playerId,JSON.stringify({mode:selected.mode,model:selected.model,isFreeTier:keyInfo.isFreeTier})]);
}

export async function failOpenRouterConnection(client:pg.PoolClient,stateHash:string,errorCode:string):Promise<void> {
  await client.query(`UPDATE openrouter_oauth_states SET status='failed',verifier_cipher='',error_code=$2,updated_at=now() WHERE state_hash=$1 AND status='exchanging'`,[stateHash,errorCode.slice(0,80)]);
}

export async function getOpenRouterConnection(client:pg.PoolClient,playerId:string):Promise<OpenRouterConnectionView> {
  const result=await client.query(`SELECT source,model,external_user_id,connection_status,connection_metadata,connected_at,last_verified_at FROM ai_profiles WHERE player_id=$1`,[playerId]);
  const row=result.rows[0];
  if(!row)return {source:"none",connected:false,status:"none",mode:null,model:null,externalUserId:null,connectedAt:null,lastVerifiedAt:null,keyInfo:null,models:OPENROUTER_MODELS};
  if(row.source!=="openrouter")return {source:"manual",connected:row.connection_status==="active",status:row.connection_status==="invalid"?"invalid":"active",mode:null,model:String(row.model),externalUserId:null,connectedAt:iso(row.connected_at),lastVerifiedAt:iso(row.last_verified_at),keyInfo:null,models:OPENROUTER_MODELS};
  const metadata=(row.connection_metadata??{}) as {mode?:OpenRouterMode;keyInfo?:OpenRouterKeyInfo};
  return {
    source:"openrouter",connected:row.connection_status==="active",status:row.connection_status==="invalid"?"invalid":"active",
    mode:metadata.mode??null,model:String(row.model),externalUserId:row.external_user_id?String(row.external_user_id):null,
    connectedAt:iso(row.connected_at),lastVerifiedAt:iso(row.last_verified_at),keyInfo:metadata.keyInfo??null,models:OPENROUTER_MODELS
  };
}

export async function selectOpenRouterMode(client:pg.PoolClient,playerId:string,mode:OpenRouterMode):Promise<OpenRouterConnectionView> {
  const selected=modelForMode(mode);
  const updated=await client.query(`UPDATE ai_profiles SET model=$2,connection_metadata=jsonb_set(connection_metadata,'{mode}',$3::jsonb,true),updated_at=now()
    WHERE player_id=$1 AND source='openrouter' AND enabled=true AND connection_status='active' RETURNING player_id`,[playerId,selected.model,JSON.stringify(mode)]);
  if(!updated.rowCount)throw new AppError("openrouter_not_connected",409,"OpenRouter is not connected right now.");
  await client.query(`INSERT INTO analytics_events (player_id,event_name,properties) VALUES ($1,'openrouter_model_selected',$2)`,[playerId,JSON.stringify({mode,model:selected.model,costTier:selected.costTier})]);
  return getOpenRouterConnection(client,playerId);
}

export async function verifyOpenRouterConnection(client:pg.PoolClient,playerId:string):Promise<{key:string;connection:OpenRouterConnectionView}> {
  const result=await client.query(`SELECT encrypted_api_key FROM ai_profiles WHERE player_id=$1 AND source='openrouter'`,[playerId]);
  if(!result.rowCount)throw new AppError("openrouter_not_connected",409,"OpenRouter is not connected right now.");
  return {key:open(String(result.rows[0].encrypted_api_key)),connection:await getOpenRouterConnection(client,playerId)};
}

export async function recordOpenRouterVerification(client:pg.PoolClient,playerId:string,keyInfo:OpenRouterKeyInfo):Promise<OpenRouterConnectionView> {
  const updated=await client.query(`UPDATE ai_profiles SET enabled=true,connection_status='active',connection_metadata=jsonb_set(connection_metadata,'{keyInfo}',$2::jsonb,true),last_verified_at=now(),updated_at=now() WHERE player_id=$1 AND source='openrouter' RETURNING player_id`,[playerId,JSON.stringify(keyInfo)]);
  if(!updated.rowCount)throw new AppError("openrouter_not_connected",409,"OpenRouter is not connected right now.");
  return getOpenRouterConnection(client,playerId);
}

export async function markOpenRouterInvalid(client:pg.PoolClient,playerId:string):Promise<void> {
  await client.query(`UPDATE ai_profiles SET connection_status='invalid',updated_at=now() WHERE player_id=$1 AND source='openrouter'`,[playerId]);
}

export async function disconnectOpenRouter(client:pg.PoolClient,playerId:string):Promise<boolean> {
  const removed=await client.query(`DELETE FROM ai_profiles WHERE player_id=$1 AND source='openrouter' RETURNING model`,[playerId]);
  await client.query(`DELETE FROM openrouter_oauth_states WHERE player_id=$1`,[playerId]);
  if(removed.rowCount)await client.query(`INSERT INTO analytics_events (player_id,event_name,properties) VALUES ($1,'openrouter_disconnected',$2)`,[playerId,JSON.stringify({model:removed.rows[0].model})]);
  return Boolean(removed.rowCount);
}
