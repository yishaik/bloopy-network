import { createHash } from "node:crypto";
import type pg from "pg";
import { config } from "./config.js";

export type AIProviderKind="platform"|"byok";

export interface AIUsageDecision {
  allowed:boolean;
  provider:AIProviderKind;
  reason?:"daily_limit"|"monthly_budget"|"sampled_out";
  dailyUsed:number;
  dailyLimit:number;
  monthlyEstimatedCostMicrousd:number;
  monthlyBudgetMicrousd:number;
}

export interface AIUsageStatus {
  provider:"platform"|"byok"|"none";
  dailyUsed:number;
  dailyLimit:number;
  monthlyEstimatedCostUsd:number;
  monthlyBudgetUsd:number;
  platformAvailable:boolean;
}

export function configuredPlatformAvailable():boolean {
  if(!config.PLATFORM_AI_ENABLED||!config.PLATFORM_AI_BASE_URL||!config.PLATFORM_AI_MODEL||!config.PLATFORM_AI_API_KEY)return false;
  return config.PLATFORM_AI_ALLOWED_MODELS.length===0||config.PLATFORM_AI_ALLOWED_MODELS.includes(config.PLATFORM_AI_MODEL);
}

export function shouldSampleRoutineScene(key:string):boolean {
  if(config.AI_PLATFORM_ENRICHMENT_PERCENT<=0)return false;
  if(config.AI_PLATFORM_ENRICHMENT_PERCENT>=100)return true;
  const bucket=parseInt(createHash("sha256").update(key).digest("hex").slice(0,8),16)%100;
  return bucket<config.AI_PLATFORM_ENRICHMENT_PERCENT;
}

export function estimateNarrativeCostMicrousd(inputTokens:number,outputTokens:number):number {
  const usd=(inputTokens*config.PLATFORM_AI_INPUT_USD_PER_MILLION+outputTokens*config.PLATFORM_AI_OUTPUT_USD_PER_MILLION)/1_000_000;
  return Math.max(0,Math.round(usd*1_000_000));
}

function requestLimit(provider:AIProviderKind):number {
  return provider==="platform"?config.AI_PLATFORM_DAILY_REQUEST_LIMIT:config.AI_BYOK_DAILY_REQUEST_LIMIT;
}

async function currentMonthlyPlatformCost(client:pg.PoolClient):Promise<number> {
  const result=await client.query(`SELECT COALESCE(SUM(estimated_cost_microusd),0)::bigint AS total
    FROM ai_generation_logs
    WHERE provider='platform' AND used_ai=true AND created_at>=date_trunc('month',now())`);
  return Number(result.rows[0]?.total??0);
}

export async function reserveAIRequest(client:pg.PoolClient,playerId:string,provider:AIProviderKind,options:{sampleKey?:string;priority?:"high"|"routine"}={}):Promise<AIUsageDecision> {
  const dailyLimit=requestLimit(provider);
  const monthlyBudgetMicrousd=Math.round(config.PLATFORM_AI_MONTHLY_BUDGET_USD*1_000_000);
  const monthlyEstimatedCostMicrousd=provider==="platform"?await currentMonthlyPlatformCost(client):0;

  if(provider==="platform"&&options.priority!=="high"&&options.sampleKey&&!shouldSampleRoutineScene(options.sampleKey)) {
    return {allowed:false,provider,reason:"sampled_out",dailyUsed:0,dailyLimit,monthlyEstimatedCostMicrousd,monthlyBudgetMicrousd};
  }
  if(provider==="platform"&&monthlyBudgetMicrousd>=0&&monthlyEstimatedCostMicrousd>=monthlyBudgetMicrousd) {
    return {allowed:false,provider,reason:"monthly_budget",dailyUsed:0,dailyLimit,monthlyEstimatedCostMicrousd,monthlyBudgetMicrousd};
  }
  if(dailyLimit<=0) {
    return {allowed:false,provider,reason:"daily_limit",dailyUsed:0,dailyLimit,monthlyEstimatedCostMicrousd,monthlyBudgetMicrousd};
  }

  const reserved=await client.query(`INSERT INTO ai_daily_usage (player_id,usage_date,provider,request_count)
    VALUES ($1,(now() AT TIME ZONE 'UTC')::date,$2,1)
    ON CONFLICT (player_id,usage_date,provider) DO UPDATE SET
      request_count=ai_daily_usage.request_count+1,
      updated_at=now()
    WHERE ai_daily_usage.request_count<$3
    RETURNING request_count`,[playerId,provider,dailyLimit]);

  if(!reserved.rowCount) {
    const existing=await client.query(`SELECT request_count FROM ai_daily_usage WHERE player_id=$1 AND usage_date=(now() AT TIME ZONE 'UTC')::date AND provider=$2`,[playerId,provider]);
    return {allowed:false,provider,reason:"daily_limit",dailyUsed:Number(existing.rows[0]?.request_count??dailyLimit),dailyLimit,monthlyEstimatedCostMicrousd,monthlyBudgetMicrousd};
  }

  return {allowed:true,provider,dailyUsed:Number(reserved.rows[0].request_count),dailyLimit,monthlyEstimatedCostMicrousd,monthlyBudgetMicrousd};
}

export async function getAIUsageStatus(client:pg.PoolClient,playerId:string,hasByok:boolean):Promise<AIUsageStatus> {
  const provider:AIUsageStatus["provider"]=hasByok?"byok":configuredPlatformAvailable()?"platform":"none";
  if(provider==="none")return {provider,dailyUsed:0,dailyLimit:0,monthlyEstimatedCostUsd:0,monthlyBudgetUsd:config.PLATFORM_AI_MONTHLY_BUDGET_USD,platformAvailable:false};
  const usage=await client.query(`SELECT request_count FROM ai_daily_usage WHERE player_id=$1 AND usage_date=(now() AT TIME ZONE 'UTC')::date AND provider=$2`,[playerId,provider]);
  const monthly=provider==="platform"?await currentMonthlyPlatformCost(client):0;
  return {
    provider,
    dailyUsed:Number(usage.rows[0]?.request_count??0),
    dailyLimit:requestLimit(provider),
    monthlyEstimatedCostUsd:monthly/1_000_000,
    monthlyBudgetUsd:config.PLATFORM_AI_MONTHLY_BUDGET_USD,
    platformAvailable:configuredPlatformAvailable()
  };
}
