const tg=window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const headers={"content-type":"application/json"};
if(tg?.initData) headers["x-telegram-init-data"]=tg.initData;

let state;
let selectedMarker;
const $=(id)=>document.getElementById(id);

function toast(message){
  $("toast").textContent=message;
  $("toast").classList.add("show");
  setTimeout(()=>$("toast").classList.remove("show"),2400);
}

async function api(path,options={}){
  const response=await fetch(path,{...options,headers:{...headers,...(options.headers||{})}});
  if(!response.ok) throw new Error((await response.json().catch(()=>({}))).error||"Request failed");
  return response.json();
}

function escapeHtml(value=""){
  return String(value).replace(/[&<>'"]/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
}

function storyCard(story){
  const choices=Array.isArray(story.choices)?story.choices:[];
  return `<article class="story"><h3>${escapeHtml(story.title)}</h3><p>${escapeHtml(story.body)}</p>${choices.length?`<div class="choices">${choices.map((choice)=>`<button data-action="${escapeHtml(choice.action)}">${escapeHtml(choice.label)}</button>`).join("")}</div>`:""}</article>`;
}

function setButtonsDisabled(container,disabled){
  container?.querySelectorAll("button").forEach((button)=>{button.disabled=disabled;});
}

function renderGenesis(onboarding){
  $("genesis").hidden=false;
  $("game-shell").hidden=true;
  $("wake-step").hidden=onboarding.status!=="wake_choice";
  $("identity-step").hidden=onboarding.status!=="identity";

  if(onboarding.status==="wake_choice"){
    $("wake-options").innerHTML=onboarding.wakeChoices.map((choice)=>`
      <button class="genesis-choice" data-wake-choice="${escapeHtml(choice.id)}">
        <strong>${escapeHtml(choice.label)}</strong>
        <span>${escapeHtml(choice.hint)}</span>
      </button>`).join("");
  }

  if(onboarding.status==="identity"){
    selectedMarker=selectedMarker||onboarding.visualMarker||onboarding.visualMarkers[0]?.id;
    $("genesis-avatar").src=`/api/creatures/${state.creature.id}/avatar.svg?v=genesis`;
    if(!$("identity-name").value&&state.creature.name!=="Unnamed Bloopy") $("identity-name").value=state.creature.name;
    $("marker-options").innerHTML=onboarding.visualMarkers.map((marker)=>`
      <button type="button" class="marker-choice ${selectedMarker===marker.id?"selected":""}" data-marker="${escapeHtml(marker.id)}" aria-pressed="${selectedMarker===marker.id}">
        <span>${escapeHtml(marker.symbol)}</span>
        <small>${escapeHtml(marker.label)}</small>
      </button>`).join("");
  }
}

function renderGame(){
  $("genesis").hidden=true;
  $("game-shell").hidden=false;
  const creature=state.creature;
  $("creature-name").textContent=creature.name;
  $("mood-line").textContent=`${creature.mood} · ${creature.current_location.replaceAll("_"," ")}`;
  $("avatar").src=`/api/creatures/${creature.id}/avatar.svg?v=${creature.level}-${encodeURIComponent(creature.updated_at||"")}`;
  $("energy").textContent=creature.energy;
  $("level").textContent=`Lv ${creature.level}`;
  $("xp").textContent=creature.xp;
  $("story-feed").innerHTML=(state.stories||[]).map(storyCard).join("");
  $("npc-list").innerHTML=(state.npcs||[]).map((npc)=>`<div class="npc"><img src="/api/creatures/${npc.id}/avatar.svg"><b>${escapeHtml(npc.name)}</b><small>${escapeHtml(npc.current_location.replaceAll("_"," "))}</small></div>`).join("");
}

function render(){
  const onboarding=state.onboarding;
  if(onboarding?.enabled&&onboarding.status!=="complete") renderGenesis(onboarding);
  else renderGame();
}

async function refresh(){
  state=await api("/api/bootstrap");
  render();
}

async function chooseWake(choice){
  setButtonsDisabled($("wake-options"),true);
  try{
    const result=await api("/api/onboarding/wake",{method:"POST",body:JSON.stringify({choice})});
    if(result.story) toast(result.story.title);
    await refresh();
  }catch(error){
    toast(error.message);
    setButtonsDisabled($("wake-options"),false);
  }
}

async function finishGenesis(event){
  event.preventDefault();
  if(!selectedMarker){toast("Choose a mark first");return;}
  const name=$("identity-name").value;
  setButtonsDisabled($("identity-form"),true);
  try{
    const result=await api("/api/onboarding/identity",{method:"POST",body:JSON.stringify({name,marker:selectedMarker})});
    if(result.story) toast(result.story.title);
    await refresh();
  }catch(error){
    toast(error.message);
    setButtonsDisabled($("identity-form"),false);
  }
}

async function act(action){
  document.querySelectorAll("button[data-action]").forEach((button)=>{button.disabled=true;});
  try{
    const result=await api("/api/actions",{method:"POST",body:JSON.stringify({action})});
    toast(result.story.title);
    await refresh();
  }catch(error){
    toast(error.message);
  }finally{
    document.querySelectorAll("button[data-action]").forEach((button)=>{button.disabled=false;});
  }
}

document.addEventListener("click",(event)=>{
  const wakeButton=event.target.closest("button[data-wake-choice]");
  if(wakeButton){void chooseWake(wakeButton.dataset.wakeChoice);return;}

  const markerButton=event.target.closest("button[data-marker]");
  if(markerButton){
    selectedMarker=markerButton.dataset.marker;
    document.querySelectorAll("button[data-marker]").forEach((button)=>{
      const selected=button.dataset.marker===selectedMarker;
      button.classList.toggle("selected",selected);
      button.setAttribute("aria-pressed",String(selected));
    });
    return;
  }

  const actionButton=event.target.closest("button[data-action]");
  if(actionButton) void act(actionButton.dataset.action);
});

$("identity-form").addEventListener("submit",finishGenesis);

$("share").addEventListener("click",()=>{
  const latest=state.stories?.[0];
  if(!latest)return;
  const url=`${location.origin}/?startapp=meet_${state.creature.slug}`;
  const share=`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(`${state.creature.name}: ${latest.title}`)}`;
  tg?.openTelegramLink?tg.openTelegramLink(share):window.open(share,"_blank","noopener");
});

$("spawn-bot").addEventListener("click",async()=>{
  try{
    const {url}=await api("/api/bots/spawn-link");
    tg?.openTelegramLink?tg.openTelegramLink(url):window.open(url,"_blank","noopener");
  }catch(error){toast(error.message);}
});

$("ai-form").addEventListener("submit",async(event)=>{
  event.preventDefault();
  const values=Object.fromEntries(new FormData(event.currentTarget));
  try{
    await api("/api/settings/ai",{method:"POST",body:JSON.stringify(values)});
    event.currentTarget.reset();
    toast("Private model connection saved");
  }catch(error){toast(error.message);}
});

refresh().catch((error)=>toast(error.message));
