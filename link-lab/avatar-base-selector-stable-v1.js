(() => {
  'use strict';
  if (window.__ml3dAvatarBaseSelectorStableV1) return;
  window.__ml3dAvatarBaseSelectorStableV1 = true;

  const STYLE_ID='ml3d-avatar-base-selector-stable-style';
  if(!document.getElementById(STYLE_ID)){
    const s=document.createElement('style');
    s.id=STYLE_ID;
    s.textContent=`
      #avatarFinalBase button{position:relative}
      #avatarFinalBase button>canvas.avatar-v3-base-choice-static{
        display:block!important;visibility:visible!important;opacity:1!important;
        position:relative!important;width:40px!important;height:60px!important;flex:0 0 auto;
        image-rendering:pixelated;image-rendering:crisp-edges;pointer-events:none!important;
      }
      #avatarFinalBase button>canvas.avatar-v5-choice{display:none!important;visibility:hidden!important;opacity:0!important}
      @media(max-width:560px){#avatarFinalBase button>canvas.avatar-v3-base-choice-static{width:34px!important;height:51px!important}}
    `;
    document.head.appendChild(s);
  }

  function hasPixels(canvas){
    try{
      const d=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height).data;
      for(let i=3;i<d.length;i+=16) if(d[i]>8) return true;
    }catch{}
    return false;
  }

  function freezeButton(button){
    const live=button.querySelector(':scope > canvas.avatar-v5-choice');
    if(!live||!hasPixels(live)) return false;
    let snap=button.querySelector(':scope > canvas.avatar-v3-base-choice-static');
    if(!snap){
      snap=document.createElement('canvas');
      snap.className='avatar-v3-base-choice-static';
      button.appendChild(snap);
    }
    if(snap.dataset.frozen==='1') return true;
    snap.width=live.width||64;
    snap.height=live.height||96;
    const ctx=snap.getContext('2d');
    ctx.imageSmoothingEnabled=false;
    ctx.clearRect(0,0,snap.width,snap.height);
    ctx.drawImage(live,0,0,snap.width,snap.height);
    snap.dataset.frozen='1';
    return true;
  }

  function freezeAll(){
    const buttons=[...document.querySelectorAll('#avatarFinalBase button')];
    if(!buttons.length) return false;
    let ok=true;
    for(const b of buttons) ok=freezeButton(b)&&ok;
    return ok;
  }

  function attemptFreeze(){
    let tries=0;
    const tick=()=>{
      tries++;
      if(freezeAll()||tries>90) return;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  const observer=new MutationObserver(()=>{
    document.querySelectorAll('#avatarFinalBase button').forEach(b=>{
      if(!b.querySelector(':scope > canvas.avatar-v3-base-choice-static')) attemptFreeze();
    });
  });
  observer.observe(document.body,{childList:true,subtree:true});

  document.addEventListener('click',e=>{
    if(e.target.closest('#avatarButton,#avatarFinalBase button')) setTimeout(attemptFreeze,40);
  });

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',attemptFreeze,{once:true});
  else attemptFreeze();
})();
