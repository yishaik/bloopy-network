import type pg from "pg";
import { buildStory } from "./story.js";
import type { StoryCard } from "./types.js";

export async function processDueEvents(client: pg.PoolClient): Promise<number> {
  const result = await client.query(`SELECT we.*,c.name,c.personality,c.player_id,p.telegram_user_id FROM world_events we JOIN creatures c ON c.id=we.creature_id LEFT JOIN players p ON p.id=c.player_id WHERE we.status='pending' AND we.due_at<=now() ORDER BY we.due_at FOR UPDATE OF we SKIP LOCKED LIMIT 20`);
  for (const event of result.rows) {
    await client.query("UPDATE world_events SET status='processing',updated_at=now() WHERE id=$1",[event.id]);
    const action = event.payload?.action??"social";
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
    await client.query(`INSERT INTO world_events (creature_id,event_type,payload,due_at) VALUES ($1,'proactive_story',$2,now()+interval '8 hours')`,[event.creature_id,JSON.stringify({action:action==="social"?"explore":"social"})]);
  }
  return result.rowCount??0;
}
