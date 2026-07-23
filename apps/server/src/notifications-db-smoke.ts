import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { markDailyReturnOpened, saveNotificationPreferences, scheduleDueDailyReturnNotifications } from "./notifications.js";
import { dispatchOutbox } from "./telegram.js";

function assert(condition:unknown,message:string):asserts condition {
  if(!condition)throw new Error(message);
}

async function main() {
  const client=await db.connect();
  const originalFetch=globalThis.fetch;
  try {
    await client.query("BEGIN");
    const telegramId=Number(`8${String(Date.now()).slice(-9)}`);
    const player=(await client.query(`INSERT INTO players (telegram_user_id,display_name,locale) VALUES ($1,'Notification Smoke','en') RETURNING id`,[telegramId])).rows[0];
    const creature=(await client.query(`INSERT INTO creatures (player_id,slug,name,kind,personality,genome,energy,mood,current_location,created_at) VALUES ($1,$2,'Piko','player',$3,$4,82,'curious','cardboard_nest',now()-interval '2 days') RETURNING id`,[
      player.id,`notification-smoke-${randomUUID()}`,
      JSON.stringify({archetype:"gentle_explorer",voice:"earnest_whimsy",curiosity:0.72,courage:0.48,empathy:0.67,mischief:0.49,sociability:0.62}),
      JSON.stringify({body:"round",primary:"#aaaaaa",secondary:"#bbbbbb",eyes:"wide",mark:"moon",accessory:"leaf",evolution:1})
    ])).rows[0];
    await client.query(`INSERT INTO onboarding_states (creature_id,status,completed_at) VALUES ($1,'complete',now()-interval '2 days')`,[creature.id]);
    await client.query(`INSERT INTO memories (creature_id,source_type,source_version,summary,importance,is_private,tier,privacy_level,confidence,canonical_status,world_id) VALUES ($1,'smoke','notification-smoke-v1','Piko remembers a quiet promise.',0.8,true,'episodic','private',1,'approved','bloopy-origin')`,[creature.id]);

    let quietRejected=false;
    try {
      await saveNotificationPreferences(client,player.id,creature.id,{enabled:true,timezone:"Asia/Jerusalem",deliveryTime:"23:00",quietStart:"22:00",quietEnd:"08:00"});
    } catch(error) {
      quietRejected=error instanceof Error&&error.message.includes("quiet hours");
    }
    assert(quietRejected,"delivery inside quiet hours was accepted");

    const enabled=await saveNotificationPreferences(client,player.id,creature.id,{enabled:true,timezone:"Asia/Jerusalem",deliveryTime:"10:00",quietStart:"22:00",quietEnd:"08:00"});
    assert(enabled.enabled&&enabled.timezone==="Asia/Jerusalem","notification preferences were not saved");
    await client.query(`UPDATE notification_preferences SET next_delivery_at=now()-interval '1 minute' WHERE player_id=$1`,[player.id]);

    const firstSchedule=await scheduleDueDailyReturnNotifications(client);
    const secondSchedule=await scheduleDueDailyReturnNotifications(client);
    assert(firstSchedule===1,"due daily notification was not scheduled");
    assert(secondSchedule===0,"scheduler created a duplicate notification");
    const scheduled=await client.query(`SELECT o.*,dri.notification_scheduled_at FROM outbox o JOIN daily_return_instances dri ON dri.id=o.daily_return_id WHERE o.player_id=$1`,[player.id]);
    assert(scheduled.rowCount===1,"outbox did not contain exactly one daily notification");
    assert(scheduled.rows[0].source_key&&scheduled.rows[0].notification_scheduled_at,"scheduled notification metadata is missing");

    globalThis.fetch=(async()=>({json:async()=>({ok:true,result:{message_id:1}})})) as typeof fetch;
    const firstDispatch=await dispatchOutbox(client);
    const secondDispatch=await dispatchOutbox(client);
    assert(firstDispatch===1,"daily notification was not dispatched");
    assert(secondDispatch===0,"sent outbox message was dispatched twice");
    const delivery=await client.query(`SELECT o.status,o.sent_at,dri.notification_sent_at FROM outbox o JOIN daily_return_instances dri ON dri.id=o.daily_return_id WHERE o.player_id=$1`,[player.id]);
    assert(delivery.rows[0].status==="sent"&&delivery.rows[0].sent_at&&delivery.rows[0].notification_sent_at,"delivery state was not persisted");
    const deliveredEvents=await client.query(`SELECT COUNT(*)::integer AS count FROM analytics_events WHERE player_id=$1 AND event_name='daily_return_notification_delivered'`,[player.id]);
    assert(Number(deliveredEvents.rows[0].count)===1,"delivery analytics was duplicated");

    const dailyReturnId=String(scheduled.rows[0].daily_return_id);
    const firstOpen=await markDailyReturnOpened(client,player.id,creature.id,dailyReturnId);
    const secondOpen=await markDailyReturnOpened(client,player.id,creature.id,dailyReturnId);
    assert(firstOpen&&!secondOpen,"notification open was not idempotent");
    const openedEvents=await client.query(`SELECT COUNT(*)::integer AS count FROM analytics_events WHERE player_id=$1 AND event_name='daily_return_notification_opened'`,[player.id]);
    assert(Number(openedEvents.rows[0].count)===1,"open analytics was duplicated");

    const disabled=await saveNotificationPreferences(client,player.id,creature.id,{enabled:false,timezone:"Asia/Jerusalem",deliveryTime:"10:00",quietStart:"22:00",quietEnd:"08:00"});
    assert(!disabled.enabled&&disabled.nextDeliveryAt===null,"notification opt-out did not clear scheduling");

    await client.query("ROLLBACK");
    console.log("notification database smoke test passed");
  } catch(error) {
    await client.query("ROLLBACK").catch(()=>undefined);
    throw error;
  } finally {
    globalThis.fetch=originalFetch;
    client.release();
    await db.end();
  }
}

main().catch((error)=>{console.error(error);process.exitCode=1;});
