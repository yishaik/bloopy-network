import { randomUUID } from "node:crypto";
import type pg from "pg";
import { config } from "./config.js";
import { seal } from "./crypto.js";
import { buildStory, type GameAction } from "./story.js";
import type { AvatarGenome, Personality, StoryCard, TelegramUser } from "./types.js";

function starterPersonality(seed: number): Personality {
  return { archetype: seed % 2 === 0 ? "curious_trickster" : "gentle_explorer", voice: seed % 2 === 0 ? "warm_deadpan" : "earnest_whimsy", curiosity:0.72, courage:0.48, empathy:0.67, mischief:seed%2===0?0.71:0.49, sociability:0.62 };
}
function starterGenome(seed: number): AvatarGenome {
  const colors = [["#8ee3cf","#ff8fa3"],["#a9c8ff","#ffd37d"],["#c7a8ff","#87dfba"]] as const;
  const [primary, secondary] = colors[Math.abs(seed)%colors.length] as readonly [string,string];
  return { body:seed%3===0?"cloud":seed%3===1?"pear":"round", primary, secondary, eyes:seed%2===0?"wide":"spark", mark:seed%3===0?"moon":seed%3===1?"star":"dot", accessory:seed%2===0?"satchel":"leaf", evolution:1 };
}

export async function bootstrapPlayer(client: pg.PoolClient, user: TelegramUser) {
  const playerResult = await client.query(`INSERT INTO players (telegram_user_id, display_name, locale) VALUES ($1,$2,$3) ON CONFLICT (telegram_user_id) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING *`, [user.id,user.first_name,user.language_code??"en"]);
  const player = playerResult.rows[0];
  let creatureResult = await client.query("SELECT * FROM creatures WHERE player_id=$1 AND kind='player' LIMIT 1", [player.id]);
  if (!creatureResult.rowCount) {
    const personality = starterPersonality(user.id);
    const genome = starterGenome(user.id);
    creatureResult = await client.query(`INSERT INTO creatures (player_id,slug,name,kind,personality,genome,energy,mood,current_location) VALUES ($1,$2,$3,'player',$4,$5,82,'curious','cardboard_nest') RETURNING *`, [player.id,`bloopy-${user.id}`,`${user.first_name}'s Bloopy`,personality,genome]);
    const creature = creatureResult.rows[0];
    const opening = buildStory("talk", creature.name, personality, user.id);
    await client.query(`INSERT INTO story_entries (creature_id,title,body,choices,reward) VALUES ($1,$2,$3,$4,$5)`, [creature.id,"A small creature wakes up",`A soft pop comes from the cardboard nest. ${opening.body}`,opening.choices,opening.reward??{}]);
    await client.query(`INSERT INTO world_events (creature_id,event_type,payload,due_at) VALUES ($1,'proactive_story',$2,now()+($3||' seconds')::interval)`, [creature.id,{action:"social"},config.PROACTIVE_DELAY_SECONDS]);
    await client.query(`INSERT INTO quest_instances (quest_id,creature_id,status,progress) VALUES ('first-window',$1,'active','{"seen":false}'),('meet-numa',$1,'active','{"met":false}')`, [creature.id]);
  }
  return { player, creature: creatureResult.rows[0] };
}

export async function getDashboard(client: pg.PoolClient, playerId: string) {
  const creatureResult = await client.query("SELECT * FROM creatures WHERE player_id=$1 AND kind='player' LIMIT 1", [playerId]);
  const creature = creatureResult.rows[0];
  if (!creature) throw new Error("creature not found");
  const [stories,npcs,relationships,questInstances] = await Promise.all([
    client.query("SELECT * FROM story_entries WHERE creature_id=$1 ORDER BY created_at DESC LIMIT 12",[creature.id]),
    client.query("SELECT id,slug,name,personality,genome,mood,current_location FROM creatures WHERE kind IN ('npc','system') ORDER BY name"),
    client.query("SELECT * FROM relationships WHERE source_creature_id=$1",[creature.id]),
    client.query(`SELECT qi.*,q.title,q.description FROM quest_instances qi JOIN quests q ON q.id=qi.quest_id WHERE qi.creature_id=$1 ORDER BY qi.created_at DESC`,[creature.id])
  ]);
  return { creature, stories:stories.rows, npcs:npcs.rows, relationships:relationships.rows, quests:questInstances.rows };
}

export async function performAction(client: pg.PoolClient, creatureId: string, action: GameAction, narratedStory?: StoryCard) {
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
  await client.query(`INSERT INTO game_events (id,aggregate_id,event_type,payload) VALUES ($1,$2,'player_action',$3)`,[eventId,creatureId,{action,story,energyDelta,xp}]);
  await client.query(`INSERT INTO story_entries (creature_id,event_id,title,body,choices,reward) VALUES ($1,$2,$3,$4,$5,$6)`,[creatureId,eventId,story.title,story.body,story.choices,story.reward??{}]);
  if (action==="social") await client.query(`INSERT INTO relationships (source_creature_id,target_creature_id,trust,affection,rivalry,last_event) SELECT $1,id,6,8,1,'first_contact' FROM creatures WHERE slug='numa-cloudcartographer' ON CONFLICT (source_creature_id,target_creature_id) DO UPDATE SET trust=relationships.trust+1,affection=relationships.affection+2,last_event='shared_story'`,[creatureId]);
  return { story, energy:newEnergy, xp:newXp, level:newLevel };
}

export async function saveAIProfile(client: pg.PoolClient, playerId: string, input: {baseUrl:string;model:string;apiKey:string}) {
  const url = new URL(input.baseUrl);
  const local = ["localhost","127.0.0.1","::1"].includes(url.hostname);
  if (url.protocol!=="https:" && !(config.ALLOW_LOCAL_AI&&local)) throw new Error("AI endpoint must use HTTPS");
  await client.query(`INSERT INTO ai_profiles (player_id,base_url,model,encrypted_api_key,enabled) VALUES ($1,$2,$3,$4,true) ON CONFLICT (player_id) DO UPDATE SET base_url=EXCLUDED.base_url,model=EXCLUDED.model,encrypted_api_key=EXCLUDED.encrypted_api_key,enabled=true,updated_at=now()`,[playerId,url.toString().replace(/\/$/,""),input.model,seal(input.apiKey)]);
}
