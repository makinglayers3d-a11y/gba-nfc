(() => {
'use strict';
if(window.__ml3dAvatarCustomizerV3Unified)return;window.__ml3dAvatarCustomizerV3Unified=true;
const C=()=>window.ML3DAvatarCompositor;
const HAIR_OPTIONS=[0,1,2,3,4,5,6,7,8,9];
const PALETTES={
skin:['#f6d6bc','#efc3a1','#d89c73','#b8754c','#8b5537','#5b3425'],
hairColor:['#2b211c','#4a3024','#7c4d31','#8b3441','#e4b842','#dfe4ea','#40558d','#c33d49']
};
let lastProfile='',readyOnce=false,lastPaint=0,hairDraft=null;
const profile=()=>C()?.profile?.()||{};
function apply(patch){C()?.setProfile?.(patch);lastProfile='';setTimeout(()=>{C()?.paintPreview?.();C()?.paintLobby?.();refresh(true)},0)}
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function savedHairAdjust(){
  const p=profile();
  return{
    x:clamp(Number(p.hairOffsetX)||0,-24,24),
    y:clamp(Number(p.hairOffsetY)||0,-24,24),
    scale:clamp(Number(p.hairScale)||1,.45,2)
  };
}
function ensureHairDraft(){if(!hairDraft)hairDraft=savedHairAdjust();return hairDraft}
function updateHairCalibratorLabels(root){
  const d=ensureHairDraft();
  root.querySelector('[data-hair-x]').textContent=`X ${d.x>0?'+':''}${d.x}`;
  root.querySelector('[data-hair-y]').textContent=`Y ${d.y>0?'+':''}${d.y}`;
  root.querySelector('[data-hair-scale]').textContent=`${Math.round(d.scale*100)}%`;
}
function previewHairChange(dx=0,dy=0,ds=0){
  const d=ensureHairDraft();
  d.x=clamp(d.x+dx,-24,24);
  d.y=clamp(d.y+dy,-24,24);
  d.scale=Math.round(clamp(d.scale+ds,.45,2)*100)/100;
  C()?.setPreviewHairAdjust?.(d);
  C()?.paintPreview?.();
  const root=document.querySelector('.avatar-hair-calibrator');if(root)updateHairCalibratorLabels(root);
}
function ensureHairCalibrator(){
  const preview=document.getElementById('avatarFinalPreview');if(!preview)return null;
  let root=preview.querySelector(':scope > .avatar-hair-calibrator');
  if(root){updateHairCalibratorLabels(root);return root}
  root=document.createElement('div');root.className='avatar-hair-calibrator';
  root.innerHTML=`
    <div class="avatar-hair-calibrator-title">AJUSTAR PELO</div>
    <div class="avatar-hair-calibrator-values">
      <span data-hair-x>X 0</span><span data-hair-y>Y 0</span><span data-hair-scale>100%</span>
    </div>
    <div class="avatar-hair-calibrator-dpad">
      <button type="button" data-hair-move="up" aria-label="Subir pelo">▲</button>
      <button type="button" data-hair-move="left" aria-label="Mover pelo a la izquierda">◀</button>
      <button type="button" data-hair-center aria-label="Centro">•</button>
      <button type="button" data-hair-move="right" aria-label="Mover pelo a la derecha">▶</button>
      <button type="button" data-hair-move="down" aria-label="Bajar pelo">▼</button>
    </div>
    <div class="avatar-hair-calibrator-size">
      <button type="button" data-hair-size="-">−</button>
      <span>TAMAÑO</span>
      <button type="button" data-hair-size="+">+</button>
    </div>
    <div class="avatar-hair-calibrator-actions">
      <button type="button" data-hair-reset>RESET</button>
      <button type="button" data-hair-apply>CLONAR AL PERSONAJE</button>
    </div>`;
  preview.append(root);
  root.addEventListener('click',e=>{
    const move=e.target.closest('[data-hair-move]');
    if(move){
      const dir=move.dataset.hairMove;
      if(dir==='up')previewHairChange(0,-1,0);
      if(dir==='down')previewHairChange(0,1,0);
      if(dir==='left')previewHairChange(-1,0,0);
      if(dir==='right')previewHairChange(1,0,0);
      return;
    }
    const size=e.target.closest('[data-hair-size]');
    if(size){previewHairChange(0,0,size.dataset.hairSize==='+'?.05:-.05);return}
    if(e.target.closest('[data-hair-center]')){
      hairDraft={x:0,y:0,scale:ensureHairDraft().scale};
      C()?.setPreviewHairAdjust?.(hairDraft);C()?.paintPreview?.();updateHairCalibratorLabels(root);return;
    }
    if(e.target.closest('[data-hair-reset]')){
      hairDraft={x:0,y:0,scale:1};
      C()?.setPreviewHairAdjust?.(hairDraft);C()?.paintPreview?.();updateHairCalibratorLabels(root);return;
    }
    if(e.target.closest('[data-hair-apply]')){
      const d=ensureHairDraft();
      C()?.setPreviewHairAdjust?.(null);
      apply({hairOffsetX:d.x,hairOffsetY:d.y,hairScale:d.scale});
      hairDraft=null;
      return;
    }
  });
  updateHairCalibratorLabels(root);
  return root;
}
function ensureEditor(){
  const base=document.getElementById('avatarFinalBase');if(!base||!base.parentElement)return null;
  let panel=document.getElementById('avatarCustomizerV3');if(panel)return panel;
  panel=document.createElement('section');panel.id='avatarCustomizerV3';
  panel.innerHTML='<div class="avatar-v3-skin"></div><div class="avatar-v3-tabs"></div><div class="avatar-v3-options"></div><div class="avatar-v3-colors"></div><p class="avatar-v3-status"></p>';
  base.insertAdjacentElement('afterend',panel);
  const tabs=panel.querySelector('.avatar-v3-tabs'),b=document.createElement('button');
  b.type='button';b.dataset.kind='hair';b.textContent='PELO';b.classList.add('active');tabs.append(b);
  return panel;
}
function colorControl(host,label,field,palette){
  const p=profile(),row=document.createElement('div');row.className='avatar-v3-color-control';
  const head=document.createElement('div');head.className='avatar-v3-color-head';head.innerHTML=`<b>${label}</b><span>${p[field]||palette[0]}</span>`;row.append(head);
  const sw=document.createElement('div');sw.className='avatar-v3-swatches';
  palette.forEach(v=>{const b=document.createElement('button');b.type='button';b.className='avatar-v3-swatch'+(String(p[field]).toLowerCase()===v.toLowerCase()?' selected':'');b.style.setProperty('--sw',v);b.title=v;b.onclick=()=>apply({[field]:v});sw.append(b)});
  const pick=document.createElement('input');pick.type='color';pick.className='avatar-v3-picker';pick.value=/^#[0-9a-f]{6}$/i.test(p[field]||'')?p[field]:palette[0];pick.oninput=e=>apply({[field]:e.target.value});sw.append(pick);
  row.append(sw);host.append(row);
}
function renderOptions(host){
  host.textContent='';const p=profile();
  for(const v of HAIR_OPTIONS){
    const b=document.createElement('button');b.type='button';b.dataset.kind='hair';b.className='avatar-v3-option'+(String(p.hair)===String(v)?' selected':'');
    if(v===0){
      b.dataset.noHair='1';
      const empty=document.createElement('div');empty.className='avatar-v3-no-hair';empty.textContent='Ø';b.append(empty);
    }else{
      const thumb=C()?.thumbFor?.('hair',v);if(thumb){thumb.className='avatar-v3-thumb';b.append(thumb)}
    }
    const s=document.createElement('small');s.textContent=v===0?'SIN PELO':String(v);b.append(s);b.onclick=()=>apply({hair:v});host.append(b);
  }
}
function refresh(rebuild=false){
  const panel=ensureEditor();if(!panel)return;const p=profile();ensureHairCalibrator();
  if(rebuild){
    const skin=panel.querySelector('.avatar-v3-skin');skin.textContent='';colorControl(skin,'TONO DE PIEL','skin',PALETTES.skin);
    renderOptions(panel.querySelector('.avatar-v3-options'));
    const colors=panel.querySelector('.avatar-v3-colors');colors.textContent='';colorControl(colors,'COLOR DE PELO','hairColor',PALETTES.hairColor);
  }
  panel.querySelector('.avatar-v3-status').textContent=C()?.ready?.()?'Vista previa aplicada al personaje grande.':'Cargando atlas de pelo…';lastProfile=JSON.stringify(p);
}
function wire(){document.addEventListener('click',e=>{if(e.target.closest('#avatarButton,#avatarFinalBase button,#saveAvatarFinal'))setTimeout(()=>{ensureEditor();C()?.paintPreview?.();refresh(true)},30)})}
function loop(ts){
  const comp=C();
  if(comp?.ready?.()){
    if(!readyOnce){readyOnce=true;refresh(true)}
    if(ts-lastPaint>42){lastPaint=ts;comp.paintLobby?.();comp.paintPreview?.()}
    const k=JSON.stringify(profile());if(k!==lastProfile)refresh(true);
  }else ensureEditor();
  requestAnimationFrame(loop);
}
function boot(){ensureEditor();ensureHairCalibrator();refresh(true);wire();requestAnimationFrame(loop)}
window.ML3DAvatarCustomizerV3={profile,setProfile:apply,refresh};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();