import type pg from "pg";
import { config } from "./config.js";
import type { DailyReturnView } from "./memory.js";

export interface NotificationPreferencesView {
  enabled:boolean;
  timezone:string;
  deliveryTime:string;
  quietStart:string;
  quietEnd:string;
  nextDeliveryAt:string|null;
}

export interface NotificationSettingsInput {
  enabled:boolean;
  timezone:string;
  deliveryTime:string;
  quietStart:string;
  quietEnd:string;
}

const dailyChoices:DailyReturnView["choices"]=[
  {id:"hold_close",label:"Keep this memory close"},
  {id:"tell_someone",label:"Tell someone about it"},
  {id:"set_down",label:"Set it down for today"}
];

function timeOnly(value:unknown):string {
  return String(value).slice(0,5);
}

function dateOnly(value:unknown):string {
  if(value instanceof Date)return value.toISOString().slice(0,10);
  const text=String(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:new Date(text).toISOString().slice(0,10);
}

function notificationView(row:Record<string,unknown>):NotificationPreferencesView {
  return {
    enabled:Boolean(row.enabled),
    timezone:String(row.timezone),
    deliveryTime:timeOnly(row.delivery_time),
    quietStart:timeOnly(row.quiet_start),
    quietEnd:timeOnly(row.quiet_end),
    nextDeliveryAt:row.next_delivery_at?new Date(String(row.next_delivery_at)).toISOString():null
  };
}

function dailyView(row:Record<string,unknown>):DailyReturnView {
  return {
    id:String(row.id),
    status:row.status as "active"|"completed",
    returnDate:dateOnly(row.return_date),
    memoryId:row.memory_id?String(row.memory_id):null,
    title:String(row.title),
    body:String(row.body),
    choices:row.status==="active"?(row.choices as DailyReturnView["choices"]):[],
    choiceId:(row.choice_id??null) as DailyReturnView["choiceId"],
    result:(row.result??{}) as Record<string,unknown>
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

export function isValidTimeZone(timezone:string):boolean {
  if(timezone.length<1||timezone.length>80)return false;
  try { new Intl.DateTimeFormat("en-US",{timeZone:timezone}).format(new Date());return true; }
  catch { return false; }
}

function parseTime(value:string):number {
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))throw new Error("time must use HH:mm");
  const [hours,minutes]=value.split(":").map(Number) as [number,number];
  return hours*60+minutes;
}

export function timeFallsInQuietHours(deliveryTime:string,quietStart:string,quietEnd:string):boolean {
  const delivery=parseTime(deliveryTime);
  const start=parseTime(quietStart);
  const end=parseTime(quietEnd);
  if(start===end)return false;
  return start<end?delivery>=start&&delivery<end:delivery>=start||delivery<end;
}

async function computeNextDelivery(client:pg.PoolClient,timezone:string,deliveryTime:string,from=new Date()):Promise<Date> {
  const local=await client.query(`SELECT ($1::timestamptz AT TIME ZONE $2)::date AS local_date,($1::timestamptz AT TIME ZONE $2)::time AS local_time`,[from.toISOString(),timezone]);
  const localDate=dateOnly(local.rows[0].local_date);
  const localTime=timeOnly(local.rows[0].local_time);
  const addDay=parseTime(deliveryTime)<=parseTime(localTime)?1:0;
  const result=await client.query(`SELECT ((($1::date+$2::integer)+$3::time) AT TIME ZONE $4) AS due_at`,[localDate,addDay,deliveryTime,timezone]);
  return new Date(result.rows[0].due_at);
}

async function computeFollowingDelivery(client:pg.PoolClient,timezone:string,deliveryTime:string,localDate:string):Promise<Date> {
  const result=await client.query(`SELECT ((($1::date+1)+$2::time) AT TIME ZONE $3) AS due_at`,[localDate,deliveryTime,timezone]);
  return new Date(result.rows[0].due_at);
}

export async function getNotificationPreferences(client:pg.PoolClient,playerId:string):Promise<NotificationPreferencesView> {
  const result=await client.query(`SELECT * FROM notification_preferences WHERE player_id=$1`,[playerId]);
  if(result.rowCount)return notificationView(result.rows[0]);
  return {enabled:false,timezone:"UTC",deliveryTime:"10:00",quietStart:"22:00",quietEnd:"08:00",nextDeliveryAt:null};
}

export async function saveNotificationPreferences(client:pg.PoolClient,playerId:string,creatureId:string,input:NotificationSettingsInput):Promise<NotificationPreferencesView> {
  if(!isValidTimeZone(input.timezone))throw new Error("unsupported timezone");
  parseTime(input.deliveryTime);parseTime(input.quietStart);parseTime(input.quietEnd);
  if(input.enabled&&timeFallsInQuietHours(input.deliveryTime,input.quietStart,input.quietEnd))throw new Error("daily delivery time falls inside quiet hours");
  const nextDelivery=input.enabled?await computeNextDelivery(client,input.timezone,input.deliveryTime):null;
  const result=await client.query(`INSERT INTO notification_preferences (player_id,enabled,timezone,delivery_time,quiet_start,quiet_end,next_delivery_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (player_id) DO UPDATE SET enabled=EXCLUDED.enabled,timezone=EXCLUDED.timezone,delivery_time=EXCLUDED.delivery_time,quiet_start=EXCLUDED.quiet_start,quiet_end=EXCLUDED.quiet_end,next_delivery_at=EXCLUDED.next_delivery_at,updated_at=now()
    RETURNING *`,[playerId,input.enabled,input.timezone,input.deliveryTime,input.quietStart,input.quietEnd,nextDelivery?.toISOString()??null]);
  await client.query(`INSERT INTO analytics_events (player_id,creature_id,event_name,properties) VALUES ($1,$2,'notification_preferences_updated',$3)`,[playerId,creatureId,JSON.stringify({enabled:input.enabled,timezone:input.timezone,deliveryTime:input.deliveryTime,quietStart:input.quietStart,quietEnd:input.quietEnd})]);
  return notificationView(result.rows[0]);
}

export async function ensureDailyReturnForDate(client:pg.PoolClient,playerId:string,creatureId:string,returnDate:string,worldId="bloopy-origin"):Promise<DailyReturnView|null> {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(returnDate))throw new Error("invalid local return date");
  const creatureResult=await client.query(`SELECT c.name,c.created_at,os.status AS onboarding_status FROM creatures c LEFT JOIN onboarding_states os ON os.creature_id=c.id WHERE c.id=$1`,[creatureId]);
  const creature=creatureResult.rows[0];
  if(!creature||creature.onboarding_status!=="complete")return null;
  const age=await client.query(`SELECT ($1::date-($2::timestamptz AT TIME ZONE 'UTC')::date)::integer AS days`,[returnDate,creature.created_at]);
  if(Number(age.rows[0]?.days)<1)return null;
  const existing=await client.query(`SELECT * FROM daily_return_instances WHERE creature_id=$1 AND world_id=$2 AND return_date=$3::date`,[creatureId,worldId,returnDate]);
  if(existing.rowCount)return dailyView(existing.rows[0]);
  const memory=await client.query(`SELECT * FROM memories WHERE creature_id=$1 AND world_id=$2 AND tier IN ('identity','episodic') AND deleted_at IS NULL AND canonical_status IN ('approved','user_asserted') AND (expires_at IS NULL OR expires_at>now()) ORDER BY last_used_at NULLS FIRST,importance DESC,created_at DESC LIMIT 1`,[creatureId,worldId]);
  const selected=memory.rows[0];
  const story=dailyStory(String(creature.name),selected?String(selected.summary):undefined);
  const inserted=await client.query(`INSERT INTO daily_return_instances (creature_id,world_id,return_date,memory_id,title,body,choices) VALUES ($1,$2,$3::date,$4,$5,$6,$7) ON CONFLICT (creature_id,world_id,return_date) DO NOTHING RETURNING *`,[
    creatureId,worldId,returnDate,selected?.id??null,story.title,story.body,JSON.stringify(dailyChoices)
  ]);
  const row=inserted.rows[0]??(await client.query(`SELECT * FROM daily_return_instances WHERE creature_id=$1 AND world_id=$2 AND return_date=$3::date`,[creatureId,worldId,returnDate])).rows[0];
  if(inserted.rowCount) {
    if(selected) {
      await client.query(`UPDATE memories SET last_used_at=now(),updated_at=now() WHERE id=$1`,[selected.id]);
      await client.query(`INSERT INTO memory_audit_events (creature_id,memory_id,event_type,actor_type,details) VALUES ($1,$2,'used','engine',$3)`,[creatureId,selected.id,JSON.stringify({surface:"daily_return",worldId,returnDate})]);
    }
    await client.query(`INSERT INTO analytics_events (player_id,creature_id,event_name,properties) VALUES ($1,$2,'daily_return_created',$3)`,[playerId,creatureId,JSON.stringify({worldId,returnDate,hasMemory:Boolean(selected)})]);
  }
  return dailyView(row);
}

export async function localDateForPlayer(client:pg.PoolClient,playerId:string):Promise<{date:string;timezone:string}> {
  const preference=await client.query(`SELECT timezone FROM notification_preferences WHERE player_id=$1`,[playerId]);
  const timezone=preference.rows[0]?.timezone?String(preference.rows[0].timezone):"UTC";
  const result=await client.query(`SELECT (now() AT TIME ZONE $1)::date AS local_date`,[timezone]);
  return {date:dateOnly(result.rows[0].local_date),timezone};
}

export async function markDailyReturnOpened(client:pg.PoolClient,playerId:string,creatureId:string,dailyReturnId:string):Promise<boolean> {
  const updated=await client.query(`UPDATE daily_return_instances SET notification_opened_at=now(),updated_at=now() WHERE id=$1 AND creature_id=$2 AND notification_sent_at IS NOT NULL AND notification_opened_at IS NULL RETURNING return_date`,[dailyReturnId,creatureId]);
  if(!updated.rowCount)return false;
  await client.query(`INSERT INTO analytics_events (player_id,creature_id,event_name,properties) VALUES ($1,$2,'daily_return_notification_opened',$3)`,[playerId,creatureId,JSON.stringify({returnDate:dateOnly(updated.rows[0].return_date)})]);
  return true;
}

export async function scheduleDueDailyReturnNotifications(client:pg.PoolClient):Promise<number> {
  if(!config.TELEGRAM_MANAGER_BOT_TOKEN)return 0;
  const due=await client.query(`SELECT np.*,p.telegram_user_id,c.id AS creature_id,c.name
    FROM notification_preferences np
    JOIN players p ON p.id=np.player_id
    JOIN creatures c ON c.player_id=p.id AND c.kind='player'
    JOIN onboarding_states os ON os.creature_id=c.id AND os.status='complete'
    WHERE np.enabled=true AND np.next_delivery_at IS NOT NULL AND np.next_delivery_at<=now()
    ORDER BY np.next_delivery_at
    FOR UPDATE OF np SKIP LOCKED LIMIT 25`);
  let scheduled=0;
  for(const row of due.rows) {
    const local=await client.query(`SELECT ($1::timestamptz AT TIME ZONE $2)::date AS local_date`,[row.next_delivery_at,row.timezone]);
    const localDate=dateOnly(local.rows[0].local_date);
    const daily=await ensureDailyReturnForDate(client,String(row.player_id),String(row.creature_id),localDate);
    let outcome="not_eligible";
    if(daily?.status==="active") {
      const sourceKey=`daily-return-notification:${daily.id}`;
      const payload={
        method:"sendMessage",
        text:`${daily.title}\n\n${daily.body}`,
        reply_markup:{inline_keyboard:[[{text:"Open today's moment",web_app:{url:config.PUBLIC_BASE_URL}}]]}
      };
      const inserted=await client.query(`INSERT INTO outbox (chat_id,payload,source_key,player_id,creature_id,daily_return_id) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING RETURNING id`,[
        String(row.telegram_user_id),JSON.stringify(payload),sourceKey,row.player_id,row.creature_id,daily.id
      ]);
      if(inserted.rowCount) {
        scheduled+=1;
        outcome="scheduled";
        await client.query(`UPDATE daily_return_instances SET notification_scheduled_at=now(),updated_at=now() WHERE id=$1`,[daily.id]);
        await client.query(`INSERT INTO analytics_events (player_id,creature_id,event_name,properties) VALUES ($1,$2,'daily_return_notification_scheduled',$3)`,[row.player_id,row.creature_id,JSON.stringify({returnDate:localDate,timezone:row.timezone})]);
      } else outcome="already_scheduled";
    } else if(daily?.status==="completed") outcome="already_completed";
    const next=await computeFollowingDelivery(client,String(row.timezone),timeOnly(row.delivery_time),localDate);
    await client.query(`UPDATE notification_preferences SET next_delivery_at=$2,updated_at=now() WHERE player_id=$1`,[row.player_id,next.toISOString()]);
    if(outcome!=="scheduled"&&outcome!=="already_scheduled")await client.query(`INSERT INTO analytics_events (player_id,creature_id,event_name,properties) VALUES ($1,$2,'daily_return_notification_skipped',$3)`,[row.player_id,row.creature_id,JSON.stringify({returnDate:localDate,reason:outcome})]);
  }
  return scheduled;
}
