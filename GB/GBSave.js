(() => {
  "use strict";
  const SAVE_PREFIX="gba-gb-save:";let currentKey=null,currentEmulator=null,saveTimer=null;const saveKey=r=>SAVE_PREFIX+r;
  function saveCurrent(){if(!currentEmulator||!currentKey)return;try{if(typeof currentEmulator.getExtRam!=="function")return;const x=currentEmulator.getExtRam();if(!x||!x.byteLength)return;localStorage.setItem(currentKey,JSON.stringify(Array.from(x)))}catch(e){console.error("No se pudo guardar la partida GB/GBC:",e)}}
  function loadFor(r,g){const x=localStorage.getItem(saveKey(r));if(!x||!g)return;try{const b=new Uint8Array(JSON.parse(x));if(typeof g.loadExtRam==="function")g.loadExtRam(b)}catch(e){console.error("No se pudo restaurar la partida GB/GBC:",e)}}
  const api=window.gbaGB;const originalStart=api&&api.start;const originalStartBuffer=api&&api.startBuffer;
  function attachSaveIdentity(identity,g){currentKey=saveKey(identity);currentEmulator=g;loadFor(identity,g);saveTimer=setInterval(saveCurrent,5000);return g}
  function prepareStart(){if(saveTimer){clearInterval(saveTimer);saveTimer=null}saveCurrent()}
  if(originalStart&&originalStartBuffer){
    api.start=async function(r){prepareStart();const g=await originalStart.call(this,r);if(saveTimer)clearInterval(saveTimer);return attachSaveIdentity(r,g)};
    api.startBuffer=async function(buffer,filename,identity,useLegacySave){prepareStart();const g=await originalStartBuffer.call(this,buffer,filename,identity,useLegacySave);return attachSaveIdentity(identity||filename,g)};
    api.save=saveCurrent;
    const originalStop=api.stop;api.stop=function(){saveCurrent();if(saveTimer){clearInterval(saveTimer);saveTimer=null}currentEmulator=null;currentKey=null;return originalStop.call(this)};
    addEventListener('pagehide',saveCurrent);addEventListener('beforeunload',saveCurrent)
  }
  if(!document.querySelector('script[data-ml3d-developer-tools]')){const p=document.createElement('script');p.src='developer-tools-panels.js?v=final-port-1';p.onload=()=>{const s=document.createElement('script');s.src='developer-tools.js?v=final-port-1';s.dataset.ml3dDeveloperTools='true';s.onload=()=>{const r=document.createElement('script');r.src='ml3d-feature-repair.js?v=final-port-1';r.onload=()=>{const f=document.createElement('script');f.src='ml3d-interaction-fixes.js?v=final-port-1';f.onload=()=>{const a=document.createElement('script');a.src='appearance-selector.js?v=final-port-1';document.head.appendChild(a)};document.head.appendChild(f)};document.head.appendChild(r)};document.head.appendChild(s)};document.head.appendChild(p)}
  if(!document.querySelector('script[data-ml3d-sp-swipe-fix]')){const w=document.createElement('script');w.src='sp-selector-swipe-fix.js?v=final-port-1';w.dataset.ml3dSpSwipeFix='true';document.head.appendChild(w)}
})();
