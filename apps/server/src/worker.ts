import type pg from "pg";
import { buildStory, type GameAction } from "./story.js";
import type { StoryCard } from "./types.js";

const PROACTIVE_ROTATION: GameAction[] = ["explore", "social", "talk", "help"];
const STREAM_EVENT_TYPES = new Set(["proactive_story", "genesis_callback"]);

export async function processDueEvents(client: pg.PoolClient): Promise<number> {
  const result = await client.query(`SELECT we.*,c.name,c.personality,c.player_id,p.telegram_user_id FROM world_events we JOIN creatures c ON c.id=we.creature_id LEFT JOIN players p ON p.id=c.player_id WHERE we.status='pending' AND we.due_at<=now() ORDER BY we.due_at FOR UPDATE OF we SKIP LOCKED LIMIT 20`);
  for (const event of result.rows) {
    await client.query("UPDATE world_events SET status='processing',updated_at=now() WHERE id=$1",[event.id]);
    const action = (event.payload?.action ?? "social") as GameAction;
    const authoredMessage=typeof event.payload?.message==="string"?event.payload.message:null;
    const story:StoryCard=authoredMessage?{
      title:typeof event.payload?.title==="string"?event.payload.title:"Your creature found something",
      body:authoredMessage,
      choices:[{id:"investigate",label:"Investigate it",action:"explore"},{id:"ask",label:"Ask what happened",action:"talk"}],
      reward:{xp:4}
    }:buildStory(action,event.name,event.personality,Number(new Date(event.due_at)));
    await client.query(`INSERT INTO story_entries (creature_id,event_id,title,body,choices,reward) VALUES ($1,$2,$3,$4,$5,$6)`,[event.creature_id,event.id,story.title,story.body,JSON.stringify(story.choices),JSON.stringify(story.reward??{})]);
    if (event.telegram_user_id) await client.query(`INSERT INTO outbox (chat_id,payload) VALUES ($1,$2)`,[String(event.telegram_user_id),JSON.stringify({method:"sendMessage",text:`${story.title}\n\n${story.body}`})]);
    await client.query("UPDATE world_events SET status='completed',updated_at=now() WHERE id=$1",[event.id]);
    // Only stream events keep the proactive loop alive; one-offs (door_cliffhanger) must not fork a second stream.
    if (STREAM_EVENT_TYPES.has(event.event_type)) {
      const nextAction = PROACTIVE_ROTATION[(Math.abs(Number(new Date(event.due_at))) + 1) % PROACTIVE_ROTATION.length];
      const hours = 6 + Math.floor(Math.random() * 5);
      await client.query(`INSERT INTO world_events (creature_id,event_type,payload,due_at)
        SELECT $1,'proactive_story',$2,now()+($3||' hours')::interval
        WHERE NOT EXISTS (SELECT 1 FROM world_events WHERE creature_id=$1 AND status='pending' AND event_type='proactive_story')`,[event.creature_id,JSON.stringify({action:nextAction}),hours]);
    }
  }
  return result.rowCount??0;
}

export async function cleanupProcessedWork(client: pg.PoolClient): Promise<void> {
  await client.query("DELETE FROM telegram_updates WHERE received_at < now() - interval '7 days'");
  await client.query("DELETE FROM outbox WHERE status='sent' AND created_at < now() - interval '14 days'");
}
