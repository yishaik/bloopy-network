import { randomUUID } from "node:crypto";
import type pg from "pg";
import { config } from "./config.js";
import { seal } from "./crypto.js";
import {
  applyWakeChoice,
  identityStory,
  normalizeCreatureName,
  proactiveGenesisText,
  visualMarkerOptions,
  wakeChoiceOptions,
  wakeFlag,
  wakeStory,
  type VisualMarker,
  type WakeChoice
} from "./onboarding.js";
import { buildStory, type GameAction } from "./story.js";
import type { AvatarGenome, OnboardingState, Personality, StoryCard, TelegramUser } from "./types.js";

function starterPersonality(seed: number): Personality {
  return { archetype: seed % 2 === 0 ? "curious_trickster" : "gentle_explorer", voice: seed % 2 === 0 ? "warm_deadpan" : "earnest_whimsy", curiosity:0.72, courage:0.48, empathy:0.67, mischief:seed%2===0?0.71:0.49, sociability:0.62 };
}

function starterGenome(seed: number): AvatarGenome {
  const colors = [["#8ee3cf","#ff8fa3"],["#a9c8ff","#ffd37d"],["#c7a8ff","#87dfba"]] as const;
  const [primary, secondary] = colors[Math.abs(seed)%colors.length] as readonly [string,string];
  return { body:seed%3===0?"cloud":seed%3===1?"pear":"round", primary, secondary, eyes:seed%2===0?"wide":"spark", mark:seed%3===0?"moon":seed%3===1?"star":"dot", accessory:seed%2===0?"satchel":"leaf", evolution:1 };
}

async function recordAnalytics(client:pg.PoolClient,playerId:string,creatureId:string,eventName:string,properties:Record<string,unknown>={}) {
  await client.query(`INSERT INTO analytics_events (player_id,creature_id,event_name,properties) VALUES ($1,$2,$3,$4)`,[playerId,creatureId,eventName,JSON.stringify(properties)]);
}

async function seedPlayableWorld(client:pg.PoolClient,creatureId:string,callbackText?:string) {
  await client.query(`INSERT INTO quest_instances (quest_id,creature_id,status,progress)
    SELECT seed.quest_id,$1,'active',seed.progress::jsonb
    FROM (VALUES ('first-window','{"seen":false}'),('meet-numa','{"met":false}')) AS seed(quest_id,progress)
    WHERE NOT EXISTS (SELECT 1 FROM quest_instances qi WHERE qi.quest_id=seed.quest_id AND qi.creature_id=$1)`,[creatureId]);
  const payload=callbackText?{action:"explore",message:callbackText,title:"Something moved under the nest"}:{action:"social"};
  await client.query(`INSERT INTO world_events (creature_id,event_type,payload,due_at)
    SELECT $1,$2,$3,now()+($4||' seconds')::interval
    WHERE NOT EXISTS (SELECT 1 FROM world_events WHERE creature_id=$1 AND status='pending')`,[creatureId,callbackText?"genesis_callback":"proactive_story",JSON.stringify(payload),config.PROACTIVE_DELAY_SECONDS]);
}

export async function getOnboardingState(client:pg.PoolClient,creatureId:string):Promise<OnboardingState> {
  let result=await client.query("SELECT * FROM onboarding_states WHERE creature_id=$1",[creatureId]);
  if(!result.rowCount) {
    await client.query(`INSERT INTO onboarding_states (creature_id,status,completed_at) VALUES ($1,'complete',now()) ON CONFLICT DO NOTHING`,[creatureId]);
    result=await client.query("SELECT * FROM onboarding_states WHERE creature_id=$1",[creatureId]);
  }
  const row=result.rows[0];
  return {
    enabled:config.CHARACTER_GENESIS_ENABLED,
    status:row.status,
    wakeChoice:row.wake_choice??undefined,
    visualMarker:row.visual_marker??undefined,
    wakeChoices:wakeChoiceOptions,
    visualMarkers:visualMarkerOptions
  };
}

export async function assertOnboardingComplete(client:pg.PoolClient,creatureId:string):Promise<void> {
  if(!config.CHARACTER_GENESIS_ENABLED) return;
  const state=await getOnboardingState(client,creatureId);
  if(state.status!=="complete") throw new Error("onboarding must be completed first");
}

export async function bootstrapPlayer(client: pg.PoolClient, user: TelegramUser) {
  const playerResult = await client.query(`INSERT INTO players (telegram_user_id, display_name, locale) VALUES ($1,$2,$3) ON CONFLICT (telegram_user_id) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING *`, [user.id,user.first_name,user.language_code??"en"]);
  const player = playerResult.rows[0];
  let creatureResult = await client.query("SELECT * FROM creatures WHERE player_id=$1 AND kind='player' LIMIT 1", [player.id]);
  if (!creatureResult.rowCount) {
    const personality = starterPersonality(user.id);
    const genome = starterGenome(user.id);
    const initialName=config.CHARACTER_GENESIS_ENABLED?"Unnamed Bloopy":`${user.first_name}'s Bloopy`;
    creatureResult = await client.query(`INSERT INTO creatures (player_id,slug,name,kind,personality,genome,energy,mood,current_location) VALUES ($1,$2,$3,'player',$4,$5,82,'sleepy','cardboard_nest') RETURNING *`, [player.id,`bloopy-${user.id}`,initialName,personality,genome]);
    const creature = creatureResult.rows[0];
    if(config.CHARACTER_GENESIS_ENABLED) {
      await client.query(`INSERT INTO onboarding_states (creature_id,status) VALUES ($1,'wake_choice')`,[creature.id]);
      await client.query(`INSERT INTO story_entries (creature_id,title,body,choices,reward) VALUES ($1,$2,$3,'[]','{}')`,[creature.id,"Something is sleeping in the box","The cardboard nest rises and falls with tiny breaths. Whatever is inside has not decided whether waking up is a good idea."]);
      await recordAnalytics(client,player.id,creature.id,"onboarding_started");
    } else {
      await client.query(`INSERT INTO onboarding_states (creature_id,status,completed_at) VALUES ($1,'complete',now())`,[creature.id]);
      const opening = buildStory("talk", creature.name, personality, user.id);
      await client.query(`INSERT INTO story_entries (creature_id,title,body,choices,reward) VALUES ($1,$2,$3,$4,$5)`, [creature.id,"A small creature wakes up",`A soft pop comes from the cardboard nest. ${opening.body}`,JSON.stringify(opening.choices),JSON.stringify(opening.reward??{})]);
      await seedPlayableWorld(client,creature.id);
    }
  }
  return { player, creature: creatureResult.rows[0] };
}

export async function getDashboard(client: pg.PoolClient, playerId: string) {
  const creatureResult = await client.query("SELECT * FROM creatures WHERE player_id=$1 AND kind='player' LIMIT 1", [playerId]);
  const creature = creatureResult.rows[0];
  if (!creature) throw new Error("creature not found");
  const [stories,npcs,relationships,questInstances,onboarding] = await Promise.all([
    client.query("SELECT * FROM story_entries WHERE creature_id=$1 ORDER BY created_at DESC LIMIT 12",[creature.id]),
    client.query("SELECT id,slug,name,personality,genome,mood,current_location FROM creatures WHERE kind IN ('npc','system') ORDER BY name"),
    client.query("SELECT * FROM relationships WHERE source_creature_id=$1",[creature.id]),
    client.query(`SELECT qi.*,q.title,q.description FROM quest_instances qi JOIN quests q ON q.id=qi.quest_id WHERE qi.creature_id=$1 ORDER BY qi.created_at DESC`,[creature.id]),
    getOnboardingState(client,creature.id)
  ]);
  return { creature, stories:stories.rows, npcs:npcs.rows, relationships:relationships.rows, quests:questInstances.rows, onboarding };
}

export async function selectWakeChoice(client:pg.PoolClient,playerId:string,creatureId:string,choice:WakeChoice) {
  const stateResult=await client.query("SELECT * FROM onboarding_states WHERE creature_id=$1 FOR UPDATE",[creatureId]);
  const state=stateResult.rows[0];
  if(!state) throw new Error("onboarding state not found");
  if(state.status==="complete") return {onboarding:await getOnboardingState(client,creatureId)};
  if(state.status==="identity") {
    if(state.wake_choice!==choice) throw new Error("wake choice was already selected");
    return {onboarding:await getOnboardingState(client,creatureId)};
  }
  const creatureResult=await client.query("SELECT personality FROM creatures WHERE id=$1 FOR UPDATE",[creatureId]);
  const personality=creatureResult.rows[0]?.personality as Personality|undefined;
  if(!personality) throw new Error("creature not found");
  const story=wakeStory(choice);
  const nextPersonality=applyWakeChoice(personality,choice);
  await client.query(`INSERT INTO player_choices (creature_id,scene_id,choice_id,choice_payload) VALUES ($1,'genesis_wake',$2,$3)`,[creatureId,choice,JSON.stringify({traitDelta:true})]);
  await client.query(`UPDATE onboarding_states SET status='identity',wake_choice=$2,updated_at=now() WHERE creature_id=$1`,[creatureId,choice]);
  await client.query(`UPDATE creatures SET personality=$2,mood='alert',updated_at=now() WHERE id=$1`,[creatureId,JSON.stringify(nextPersonality)]);
  await client.query(`INSERT INTO story_flags (creature_id,flag_key,flag_value) VALUES ($1,$2,'true') ON CONFLICT (creature_id,flag_key) DO UPDATE SET flag_value='true',updated_at=now()`,[creatureId,wakeFlag(choice)]);
  await client.query(`INSERT INTO memories (creature_id,source_type,summary,importance,is_private) VALUES ($1,'genesis',$2,0.8,true)`,[creatureId,`The player chose to wake the creature with: ${choice}.`]);
  await client.query(`INSERT INTO story_entries (creature_id,title,body,choices,reward) VALUES ($1,$2,$3,'[]','{}')`,[creatureId,story.title,story.body]);
  await recordAnalytics(client,playerId,creatureId,"wake_choice_selected",{choice});
  return {story,onboarding:await getOnboardingState(client,creatureId)};
}

export async function completeOnboarding(client:pg.PoolClient,playerId:string,creatureId:string,input:{name:string;marker:VisualMarker}) {
  const stateResult=await client.query("SELECT * FROM onboarding_states WHERE creature_id=$1 FOR UPDATE",[creatureId]);
  const state=stateResult.rows[0];
  if(!state) throw new Error("onboarding state not found");
  if(state.status==="complete") return {onboarding:await getOnboardingState(client,creatureId)};
  if(state.status!=="identity"||!state.wake_choice) throw new Error("wake choice must be selected first");
  const name=normalizeCreatureName(input.name);
  const choice=state.wake_choice as WakeChoice;
  const creatureResult=await client.query("SELECT genome,xp,level FROM creatures WHERE id=$1 FOR UPDATE",[creatureId]);
  const creature=creatureResult.rows[0];
  if(!creature) throw new Error("creature not found");
  const genome={...(creature.genome as AvatarGenome),mark:input.marker};
  const story=identityStory(name,choice,input.marker);
  const xp=Number(creature.xp)+Number(story.reward?.xp??0);
  const level=Math.max(Number(creature.level),1+Math.floor(xp/100));
  await client.query(`INSERT INTO player_choices (creature_id,scene_id,choice_id,choice_payload) VALUES ($1,'genesis_identity',$2,$3)`,[creatureId,input.marker,JSON.stringify({name})]);
  await client.query(`UPDATE creatures SET name=$2,genome=$3,xp=$4,level=$5,mood='curious',updated_at=now() WHERE id=$1`,[creatureId,name,JSON.stringify(genome),xp,level]);
  await client.query(`UPDATE onboarding_states SET status='complete',visual_marker=$2,completed_at=now(),updated_at=now() WHERE creature_id=$1`,[creatureId,input.marker]);
  await client.query(`INSERT INTO story_flags (creature_id,flag_key,flag_value) VALUES ($1,'genesis_identity',$2) ON CONFLICT (creature_id,flag_key) DO UPDATE SET flag_value=EXCLUDED.flag_value,updated_at=now()`,[creatureId,JSON.stringify({name,marker:input.marker,wakeChoice:choice})]);
  await client.query(`INSERT INTO memories (creature_id,source_type,summary,importance,is_private) VALUES ($1,'genesis',$2,1,true)`,[creatureId,`${name} remembers being woken with ${choice} and choosing the ${input.marker} mark.`]);
  await client.query(`INSERT INTO story_entries (creature_id,title,body,choices,reward) VALUES ($1,$2,$3,$4,$5)`,[creatureId,story.title,story.body,JSON.stringify(story.choices),JSON.stringify(story.reward??{})]);
  await seedPlayableWorld(client,creatureId,proactiveGenesisText(name,choice));
  await recordAnalytics(client,playerId,creatureId,"creature_named",{length:name.length});
  await recordAnalytics(client,playerId,creatureId,"visual_marker_selected",{marker:input.marker});
  await recordAnalytics(client,playerId,creatureId,"onboarding_completed",{wakeChoice:choice,marker:input.marker});
  return {story,onboarding:await getOnboardingState(client,creatureId),creature:{name,genome,xp,level}};
}

export async function performAction(client: pg.PoolClient, creatureId: string, action: GameAction, narratedStory?: StoryCard) {
  await assertOnboardingComplete(client,creatureId);
  const result = await client.query("SELECT * FROM creatures WHERE id=$1 FOR UPDATE",[creatureId]);
  const creature = result.rows[0];
  if (!creature) throw new Error("creature not found");
  const story = narratedStory ?? buildStory(action,creature.name,creature.personality,Date.now());
  const xp = Number(story.reward?.xp??0);
  const energyDelta = action==="rest"?18:-Math.min(12,4+Math.floor(xp/2));
  const newEnergy = Math.max(0,Math.min(100,Number(creature.energy)+energyDelta));
  const newXp = Number(creature.xp)+xp;
  const newLevel = Math.max(Number(creature.level),1+Math.floor(newXp/100));
  await client.query(`UPDATE creatures SET energy=$2,xp=$3,level=$4,mood=$5,updated_at=now() WHERE id=$1`,[creatureId,newEnergy,newXp,newLevel,action==="rest"?"cozy":"excited"]);
  const eventId = randomUUID();
  await client.query(`INSERT INTO game_events (id,aggregate_id,event_type,payload) VALUES ($1,$2,'player_action',$3)`,[eventId,creatureId,JSON.stringify({action,story,energyDelta,xp})]);
  await client.query(`INSERT INTO story_entries (creature_id,event_id,title,body,choices,reward) VALUES ($1,$2,$3,$4,$5,$6)`,[creatureId,eventId,story.title,story.body,JSON.stringify(story.choices),JSON.stringify(story.reward??{})]);
  if (action==="social") await client.query(`INSERT INTO relationships (source_creature_id,target_creature_id,trust,affection,rivalry,last_event) SELECT $1,id,6,8,1,'first_contact' FROM creatures WHERE slug='numa-cloudcartographer' ON CONFLICT (source_creature_id,target_creature_id) DO UPDATE SET trust=relationships.trust+1,affection=relationships.affection+2,last_event='shared_story'`,[creatureId]);
  return { story, energy:newEnergy, xp:newXp, level:newLevel };
}

export async function saveAIProfile(client: pg.PoolClient, playerId: string, input: {baseUrl:string;model:string;apiKey:string}) {
  const url = new URL(input.baseUrl);
  const local = ["localhost","127.0.0.1","::1"].includes(url.hostname);
  if (url.protocol!=="https:" && !(config.ALLOW_LOCAL_AI&&local)) throw new Error("AI endpoint must use HTTPS");
  await client.query(`INSERT INTO ai_profiles (player_id,base_url,model,encrypted_api_key,enabled) VALUES ($1,$2,$3,$4,true) ON CONFLICT (player_id) DO UPDATE SET base_url=EXCLUDED.base_url,model=EXCLUDED.model,encrypted_api_key=EXCLUDED.encrypted_api_key,enabled=true,updated_at=now()`,[playerId,url.toString().replace(/\/$/,""),input.model,seal(input.apiKey)]);
}
