(() => {
  "use strict";

  const PROFILE_KEY = "ml3d-link-avatar-final-v1";
  const LEGACY_KEY = "ml3d-link-profile-v1";
  const VERSION = 3;
  const channels = new Set();
  const remoteProfiles = new Map();
  const seenPackets = new Set();
  const previousPos = new Map();
  const renderState = new Map();

  const CATALOG = {
    base: ["male", "female"],
    hair: [0,1,2,3,4,5,6,7,8,9],
    top: [1,2,3,4,5,6,7,8],
    bottom: [1,2,3,4,5,6,7,8],
    shoes: [1,2,3,4,5,6],
    accessory: ["none","cap","glasses","headphones","backpack","scarf","beret","shoulderbag"],
    skin: ["#f6d6bc","#efc3a1","#d89c73","#b8754c","#8b5537","#5b3425"],
    hairColor: ["#2b211c","#4a3024","#7c4d31","#c18a4d","#151a24","#667284","#8b3441","#5b456f"],
    primary: ["#d94e4e","#e47732","#e4b842","#59a55a","#4a9bd0","#4c71c5","#8165c5","#d96991"],
    secondary: ["#202831","#6a4637","#efe7d8","#b84545","#3f78b8","#4d8f5b","#d9b84a","#d66d93"]
  };

  const DEFAULT = {
    version: VERSION,
    id: globalThis.crypto?.randomUUID?.() || `av-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: "Jugador",
    base: "male",
    hair: 1,
    top: 1,
    bottom: 1,
    shoes: 1,
    accessory: "none",
    skin: CATALOG.skin[1],
    hairColor: CATALOG.hairColor[1],
    primary: CATALOG.primary[4],
    secondary: CATALOG.secondary[2]
  };

  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const cleanName = (v) => String(v || "Jugador").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0,32) || "Jugador";
  const validHex = (v) => /^#[0-9a-f]{6}$/i.test(v || "");

  function normalize(value={}) {
    const p = {...DEFAULT, ...value};
    p.version = VERSION;
    p.name = cleanName(p.name);
    p.base = CATALOG.base.includes(p.base) ? p.base : DEFAULT.base;
    for (const key of ["hair","top","bottom","shoes"]) {
      const n = Number(p[key]);
      p[key] = CATALOG[key].includes(n) ? n : DEFAULT[key];
    }
    p.accessory = CATALOG.accessory.includes(p.accessory) ? p.accessory : "none";
    for (const key of ["skin","hairColor","primary","secondary"]) if (!validHex(p[key])) p[key] = DEFAULT[key];
    return p;
  }

  function legacyName() {
    try { return cleanName(JSON.parse(localStorage.getItem(LEGACY_KEY) || "{}").name || "Jugador"); }
    catch { return "Jugador"; }
  }

  function loadProfile() {
    try { return normalize({...DEFAULT, name: legacyName(), ...JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}")}); }
    catch { return normalize({...DEFAULT, name: legacyName()}); }
  }

  let profile = loadProfile();
  function saveProfile(next) {
    profile = normalize(next);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    return profile;
  }

  function darken(hex, amount=.22) {
    const n=parseInt(hex.slice(1),16); let r=n>>16,g=(n>>8)&255,b=n&255;
    r=Math.max(0,Math.round(r*(1-amount))); g=Math.max(0,Math.round(g*(1-amount))); b=Math.max(0,Math.round(b*(1-amount)));
    return `rgb(${r},${g},${b})`;
  }
  function lighten(hex, amount=.22) {
    const n=parseInt(hex.slice(1),16); let r=n>>16,g=(n>>8)&255,b=n&255;
    r=Math.min(255,Math.round(r+(255-r)*amount)); g=Math.min(255,Math.round(g+(255-g)*amount)); b=Math.min(255,Math.round(b+(255-b)*amount));
    return `rgb(${r},${g},${b})`;
  }

  function makeCanvas(cssClass="") {
    const c=document.createElement("canvas"); c.width=32; c.height=40; c.className=cssClass; c.setAttribute("aria-hidden","true"); return c;
  }

  function px(ctx,x,y,w,h,color){ctx.fillStyle=color;ctx.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));}
  function outlineRect(ctx,x,y,w,h,fill,outline="#17202a"){
    px(ctx,x-1,y,w+2,h,outline); px(ctx,x,y-1,w,h+2,outline); px(ctx,x,y,w,h,fill);
  }
  function shadow(ctx){ctx.fillStyle="rgba(0,0,0,.28)";ctx.fillRect(8,36,16,2);ctx.fillStyle="rgba(0,0,0,.16)";ctx.fillRect(11,38,10,1);}

  function drawHair(ctx,p,dir) {
    if (Number(p.hair) === 0) return;
    const c=p.hairColor, hi=lighten(c,.16), lo=darken(c,.28), back=dir==="back", side=dir==="left"||dir==="right";
    if (p.base==="female" && [2,5,7].includes(p.hair)) {
      if (side) { outlineRect(ctx,19,7,6,16,c); px(ctx,21,21,5,6,lo); }
      else { outlineRect(ctx,7,8,18,14,c); px(ctx,7,17,4,10,lo); px(ctx,21,17,4,10,lo); }
    }
    const patterns = {
      1:[[8,5,16,5],[6,8,20,6],[7,14,4,4],[21,14,4,4]],
      2:[[7,4,18,6],[5,9,22,6],[6,15,6,5],[20,14,6,5]],
      3:[[9,3,5,4],[14,2,5,5],[19,4,5,4],[6,8,21,7]],
      4:[[7,5,18,5],[5,9,22,5],[6,14,5,6],[21,14,5,6]],
      5:[[9,3,4,5],[13,5,5,4],[18,2,5,6],[6,8,20,8]],
      6:[[6,5,20,6],[5,10,22,6],[6,16,5,5],[21,16,5,5]],
      7:[[8,4,17,6],[6,9,21,7],[5,15,7,5],[20,14,7,6]],
      8:[[7,4,18,5],[5,8,22,8],[6,15,4,6],[22,15,4,6]],
      9:[[7,4,18,5],[5,8,22,8],[6,15,4,6],[22,15,4,6]]
    };
    const arr=patterns[p.hair]||patterns[1];
    arr.forEach((r,i)=>outlineRect(ctx,r[0],r[1],r[2],r[3],i===0?hi:c,lo));
    if(!back){ px(ctx,9,10,5,3,c); px(ctx,13,9,4,4,c); px(ctx,18,10,5,3,c); }
  }

  function drawHead(ctx,p,dir) {
    const side=dir==="left"||dir==="right", back=dir==="back";
    outlineRect(ctx,9,9,14,12,p.skin,"#3a2925");
    if(back) return;
    if(side){ px(ctx,11,14,2,3,"#17202a"); px(ctx,12,18,3,1,darken(p.skin,.28)); }
    else { px(ctx,12,14,2,3,"#17202a"); px(ctx,18,14,2,3,"#17202a"); px(ctx,15,18,3,1,darken(p.skin,.28)); }
    px(ctx,10,12,1,3,lighten(p.skin,.22));
  }

  function drawTop(ctx,p,dir,frame) {
    const side=dir==="left"||dir==="right", pri=p.primary, sec=p.secondary, lo=darken(pri,.3), hi=lighten(pri,.2);
    const x=side?11:9,w=side?10:14;
    outlineRect(ctx,x,21,w,9,pri,"#17202a");
    if(p.top===1){px(ctx,x+2,22,2,7,sec);px(ctx,x+w-4,22,2,7,sec)}
    if(p.top===2){px(ctx,x+2,22,w-4,3,sec);px(ctx,x+Math.floor(w/2)-1,25,2,4,lo)}
    if(p.top===3){px(ctx,x+1,22,w-2,2,lo);px(ctx,x+3,25,w-6,3,sec)}
    if(p.top===4){px(ctx,x+2,22,3,7,sec);px(ctx,x+w-5,22,3,7,sec);px(ctx,x+5,22,w-10,2,hi)}
    if(p.top===5){px(ctx,x+2,22,w-4,6,sec);px(ctx,x+2,27,w-4,2,lo)}
    if(p.top===6){px(ctx,x+Math.floor(w/2)-1,21,2,9,sec);px(ctx,x+2,22,2,7,hi)}
    if(p.top===7){px(ctx,x+2,22,w-4,2,lo);px(ctx,x+3,25,w-6,2,sec)}
    if(p.top===8){px(ctx,x+2,22,3,7,sec);px(ctx,x+w-5,22,3,7,lo)}
    const armSwing = frame===1 ? -1 : frame===3 ? 1 : 0;
    if(side){outlineRect(ctx,8,22+armSwing,3,7,p.skin,"#3a2925");outlineRect(ctx,21,22-armSwing,3,7,pri,"#17202a");}
    else {outlineRect(ctx,6,22+armSwing,3,7,p.skin,"#3a2925");outlineRect(ctx,23,22-armSwing,3,7,p.skin,"#3a2925");}
  }

  function drawBottom(ctx,p,dir,frame) {
    const side=dir==="left"||dir==="right", pri=p.primary, sec=p.secondary;
    const c=["#26313d","#355d91","#8b6b48","#374452","#49694b","#e5e7e9","#2c3137","#3b78a7"][p.bottom-1]||sec;
    const skirt=p.base==="female" && [2,3,6,8].includes(p.bottom);
    if(skirt){outlineRect(ctx,10,29,12,4,c,"#17202a");px(ctx,9,32,14,2,darken(c,.22));}
    else outlineRect(ctx,10,29,12,5,c,"#17202a");
    const swing=frame===1?1:frame===3?-1:0;
    if(side){outlineRect(ctx,12,33,4,5+swing,p.skin,"#3a2925");outlineRect(ctx,17,33,4,5-swing,p.skin,"#3a2925");}
    else {outlineRect(ctx,10,33,4,5+swing,p.skin,"#3a2925");outlineRect(ctx,18,33,4,5-swing,p.skin,"#3a2925");}
  }

  function drawShoes(ctx,p,dir,frame){
    const colors=["#d64a43","#3e70b0","#20262e","#81583a","#4d875a","#d9dee4"],c=colors[p.shoes-1]||"#20262e",s=frame===1?1:frame===3?-1:0;
    if(dir==="left"||dir==="right"){outlineRect(ctx,10,37,6,2,c);outlineRect(ctx,17+s,37,6,2,c);} else {outlineRect(ctx,9,37,6,2,c);outlineRect(ctx,17+s,37,6,2,c);}
  }

  function drawAccessory(ctx,p,dir){
    const a=p.accessory, back=dir==="back", side=dir==="left"||dir==="right", pri=p.primary,sec=p.secondary;
    if(a==="cap"){outlineRect(ctx,7,6,18,4,pri,"#17202a");px(ctx,20,9,7,2,sec)}
    else if(a==="glasses"&&!back){outlineRect(ctx,10,13,5,4,"#b9d9ed","#17202a");outlineRect(ctx,17,13,5,4,"#b9d9ed","#17202a");px(ctx,15,14,2,1,"#17202a")}
    else if(a==="headphones"){px(ctx,7,10,3,9,pri);px(ctx,22,10,3,9,pri);px(ctx,9,7,14,2,sec)}
    else if(a==="backpack"){outlineRect(ctx,side?20:7,22,6,10,pri,"#17202a");px(ctx,side?21:8,24,4,2,sec)}
    else if(a==="scarf"){px(ctx,9,20,14,3,pri);px(ctx,20,22,3,7,pri)}
    else if(a==="beret"){outlineRect(ctx,8,6,16,4,pri,"#17202a");px(ctx,11,5,9,2,lighten(pri,.12))}
    else if(a==="shoulderbag"){if(!back){px(ctx,11,20,2,13,sec);outlineRect(ctx,18,28,7,6,pri,"#17202a")}}
  }

  function renderSprite(canvas, rawProfile, direction="front", frame=0) {
    const p=normalize(rawProfile); const ctx=canvas.getContext("2d"); ctx.imageSmoothingEnabled=false; ctx.clearRect(0,0,32,40);
    const right=direction==="right";
    if(right){ctx.save();ctx.translate(32,0);ctx.scale(-1,1);direction="left";}
    shadow(ctx);
    if(p.accessory==="backpack"||p.accessory==="shoulderbag") drawAccessory(ctx,p,direction);
    drawHair(ctx,p,direction); drawHead(ctx,p,direction); drawTop(ctx,p,direction,frame); drawBottom(ctx,p,direction,frame); drawShoes(ctx,p,direction,frame);
    if(!["backpack","shoulderbag"].includes(p.accessory)) drawAccessory(ctx,p,direction);
    if(right) ctx.restore();
  }

  function packetId(){return `${profile.id}:${Date.now()}:${Math.random().toString(16).slice(2)}`;}
  function avatarPacket(){return {type:"avatar:final",id:packetId(),profile:{...profile},time:Date.now()};}
  function broadcastProfile(){const text=JSON.stringify(avatarPacket());for(const ch of channels)if(ch.readyState==="open")try{ch.__ml3dNativeSend(text)}catch{};renderAll();}

  function wireDataChannelPrototype(){
    if(globalThis.__ml3dAvatarFinalWired) return; globalThis.__ml3dAvatarFinalWired=true;
    const nativeSend=RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send=function(data){
      channels.add(this); this.__ml3dNativeSend=(x)=>nativeSend.call(this,x);
      let outgoing=data;
      try{
        const pkt=typeof data==="string"?JSON.parse(data):null;
        if(pkt?.type==="lobby:profile"){
          saveProfile({...profile,name:cleanName(pkt.profile?.name||profile.name)});
          queueMicrotask(()=>{if(this.readyState==="open")try{nativeSend.call(this,JSON.stringify(avatarPacket()))}catch{}});
        }
        if(pkt?.type==="lobby:snapshot"){
          pkt.avatarFinal=Object.fromEntries(remoteProfiles);pkt.avatarFinal[profile.name]=profile;outgoing=JSON.stringify(pkt);
        }
        if(pkt?.type==="lobby:player"){
          const name=cleanName(pkt.player?.name); if(remoteProfiles.has(name))pkt.avatarFinal=remoteProfiles.get(name); outgoing=JSON.stringify(pkt);
        }
      }catch{}
      return nativeSend.call(this,outgoing);
    };
    const nativeAdd=RTCDataChannel.prototype.addEventListener;
    RTCDataChannel.prototype.addEventListener=function(type,listener,options){
      channels.add(this); this.__ml3dNativeSend=(x)=>nativeSend.call(this,x);
      if(type!=="message")return nativeAdd.call(this,type,listener,options);
      const wrapped=(event)=>{
        try{
          const pkt=JSON.parse(event.data);
          if(pkt?.type==="avatar:final"&&pkt.profile){
            if(pkt.id&&seenPackets.has(pkt.id))return; if(pkt.id){seenPackets.add(pkt.id);if(seenPackets.size>180)seenPackets.delete(seenPackets.values().next().value);}
            const incoming=normalize(pkt.profile);remoteProfiles.set(incoming.name,incoming);renderAll();
            for(const ch of channels)if(ch!==this&&ch.readyState==="open")try{nativeSend.call(ch,JSON.stringify(pkt))}catch{}
          } else if(pkt?.type==="lobby:snapshot"&&pkt.avatarFinal){for(const [n,v] of Object.entries(pkt.avatarFinal))remoteProfiles.set(cleanName(n),normalize(v));renderAll();}
          else if(pkt?.type==="lobby:player"&&pkt.avatarFinal){remoteProfiles.set(cleanName(pkt.player?.name),normalize(pkt.avatarFinal));renderAll();}
        }catch{}
        return listener.call(this,event);
      };
      return nativeAdd.call(this,type,wrapped,options);
    };
    const nativeCreate=RTCPeerConnection.prototype.createDataChannel;
    RTCPeerConnection.prototype.createDataChannel=function(...args){const ch=nativeCreate.apply(this,args);wireChannel(ch);return ch;};
    const nativePcAdd=RTCPeerConnection.prototype.addEventListener;
    RTCPeerConnection.prototype.addEventListener=function(type,listener,options){if(type!=="datachannel")return nativePcAdd.call(this,type,listener,options);return nativePcAdd.call(this,type,(e)=>{wireChannel(e.channel);listener.call(this,e);},options);};
    function wireChannel(ch){if(ch.__ml3dFinal)return;ch.__ml3dFinal=true;channels.add(ch);ch.__ml3dNativeSend=(x)=>nativeSend.call(ch,x);ch.addEventListener("open",()=>setTimeout(()=>{if(ch.readyState==="open")try{nativeSend.call(ch,JSON.stringify(avatarPacket()))}catch{}},100));ch.addEventListener("close",()=>channels.delete(ch));}
  }

  function profileForPlayer(el){
    const name=cleanName($(".player-name-text",el)?.textContent?.replace(/ ★$/,""));
    if(el.classList.contains("local"))return profile;
    return remoteProfiles.get(name)||normalize({...DEFAULT,name,primary:"#4a9bd0"});
  }

  function renderPlayer(el){
    const wrap=$(".avatar-wrap",el);if(!wrap)return;wrap.classList.add("ml3d-final-mounted");
    let host=$(".ml3d-avatar-final",wrap);if(!host){host=document.createElement("div");host.className="ml3d-avatar-final";host.append(makeCanvas());wrap.append(host);}
    const canvas=$("canvas",host),id=el.dataset.playerId||"?",x=parseFloat(el.style.left)||0,y=parseFloat(el.style.top)||0,prev=previousPos.get(id)||{};
    let direction=prev.direction||"front",moving=false;
    if(Number.isFinite(prev.x)){const dx=x-prev.x,dy=y-prev.y;if(Math.abs(dx)>.04||Math.abs(dy)>.04){moving=true;direction=Math.abs(dx)>Math.abs(dy)?(dx<0?"left":"right"):(dy<0?"back":"front");}}
    const now=performance.now(),state=renderState.get(id)||{frame:0,last:0};if(moving&&now-state.last>90){state.frame=(state.frame%3)+1;state.last=now;}else if(!moving)state.frame=0;renderState.set(id,state);previousPos.set(id,{x,y,direction});
    renderSprite(canvas,profileForPlayer(el),direction,state.frame);
  }

  function renderAll(){ $$("#playersLayer .player").forEach(renderPlayer); renderEditorPreview(); }

  function optionCanvas(overrides={}){const c=makeCanvas();renderSprite(c,normalize({...profile,...overrides}),"front",0);return c;}
  function section(title,values,field,label){
    const s=document.createElement("div");s.className="avatar-final-section";s.innerHTML=`<strong>${title}</strong>`;const g=document.createElement("div");g.className="avatar-final-options";
    values.forEach(v=>{const b=document.createElement("button");b.type="button";b.className="avatar-final-option"+(profile[field]===v?" selected":"");b.append(optionCanvas({[field]:v}));const t=document.createElement("small");t.textContent=label(v);b.append(t);b.addEventListener("click",()=>{profile=normalize({...profile,[field]:v});buildEditor();renderEditorPreview();});g.append(b);});s.append(g);return s;
  }
  function swatches(title,values,field){
    const s=document.createElement("div");s.className="avatar-final-section";s.innerHTML=`<strong>${title}</strong>`;const g=document.createElement("div");g.className="avatar-final-swatches";
    values.forEach(v=>{const b=document.createElement("button");b.type="button";b.className="avatar-final-swatch"+(profile[field]===v?" selected":"");b.style.background=v;b.title=v;b.addEventListener("click",()=>{profile=normalize({...profile,[field]:v});buildEditor();renderEditorPreview();});g.append(b);});s.append(g);return s;
  }

  function installEditor(){
    const modal=$("#avatarModal .modal-card");if(!modal||modal.dataset.finalAvatar)return;modal.dataset.finalAvatar="1";
    const legacyPreview=$("#avatarPreview");if(legacyPreview)legacyPreview.style.display="none";
    ["#colorChoices","#bodyChoices","#faceChoices","#accessoryChoices"].forEach(sel=>{const e=$(sel);if(e)e.style.display="none";});
    $$("label",modal).forEach(l=>{if(l.htmlFor!=="profileName")l.style.display="none";});
    const oldSave=$("#saveProfile");if(oldSave)oldSave.style.display="none";
    const root=document.createElement("div");root.className="avatar-final-editor";root.innerHTML='<div id="avatarFinalPreview" class="avatar-final-main-preview"></div><div id="avatarFinalBase" class="avatar-final-base-row"></div><div id="avatarFinalControls"></div><button id="saveAvatarFinal" type="button" class="primary avatar-final-save">GUARDAR PERSONAJE</button><p class="avatar-final-note">Se guarda en este dispositivo y se sincroniza con la sala.</p>';
    modal.insertBefore(root,oldSave||null);
    $("#saveAvatarFinal",root).addEventListener("click",()=>{
      const name=cleanName($("#profileName")?.value||profile.name);saveProfile({...profile,name});if($("#profileName"))$("#profileName").value=profile.name;
      if(oldSave)oldSave.click();setTimeout(broadcastProfile,30);renderAll();
    });
    buildEditor();renderEditorPreview();
  }

  function buildEditor(){
    const bases=$("#avatarFinalBase"),box=$("#avatarFinalControls");if(!bases||!box)return;bases.textContent="";box.textContent="";
    [["male","HOMBRE"],["female","MUJER"]].forEach(([v,l])=>{const b=document.createElement("button");b.type="button";b.classList.toggle("selected",profile.base===v);b.append(optionCanvas({base:v}));const span=document.createElement("span");span.textContent=l;b.append(span);b.addEventListener("click",()=>{profile=normalize({...profile,base:v});buildEditor();renderEditorPreview();});bases.append(b);});
    box.append(section("Peinado",CATALOG.hair,"hair",v=>`PELO ${v}`));
    box.append(section("Ropa superior",CATALOG.top,"top",v=>`TOP ${v}`));
    box.append(section("Ropa inferior",CATALOG.bottom,"bottom",v=>`BAJO ${v}`));
    box.append(section("Calzado",CATALOG.shoes,"shoes",v=>`ZAP ${v}`));
    box.append(section("Accesorio",CATALOG.accessory,"accessory",v=>({none:"NADA",cap:"GORRA",glasses:"GAFAS",headphones:"CASCOS",backpack:"MOCHILA",scarf:"BUFANDA",beret:"BOINA",shoulderbag:"BOLSO"}[v])));
    box.append(swatches("Piel",CATALOG.skin,"skin"));box.append(swatches("Pelo · color",CATALOG.hairColor,"hairColor"));box.append(swatches("Color principal",CATALOG.primary,"primary"));box.append(swatches("Color secundario",CATALOG.secondary,"secondary"));
  }

  function renderEditorPreview(){const p=$("#avatarFinalPreview");if(!p)return;let c=$("canvas",p);if(!c){c=makeCanvas();p.append(c);}renderSprite(c,profile,"front",0);}

  function observePlayers(){
    const layer=$("#playersLayer");if(!layer)return;const obs=new MutationObserver((mut)=>{let needed=false;for(const m of mut){if(m.type==="childList"||m.type==="attributes"){needed=true;break;}}if(needed)requestAnimationFrame(renderAll);});obs.observe(layer,{childList:true,subtree:false,attributes:true,attributeFilter:["style","class"]});
    setInterval(renderAll,120);
  }

  wireDataChannelPrototype();
  const boot=()=>{installEditor();observePlayers();renderAll();};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
  window.ML3DAvatarFinal={getProfile:()=>({...profile}),setProfile:(p)=>{saveProfile({...profile,...p});buildEditor();renderAll();broadcastProfile();},renderSprite};
})();
