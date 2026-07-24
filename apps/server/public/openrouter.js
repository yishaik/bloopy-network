const tg=window.Telegram?.WebApp;
const headers={"content-type":"application/json"};
if(tg?.initData)headers["x-telegram-init-data"]=tg.initData;
const $=(id)=>document.getElementById(id);

function notify(message){
  const toast=$("toast");
  if(!toast)return;
  toast.textContent=message;
  toast.classList.add("show");
  setTimeout(()=>toast.classList.remove("show"),2600);
}

async function api(path,options={}){
  const response=await fetch(path,{...options,headers:{...headers,...(options.headers||{})}});
  if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||"Request failed");
  return response.json();
}

function confirmAction(message){
  return new Promise((resolve)=>{
    if(tg?.showConfirm){tg.showConfirm(message,(confirmed)=>resolve(Boolean(confirmed)));return;}
    resolve(window.confirm(message));
  });
}

function money(value){
  if(typeof value!=="number")return null;
  return new Intl.NumberFormat(undefined,{style:"currency",currency:"USD",maximumFractionDigits:2}).format(value);
}

function renderKeyInfo(connection){
  const info=connection.keyInfo;
  const facts=[];
  if(connection.externalUserId)facts.push(`<span>OpenRouter user ${String(connection.externalUserId).replace(/[&<>'"]/g,"")}</span>`);
  if(info?.isFreeTier===true)facts.push("<span>Free-tier key</span>");
  if(info?.isFreeTier===false)facts.push("<span>Funded account</span>");
  const remaining=money(info?.limitRemaining);
  if(remaining)facts.push(`<span>${remaining} reported remaining</span>`);
  const limit=money(info?.limit);
  if(limit)facts.push(`<span>${limit} reported limit</span>`);
  if(connection.lastVerifiedAt)facts.push(`<span>Verified ${new Date(connection.lastVerifiedAt).toLocaleString([], {dateStyle:"medium",timeStyle:"short"})}</span>`);
  $("openrouter-key-info").innerHTML=facts.join("")||"<span>Credential stored securely</span>";
}

function renderModels(connection){
  $("openrouter-models").innerHTML=(connection.models||[]).map((option)=>`
    <button type="button" class="model-option ${connection.mode===option.mode?"selected":""}" data-openrouter-mode="${option.mode}" role="radio" aria-checked="${connection.mode===option.mode}">
      <span><b>${option.label}</b><small>${option.description}</small></span>
      <span class="cost-tier">${option.costTier}</span>
    </button>`).join("");
}

function render(connection){
  const card=$("openrouter-card");
  if(!card)return;
  const isOpenRouter=connection.source==="openrouter";
  const invalid=isOpenRouter&&connection.status==="invalid";
  card.classList.toggle("invalid",invalid);
  $("openrouter-disconnected").hidden=isOpenRouter;
  $("openrouter-connected").hidden=!isOpenRouter;

  if(connection.source==="manual"){
    $("openrouter-title").textContent="Manual developer connection active";
    $("openrouter-status").textContent="manual";
    $("openrouter-description").textContent="A manually entered provider currently powers optional narration. Connecting OpenRouter will replace that profile.";
    $("openrouter-disconnected").hidden=false;
    $("openrouter-connect").textContent="Replace with OpenRouter";
    return;
  }
  if(!isOpenRouter){
    $("openrouter-title").textContent="Use your own OpenRouter account";
    $("openrouter-status").textContent="not connected";
    $("openrouter-description").textContent="Optional: authorize a user-funded model without pasting an API key. Bloopy still controls every fact, choice and reward.";
    $("openrouter-connect").textContent="Sign in with OpenRouter";
    return;
  }

  $("openrouter-title").textContent=invalid?"OpenRouter needs attention":"Connected Mind is active";
  $("openrouter-status").textContent=invalid?"invalid":"connected";
  $("openrouter-description").textContent=invalid
    ? "The saved credential no longer verifies. Reconnect or remove it; Bloopy has already fallen back safely."
    : `Selected model: ${connection.model}. Usage is charged by OpenRouter to your account.`;
  renderKeyInfo(connection);
  renderModels(connection);
}

async function load(){
  if(!tg?.initData)return;
  const dashboard=await api("/api/bootstrap");
  render(dashboard.openrouter||{source:"none",connected:false,status:"none",models:[]});
}

async function connect(){
  const button=$("openrouter-connect");button.disabled=true;
  try{
    const {url}=await api("/api/settings/openrouter/connect",{method:"POST",body:"{}"});
    if(tg?.openLink)tg.openLink(url,{try_instant_view:false});else window.location.assign(url);
  }catch(error){notify(error.message);button.disabled=false;}
}

async function selectMode(mode){
  document.querySelectorAll("button[data-openrouter-mode]").forEach((button)=>{button.disabled=true;});
  try{const connection=await api("/api/settings/openrouter/model",{method:"POST",body:JSON.stringify({mode})});render(connection);notify(`${connection.models.find((entry)=>entry.mode===mode)?.label||"Model"} selected`);}
  catch(error){notify(error.message);}
  finally{document.querySelectorAll("button[data-openrouter-mode]").forEach((button)=>{button.disabled=false;});}
}

async function verify(){
  const button=$("openrouter-verify");button.disabled=true;
  try{const connection=await api("/api/settings/openrouter/verify",{method:"POST",body:"{}"});render(connection);notify("OpenRouter connection verified");}
  catch(error){notify(error.message);await load().catch(()=>undefined);}
  finally{button.disabled=false;}
}

async function disconnect(){
  if(!await confirmAction("Disconnect OpenRouter and permanently delete the stored credential from Bloopy?"))return;
  const button=$("openrouter-disconnect");button.disabled=true;
  try{await api("/api/settings/openrouter",{method:"DELETE"});notify("OpenRouter disconnected");await load();}
  catch(error){notify(error.message);button.disabled=false;}
}

document.addEventListener("click",(event)=>{
  const mode=event.target.closest("button[data-openrouter-mode]");
  if(mode){void selectMode(mode.dataset.openrouterMode);return;}
});

$("openrouter-connect")?.addEventListener("click",connect);
$("openrouter-verify")?.addEventListener("click",verify);
$("openrouter-disconnect")?.addEventListener("click",disconnect);

load().catch((error)=>console.warn("Connected Mind status unavailable",error));
