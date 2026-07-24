import { db } from "./db.js";
import { open } from "./crypto.js";
import { saveAIProfile } from "./game.js";
import {
  beginOpenRouterConnection,
  claimOpenRouterState,
  completeOpenRouterConnection,
  disconnectOpenRouter,
  exchangeOpenRouterCode,
  getOpenRouterConnection,
  inspectOpenRouterKey,
  markOpenRouterInvalid,
  recordOpenRouterVerification,
  selectOpenRouterMode,
  verifyOpenRouterConnection
} from "./openrouter.js";

function assert(condition:unknown,message:string):asserts condition {
  if(!condition)throw new Error(message);
}

async function main() {
  const client=await db.connect();
  const originalFetch=globalThis.fetch;
  const plainKey="sk-or-v1-smoke-secret-that-must-never-be-returned";
  const manualKey="sk-or-v1-manual-smoke-secret";
  try {
    await client.query("BEGIN");
    const telegramId=Number(`7${String(Date.now()).slice(-9)}`);
    const player=(await client.query(`INSERT INTO players (telegram_user_id,display_name,locale) VALUES ($1,'OAuth Smoke','en') RETURNING id`,[telegramId])).rows[0];

    const start=await beginOpenRouterConnection(client,player.id);
    const authUrl=new URL(start.url);
    assert(authUrl.origin==="https://openrouter.ai"&&authUrl.pathname==="/auth","unexpected OpenRouter authorization URL");
    assert(authUrl.searchParams.get("code_challenge_method")==="S256","PKCE method is not S256");
    assert(Boolean(authUrl.searchParams.get("code_challenge")),"PKCE challenge is missing");
    assert(!start.url.includes("code_verifier")&&!start.url.includes(plainKey),"authorization URL leaked a verifier or key");
    const callbackUrl=new URL(String(authUrl.searchParams.get("callback_url")));
    const rawState=String(callbackUrl.searchParams.get("state"));
    assert(rawState.length>=40,"callback state is missing");

    const stateRow=await client.query(`SELECT state_hash,verifier_cipher,status,expires_at FROM openrouter_oauth_states WHERE player_id=$1`,[player.id]);
    assert(stateRow.rowCount===1,"OAuth state was not persisted");
    assert(!JSON.stringify(stateRow.rows[0]).includes(rawState),"raw OAuth state was persisted");
    assert(String(stateRow.rows[0].verifier_cipher).length>40,"PKCE verifier was not encrypted");

    const claim=await claimOpenRouterState(client,rawState);
    let replayRejected=false;
    try { await claimOpenRouterState(client,rawState); }
    catch(error) { replayRejected=error instanceof Error&&error.message.includes("already used"); }
    assert(replayRejected,"OAuth state replay was accepted");

    globalThis.fetch=async(input,init)=>{
      const url=String(input);
      if(url.endsWith("/auth/keys")){
        const body=JSON.parse(String(init?.body??"{}")) as Record<string,unknown>;
        assert(body.code==="valid-smoke-code","authorization code changed unexpectedly");
        assert(body.code_verifier===claim.verifier,"PKCE verifier was not used in the exchange");
        return new Response(JSON.stringify({key:plainKey,user_id:"user-smoke"}),{status:200,headers:{"content-type":"application/json"}});
      }
      if(url.endsWith("/key")){
        assert(new Headers(init?.headers).get("authorization")===`Bearer ${plainKey}`,"key inspection did not use the exchanged credential");
        return new Response(JSON.stringify({data:{is_free_tier:false,limit:5,limit_remaining:4.75,expires_at:null}}),{status:200,headers:{"content-type":"application/json"}});
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const exchange=await exchangeOpenRouterCode("valid-smoke-code",claim.verifier);
    const keyInfo=await inspectOpenRouterKey(exchange.key);
    await completeOpenRouterConnection(client,claim,exchange,keyInfo);

    const stored=await client.query(`SELECT * FROM ai_profiles WHERE player_id=$1`,[player.id]);
    assert(stored.rowCount===1,"OpenRouter profile was not saved");
    assert(stored.rows[0].source==="openrouter"&&stored.rows[0].connection_status==="active","OpenRouter profile metadata is incorrect");
    assert(String(stored.rows[0].encrypted_api_key)!==plainKey&&!JSON.stringify(stored.rows[0]).includes(plainKey),"plaintext OpenRouter key was stored");
    assert(open(String(stored.rows[0].encrypted_api_key))===plainKey,"encrypted OpenRouter key cannot be recovered by the server");

    const status=await getOpenRouterConnection(client,player.id);
    assert(status.connected&&status.mode==="balanced"&&status.model==="qwen/qwen3.5-9b","default connected status is incorrect");
    assert(!JSON.stringify(status).includes(plainKey),"connection status exposed the credential");

    const creative=await selectOpenRouterMode(client,player.id,"creative");
    assert(creative.mode==="creative"&&creative.model==="google/gemini-3.1-flash-lite","curated model selection failed");

    await markOpenRouterInvalid(client,player.id);
    const invalid=await getOpenRouterConnection(client,player.id);
    assert(invalid.status==="invalid"&&!invalid.connected,"invalid connection disappeared or stayed active");
    const verification=await verifyOpenRouterConnection(client,player.id);
    assert(verification.key===plainKey,"invalid connection could not be reverified");
    const activeAgain=await recordOpenRouterVerification(client,player.id,keyInfo);
    assert(activeAgain.connected&&activeAgain.status==="active","successful reverification did not reactivate the profile");

    await saveAIProfile(client,player.id,{baseUrl:"https://openrouter.ai/api/v1",model:"manual-openrouter-model",apiKey:manualKey});
    const manual=await client.query(`SELECT source,external_user_id,connection_status,connection_metadata,encrypted_api_key FROM ai_profiles WHERE player_id=$1`,[player.id]);
    assert(manual.rows[0].source==="manual"&&manual.rows[0].external_user_id===null&&manual.rows[0].connection_status==="active","manual save did not clear OpenRouter metadata");
    assert(JSON.stringify(manual.rows[0].connection_metadata)==="{}","manual save retained OAuth connection metadata");
    assert(open(String(manual.rows[0].encrypted_api_key))===manualKey,"manual credential was not encrypted through the production save path");

    await client.query(`UPDATE ai_profiles SET base_url='https://openrouter.ai/api/v1',source='openrouter',external_user_id='user-smoke',encrypted_api_key=$2,connection_status='active',connection_metadata=$3 WHERE player_id=$1`,[
      player.id,stored.rows[0].encrypted_api_key,JSON.stringify({mode:"creative",keyInfo})
    ]);
    const disconnected=await disconnectOpenRouter(client,player.id);
    assert(disconnected,"disconnect did not remove the OpenRouter profile");
    const afterDisconnect=await getOpenRouterConnection(client,player.id);
    assert(afterDisconnect.source==="none"&&!afterDisconnect.connected,"credential remained after disconnect");
    const remaining=await client.query(`SELECT (SELECT COUNT(*) FROM ai_profiles WHERE player_id=$1) AS profiles,(SELECT COUNT(*) FROM openrouter_oauth_states WHERE player_id=$1) AS states`,[player.id]);
    assert(Number(remaining.rows[0].profiles)===0&&Number(remaining.rows[0].states)===0,"disconnect did not delete credentials and OAuth state");

    await client.query("ROLLBACK");
    console.log("OpenRouter OAuth database smoke test passed");
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
