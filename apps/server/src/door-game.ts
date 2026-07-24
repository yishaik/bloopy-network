import type pg from "pg";
import { config } from "./config.js";
import { AppError } from "./errors.js";
import {
  buildImpossibleDoorBeat,
  IMPOSSIBLE_DOOR_ARC_ID,
  IMPOSSIBLE_DOOR_START_BEAT,
  IMPOSSIBLE_DOOR_VERSION,
  resolveImpossibleDoorChoice,
  type DoorBeatView,
  type DoorRoute,
  type DoorStoryState,
  type DoorTransition
} from "./impossible-door.js";
import { buildLetterBeat, LETTER_ARC_ID, LETTER_ARC_START_BEAT, LETTER_ARC_VERSION, resolveLetterChoice } from "./second-arc.js";
import type { StoryCard } from "./types.js";

const impossibleDoorEnabled=config.IMPOSSIBLE_DOOR_ENABLED;
const doorCliffhangerDelaySeconds=config.DOOR_CLIFFHANGER_DELAY_SECONDS;

export interface ArcDefinition {
  arcId:string;
  version:number;
  startBeat:string;
  questId:string;
  display:{eyebrow:string;title:string};
  activeLocation:string;
  epilogueEventType:string;
  inheritRouteFromArcId?:string;
  buildBeat(beatId:string,creatureName:string,route:DoorRoute|null,state:DoorStoryState):DoorBeatView;
  resolveChoice(beatId:string,choiceId:string,route:DoorRoute|null,state:DoorStoryState,creatureName:string):DoorTransition;
  completionMemory(creatureName:string,transition:DoorTransition):string;
}

const DOOR_ARC:ArcDefinition={
  arcId:IMPOSSIBLE_DOOR_ARC_ID,
  version:IMPOSSIBLE_DOOR_VERSION,
  startBeat:IMPOSSIBLE_DOOR_START_BEAT,
  questId:"impossible-door",
  display:{eyebrow:"FIRST ADVENTURE",title:"The door that was not there yesterday"},
  activeLocation:"impossible_door",
  epilogueEventType:"door_cliffhanger",
  buildBeat:buildImpossibleDoorBeat,
  resolveChoice:resolveImpossibleDoorChoice,
  completionMemory:(name,transition)=>`${name} survived the impossible door through the ${transition.route??"secret"} route and chose ${transition.state.epilogue??"keep_secret"}.`
};

const LETTER_ARC:ArcDefinition={
  arcId:LETTER_ARC_ID,
  version:LETTER_ARC_VERSION,
  startBeat:LETTER_ARC_START_BEAT,
  questId:"letter-from-tomorrow",
  display:{eyebrow:"SECOND ADVENTURE",title:"The letter from tomorrow"},
  activeLocation:"thirteenth_hour",
  epilogueEventType:"arc_epilogue",
  inheritRouteFromArcId:IMPOSSIBLE_DOOR_ARC_ID,
  buildBeat:buildLetterBeat,
  resolveChoice:resolveLetterChoice,
  completionMemory:(name,transition)=>`${name} followed a letter from tomorrow into the thirteenth hour and chose ${(transition.state as {letterFinal?:string}).letterFinal??"keep_stamp"}.`
};

const ARCS:Record<string,ArcDefinition>={[DOOR_ARC.arcId]:DOOR_ARC,[LETTER_ARC.arcId]:LETTER_ARC};

export interface ImpossibleDoorArcView {
  id:string;
  arcId:string;
  version:number;
  status:"active"|"completed"|"paused";
  currentBeat:string;
  route:DoorRoute|null;
  state:DoorStoryState;
  chapter:number;
  totalChapters:number;
  story:StoryCard;
  completedAt:string|null;
  display:{eyebrow:string;title:string};
}

export interface DoorChoiceResult {
  replayed:boolean;
  storyArc:ImpossibleDoorArcView;
  storyEntryId:string|null;
  narrative:null|{
    sceneId:string;
    canonicalFacts:string[];
    allowedReferences:string[];
  };
}

async function recordAnalytics(client:pg.PoolClient,playerId:string,creatureId:string,eventName:string,properties:Record<string,unknown>) {
  await client.query(`INSERT INTO analytics_events (player_id,creature_id,event_name,properties) VALUES ($1,$2,$3,$4)`,[playerId,creatureId,eventName,JSON.stringify(properties)]);
}

export async function getInventory(client:pg.PoolClient,creatureId:string) {
  const result=await client.query(`
    SELECT c.id,c.name,c.description,c.icon,c.stackable,COALESCE(SUM(l.delta),0)::integer AS quantity
    FROM item_catalog c
    JOIN inventory_ledger l ON l.item_id=c.id
    WHERE l.creature_id=$1
    GROUP BY c.id,c.name,c.description,c.icon,c.stackable
    HAVING SUM(l.delta)>0
    ORDER BY MIN(l.created_at),c.name`,[creatureId]);
  return result.rows;
}

async function getArcView(client:pg.PoolClient,creatureId:string,def:ArcDefinition):Promise<ImpossibleDoorArcView|null> {
  if(!impossibleDoorEnabled) return null;
  const result=await client.query(`SELECT sai.*,c.name FROM story_arc_instances sai JOIN creatures c ON c.id=sai.creature_id WHERE sai.creature_id=$1 AND sai.arc_id=$2`,[creatureId,def.arcId]);
  const row=result.rows[0];
  if(!row) return null;
  const route=(row.route??null) as DoorRoute|null;
  const state=(row.state??{}) as DoorStoryState;
  const beat=def.buildBeat(row.current_beat,row.name,route,state);
  const rendered=await client.query(`SELECT title,body,reward FROM story_entries WHERE arc_instance_id=$1 AND beat_id=$2 ORDER BY created_at DESC LIMIT 1`,[row.id,row.current_beat]);
  const persisted=rendered.rows[0];
  const story:StoryCard=persisted?{...beat.story,title:persisted.title,body:persisted.body,reward:persisted.reward}:{...beat.story};
  return {
    id:row.id,
    arcId:row.arc_id,
    version:Number(row.arc_version),
    status:row.status,
    currentBeat:row.current_beat,
    route,
    state,
    chapter:beat.chapter,
    totalChapters:beat.totalChapters,
    story,
    completedAt:row.completed_at?new Date(row.completed_at).toISOString():null,
    display:def.display
  };
}

async function ensureArcInstance(client:pg.PoolClient,playerId:string,creatureId:string,def:ArcDefinition):Promise<ImpossibleDoorArcView|null> {
  if(!impossibleDoorEnabled) return null;
  const onboarding=await client.query("SELECT status FROM onboarding_states WHERE creature_id=$1",[creatureId]);
  if(onboarding.rows[0]?.status!=="complete") return null;

  let inheritedRoute:DoorRoute|null=null;
  if(def.inheritRouteFromArcId) {
    const parent=await client.query("SELECT route FROM story_arc_instances WHERE creature_id=$1 AND arc_id=$2",[creatureId,def.inheritRouteFromArcId]);
    inheritedRoute=(parent.rows[0]?.route??null) as DoorRoute|null;
  }

  const inserted=await client.query(`
    INSERT INTO story_arc_instances (creature_id,arc_id,arc_version,current_beat,route)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (creature_id,arc_id) DO NOTHING
    RETURNING *`,[creatureId,def.arcId,def.version,def.startBeat,inheritedRoute]);

  if(inserted.rowCount) {
    const instance=inserted.rows[0];
    const creature=await client.query("SELECT name FROM creatures WHERE id=$1",[creatureId]);
    const beat=def.buildBeat(def.startBeat,creature.rows[0].name,inheritedRoute,{});
    await client.query(`INSERT INTO story_entries (creature_id,arc_instance_id,beat_id,title,body,choices,reward) VALUES ($1,$2,$3,$4,$5,$6,$7)`,[
      creatureId,instance.id,beat.id,beat.story.title,beat.story.body,JSON.stringify(beat.story.choices),JSON.stringify(beat.story.reward??{})
    ]);
    await client.query(`INSERT INTO quest_instances (quest_id,creature_id,status,progress)
      SELECT $2,$1,'active',$3
      WHERE NOT EXISTS (SELECT 1 FROM quest_instances WHERE quest_id=$2 AND creature_id=$1)`,[creatureId,def.questId,JSON.stringify({arcId:instance.id,beat:beat.id,chapter:beat.chapter})]);
    await recordAnalytics(client,playerId,creatureId,"story_arc_started",{arcId:def.arcId,version:def.version});
  }
  return getArcView(client,creatureId,def);
}

// The active arc drives the Mini App story card: the door first, then — after the
// cliffhanger delay has passed — the letter arc picks up its loose threads.
export async function ensureActiveStoryArc(client:pg.PoolClient,playerId:string,creatureId:string):Promise<ImpossibleDoorArcView|null> {
  const door=await ensureArcInstance(client,playerId,creatureId,DOOR_ARC);
  if(!door||door.status!=="completed"||!door.completedAt) return door;
  const readyAt=new Date(door.completedAt).getTime()+doorCliffhangerDelaySeconds*1000;
  if(Date.now()<readyAt) return door;
  return (await ensureArcInstance(client,playerId,creatureId,LETTER_ARC))??door;
}

async function applyInventoryDelta(client:pg.PoolClient,creatureId:string,def:ArcDefinition,instanceId:string,beatId:string,choiceId:string,item:{itemId:string;delta:number;reason:string}) {
  if(item.delta<0) {
    const available=await client.query(`SELECT COALESCE(SUM(delta),0)::integer AS quantity FROM inventory_ledger WHERE creature_id=$1 AND item_id=$2`,[creatureId,item.itemId]);
    if(Number(available.rows[0].quantity)+item.delta<0) throw new AppError("door_missing_item",409,`The pockets come up empty — a ${item.itemId.replaceAll("_"," ")} is needed for that.`);
  }
  const sourceKey=`arc:${instanceId}:${beatId}:${choiceId}:${item.itemId}`;
  await client.query(`INSERT INTO inventory_ledger (creature_id,item_id,delta,source_key,metadata) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (creature_id,source_key) DO NOTHING`,[
    creatureId,item.itemId,item.delta,sourceKey,JSON.stringify({arcId:def.arcId,beatId,choiceId,reason:item.reason})
  ]);
}

async function applyRelationshipEffect(client:pg.PoolClient,creatureId:string,effect:{targetSlug:string;trust:number;affection:number;rivalry:number;lastEvent:string}) {
  await client.query(`INSERT INTO relationships (source_creature_id,target_creature_id,trust,affection,rivalry,last_event)
    SELECT $1,id,$3,$4,$5,$6 FROM creatures WHERE slug=$2
    ON CONFLICT (source_creature_id,target_creature_id) DO UPDATE SET
      trust=relationships.trust+EXCLUDED.trust,
      affection=relationships.affection+EXCLUDED.affection,
      rivalry=relationships.rivalry+EXCLUDED.rivalry,
      last_event=EXCLUDED.last_event,
      updated_at=now()`,[creatureId,effect.targetSlug,effect.trust,effect.affection,effect.rivalry,effect.lastEvent]);
}

async function applyArcChoice(client:pg.PoolClient,playerId:string,creatureId:string,def:ArcDefinition,input:{beatId:string;choiceId:string}):Promise<DoorChoiceResult> {
  const instanceResult=await client.query(`SELECT sai.*,c.name FROM story_arc_instances sai JOIN creatures c ON c.id=sai.creature_id WHERE sai.creature_id=$1 AND sai.arc_id=$2 FOR UPDATE OF sai`,[creatureId,def.arcId]);
  const instance=instanceResult.rows[0];
  if(!instance) throw new AppError("door_not_started",409,"That story hasn't found this creature yet.");

  if(instance.current_beat!==input.beatId) {
    const previous=await client.query("SELECT choice_id FROM story_arc_choices WHERE instance_id=$1 AND beat_id=$2",[instance.id,input.beatId]);
    if(previous.rows[0]?.choice_id===input.choiceId) {
      const current=await getArcView(client,creatureId,def);
      if(!current) throw new AppError("door_state_missing",500,"The story briefly misplaced itself. Try again in a moment.");
      return {replayed:true,storyArc:current,storyEntryId:null,narrative:null};
    }
    throw new AppError("door_moved_on",409,"The story has already moved past that moment.");
  }
  if(instance.status!=="active") throw new AppError("door_complete",409,"That adventure is already finished. A new thread will find you later.");

  const route=(instance.route??null) as DoorRoute|null;
  const state=(instance.state??{}) as DoorStoryState;
  const transition=def.resolveChoice(input.beatId,input.choiceId,route,state,instance.name);

  await client.query(`INSERT INTO story_arc_choices (instance_id,beat_id,choice_id,result_beat,choice_payload) VALUES ($1,$2,$3,$4,$5)`,[
    instance.id,input.beatId,input.choiceId,transition.nextBeat,JSON.stringify({route:transition.route,state:transition.state})
  ]);

  for(const item of transition.inventory) await applyInventoryDelta(client,creatureId,def,instance.id,input.beatId,input.choiceId,item);
  for(const effect of transition.relationships) await applyRelationshipEffect(client,creatureId,effect);
  for(const flag of transition.flags) await client.query(`INSERT INTO story_flags (creature_id,flag_key,flag_value) VALUES ($1,$2,$3) ON CONFLICT (creature_id,flag_key) DO UPDATE SET flag_value=EXCLUDED.flag_value,updated_at=now()`,[creatureId,flag.key,JSON.stringify(flag.value)]);

  await client.query(`UPDATE creatures SET xp=xp+$2,level=GREATEST(level,1+FLOOR((xp+$2)/100.0)::integer),mood=$3,current_location=$4,updated_at=now() WHERE id=$1`,[
    creatureId,transition.xp,transition.status==="completed"?"thoughtful":"alert",transition.status==="completed"?"cardboard_nest":def.activeLocation
  ]);
  await client.query(`UPDATE story_arc_instances SET current_beat=$2,route=$3,state=$4,status=$5,completed_at=CASE WHEN $5='completed' THEN now() ELSE completed_at END,updated_at=now() WHERE id=$1`,[
    instance.id,transition.nextBeat,transition.route,JSON.stringify(transition.state),transition.status
  ]);

  const nextBeat=def.buildBeat(transition.nextBeat,instance.name,transition.route,transition.state);
  const persistedStory:StoryCard={...nextBeat.story,reward:{xp:transition.xp}};
  const storyEntry=await client.query(`INSERT INTO story_entries (creature_id,arc_instance_id,beat_id,title,body,choices,reward) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[
    creatureId,instance.id,nextBeat.id,persistedStory.title,persistedStory.body,JSON.stringify(persistedStory.choices),JSON.stringify(persistedStory.reward)
  ]);

  await client.query(`UPDATE quest_instances SET status=$3,progress=$4,updated_at=now() WHERE quest_id=$2 AND creature_id=$1`,[
    creatureId,def.questId,transition.status,JSON.stringify({arcId:instance.id,beat:transition.nextBeat,chapter:nextBeat.chapter,route:transition.route})
  ]);
  await recordAnalytics(client,playerId,creatureId,"story_arc_choice",{arcId:def.arcId,beatId:input.beatId,choiceId:input.choiceId,nextBeat:transition.nextBeat,route:transition.route});

  if(transition.status==="completed") {
    await client.query(`INSERT INTO memories (creature_id,source_type,summary,importance,is_private) VALUES ($1,'story_arc',$2,0.95,true)`,[
      creatureId,def.completionMemory(instance.name,transition)
    ]);
    if(transition.cliffhanger) {
      await client.query(`INSERT INTO world_events (creature_id,event_type,payload,due_at)
        SELECT $1,$5,$2,now()+($3||' seconds')::interval
        WHERE NOT EXISTS (SELECT 1 FROM world_events WHERE creature_id=$1 AND event_type=$5 AND payload->>'arcInstanceId'=$4)`,[
        creatureId,JSON.stringify({...transition.cliffhanger,arcInstanceId:instance.id,action:"talk"}),doorCliffhangerDelaySeconds,String(instance.id),def.epilogueEventType
      ]);
    }
    await recordAnalytics(client,playerId,creatureId,"story_arc_completed",{arcId:def.arcId,route:transition.route,state:transition.state});
  }

  const current=await getArcView(client,creatureId,def);
  if(!current) throw new AppError("door_state_missing",500,"The story briefly misplaced itself. Try again in a moment.");
  return {
    replayed:false,
    storyArc:current,
    storyEntryId:storyEntry.rows[0].id,
    narrative:nextBeat.aiEligible?{
      sceneId:`${def.arcId}:${nextBeat.id}`,
      canonicalFacts:nextBeat.canonicalFacts,
      allowedReferences:nextBeat.allowedReferences
    }:null
  };
}

export async function applyStoryArcChoice(client:pg.PoolClient,playerId:string,creatureId:string,input:{arcId:string;beatId:string;choiceId:string}):Promise<DoorChoiceResult> {
  const def=ARCS[input.arcId];
  if(!def) throw new AppError("arc_unknown",400,"No story goes by that name here.");
  return applyArcChoice(client,playerId,creatureId,def,input);
}

export async function ensureImpossibleDoorArc(client:pg.PoolClient,playerId:string,creatureId:string):Promise<ImpossibleDoorArcView|null> {
  return ensureArcInstance(client,playerId,creatureId,DOOR_ARC);
}

export async function applyImpossibleDoorChoice(client:pg.PoolClient,playerId:string,creatureId:string,input:{beatId:string;choiceId:string}):Promise<DoorChoiceResult> {
  return applyArcChoice(client,playerId,creatureId,DOOR_ARC,input);
}

export async function updateDoorStoryNarrative(client:pg.PoolClient,storyEntryId:string,title:string,body:string) {
  await client.query("UPDATE story_entries SET title=$2,body=$3 WHERE id=$1",[storyEntryId,title,body]);
}
