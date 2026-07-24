import { randomUUID } from "node:crypto";
import type pg from "pg";
import { config } from "./config.js";
import { seal } from "./crypto.js";
import { AppError } from "./errors.js";
import { assertSafeAIBaseUrl } from "./net-guard.js";
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

type Queryable = pg.Pool | pg.PoolClient;

export const ACTION_COSTS: Record<GameAction, number> = { explore: 10, help: 8, social: 6, talk: 4, rest: 0 };
const ENERGY_REGEN_SECONDS = 90;

export const SHOP_CATALOG = [
  { id: "warm_snack", name: "Warm snack", description: "Momo's soup of the day. Restores 35 energy.", icon: "🍲", cost: 5 },
  { id: "accessory_swap", name: "Accessory swap", description: "Trade your creature's accessory for the next one on Momo's rack.", icon: "🧣", cost: 12 }
] as const;
export type ShopItemId = (typeof SHOP_CATALOG)[number]["id"];

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
  const result=await client.query("SELECT * FROM onboarding_states WHERE creature_id=$1",[creatureId]);
  // Missing rows only happen for creatures created outside bootstrap; never write from this read path.
  const row=result.rows[0]??{status:config.CHARACTER_GENESIS_ENABLED?"wake_choice":"complete",wake_choice:null,visual_marker:null};
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
  if(state.status!=="complete") throw new AppError("onboarding_incomplete",409,"Your creature is still waking up. Finish the beginning of its story first.");
}

export async function bootstrapPlayer(client: pg.PoolClient, user: TelegramUser) {
  const playerResult = await client.query(`INSERT INTO players (telegram_user_id, display_name, locale) VALUES ($1,$2,$3) ON CONFLICT (telegram_user_id) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING *`, [user.id,user.first_name,user.language_code??"en"]);
  const player = playerResult.rows[0];
  let creatureResult = await client.query("SELECT * FROM creatures WHERE player_id=$1 AND kind='player' LIMIT 1", [player.id]);
  if (!creatureResult.rowCount) {
    const personality = starterPersonality(user.id);
    const genome = starterGenome(user.id);
    const initialName=config.CHARACTER_GENESIS_ENABLED?"Unnamed Bloopy":`${user.first_name}'s Bloopy`;
    const inserted = await client.query(`INSERT INTO creatures (player_id,slug,name,kind,personality,genome,energy,mood,current_location) VALUES ($1,$2,$3,'player',$4,$5,82,'sleepy','cardboard_nest') ON CONFLICT (slug) DO NOTHING RETURNING *`, [player.id,`bloopy-${user.id}`,initialName,personality,genome]);
    if (inserted.rowCount) {
      const creature = inserted.rows[0];
      if(config.CHARACTER_GENESIS_ENABLED) {
        await client.query(`INSERT INTO onboarding_states (creature_id,status) VALUES ($1,'wake_choice') ON CONFLICT (creature_id) DO NOTHING`,[creature.id]);
        await client.query(`INSERT INTO story_entries (creature_id,title,body,choices,reward) VALUES ($1,$2,$3,'[]','{}')`,[creature.id,"Something is sleeping in the box","The cardboard nest rises and falls with tiny breaths. Whatever is inside has not decided whether waking up is a good idea."]);
        await recordAnalytics(client,player.id,creature.id,"onboarding_started");
      } else {
        await client.query(`INSERT INTO onboarding_states (creature_id,status,completed_at) VALUES ($1,'complete',now()) ON CONFLICT (creature_id) DO NOTHING`,[creature.id]);
        const opening = buildStory("talk", creature.name, personality, user.id);
        await client.query(`INSERT INTO story_entries (creature_id,title,body,choices,reward) VALUES ($1,$2,$3,$4,$5)`, [creature.id,"A small creature wakes up",`A soft pop comes from the cardboard nest. ${opening.body}`,JSON.stringify(opening.choices),JSON.stringify(opening.reward??{})]);
        await seedPlayableWorld(client,creature.id);
      }
      creatureResult = inserted;
    } else {
      // Lost a concurrent bootstrap race; the winner created and seeded the creature.
      creatureResult = await client.query("SELECT * FROM creatures WHERE player_id=$1 AND kind='player' LIMIT 1", [player.id]);
      if (!creatureResult.rowCount) throw new AppError("bootstrap_conflict",409,"Two versions of you arrived at once. Try again in a second.");
    }
  }
  return { player, creature: creatureResult.rows[0] };
}

export async function applyEnergyRegen(client: pg.PoolClient, creatureId: string): Promise<void> {
  await client.query(`UPDATE creatures SET energy=LEAST(100,energy+FLOOR(EXTRACT(EPOCH FROM (now()-energy_updated_at))/${ENERGY_REGEN_SECONDS})::int),energy_updated_at=now()
    WHERE id=$1 AND kind='player' AND energy<100 AND now()-energy_updated_at>=interval '${ENERGY_REGEN_SECONDS} seconds'`,[creatureId]);
}

export async function getDashboard(client: pg.PoolClient, playerId: string) {
  const idResult = await client.query("SELECT id FROM creatures WHERE player_id=$1 AND kind='player' LIMIT 1", [playerId]);
  if (!idResult.rowCount) throw new AppError("creature_not_found",404,"No creature lives here yet. Open Bloopy from Telegram to adopt one.");
  await applyEnergyRegen(client, idResult.rows[0].id);
  const creatureResult = await client.query("SELECT * FROM creatures WHERE id=$1", [idResult.rows[0].id]);
  const creature = creatureResult.rows[0];
  const [stories,npcs,relationships,questInstances,onboarding] = await Promise.all([
    client.query("SELECT * FROM story_entries WHERE creature_id=$1 ORDER BY created_at DESC LIMIT 12",[creature.id]),
    client.query("SELECT id,slug,name,personality,genome,mood,current_location FROM creatures WHERE kind IN ('npc','system') ORDER BY name"),
    client.query("SELECT r.*,c.name AS target_name,c.slug AS target_slug,c.kind AS target_kind FROM relationships r JOIN creatures c ON c.id=r.target_creature_id WHERE r.source_creature_id=$1 ORDER BY r.affection DESC",[creature.id]),
    client.query(`SELECT qi.*,q.title,q.description FROM quest_instances qi JOIN quests q ON q.id=qi.quest_id WHERE qi.creature_id=$1 ORDER BY qi.created_at DESC`,[creature.id]),
    getOnboardingState(client,creature.id)
  ]);
  return { creature, stories:stories.rows, npcs:npcs.rows, relationships:relationships.rows, quests:questInstances.rows, onboarding, shop:SHOP_CATALOG, actionCosts:ACTION_COSTS };
}

export async function selectWakeChoice(client:pg.PoolClient,playerId:string,creatureId:string,choice:WakeChoice) {
  await client.query(`INSERT INTO onboarding_states (creature_id,status) VALUES ($1,'wake_choice') ON CONFLICT (creature_id) DO NOTHING`,[creatureId]);
  const stateResult=await client.query("SELECT * FROM onboarding_states WHERE creature_id=$1 FOR UPDATE",[creatureId]);
  const state=stateResult.rows[0];
  if(state.status==="complete") return {onboarding:await getOnboardingState(client,creatureId)};
  if(state.status==="identity") {
    if(state.wake_choice!==choice) throw new AppError("wake_already_chosen",409,"The creature already remembers how it woke up. That memory is set.");
    return {onboarding:await getOnboardingState(client,creatureId)};
  }
  const creatureResult=await client.query("SELECT personality FROM creatures WHERE id=$1 FOR UPDATE",[creatureId]);
  const personality=creatureResult.rows[0]?.personality as Personality|undefined;
  if(!personality) throw new AppError("creature_not_found",404,"No creature lives here yet.");
  const story=wakeStory(choice);
  const nextPersonality=applyWakeChoice(personality,choice);
  await client.query(`INSERT INTO player_choices (creature_id,scene_id,choice_id,choice_payload) VALUES ($1,'genesis_wake',$2,$3) ON CONFLICT (creature_id,scene_id) DO NOTHING`,[creatureId,choice,JSON.stringify({traitDelta:true})]);
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
  if(!state) throw new AppError("onboarding_missing",409,"The nest hasn't been opened yet. Start from the beginning.");
  if(state.status==="complete") return {onboarding:await getOnboardingState(client,creatureId)};
  if(state.status!=="identity"||!state.wake_choice) throw new AppError("wake_choice_first",409,"Wake the creature before naming it. It hates being named in its sleep.");
  const name=normalizeCreatureName(input.name);
  const choice=state.wake_choice as WakeChoice;
  const creatureResult=await client.query("SELECT genome,xp,level FROM creatures WHERE id=$1 FOR UPDATE",[creatureId]);
  const creature=creatureResult.rows[0];
  if(!creature) throw new AppError("creature_not_found",404,"No creature lives here yet.");
  const genome={...(creature.genome as AvatarGenome),mark:input.marker};
  const story=identityStory(name,choice,input.marker);
  const xp=Number(creature.xp)+Number(story.reward?.xp??0);
  const level=Math.max(Number(creature.level),1+Math.floor(xp/100));
  await client.query(`INSERT INTO player_choices (creature_id,scene_id,choice_id,choice_payload) VALUES ($1,'genesis_identity',$2,$3) ON CONFLICT (creature_id,scene_id) DO NOTHING`,[creatureId,input.marker,JSON.stringify({name})]);
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

export async function pickSocialTarget(runner: Queryable, creatureId: string): Promise<{id:string;slug:string;name:string}|null> {
  const result = await runner.query(`SELECT c.id,c.slug,c.name FROM creatures c
    LEFT JOIN relationships r ON r.source_creature_id=$1 AND r.target_creature_id=c.id
    WHERE c.kind IN ('npc','system')
    ORDER BY COALESCE(r.affection,0) ASC, c.name ASC LIMIT 1`,[creatureId]);
  return result.rows[0] ?? null;
}

interface QuestOutcome { xp: number; stars: number; completed: string[] }

async function evaluateQuestProgress(client: pg.PoolClient, creatureId: string, action: GameAction, socialTargetSlug: string | null): Promise<QuestOutcome> {
  const outcome: QuestOutcome = { xp: 0, stars: 0, completed: [] };
  if (action === "help") {
    await client.query(`INSERT INTO quest_instances (quest_id,creature_id,status,progress)
      SELECT 'sock-compass',$1,'active','{"helped":0}'::jsonb
      WHERE NOT EXISTS (SELECT 1 FROM quest_instances WHERE quest_id='sock-compass' AND creature_id=$1)`,[creatureId]);
  }
  const instances = await client.query(`SELECT qi.id,qi.quest_id,qi.progress,q.reward,q.title FROM quest_instances qi JOIN quests q ON q.id=qi.quest_id
    WHERE qi.creature_id=$1 AND qi.status='active' AND qi.quest_id IN ('first-window','meet-numa','sock-compass') FOR UPDATE OF qi`,[creatureId]);
  for (const instance of instances.rows) {
    const reward = (instance.reward ?? {}) as { xp?: number; stars?: number; item?: string };
    let completed = false;
    if (instance.quest_id === "first-window" && action === "explore") {
      completed = true;
      await client.query(`UPDATE quest_instances SET status='completed',progress='{"seen":true}',updated_at=now() WHERE id=$1`,[instance.id]);
    } else if (instance.quest_id === "meet-numa" && action === "social" && socialTargetSlug === "numa-cloudcartographer") {
      completed = true;
      await client.query(`UPDATE quest_instances SET status='completed',progress='{"met":true}',updated_at=now() WHERE id=$1`,[instance.id]);
    } else if (instance.quest_id === "sock-compass" && action === "help") {
      const helped = Number((instance.progress as {helped?:number})?.helped ?? 0) + 1;
      completed = helped >= 2;
      await client.query(`UPDATE quest_instances SET status=$2,progress=$3,updated_at=now() WHERE id=$1`,[instance.id,completed?"completed":"active",JSON.stringify({helped})]);
    }
    if (completed) {
      outcome.xp += Number(reward.xp ?? 0);
      outcome.stars += Number(reward.stars ?? 0);
      outcome.completed.push(instance.title);
      if (reward.item) await client.query(`INSERT INTO inventory_ledger (creature_id,item_id,delta,source_key,metadata) VALUES ($1,$2,1,$3,$4) ON CONFLICT (creature_id,source_key) DO NOTHING`,[creatureId,reward.item,`quest:${instance.quest_id}`,JSON.stringify({reason:"quest_reward"})]);
      await client.query(`INSERT INTO story_entries (creature_id,title,body,choices,reward) VALUES ($1,$2,$3,'[]',$4)`,[creatureId,`Quest complete: ${instance.title}`,`The world quietly rearranges itself to acknowledge this. Rewards have been delivered to the usual pocket.`,JSON.stringify(reward)]);
    }
  }
  return outcome;
}

export async function performAction(client: pg.PoolClient, creatureId: string, action: GameAction, narratedStory?: StoryCard, presetSocialTargetSlug?: string) {
  await assertOnboardingComplete(client,creatureId);
  await applyEnergyRegen(client,creatureId);
  const result = await client.query("SELECT * FROM creatures WHERE id=$1 FOR UPDATE",[creatureId]);
  const creature = result.rows[0];
  if (!creature) throw new AppError("creature_not_found",404,"No creature lives here yet.");
  const cost = ACTION_COSTS[action];
  if (Number(creature.energy) < cost) throw new AppError("creature_tired",409,`${creature.name} is too tired for that right now. Let it rest, or come back once it has snoozed a little.`);
  let socialTarget: {id:string;slug:string;name:string} | null = null;
  if (action === "social") {
    socialTarget = presetSocialTargetSlug
      ? (await client.query("SELECT id,slug,name FROM creatures WHERE slug=$1",[presetSocialTargetSlug])).rows[0] ?? null
      : await pickSocialTarget(client, creatureId);
  }
  const story = narratedStory ?? buildStory(action,creature.name,creature.personality,Date.now(),socialTarget?.name);
  const quest = await evaluateQuestProgress(client, creatureId, action, socialTarget?.slug ?? null);
  const xp = Number(story.reward?.xp??0) + quest.xp;
  const stars = Number(story.reward?.stars??0) + quest.stars;
  const energyDelta = action==="rest"?18:-cost;
  const newEnergy = Math.max(0,Math.min(100,Number(creature.energy)+energyDelta));
  const newXp = Number(creature.xp)+xp;
  const newLevel = Math.max(Number(creature.level),1+Math.floor(newXp/100));
  const newStars = Number(creature.stars??0)+stars;
  const genome = creature.genome as AvatarGenome;
  const evolution = Math.min(3, 1+Math.floor(newLevel/5));
  const evolved = evolution > Number(genome.evolution??1);
  const newGenome = evolved ? {...genome, evolution} : genome;
  await client.query(`UPDATE creatures SET energy=$2,xp=$3,level=$4,stars=$5,genome=$6,mood=$7,energy_updated_at=now(),updated_at=now() WHERE id=$1`,[creatureId,newEnergy,newXp,newLevel,newStars,JSON.stringify(newGenome),action==="rest"?"cozy":"excited"]);
  const eventId = randomUUID();
  await client.query(`INSERT INTO game_events (id,aggregate_id,event_type,payload) VALUES ($1,$2,'player_action',$3)`,[eventId,creatureId,JSON.stringify({action,story,energyDelta,xp,stars})]);
  await client.query(`INSERT INTO story_entries (creature_id,event_id,title,body,choices,reward) VALUES ($1,$2,$3,$4,$5,$6)`,[creatureId,eventId,story.title,story.body,JSON.stringify(story.choices),JSON.stringify(story.reward??{})]);
  if (action==="social" && socialTarget) await client.query(`INSERT INTO relationships (source_creature_id,target_creature_id,trust,affection,rivalry,last_event) VALUES ($1,$2,6,8,1,'first_contact') ON CONFLICT (source_creature_id,target_creature_id) DO UPDATE SET trust=relationships.trust+1,affection=relationships.affection+2,last_event='shared_story',updated_at=now()`,[creatureId,socialTarget.id]);
  if (newLevel > Number(creature.level)) await client.query(`INSERT INTO story_entries (creature_id,title,body,choices,reward) VALUES ($1,$2,$3,'[]','{}')`,[creatureId,`${creature.name} reached level ${newLevel}`,evolved?`Something fundamental shifts. ${creature.name} glows in a way that furniture notices. Evolution ${evolution} has begun.`:`${creature.name} feels slightly more capable of everything. New places seem a little less impossible.`]);
  return { story, energy:newEnergy, xp:newXp, level:newLevel, stars:newStars, evolution, questCompleted:quest.completed };
}

export async function buyShopItem(client: pg.PoolClient, playerId: string, creatureId: string, itemId: ShopItemId) {
  await assertOnboardingComplete(client,creatureId);
  await applyEnergyRegen(client,creatureId);
  const item = SHOP_CATALOG.find((entry)=>entry.id===itemId);
  if (!item) throw new AppError("shop_unknown_item",400,"Momo squints at the request and finds nothing like it on the shelves.");
  const result = await client.query("SELECT * FROM creatures WHERE id=$1 FOR UPDATE",[creatureId]);
  const creature = result.rows[0];
  if (!creature) throw new AppError("creature_not_found",404,"No creature lives here yet.");
  const stars = Number(creature.stars??0);
  if (stars < item.cost) throw new AppError("not_enough_stars",409,`Momo pats ${creature.name} kindly. "Come back with ${item.cost} stars. The soup will wait. Probably."`);
  const genome = creature.genome as AvatarGenome;
  let newGenome = genome;
  let newEnergy = Number(creature.energy);
  let body: string;
  if (item.id === "warm_snack") {
    newEnergy = Math.min(100, newEnergy + 35);
    body = `Momo ladles out the soup of the day. ${creature.name} drinks it in one long, thoughtful slurp and feels considerably more possible.`;
  } else {
    const rack: AvatarGenome["accessory"][] = ["satchel","leaf","scarf"];
    const next = rack[(rack.indexOf(genome.accessory)+1)%rack.length] as AvatarGenome["accessory"];
    newGenome = {...genome, accessory: next};
    body = `Momo produces ${next==="scarf"?"a scarf of questionable provenance":next==="leaf"?"a fresh leaf, only slightly used":"a sturdy satchel with room for secrets"}. ${creature.name} wears it immediately and refuses to discuss the old one.`;
  }
  await client.query(`UPDATE creatures SET stars=$2,energy=$3,genome=$4,energy_updated_at=now(),updated_at=now() WHERE id=$1`,[creatureId,stars-item.cost,newEnergy,JSON.stringify(newGenome)]);
  await client.query(`INSERT INTO story_entries (creature_id,title,body,choices,reward) VALUES ($1,$2,$3,'[]','{}')`,[creatureId,`A transaction at the button market`,body]);
  await client.query(`INSERT INTO relationships (source_creature_id,target_creature_id,trust,affection,rivalry,last_event)
    SELECT $1,id,1,1,0,'market_purchase' FROM creatures WHERE slug='momo-marketbot'
    ON CONFLICT (source_creature_id,target_creature_id) DO UPDATE SET trust=relationships.trust+1,affection=relationships.affection+1,last_event='market_purchase',updated_at=now()`,[creatureId]);
  await recordAnalytics(client,playerId,creatureId,"shop_purchase",{item:item.id,cost:item.cost});
  return { stars: stars-item.cost, energy: newEnergy, genome: newGenome, story: { title: "A transaction at the button market", body, choices: [], reward: {} } };
}

// Player-to-player meeting via a shared deep link (?startapp=meet_<slug> or /start meet_<slug>).
export async function recordEncounter(client: pg.PoolClient, playerId: string, creature: {id:string;name:string;slug:string}, targetSlug: string) {
  if (!/^[a-z0-9-]{2,80}$/.test(targetSlug) || targetSlug === creature.slug) return null;
  const targetResult = await client.query("SELECT id,name,player_id FROM creatures WHERE slug=$1 AND kind='player'",[targetSlug]);
  const target = targetResult.rows[0];
  if (!target) return null;
  const edge = await client.query(`INSERT INTO relationships (source_creature_id,target_creature_id,trust,affection,rivalry,last_event) VALUES ($1,$2,4,5,0,'link_meeting') ON CONFLICT (source_creature_id,target_creature_id) DO NOTHING RETURNING id`,[creature.id,target.id]);
  if (!edge.rowCount) return null;
  await client.query(`INSERT INTO relationships (source_creature_id,target_creature_id,trust,affection,rivalry,last_event) VALUES ($1,$2,4,5,0,'link_meeting') ON CONFLICT (source_creature_id,target_creature_id) DO NOTHING`,[target.id,creature.id]);
  const meetingBody = (a:string,b:string)=>`${a} and ${b} met through a shared story link. They compared marks, argued gently about the best napping architecture, and agreed to meet again.`;
  await client.query(`INSERT INTO story_entries (creature_id,title,body,choices,reward) VALUES ($1,$2,$3,'[]','{"xp":8}')`,[creature.id,`${creature.name} met ${target.name}`,meetingBody(creature.name,target.name)]);
  await client.query(`INSERT INTO story_entries (creature_id,title,body,choices,reward) VALUES ($1,$2,$3,'[]','{"xp":8}')`,[target.id,`${target.name} met ${creature.name}`,meetingBody(target.name,creature.name)]);
  await client.query(`UPDATE creatures SET xp=xp+8,level=GREATEST(level,1+FLOOR((xp+8)/100.0)::integer),updated_at=now() WHERE id IN ($1,$2)`,[creature.id,target.id]);
  await client.query(`INSERT INTO memories (creature_id,source_type,summary,importance,is_private) VALUES ($1,'encounter',$2,0.6,false),($3,'encounter',$4,0.6,false)`,[creature.id,`Met ${target.name} through a shared link.`,target.id,`Met ${creature.name} through a shared link.`]);
  await recordAnalytics(client,playerId,creature.id,"player_encounter",{targetSlug});
  return { metName: target.name as string };
}

export async function saveAIProfile(client: pg.PoolClient, playerId: string, input: {baseUrl:string;model:string;apiKey:string}) {
  const url = await assertSafeAIBaseUrl(input.baseUrl);
  await client.query(`INSERT INTO ai_profiles (player_id,base_url,model,encrypted_api_key,enabled,source,external_user_id,connection_status,connection_metadata,connected_at,last_verified_at,disconnected_at)
    VALUES ($1,$2,$3,$4,true,'manual',NULL,'active','{}',now(),NULL,NULL)
    ON CONFLICT (player_id) DO UPDATE SET base_url=EXCLUDED.base_url,model=EXCLUDED.model,encrypted_api_key=EXCLUDED.encrypted_api_key,enabled=true,source='manual',external_user_id=NULL,connection_status='active',connection_metadata='{}',connected_at=now(),last_verified_at=NULL,disconnected_at=NULL,updated_at=now()`,[playerId,url.toString().replace(/\/$/,""),input.model,seal(input.apiKey)]);
}
