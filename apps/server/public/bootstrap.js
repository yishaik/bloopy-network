const tg=window.Telegram?.WebApp;
const params=new URLSearchParams(window.location.search);
const oauthStatus=params.get("openrouter");

if(oauthStatus&&!tg?.initData){
  await import("/openrouter-return.js");
}else{
  await Promise.all([import("/app.js"),import("/openrouter.js")]);
}
