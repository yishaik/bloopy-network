const params=new URLSearchParams(window.location.search);
const status=params.get("openrouter");
const success=status==="connected";
const reason=params.get("reason");
const botUsername=document.documentElement.dataset.managerBot||"";
const returnUrl=botUsername?`https://t.me/${botUsername.replace(/^@/,"")}?startapp=openrouter_${success?"connected":"error"}`:"https://t.me";

document.body.innerHTML=`
  <main class="oauth-return">
    <section class="card oauth-result ${success?"success":"error"}">
      <div class="oauth-symbol" aria-hidden="true">${success?"✓":"!"}</div>
      <p class="eyebrow">CONNECTED MIND</p>
      <h1>${success?"OpenRouter is connected":"The connection was not completed"}</h1>
      <p>${success
        ?"The credential was encrypted and saved on the Bloopy server. No API key was placed in this page or browser storage."
        :`Bloopy stayed on its safe authored fallback. ${reason==="expired_state"?"The authorization link expired or was already used.":"OpenRouter could not be verified."}`}</p>
      <a class="oauth-return-button" href="${returnUrl}">${botUsername?"Return to Bloopy in Telegram":"Open Telegram"}</a>
      <small>You may close this browser tab after returning.</small>
    </section>
  </main>`;

history.replaceState({},document.title,window.location.pathname);
