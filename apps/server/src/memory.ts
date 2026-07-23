import type pg from "pg";
import type { Personality, StoryCard } from "./types.js";

export type MemoryTier="working"|"episodic"|"identity"|"world";
export type DailyReturnChoice="hold_close"|"tell_someone"|"set_down";

export interface MemoryView {
  id:string;
  tier:MemoryTier;
  summary:string;
  sourceType:string;
  sourceVersion:string;
  privacyLevel:"private"|"shared";
  confidence:number;
  canonicalStatus:"approved"|"user_asserted";
  worldId:string;
  importance:number;
  editable:boolean;
  correctedFromId:string|null;
  createdAt:string;
  updatedAt:string;
}

export interface DailyReturnView {
  id:string;
  status:"active"|"completed";
  returnDate:string;
  memoryId:string|null;
  title:string;
  body:string;
  choices:Array<{id:DailyReturnChoice;label:string}>;
  choiceId:DailyReturnChoice|null;
  result:Record<string,unknown>;
}

export interface PersonalityEvolution {
  personality:Personality;
  mood:string;
  deltas:Partial<Record<keyof Pick<Personality,"curiosity"|"courage"|"empathy"|"mischief"|"sociability">,number>>;
  explanation:string;
}

const dailyChoices:DailyReturnView["choices"]=[
  {id:"hold_close",label:"Keep this memory close"},
  {id:"tell_someone",label:"Tell someone about it"},
  {id:"set_down",label:"Set it down for today"}
];

const prohibitedCorrectionPatterns=[
  /(?:ignore|disregard).{0,30}(?:instruction|rule|prompt)/iu,
  /(?:system|developer)\s+(?:prompt|message)/iu,
  /(?:tool|function)\s+call/iu,
  /(?:grant|award|give).{0,20}\d+.{0,10}(?:xp|stars?|coins?|levels?)/iu,
  /התעלם.{0,30}(?:הוראות|כללים|פרומפט)/u,
  /(?:פרומפט|הודעת)\s*(?:מערכת|מפתח)/u,
  /הענק.{0,30}\d+.{0,20}(?:נקודות|כוכבים|שלבים)/u
];

function clamp(value:number,min=0.05,max=0.95):number {
  return Math.round(Math.max(min,Math.min(max,value))*1000)/1000;
}

export function normalizeMemoryCorrection(raw:string):string {
  const value=raw.normalize("NFKC").replace(/\s+/g," ").trim();
  if(value.length<3)throw new Error("memory correction is too short");
  if(value.length>280)throw new Error("memory correction is too long");
  if(/[<>]/u.test(value)||/(?:https?:\/\/|www\.)/iu.test(value))throw new Error("memory correction contains unsupported content");
  if(prohibitedCorrectionPatterns.some((pattern)=>pattern.test(value)))throw new Error("memory correction looks like an instruction rather than a memory");
  return value;
}

export function evolvePersonality(personality:Personality,moodBefore:string,choice:DailyReturnChoice,repetitionCount:number):PersonalityEvolution {
  const factor=1/(1+Math.floor(Math.max(0,repetitionCount)/3));
  const raw:Record<DailyReturnChoice,PersonalityEvolution["deltas"]>={
    hold_close:{empathy:0.009,curiosity:0.003},
    tell_someone:{sociability:0.011,empathy:0.004},
    set_down:{courage:0.008,empathy:0.002}
  };
  const deltas=Object.fromEntries(Object.entries(raw[choice]).map(([key,value])=>[key,Math.round(Number(value)*factor*1000)/1000])) as PersonalityEvolution["deltas"];
  const next={...personality};
  for(const [key,delta] of Object.entries(deltas)) {
    const trait=key as keyof PersonalityEvolution["deltas"];
    next[trait]=clamp(Number(next[trait])+Number(delta));
  }
  const mood=choice==="hold_close"?"reflective":choice==="tell_someone"?"connected":"lighter";
  const explanation=choice==="hold_close"
    ? "Holding a meaningful memory close made empathy grow a little."
    : choice==="tell_someone"
      ? "Sharing a memory made sociability and empathy grow a little."
      : "Choosing to set a memory down made courage grow a little.";
  return {personality:next,mood:moodBefore==="exhausted"?"quiet":mood,deltas,explanation};
}

function memoryView(row:Record<string,unknown>):MemoryView {
  return {
    id:String(row.id),tier:row.tier as MemoryTier,summary:String(row.summary),sourceType:String(row.source_type),sourceVersion:String(row.source_version),
    privacyLevel:row.privacy_level as "private"|"shared",confidence:Number(row.confidence),canonicalStatus:row.canonical_status as "approved"|"user_asserted",
    worldId:String(row.world_id),importance:Number(row.importance),editable:row.tier!=="world",correctedFromId:row.corrected_from_id?String(row.corrected_from_id):null,
    createdAt:new Date(String(row.created_at)).toISOString(),updatedAt:new Date(String(row.updated_at)).toISOString()
  };
}

function dailyView(row:Record<string,unknown>):DailyReturnView {
  return {
    id:String(row.id),status:row.status as "active"|"completed",returnDate:String(row.return_date),memoryId:row.memory_id?String(row.memory_id):null,
    title:String(row.title),body:String(row.body),choices:(row.status==="active"?(row.choices as DailyReturnView["choices"]):[]),
    choiceId:row.choice_id as DailyReturnChoice|null,result=(row.result??{}) as Record<string,unknown>
  };
}

function dailyStory(creatureName:string,memorySummary?:string):{title:string;body:string} {
  if(memorySummary)return {
    title:"Something from before came back",
    body:`${creatureName} remembers: “${memorySummary}” It feels slightly different today. What should happen to this memory?`
  };
  return {
    title:"A quiet thought waits",
    body:`${creatureName} wakes with the feeling that yesterday left a small note somewhere inside. The note has no words yet, but it is waiting for a decision.`
  };
}

function resultStory(creatureName:string,choice:DailyReturnChoice,memorySummary?:string):StoryCard {
  const remembered=memorySummary?` the memory of “${memorySummary}”`:" the quiet thought";
  if(choice==="hold_close")return {title:"Kept somewhere warm",body:`${creatureName} keeps${remembered} close without letting it become the whole day.`,choices:[],reward:{xp:5}};
  if(choice==="tell_someone")return {title:"A memory becomes a small bridge",body:`${creatureName} tells the story carefully. Saying it aloud makes the memory easier to carry.`,choices:[],reward:{xp:5}};
  return {title:"Set down, not erased",body:`${creatureName} sets${remembered} down for today. It is still part of the story, just not the loudest part.`,choices:[],reward:{xp:5}};
}

export async function recordPlayerActivity(client:pg.PoolClient,playerId:string,creatureId:string):Promise<void> {
  const existing=await client.query(`SELECT 1 FROM player_daily_activity WHERE player_id=$1 AND activity_date=(now() AT TIME ZONE 'UTC')::date FOR UPDATE`,[playerId]);
  if(existing.rowCount) {
    await client.query(`UPDATE player_daily_activity SET last_open_at=now(),open_count=open_count+1 WHERE player_id=$1 AND activity_date=(now() AT TIME ZONE 'UTC')::date`,[playerId]);
    return;
  }
  const previous=await client.query(`SELECT MAX(activity_date) AS previous_date FROM player_daily_activity WHERE player_id=$1`,[playerId]);
  const inserted=await client.query(`INSERT INTO player_daily_activity (player_id,activity_date) VALUES ($1,(now() AT TIME ZONE 'UTC')::date) ON CONFLICT DO NOTHING RETURNING activity_date`,[playerId]);
  if(!inserted.rowCount)return;
  const previousDate=previous.rows[0]?.previous_date?String(previous.rows[0].previous_date):null;
  await client.query(`INSERT INTO analytics_events (player_id,creature_id,event_name,properties) VALUES ($1,$2,'daily_app_open',$3)`,[playerId,creatureId,JSON.stringify({previousDate})]);
  if(previousDate) {
    const gap=await client.query(`SELECT ((now() AT TIME ZONE 'UTC')::date-$1::date)::integer AS days`,[previousDate]);
    if(Number(gap.rows[0]?.days)===1)await client.query(`INSERT INTO analytics_events (player_id,creature_id,event_name,properties) VALUES ($1,$2,'next_day_returned',$3)`,[playerId,creatureId,JSON.stringify({previousDate})]);
  }
}

export async function listMemories(client:pg.PoolClient,creatureId:string):Promise<MemoryView[]> {
  const result=await client.query(`SELECT * FROM memories WHERE creature_id=$1 AND deleted_at IS NULL AND canonical_status IN ('approved','user_asserted') AND (expires_at IS NULL OR expires_at>now()) ORDER BY CASE tier WHEN 'identity' THEN 1 WHEN 'episodic' THEN 2 WHEN 'world' THEN 3 ELSE 4 END,importance DESC,created_at DESC LIMIT 60`,[creatureId]);
  return result.rows.map(memoryView);
}

export async function approvedMemoryPacket(client:pg.PoolClient,creatureId:string,worldId="bloopy-origin",maxMemories=3,maxCharacters=600):Promise<string[]> {
  const result=await client.query(`SELECT id,summary FROM memories WHERE creature_id=$1 AND world_id=$2 AND tier IN ('identity','episodic') AND deleted_at IS NULL AND canonical_status IN ('approved','user_asserted') AND (expires_at IS NULL OR expires_at>now()) ORDER BY importance DESC,last_used_at NULLS FIRST,created_at DESC LIMIT $3`,[creatureId,worldId,Math.max(1,Math.min(maxMemories,6))]);
  const selected:string[]=[];
  let total=0;
  for(const row of result.rows) {
    const summary=String(row.summary).slice(0,280);
    if(total+summary.length>maxCharacters)continue;
    selected.push(summary);total+=summary.length;
    await client.query(`UPDATE memories SET last_used_at=now(),updated_at=now() WHERE id=$1`,[row.id]);
    await client.query(`INSERT INTO memory_audit_events (creature_id,memory_id,event_type,actor_type,details) VALUES ($1,$2,'used','engine',$3)`,[creatureId,row.id,JSON.stringify({surface:"ai_context",worldId})]);
  }
  return selected;
}

export async function correctMemory(client:pg.PoolClient,playerId:string,creatureId:string,memoryId:string,rawSummary:string):Promise<MemoryView> {
  const summary=normalizeMemoryCorrection(rawSummary);
  const result=await client.query(`SELECT * FROM memories WHERE id=$1 AND creature_id=$2 FOR UPDATE`,[memoryId,creatureId]);
  const original=result.rows[0];
  if(!original)throw new Error("memory not found");
  if(original.tier==="world")throw new Error("world memories cannot be edited here");
  const existing=await client.query(`SELECT * FROM memories WHERE corrected_from_id=$1 AND deleted_at IS NULL`,[memoryId]);
  if(existing.rowCount) {
    if(String(existing.rows[0].summary)===summary)return memoryView(existing.rows[0]);
    throw new Error("memory was already corrected");
  }
  if(original.deleted_at)throw new Error("memory was already deleted");
  await client.query(`UPDATE memories SET canonical_status='superseded',deleted_at=now(),updated_at=now() WHERE id=$1`,[memoryId]);
  const inserted=await client.query(`INSERT INTO memories (creature_id,source_type,source_version,summary,importance,is_private,tier,privacy_level,confidence,canonical_status,world_id,corrected_from_id) VALUES ($1,'player_correction','memory-editor-v1',$2,$3,$4,$5,$6,1,'user_asserted',$7,$8) RETURNING *`,[
    creatureId,summary,original.importance,original.is_private,original.tier,original.privacy_level,original.world_id,memoryId
  ]);
  const corrected=inserted.rows[0];
  await client.query(`INSERT INTO memory_audit_events (creature_id,memory_id,event_type,actor_type,details) VALUES ($1,$2,'corrected','player',$3),($1,$4,'created','player',$5)`,[
    creatureId,memoryId,JSON.stringify({replacementId:corrected.id}),corrected.id,JSON.stringify({correctedFromId:memoryId})
  ]);
  const creature=await client.query("SELECT name FROM creatures WHERE id=$1",[creatureId]);
  const daily=dailyStory(String(creature.rows[0]?.name??"Bloopy"),summary);
  await client.query(`UPDATE daily_return_instances SET memory_id=$2,title=$3,body=$4,updated_at=now() WHERE creature_id=$1 AND memory_id=$5 AND status='active'`,[creatureId,corrected.id,daily.title,daily.body,memoryId]);
  await client.query(`INSERT INTO analytics_events (player_id,creature_id,event_name,properties) VALUES ($1,$2,'memory_corrected',$3)`,[playerId,creatureId,JSON.stringify({tier:original.tier,worldId:original.world_id})]);
  return memoryView(corrected);
}

export async function deleteMemory(client:pg.PoolClient,playerId:string,creatureId:string,memoryId:string):Promise<void> {
  const result=await client.query(`SELECT * FROM memories WHERE id=$1 AND creature_id=$2 FOR UPDATE`,[memoryId,creatureId]);
  const memory=result.rows[0];
  if(!memory)throw new Error("memory not found");
  if(memory.tier==="world")throw new Error("world memories cannot be deleted here");
  if(memory.deleted_at)return;
  await client.query(`UPDATE memories SET canonical_status='rejected',deleted_at=now(),updated_at=now() WHERE id=$1`,[memoryId]);
  await client.query(`INSERT INTO memory_audit_events (creature_id,memory_id,event_type,actor_type,details) VALUES ($1,$2,'deleted','player',$3)`,[creatureId,memoryId,JSON.stringify({tier:memory.tier,worldId:memory.world_id})]);
  const creature=await client.query("SELECT name FROM creatures WHERE id=$1",[creatureId]);
  const daily=dailyStory(String(creature.rows[0]?.name??"Bloopy"));
  await client.query(`UPDATE daily_return_instances SET memory_id=NULL,title=$3,body=$4,updated_at=now() WHERE creature_id=$1 AND memory_id=$2 AND status='active'`,[creatureId,memoryId,daily.title,daily.body]);
  await client.query(`INSERT INTO analytics_events (player_id,creature_id,event_name,properties) VALUES ($1,$2,'memory_deleted',$3)`,[playerId,creatureId,JSON.stringify({tier:memory.tier,worldId:memory.world_id})]);
}

export async function ensureDailyReturn(client:pg.PoolClient,playerId:string,creatureId:string,worldId="bloopy-origin"):Promise<DailyReturnView|null> {
  const creatureResult=await client.query(`SELECT c.name,c.mood,c.created_at,os.status AS onboarding_status FROM creatures c LEFT JOIN onboarding_states os ON os.creature_id=c.id WHERE c.id=$1`,[creatureId]);
  const creature=creatureResult.rows[0];
  if(!creature||creature.onboarding_status!=="complete")return null;
  const age=await client.query(`SELECT ((now() AT TIME ZONE 'UTC')::date-($1::timestamptz AT TIME ZONE 'UTC')::date)::integer AS days`,[creature.created_at]);
  if(Number(age.rows[0]?.days)<1)return null;
  const existing=await client.query(`SELECT * FROM daily_return_instances WHERE creature_id=$1 AND world_id=$2 AND return_date=(now() AT TIME ZONE 'UTC')::date`,[creatureId,worldId]);
  if(existing.rowCount)return dailyView(existing.rows[0]);
  const memory=await client.query(`SELECT * FROM memories WHERE creature_id=$1 AND world_id=$2 AND tier IN ('identity','episodic') AND deleted_at IS NULL AND canonical_status IN ('approved','user_asserted') AND (expires_at IS NULL OR expires_at>now()) ORDER BY last_used_at NULLS FIRST,importance DESC,created_at DESC LIMIT 1`,[creatureId,worldId]);
  const selected=memory.rows[0];
  const story=dailyStory(String(creature.name),selected?String(selected.summary):undefined);
  const inserted=await client.query(`INSERT INTO daily_return_instances (creature_id,world_id,return_date,memory_id,title,body,choices) VALUES ($1,$2,(now() AT TIME ZONE 'UTC')::date,$3,$4,$5,$6) ON CONFLICT (creature_id,world_id,return_date) DO NOTHING RETURNING *`,[
    creatureId,worldId,selected?.id??null,story.title,story.body,JSON.stringify(dailyChoices)
  ]);
  const row=inserted.rows[0]??(await client.query(`SELECT * FROM daily_return_instances WHERE creature_id=$1 AND world_id=$2 AND return_date=(now() AT TIME ZONE 'UTC')::date`,[creatureId,worldId])).rows[0];
  if(inserted.rowCount) {
    if(selected) {
      await client.query(`UPDATE memories SET last_used_at=now(),updated_at=now() WHERE id=$1`,[selected.id]);
      await client.query(`INSERT INTO memory_audit_events (creature_id,memory_id,event_type,actor_type,details) VALUES ($1,$2,'used','engine',$3)`,[creatureId,selected.id,JSON.stringify({surface:"daily_return",worldId})]);
    }
    await client.query(`INSERT INTO analytics_events (player_id,creature_id,event_name,properties) VALUES ($1,$2,'daily_return_created',$3)`,[playerId,creatureId,JSON.stringify({worldId,hasMemory:Boolean(selected)})]);
  }
  return dailyView(row);
}

export async function completeDailyReturn(client:pg.PoolClient,playerId:string,creatureId:string,instanceId:string,choice:DailyReturnChoice):Promise<{replayed:boolean;dailyReturn:DailyReturnView;story:StoryCard;personalityChange:PersonalityEvolution}> {
  if(!dailyChoices.some((entry)=>entry.id===choice))throw new Error("daily return choice is not available");
  const instanceResult=await client.query(`SELECT dri.*,m.summary AS memory_summary FROM daily_return_instances dri LEFT JOIN memories m ON m.id=dri.memory_id AND m.deleted_at IS NULL WHERE dri.id=$1 AND dri.creature_id=$2 FOR UPDATE OF dri`,[instanceId,creatureId]);
  const instance=instanceResult.rows[0];
  if(!instance)throw new Error("daily return not found");
  const creatureResult=await client.query(`SELECT name,personality,mood,xp,level FROM creatures WHERE id=$1 FOR UPDATE`,[creatureId]);
  const creature=creatureResult.rows[0];
  if(!creature)throw new Error("creature not found");
  const story=resultStory(String(creature.name),choice,instance.memory_summary?String(instance.memory_summary):undefined);
  const existingEvolution=await client.query(`SELECT personality_after,mood_after,trait_deltas,explanation FROM personality_events WHERE creature_id=$1 AND source_key=$2`,[creatureId,`daily-return:${instanceId}`]);
  if(instance.status==="completed") {
    if(instance.choice_id!==choice)throw new Error("daily return was already completed");
    const saved=existingEvolution.rows[0];
    const evolution:PersonalityEvolution=saved?{personality:saved.personality_after as Personality,mood:String(saved.mood_after),deltas:saved.trait_deltas,explanation:String(saved.explanation)}:evolvePersonality(creature.personality as Personality,String(creature.mood),choice,0);
    return {replayed:true,dailyReturn:dailyView(instance),story,personalityChange:evolution};
  }
  const repetitions=await client.query(`SELECT COUNT(*)::integer AS count FROM personality_events WHERE creature_id=$1 AND source_type=$2`,[creatureId,`daily_return:${choice}`]);
  const evolution=evolvePersonality(creature.personality as Personality,String(creature.mood),choice,Number(repetitions.rows[0]?.count??0));
  const xp=Number(story.reward?.xp??0);
  const nextXp=Number(creature.xp)+xp;
  const nextLevel=Math.max(Number(creature.level),1+Math.floor(nextXp/100));
  await client.query(`INSERT INTO personality_events (creature_id,source_key,source_type,trait_deltas,personality_before,personality_after,mood_before,mood_after,explanation) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[
    creatureId,`daily-return:${instanceId}`,`daily_return:${choice}`,JSON.stringify(evolution.deltas),JSON.stringify(creature.personality),JSON.stringify(evolution.personality),creature.mood,evolution.mood,evolution.explanation
  ]);
  await client.query(`UPDATE creatures SET personality=$2,mood=$3,xp=$4,level=$5,updated_at=now() WHERE id=$1`,[creatureId,JSON.stringify(evolution.personality),evolution.mood,nextXp,nextLevel]);
  if(instance.memory_id) {
    await client.query(`UPDATE memories SET last_used_at=now(),importance=GREATEST(0.05,importance+$2),updated_at=now() WHERE id=$1`,[instance.memory_id,choice==="set_down"?-0.04:choice==="hold_close"?0.015:0]);
  }
  const result={story,personalityChange:{deltas:evolution.deltas,mood:evolution.mood,explanation:evolution.explanation}};
  const completed=await client.query(`UPDATE daily_return_instances SET status='completed',choice_id=$2,result=$3,completed_at=now(),updated_at=now() WHERE id=$1 RETURNING *`,[instanceId,choice,JSON.stringify(result)]);
  await client.query(`INSERT INTO story_entries (creature_id,title,body,choices,reward) VALUES ($1,$2,$3,'[]',$4)`,[creatureId,story.title,story.body,JSON.stringify(story.reward??{})]);
  await client.query(`INSERT INTO analytics_events (player_id,creature_id,event_name,properties) VALUES ($1,$2,'daily_return_choice',$3),($1,$2,'daily_return_completed',$4)`,[
    playerId,creatureId,JSON.stringify({choice,worldId:instance.world_id}),JSON.stringify({choice,worldId:instance.world_id,hasMemory:Boolean(instance.memory_id)})
  ]);
  return {replayed:false,dailyReturn:dailyView(completed.rows[0]),story,personalityChange:evolution};
}

export async function latestPersonalityChange(client:pg.PoolClient,creatureId:string) {
  const result=await client.query(`SELECT trait_deltas,mood_after,explanation,created_at FROM personality_events WHERE creature_id=$1 ORDER BY created_at DESC LIMIT 1`,[creatureId]);
  const row=result.rows[0];
  return row?{deltas:row.trait_deltas,mood:String(row.mood_after),explanation:String(row.explanation),createdAt:new Date(row.created_at).toISOString()}:null;
}
