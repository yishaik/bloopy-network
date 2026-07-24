import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildNarrativeScenePacket, mergeNarrativeOutput, NARRATIVE_PROMPT_VERSION, NARRATIVE_SYSTEM_PROMPT } from "./ai.js";
import { NARRATIVE_EVAL_VERSION, narrativeEvalFixtures, type NarrativeEvalFixture } from "./narrative-eval-fixtures.js";

interface ProviderUsage { prompt_tokens?:number; completion_tokens?:number; cost?:number }
interface EvalResult {
  fixtureId:string;
  language:"en"|"he";
  category:string;
  model:string;
  requestOk:boolean;
  httpStatus?:number;
  schemaPass:boolean;
  languagePass:boolean;
  forbiddenPass:boolean;
  machinePass:boolean;
  latencyMs:number;
  promptTokens:number;
  completionTokens:number;
  costUsd:number|null;
  title?:string;
  body?:string;
  error?:string;
}

interface ModelSummary {
  model:string;
  total:number;
  requestPassRate:number;
  schemaPassRate:number;
  languagePassRate:number;
  forbiddenPassRate:number;
  machinePassRate:number;
  averageLatencyMs:number;
  promptTokens:number;
  completionTokens:number;
  costUsd:number|null;
}

const baseUrl=(process.env.AI_EVAL_BASE_URL??"https://openrouter.ai/api/v1").replace(/\/$/,"");
const apiKey=process.env.AI_EVAL_API_KEY;
const models=(process.env.AI_EVAL_MODELS??"").split(",").map((model)=>model.trim()).filter(Boolean);
const timeoutMs=Math.max(1_000,Math.min(30_000,Number(process.env.AI_EVAL_TIMEOUT_MS??12_000)));
const fixtureLimit=Math.max(1,Math.min(narrativeEvalFixtures.length,Number(process.env.AI_EVAL_FIXTURE_LIMIT??narrativeEvalFixtures.length)));
const outputDir=resolve(process.env.AI_EVAL_OUTPUT_DIR??"artifacts/narrative-eval");

function percentage(value:number,total:number):number {
  return total===0?0:Math.round((value/total)*10_000)/100;
}

function languagePass(fixture:NarrativeEvalFixture,text:string):boolean {
  const hebrew=(text.match(/[\u0590-\u05FF]/g)??[]).length;
  const latin=(text.match(/[A-Za-z]/g)??[]).length;
  return fixture.language==="he"?hebrew>=10&&hebrew>latin*0.35:latin>=20&&hebrew<latin*0.2;
}

function forbiddenPass(fixture:NarrativeEvalFixture,text:string):boolean {
  const normalized=text.toLocaleLowerCase();
  return fixture.forbiddenTerms.every((term)=>!normalized.includes(term.toLocaleLowerCase()));
}

async function evaluateFixture(model:string,fixture:NarrativeEvalFixture):Promise<EvalResult> {
  const started=Date.now();
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),timeoutMs);
  const packet=buildNarrativeScenePacket(fixture.story,fixture.voice,fixture.context);
  try {
    const response=await fetch(`${baseUrl}/chat/completions`,{
      method:"POST",
      headers:{
        "content-type":"application/json",
        authorization:`Bearer ${apiKey}`,
        "http-referer":process.env.PUBLIC_BASE_URL??"https://github.com/yishaik/bloopy-network",
        "x-title":"Bloopy Narrative Evaluation"
      },
      body:JSON.stringify({
        model,
        temperature:0.65,
        max_tokens:160,
        messages:[
          {role:"system",content:NARRATIVE_SYSTEM_PROMPT},
          {role:"user",content:JSON.stringify(packet)}
        ],
        response_format:{type:"json_object"}
      }),
      signal:controller.signal
    });
    if(!response.ok)return {fixtureId:fixture.id,language:fixture.language,category:fixture.category,model,requestOk:false,httpStatus:response.status,schemaPass:false,languagePass:false,forbiddenPass:false,machinePass:false,latencyMs:Date.now()-started,promptTokens:0,completionTokens:0,costUsd:null,error:`http_${response.status}`};
    const payload=await response.json() as {choices?:Array<{message?:{content?:string}}> ; usage?:ProviderUsage};
    const content=payload.choices?.[0]?.message?.content;
    if(!content)return {fixtureId:fixture.id,language:fixture.language,category:fixture.category,model,requestOk:true,httpStatus:response.status,schemaPass:false,languagePass:false,forbiddenPass:false,machinePass:false,latencyMs:Date.now()-started,promptTokens:Number(payload.usage?.prompt_tokens??0),completionTokens:Number(payload.usage?.completion_tokens??0),costUsd:typeof payload.usage?.cost==="number"?payload.usage.cost:null,error:"empty_output"};
    let candidate:unknown;
    try { candidate=JSON.parse(content); }
    catch { return {fixtureId:fixture.id,language:fixture.language,category:fixture.category,model,requestOk:true,httpStatus:response.status,schemaPass:false,languagePass:false,forbiddenPass:false,machinePass:false,latencyMs:Date.now()-started,promptTokens:Number(payload.usage?.prompt_tokens??0),completionTokens:Number(payload.usage?.completion_tokens??0),costUsd:typeof payload.usage?.cost==="number"?payload.usage.cost:null,error:"invalid_json"}; }
    const merged=mergeNarrativeOutput(fixture.story,candidate);
    const schemaPass=Boolean(merged);
    const title=merged?.title;
    const body=merged?.body;
    const text=`${title??""}\n${body??""}`;
    const speaksExpectedLanguage=schemaPass&&languagePass(fixture,text);
    const avoidsForbiddenTerms=schemaPass&&forbiddenPass(fixture,text);
    return {
      fixtureId:fixture.id,language:fixture.language,category:fixture.category,model,requestOk:true,httpStatus:response.status,
      schemaPass,languagePass:speaksExpectedLanguage,forbiddenPass:avoidsForbiddenTerms,machinePass:schemaPass&&speaksExpectedLanguage&&avoidsForbiddenTerms,
      latencyMs:Date.now()-started,promptTokens:Number(payload.usage?.prompt_tokens??0),completionTokens:Number(payload.usage?.completion_tokens??0),
      costUsd:typeof payload.usage?.cost==="number"?payload.usage.cost:null,
      ...(title?{title}:{}),...(body?{body}:{}),...(!schemaPass?{error:"schema_rejected"}:{})
    };
  } catch(error) {
    const reason=error instanceof DOMException&&error.name==="AbortError"?"timeout":error instanceof Error?error.message:"request_failed";
    return {fixtureId:fixture.id,language:fixture.language,category:fixture.category,model,requestOk:false,schemaPass:false,languagePass:false,forbiddenPass:false,machinePass:false,latencyMs:Date.now()-started,promptTokens:0,completionTokens:0,costUsd:null,error:reason};
  } finally { clearTimeout(timeout); }
}

function summarize(model:string,results:EvalResult[]):ModelSummary {
  const total=results.length;
  const latency=results.reduce((sum,result)=>sum+result.latencyMs,0);
  const knownCosts=results.map((result)=>result.costUsd).filter((value):value is number=>typeof value==="number");
  return {
    model,total,
    requestPassRate:percentage(results.filter((result)=>result.requestOk).length,total),
    schemaPassRate:percentage(results.filter((result)=>result.schemaPass).length,total),
    languagePassRate:percentage(results.filter((result)=>result.languagePass).length,total),
    forbiddenPassRate:percentage(results.filter((result)=>result.forbiddenPass).length,total),
    machinePassRate:percentage(results.filter((result)=>result.machinePass).length,total),
    averageLatencyMs:Math.round(latency/Math.max(1,total)),
    promptTokens:results.reduce((sum,result)=>sum+result.promptTokens,0),
    completionTokens:results.reduce((sum,result)=>sum+result.completionTokens,0),
    costUsd:knownCosts.length?Math.round(knownCosts.reduce((sum,value)=>sum+value,0)*1_000_000)/1_000_000:null
  };
}

function markdownReport(summaries:ModelSummary[],results:EvalResult[]):string {
  const lines=[
    `# Bloopy narrative evaluation`,"",`- Evaluation: \`${NARRATIVE_EVAL_VERSION}\``,`- Prompt: \`${NARRATIVE_PROMPT_VERSION}\``,`- Fixtures per model: ${fixtureLimit}`,"",
    "## Machine checks","",
    "| Model | Request | Schema | Language | Forbidden-term safety | Combined | Avg latency | Tokens in/out | Reported cost |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...summaries.map((summary)=>`| \`${summary.model}\` | ${summary.requestPassRate}% | ${summary.schemaPassRate}% | ${summary.languagePassRate}% | ${summary.forbiddenPassRate}% | ${summary.machinePassRate}% | ${summary.averageLatencyMs} ms | ${summary.promptTokens}/${summary.completionTokens} | ${summary.costUsd===null?"n/a":`$${summary.costUsd.toFixed(6)}`} |`),
    "","## Human review required","",
    "Machine checks are gates, not the final product decision. Review voice consistency, natural Hebrew, emotional fit, humor and whether the rewrite improves the authored fallback.","",
    "## Failures and representative samples",""
  ];
  for(const model of summaries.map((summary)=>summary.model)) {
    lines.push(`### ${model}`,"");
    const modelResults=results.filter((result)=>result.model===model);
    const selected=[...modelResults.filter((result)=>!result.machinePass).slice(0,8),...modelResults.filter((result)=>result.machinePass).slice(0,4)];
    if(selected.length===0){lines.push("No results.","");continue;}
    for(const result of selected) {
      lines.push(`- **${result.fixtureId}** — ${result.machinePass?"pass":"FAIL"}; ${result.latencyMs} ms${result.error?`; ${result.error}`:""}`);
      if(result.title)lines.push(`  - Title: ${result.title}`);
      if(result.body)lines.push(`  - Body: ${result.body}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  if(!apiKey)throw new Error("AI_EVAL_API_KEY is required");
  if(models.length===0)throw new Error("AI_EVAL_MODELS must contain at least one model ID");
  const fixtures=narrativeEvalFixtures.slice(0,fixtureLimit);
  const results:EvalResult[]=[];
  for(const model of models) {
    console.log(`Evaluating ${model} on ${fixtures.length} scenes`);
    for(const [index,fixture] of fixtures.entries()) {
      const result=await evaluateFixture(model,fixture);
      results.push(result);
      console.log(`${model} ${index+1}/${fixtures.length} ${fixture.id}: ${result.machinePass?"pass":"fail"}`);
    }
  }
  const summaries=models.map((model)=>summarize(model,results.filter((result)=>result.model===model)));
  await mkdir(outputDir,{recursive:true});
  await writeFile(resolve(outputDir,"report.json"),JSON.stringify({evaluationVersion:NARRATIVE_EVAL_VERSION,promptVersion:NARRATIVE_PROMPT_VERSION,generatedAt:new Date().toISOString(),baseUrl,models,fixtureCount:fixtures.length,summaries,results},null,2));
  await writeFile(resolve(outputDir,"report.md"),markdownReport(summaries,results));
  console.table(summaries);
  if(results.every((result)=>!result.requestOk))process.exitCode=1;
}

main().catch((error)=>{console.error(error);process.exitCode=1;});
