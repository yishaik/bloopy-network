import type pg from "pg";
import { config } from "./config.js";
import {
  buildImpossibleDoorBeat,
  IMPOSSIBLE_DOOR_ARC_ID,
  IMPOSSIBLE_DOOR_START_BEAT,
  IMPOSSIBLE_DOOR_VERSION,
  resolveImpossibleDoorChoice,
  type DoorRoute,
  type DoorStoryState
} from "./impossible-door.js";

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
  story:{title:string;body:string;choices:Array<{id:string;label:string;action:string}>;reward?:{xp?:number;stars?:number}};
  completedAt:string|null;
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

export async function ensureImpossibleDoorArc(client:pg.PoolClient,playerId:string,creatureId:string):Promise<ImpossibleDoorArcView|null> {
  if(!config.IMPOSSIBLE_DOOR_ENABLED) return null;
  const onboarding=await client.query("SELECT status FROM onboarding_states WHERE creature_id=$1",[creatureId]);
  if(onboarding.rows[0]?.status!=="complete") return null;

  const inserted=await client.query(`
    INSERT INTO story_arc_instances (creature_id,arc_id,arc_version,current_beat)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (creature_id,arc_id) DO NOTHING
    RETURNING *`,[creatureId,IMPOSSIBLE_DOOR_ARC_ID,IMPOSSIBLE_DOOR_VERSION,IMPOSSIBLE_DOOR_START_BEAT]);

  if(inserted.rowCount) {
    const instance=inserted.rows[0];
    const creature=await client.query("SELECT name FROM creatures WHERE id=$1",[creatureId]);
    const beat=buildImpossibleDoorBeat(IMPOSSIBLE_DOOR_START_BEAT,creature.rows[0].name,null,{});
    await client.query(`INSERT INTO story_entries (creature_id,arc_instance_id,beat_id,title,body,choices,reward) VALUES ($1,$2,$3,$4,$5,$6,$7)`,[
      creatureId,instance.id,beat.id,beat.story.title,beat.story.body,JSON.stringify(beat.story.choices),JSON.stringify(beat.story.reward??{})
    ]);
    await client.query(`INSERT INTO quest_instances (quest_id,creature_id,status,progress)
      SELECT 'impossible-door',$1,'active',$2
      WHERE NOT EXISTS (SELECT 1 FROM quest_instances WHERE quest_id='impossible-door' AND creature_id=$1)`,[creatureId,JSON.stringify({arcId:instance.id,beat:beat.id,chapter:beat.chapter})]);
    await recordAnalytics(client,playerId,creatureId,"story_arc_started",{arcId:IMPOSSIBLE_DOOR_ARC_ID,version:IMPOSSIBLE_DOOR_VERSION});
  }
  return getImpossibleDoorArc(client,creatureId);
}

export async function getImpossibleDoorArc(client:pg.PoolClient,creatureId:string):Promise<ImpossibleDoorArcView|null> {
  if(!config.IMPOSSIBLE_DOOR_ENABLED) return null;
  const result=await client.query(`SELECT sai.*,c.name FROM story_arc_instances sai JOIN creatures c ON c.id=sai.creature_id WHERE sai.creature_id=$1 AND sai.arc_id=$2`,[creatureId,IMPOSSIBLE_DOOR_ARC_ID]);
  const row=result.rows[0];
  if(!row) return null;
  const route=(row.route??null) as DoorRoute|null;
  const state=(row.state??{}) as DoorStoryState;
  const beat=buildImpossibleDoorBeat(row.current_beat,row.name,route,state);
  const rendered=await client.query(`SELECT title,body,reward FROM story_entries WHERE arc_instance_id=$1 AND beat_id=$2 ORDER BY created_at DESC LIMIT 1`,[row.id,row.current_beat]);
  const persisted=rendered.rows[0];
  const story=persisted?{...beat.story,title:persisted.title,body:persisted.body,reward:persisted.reward}:{...beat.story};
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
    completedAt:row.completed_at?new Date(row.completed_at).toISOString():null
  };
}

async function applyInventoryDelta(client:pg.PoolClient,creatureId:string,instanceId:string,beatId:string,choiceId:string,item:{itemId:string;delta:number;reason:string}) {
  if(item.delta<0) {
    const available=await client.query(`SELECT COALESCE(SUM(delta),0)::integer AS quantity FROM inventory_ledger WHERE creature_id=$1 AND item_id=$2`,[creatureId,item.itemId]);
    if(Number(available.rows[0].quantity)+item.delta<0) throw new Error(`not enough ${item.itemId} in inventory`);
  }
  const sourceKey=`door:${instanceId}:${beatId}:${choiceId}:${item.itemId}`;
  await client.query(`INSERT INTO inventory_ledger (creature_id,item_id,delta,source_key,metadata) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (creature_id,source_key) DO NOTHING`,[
    creatureId,item.itemId,item.delta,sourceKey,JSON.stringify({arcId:IMPOSSIBLE_DOOR_ARC_ID,beatId,choiceId,reason:item.reason})
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

export async function applyImpossibleDoorChoice(client:pg.PoolClient,playerId:string,creatureId:string,input:{beatId:string;choiceId:string}):Promise<DoorChoiceResult> {
  const instanceResult=await client.query(`SELECT sai.*,c.name FROM story_arc_instances sai JOIN creatures c ON c.id=sai.creature_id WHERE sai.creature_id=$1 AND sai.arc_id=$2 FOR UPDATE OF sai`,[creatureId,IMPOSSIBLE_DOOR_ARC_ID]);
  const instance=instanceResult.rows[0];
  if(!instance) throw new Error("impossible door story has not started");

  if(instance.current_beat!==input.beatId) {
    const previous=await client.query("SELECT choice_id FROM story_arc_choices WHERE instance_id=$1 AND beat_id=$2",[instance.id,input.beatId]);
    if(previous.rows[0]?.choice_id===input.choiceId) {
      const current=await getImpossibleDoorArc(client,creatureId);
      if(!current) throw new Error("story arc not found");
      return {replayed:true,storyArc:current,storyEntryId:null,narrative:null};
    }
    throw new Error("story has already moved on");
  }
  if(instance.status!=="active") throw new Error("story arc is already complete");

  const route=(instance.route??null) as DoorRoute|null;
  const state=(instance.state??{}) as DoorStoryState;
  const transition=resolveImpossibleDoorChoice(input.beatId,input.choiceId,route,state,instance.name);

  await client.query(`INSERT INTO story_arc_choices (instance_id,beat_id,choice_id,result_beat,choice_payload) VALUES ($1,$2,$3,$4,$5)`,[
    instance.id,input.beatId,input.choiceId,transition.nextBeat,JSON.stringify({route:transition.route,state:transition.state})
  ]);

  for(const item of transition.inventory) await applyInventoryDelta(client,creatureId,instance.id,input.beatId,input.choiceId,item);
  for(const effect of transition.relationships) await applyRelationshipEffect(client,creatureId,effect);
  for(const flag of transition.flags) await client.query(`INSERT INTO story_flags (creature_id,flag_key,flag_value) VALUES ($1,$2,$3) ON CONFLICT (creature_id,flag_key) DO UPDATE SET flag_value=EXCLUDED.flag_value,updated_at=now()`,[creatureId,flag.key,JSON.stringify(flag.value)]);

  await client.query(`UPDATE creatures SET xp=xp+$2,level=GREATEST(level,1+FLOOR((xp+$2)/100.0)::integer),mood=$3,current_location=$4,updated_at=now() WHERE id=$1`,[
    creatureId,transition.xp,transition.status==="completed"?"thoughtful":"alert",transition.status==="completed"?"cardboard_nest":"impossible_door"
  ]);
  await client.query(`UPDATE story_arc_instances SET current_beat=$2,route=$3,state=$4,status=$5,completed_at=CASE WHEN $5='completed' THEN now() ELSE completed_at END,updated_at=now() WHERE id=$1`,[
    instance.id,transition.nextBeat,transition.route,JSON.stringify(transition.state),transition.status
  ]);

  const nextBeat=buildImpossibleDoorBeat(transition.nextBeat,instance.name,transition.route,transition.state);
  const persistedStory={...nextBeat.story,reward:{xp:transition.xp}};
  const storyEntry=await client.query(`INSERT INTO story_entries (creature_id,arc_instance_id,beat_id,title,body,choices,reward) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[
    creatureId,instance.id,nextBeat.id,persistedStory.title,persistedStory.body,JSON.stringify(persistedStory.choices),JSON.stringify(persistedStory.reward)
  ]);

  await client.query(`UPDATE quest_instances SET status=$3,progress=$4,updated_at=now() WHERE quest_id='impossible-door' AND creature_id=$1`,[
    creatureId,instance.id,transition.status,JSON.stringify({arcId:instance.id,beat:transition.nextBeat,chapter:nextBeat.chapter,route:transition.route})
  ]);
  await recordAnalytics(client,playerId,creatureId,"story_arc_choice",{arcId:IMPOSSIBLE_DOOR_ARC_ID,beatId:input.beatId,choiceId:input.choiceId,nextBeat:transition.nextBeat,route:transition.route});

  if(transition.status==="completed") {
    await client.query(`INSERT INTO memories (creature_id,source_type,summary,importance,is_private) VALUES ($1,'story_arc',$2,0.95,true)`,[
      creatureId,`${instance.name} survived the impossible door through the ${transition.route??"secret"} route and chose ${transition.state.epilogue??"keep_secret"}.`
    ]);
    if(transition.cliffhanger) {
      await client.query(`INSERT INTO world_events (creature_id,event_type,payload,due_at)
        SELECT $1,'door_cliffhanger',$2,now()+($3||' seconds')::interval
        WHERE NOT EXISTS (SELECT 1 FROM world_events WHERE creature_id=$1 AND event_type='door_cliffhanger' AND payload->>'arcInstanceId'=$4)`,[
        creatureId,JSON.stringify({...transition.cliffhanger,arcInstanceId:instance.id,action:"talk"}),config.DOOR_CLIFFHANGER_DELAY_SECONDS,String(instance.id)
      ]);
    }
    await recordAnalytics(client,playerId,creatureId,"story_arc_completed",{arcId:IMPOSSIBLE_DOOR_ARC_ID,route:transition.route,doorAction:transition.state.doorAction,finalChoice:transition.state.finalChoice,epilogue:transition.state.epilogue});
  }

  const current=await getImpossibleDoorArc(client,creatureId);
  if(!current) throw new Error("story arc not found after transition");
  return {
    replayed:false,
    storyArc:current,
    storyEntryId:storyEntry.rows[0].id,
    narrative:nextBeat.aiEligible?{
      sceneId:`${IMPOSSIBLE_DOOR_ARC_ID}:${nextBeat.id}`,
      canonicalFacts:nextBeat.canonicalFacts,
      allowedReferences:nextBeat.allowedReferences
    }:null
  };
}

export async function updateDoorStoryNarrative(client:pg.PoolClient,storyEntryId:string,title:string,body:string) {
  await client.query("UPDATE story_entries SET title=$2,body=$3 WHERE id=$1",[storyEntryId,title,body]);
}
