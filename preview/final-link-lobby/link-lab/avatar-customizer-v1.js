(() => {
  'use strict';
  if (window.__ml3dAvatarCustomizerV3Loader) return;
  window.__ml3dAvatarCustomizerV3Loader = true;

  const root=document.documentElement;
  let loading=false,loaded=false,compositorLoading=false,thumbsLoading=false,thumbsLoaded=false,stableLoading=false,stableLoaded=false;

  function ensureStyle(){
    if(document.querySelector('link[data-ml3d-avatar-unified]'))return;
    const l=document.createElement('link');l.rel='stylesheet';l.href='./avatar-customizer-v3.css?v=14';l.dataset.ml3dAvatarUnified='1';document.head.appendChild(l);
  }
  function fallback(error){console.error('[ML3D avatar] Fallo al cargar personalizador modular.',error||'unknown');root.classList.remove('ml3d-avatar-v3-active');root.classList.add('ml3d-avatar-base-only');window.__ML3DAvatarCustomizerMode='base-only-safe';}
  function loadV3(){
    if(loading||loaded||!document.getElementById('avatarFinalBase'))return;
    if(!window.ML3DAvatarCompositor){loadCompositor();return;}
    if(!thumbsLoaded){loadThumbs();return;}
    if(!stableLoaded){loadStableBaseSelector();return;}
    ensureStyle();loading=true;root.classList.remove('ml3d-avatar-base-only');root.classList.add('ml3d-avatar-v3-active');window.__ML3DAvatarCustomizerMode='unified-v3-loading';
    const s=document.createElement('script');s.src='./avatar-customizer-v3.js?v=13';s.defer=true;
    s.onload=()=>{loading=false;loaded=true;window.__ML3DAvatarCustomizerMode='unified-v3';window.ML3DAvatarCustomizerV3?.refresh?.(true)};
    s.onerror=e=>{loading=false;fallback(e)};document.head.appendChild(s);
  }
  function loadStableBaseSelector(){
    if(window.__ml3dAvatarBaseSelectorStableV1){stableLoaded=true;loadV3();return;}
    if(stableLoading)return;
    stableLoading=true;
    const s=document.createElement('script');s.src='./avatar-base-selector-stable-v1.js?v=1';s.defer=true;
    s.onload=()=>{stableLoading=false;stableLoaded=true;loadV3()};
    s.onerror=e=>{stableLoading=false;fallback(e)};
    document.head.appendChild(s);
  }
  function loadThumbs(){
    if(window.__ml3dAvatarAssetThumbsV2){thumbsLoaded=true;loadStableBaseSelector();return;}
    if(thumbsLoading)return;
    thumbsLoading=true;
    const s=document.createElement('script');s.src='./avatar-asset-thumbs-v1.js?v=5';s.defer=true;
    s.onload=()=>{thumbsLoading=false;thumbsLoaded=true;loadStableBaseSelector()};
    s.onerror=e=>{thumbsLoading=false;fallback(e)};
    document.head.appendChild(s);
  }
  function loadCompositor(){
    if(window.ML3DAvatarCompositor){loadThumbs();return;}if(compositorLoading)return;compositorLoading=true;ensureStyle();
    const s=document.createElement('script');s.src='./avatar-compositor-v1.js?v=16';s.defer=true;s.onload=()=>{compositorLoading=false;loadThumbs()};s.onerror=e=>{compositorLoading=false;fallback(e)};document.head.appendChild(s);
  }
  function wait(){
    if(document.getElementById('avatarFinalBase')){requestAnimationFrame(()=>setTimeout(loadCompositor,80));return;}
    const ob=new MutationObserver(()=>{if(!document.getElementById('avatarFinalBase'))return;ob.disconnect();requestAnimationFrame(()=>setTimeout(loadCompositor,80));});ob.observe(document.body,{childList:true,subtree:true});
  }
  function boot(){root.classList.remove('ml3d-avatar-base-only');root.classList.add('ml3d-avatar-v3-active');ensureStyle();wait();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
