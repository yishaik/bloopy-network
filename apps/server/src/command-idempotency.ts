import type pg from "pg";
import { performAction } from "./game.js";
import type { GameAction } from "./story.js";
import type { StoryCard } from "./types.js";

export interface ActionResult {
  story:StoryCard;
  energy:number;
  xp:number;
  level:number;
  stars:number;
  evolution:number;
  questCompleted:string[];
}

export async function performActionOnce(client:pg.PoolClient,input:{creatureId:string;action:GameAction;commandKey:string;narratedStory?:StoryCard;socialTargetSlug?:string}):Promise<ActionResult> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[input.commandKey]);
  const existing=await client.query(`SELECT payload->'result' AS result FROM game_events WHERE command_key=$1`,[input.commandKey]);
  if(existing.rowCount&&existing.rows[0].result)return existing.rows[0].result as ActionResult;
  const result=await performAction(client,input.creatureId,input.action,input.narratedStory,input.socialTargetSlug) as ActionResult;
  const event=await client.query(`SELECT id FROM game_events WHERE aggregate_id=$1 AND event_type='player_action' AND command_key IS NULL ORDER BY created_at DESC,id DESC LIMIT 1`,[input.creatureId]);
  if(!event.rowCount)throw new Error("player action event was not recorded");
  await client.query(`UPDATE game_events SET command_key=$2,payload=jsonb_set(payload,'{result}',$3::jsonb,true) WHERE id=$1`,[event.rows[0].id,input.commandKey,JSON.stringify(result)]);
  return result;
}
