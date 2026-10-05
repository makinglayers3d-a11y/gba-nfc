(()=>{
'use strict';

const LEGACY='ml3d-dev-touch-positions';
const PREFIX='ml3d-dev-touch-positions:';
const DEFAULT_TOUCH_POSITIONS={sp:{},custom:{}};
const family=()=>document.body.classList.contains('ml3d-custom-skin')?'custom':'sp';
const profileKey=()=>PREFIX+family();
const clone=v=>JSON.parse(JSON.stringify(v||{}));

if(!localStorage.getItem(PREFIX+'sp')){
  const old=localStorage.getItem(LEGACY);
  if(old)localStorage.setItem(PREFIX+'sp',old);
}

const controls=[...document.querySelectorAll('#controls [data-key]')];
const menuButton=document.getElementById('menu-button');
const canvas=document.getElementById('screen');
const brands=[...document.querySelectorAll('.sp-code-brand,.bottom-brand')];
if(!controls.length||!canvas||!brands.length)return;

brands.forEach(el=>{
  el.style.pointerEvents='auto';
  el.style.touchAction='none';
  el.style.userSelect='none';
  el.style.webkitUserSelect='none';
  el.style.webkitTouchCallout='none';
  el.querySelectorAll('*').forEach(x=>{
    x.style.userSelect='none';
    x.style.webkitUserSelect='none';
    x.style.webkitTouchCallout='none';
    x.draggable=false;
  });
  ['contextmenu','selectstart','dragstart'].forEach(t=>el.addEventListener(t,e=>e.preventDefault()));
});

const style=document.createElement('style');
style.textContent=`
#dev-panel{position:fixed;z-index:10020;width:780px;height:520px;box-sizing:border-box;overflow:hidden;color:#eef7ff;background:linear-gradient(145deg,#07131e,#0a1c2a 56%,#061019);border:1px solid #31536b;border-radius:18px;box-shadow:0 18px 55px #000d,inset 0 1px #ffffff18;font:14px/1.28 system-ui,-apple-system,sans-serif;transform-origin:0 0;user-select:none;-webkit-user-select:none;touch-action:manipulation}#dev-panel[hidden]{display:none!important}
.dev-head{height:66px;box-sizing:border-box;display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid #264457;background:linear-gradient(90deg,#07141f,#0b2231 60%,#081722)}.dev-gear{width:39px;height:39px;border-radius:12px;display:grid;place-items:center;font-size:28px;color:#d6ebff;background:#15334a;border:1px solid #42637b}.dev-title{flex:1;min-width:0}.dev-title strong{display:block;font-size:23px;line-height:1.05;white-space:nowrap}.dev-title strong b{color:#995cff}.dev-title small{display:block;margin-top:4px;color:#91aabd;font-size:12px}.dev-close{width:42px;height:42px;padding:0;border:1px solid #46647a;border-radius:11px;background:#172b3a;color:#fff;font-size:28px;line-height:1;touch-action:manipulation}
.dev-body{height:454px;display:grid;grid-template-columns:275px 1fr;gap:10px;padding:10px;box-sizing:border-box}.dev-nav{height:100%;box-sizing:border-box;padding:7px;border:1px solid #294659;border-radius:13px;background:#07141ec9;overflow:hidden}.dev-nav button{width:100%;height:51px;display:grid;grid-template-columns:40px 1fr;align-items:center;column-gap:9px;margin:0 0 3px;padding:4px 8px;border:1px solid transparent;border-bottom-color:#1d3444;border-radius:8px;background:transparent;color:#edf7ff;text-align:left;touch-action:manipulation}.dev-nav button:last-child{margin-bottom:0}.dev-nav button.on{background:linear-gradient(90deg,#07509c,#0867c9);border-color:#1a91ff;box-shadow:0 0 15px #087fff55}.dev-nav-icon{font-size:25px;text-align:center}.dev-nav-copy{min-width:0}.dev-nav button b{display:block;font-size:13px;white-space:nowrap}.dev-nav button small{display:block;color:#829eaf;font-size:10px;margin-top:1px;white-space:nowrap}.dev-nav button.on small{color:#ccecff}
.dev-pages{height:100%;overflow:hidden}.dev-page{height:100%;display:none}.dev-page.on{display:block}.dev-card{height:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #29475c;border-radius:13px;background:#071621df;overflow:hidden}.dev-card-title{display:flex;align-items:center;gap:8px;margin-bottom:2px}.dev-card-title h3{margin:0;font-size:18px}.dev-eye{font-size:24px}.dev-card-desc{margin:0 0 8px;color:#9db4c4;font-size:11px}.dev-master{margin-left:auto;display:flex;align-items:center;gap:7px;font-weight:700;font-size:12px}.dev-switch{width:42px;height:23px;position:relative;border:0;border-radius:15px;background:#38505f;padding:0;touch-action:manipulation}.dev-switch::after{content:'';position:absolute;left:3px;top:3px;width:17px;height:17px;border-radius:50%;background:#fff;transition:left .12s}.dev-switch.on{background:#087ff2}.dev-switch.on::after{left:22px}
.dev-actions{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin:8px 0}.dev-action{min-height:86px;padding:7px 4px;border:1px solid #496276;border-radius:10px;background:#132736;color:#fff;font-size:11px;font-weight:800;touch-action:manipulation}.dev-action .ico{display:block;font-size:28px;line-height:1;margin-bottom:6px}.dev-action small{display:block;margin-top:3px;color:#9db2c0;font-size:9px;font-weight:500;line-height:1.2}.dev-action.on{background:linear-gradient(180deg,#0763c9,#074b9f);border-color:#1594ff;box-shadow:0 0 12px #087fff66}.dev-action.good{border-color:#168657;background:#0c2f25}.dev-action.danger{border-color:#7e5059}.dev-action.copy{border-color:#148dff;background:#0a3563}
.dev-grid2{display:grid;grid-template-columns:1.08fr .92fr;gap:8px}.dev-box{min-height:164px;box-sizing:border-box;padding:9px;border:1px solid #223e50;border-radius:10px;background:#05121b}.dev-box h4{margin:0 0 7px;font-size:12px}.dev-line{display:flex;align-items:center;gap:7px;margin:7px 0;font-size:10px}.dev-line label{flex:1}.dev-line input[type=range]{width:55%;accent-color:#0c82ff}.dev-line output{width:40px;text-align:right;font-weight:800}.dev-toggle-row{display:flex;align-items:center;justify-content:space-between;margin:7px 0;font-size:10px}.dev-help{font-size:10px;color:#d0dce4}.dev-help ol{margin:4px 0 5px;padding-left:18px}.dev-help li{margin:4px 0}.dev-tip{color:#f7ce42}.dev-status{margin-top:7px;padding:6px 8px;border-radius:7px;background:#04101a;color:#8fb4cd;font-size:9px}.dev-status b{color:#fff}
.dev-page-section{margin-bottom:9px;padding:10px;border:1px solid #29475c;border-radius:10px;background:#07141f}.dev-page-section h3{margin:0 0 6px;font-size:15px}.dev-page-section p{margin:0 0 8px;color:#9db4c4;font-size:10px}.dev-page-row{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.dev-mini-btn{min-height:38px;padding:7px 10px;border:1px solid #496276;border-radius:8px;background:#132736;color:#fff;font-size:10px;font-weight:800;touch-action:manipulation}.dev-mini-btn.on{background:#075ec0;border-color:#168fff}.dev-info-list{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;max-height:328px;overflow:auto}.dev-info-item{padding:7px;border:1px solid #244155;border-radius:7px;background:#06121b;font:9px/1.45 ui-monospace,monospace}.dev-test-list{display:flex;gap:6px;flex-wrap:wrap}.dev-test-key{min-width:54px;padding:7px;border:1px solid #385970;border-radius:8px;background:#102432;text-align:center;font-weight:800;font-size:10px}.dev-test-key.on{background:#0873df;border-color:#42a8ff;box-shadow:0 0 10px #078fff}.dev-data{white-space:pre-wrap;font:10px/1.55 ui-monospace,monospace;color:#bad4e6}
.dev-hitbox{position:fixed;z-index:9990;box-sizing:border-box;border:2px solid #168fff;background:#168fff32;border-radius:8px;color:#fff;font:800 9px/1.18 system-ui;text-shadow:0 1px 3px #000;display:flex;align-items:flex-start;justify-content:center;padding:3px;text-align:center;pointer-events:none;touch-action:none;white-space:pre-line}.dev-hitbox::after{content:'';position:absolute;left:50%;top:50%;width:8px;height:8px;border-radius:50%;background:currentColor;transform:translate(-50%,-50%);box-shadow:0 0 8px currentColor}.dev-hitbox[data-key=A],.dev-hitbox[data-key=LEFT]{color:#38ff91;border-color:#16dc70;background:#16dc7035}.dev-hitbox[data-key=B],.dev-hitbox[data-key=RIGHT]{color:#ff5555;border-color:#ff3030;background:#ff303035}.dev-hitbox[data-key=DOWN]{color:#ffd52f;border-color:#e9a900;background:#e9a90035}.dev-hitbox[data-key=L],.dev-hitbox[data-key=R],.dev-hitbox[data-key=START],.dev-hitbox[data-key=SELECT],.dev-hitbox[data-key=MENU]{color:#a47cff;border-color:#7546ff;background:#7546ff35}.dev-hitbox.editable{pointer-events:auto}.dev-hitbox.unlocking{box-shadow:0 0 0 2px #ff7b18,0 0 15px #ff7b18}.dev-hitbox.moving{box-shadow:0 0 0 2px #f4b41b,0 0 16px #f4b41b}.dev-hitbox.armed{animation:devBlink .48s steps(2,end) infinite;box-shadow:0 0 0 2px #ff3030,0 0 18px #ff3030}.dev-hitbox.hit{filter:brightness(2);box-shadow:0 0 0 2px #087df0,0 0 18px #087df0}.dev-hitbox.hidden{display:none!important}.dev-no-label{font-size:0}.dev-no-label::after{font-size:initial}@keyframes devBlink{50%{opacity:.32}}
.dev-zone-info,.dev-legend,.dev-editbar{position:fixed;z-index:10010;background:#06131ef2;border:1px solid #31536b;border-radius:10px;color:#eaf6ff;font:10px/1.35 system-ui;box-shadow:0 8px 24px #0009}.dev-zone-info{left:max(10px,env(safe-area-inset-left));bottom:calc(54px + env(safe-area-inset-bottom));width:min(42vw,190px);padding:9px}.dev-zone-info h4,.dev-legend h4{margin:0 0 6px;font-size:11px}.dev-zone-info .kv{display:grid;grid-template-columns:58px 1fr;margin:3px 0}.dev-zone-info .kv b{overflow:hidden;text-overflow:ellipsis}.dev-zone-tools{display:flex;gap:4px;margin-top:7px}.dev-zone-tools button{flex:1;background:#173044;color:#fff;border:1px solid #466177;border-radius:5px;padding:5px 2px;font-size:9px;font-weight:800;touch-action:manipulation}.dev-legend{right:max(10px,env(safe-area-inset-right));bottom:calc(54px + env(safe-area-inset-bottom));width:min(36vw,160px);padding:9px}.dev-legend div{margin:3px 0}.dev-dot{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px}.dev-editbar{left:50%;bottom:calc(8px + env(safe-area-inset-bottom));transform:translateX(-50%);padding:7px 14px;min-width:min(86vw,480px);display:flex;gap:12px;justify-content:center;text-align:center}.dev-editbar b{color:#32ee91}.dev-hidden{display:none!important}.dev-grid-overlay{position:fixed;inset:0;z-index:9980;pointer-events:none;background-image:linear-gradient(#38aaff24 1px,transparent 1px),linear-gradient(90deg,#38aaff24 1px,transparent 1px);background-size:24px 24px}
`;
document.head.appendChild(style);

const panel=document.createElement('section');
panel.id='dev-panel';
panel.hidden=true;
panel.innerHTML=`
<header class="dev-head">
  <div class="dev-gear">⚙</div>
  <div class="dev-title"><strong>ML3D Developer <b>• <span id="dev-profile">SP Touch Lab</span></b></strong><small>Herramientas de depuración y ajustes avanzados</small></div>
  <button class="dev-close" type="button" aria-label="Cerrar">×</button>
</header>
<div class="dev-body">
  <nav class="dev-nav">
    <button class="on" data-page="touch"><span class="dev-nav-icon">☝</span><span class="dev-nav-copy"><b>Sensores táctiles</b><small>Ver y ajustar zonas táctiles</small></span></button>
    <button data-page="grid"><span class="dev-nav-icon">▦</span><span class="dev-nav-copy"><b>Cuadrícula</b><small>Mostrar cuadrícula de referencia</small></span></button>
    <button data-page="test"><span class="dev-nav-icon">🎮</span><span class="dev-nav-copy"><b>Pruebas de controles</b><small>Probar entradas en tiempo real</small></span></button>
    <button data-page="info"><span class="dev-nav-icon">ⓘ</span><span class="dev-nav-copy"><b>Información de posición</b><small>Coordenadas y medidas</small></span></button>
    <button data-page="fine"><span class="dev-nav-icon">☷</span><span class="dev-nav-copy"><b>Ajuste fino</b><small>Mover y redimensionar zonas</small></span></button>
    <button data-page="look"><span class="dev-nav-icon">◉</span><span class="dev-nav-copy"><b>Apariencia</b><small>Colores, opacidad y etiquetas</small></span></button>
    <button data-page="system"><span class="dev-nav-icon">▣</span><span class="dev-nav-copy"><b>Sistema</b><small>Datos del navegador y rendimiento</small></span></button>
    <button data-page="extra"><span class="dev-nav-icon">🔧</span><span class="dev-nav-copy"><b>Herramientas extra</b><small>Funciones adicionales</small></span></button>
  </nav>
  <main class="dev-pages">
    <section class="dev-page on" data-view="touch">
      <div class="dev-card">
        <div class="dev-card-title"><span class="dev-eye">◉</span><h3>Sensores táctiles</h3><div class="dev-master"><button id="dev-visible" class="dev-switch"></button><span>Mostrar zonas táctiles</span></div></div>
        <p class="dev-card-desc">Muestra las zonas táctiles de todos los controles. Puedes mover, redimensionar y ajustar la posición de cada zona.</p>
        <div class="dev-actions">
          <button id="dev-lock" class="dev-action on"><span class="ico">🔒</span>Zonas fijas<small>Bloquea todas las zonas</small></button>
          <button id="dev-edit" class="dev-action"><span class="ico">✥</span>Mover zonas<small>Mantén pulsado 3s para liberar</small></button>
          <button id="dev-fix" class="dev-action good"><span class="ico">✓</span>Fijar cambios<small>Aplica la nueva posición</small></button>
          <button id="dev-reset" class="dev-action danger"><span class="ico">↶</span>Restablecer<small>Vuelve a la posición por defecto</small></button>
          <button id="dev-copy" class="dev-action copy"><span class="ico">▣</span>Copiar coordenadas<small>Copia posición y tamaño</small></button>
        </div>
        <div class="dev-grid2">
          <div class="dev-box">
            <h4>Ajustes de visualización</h4>
            <div class="dev-line"><label>Tamaño de zona</label><input id="dev-size" type="range" min="60" max="160" value="100"><output id="dev-size-v">100%</output></div>
            <div class="dev-line"><label>Opacidad (modo edición)</label><input id="dev-opacity" type="range" min="20" max="100" value="70"><output id="dev-opacity-v">70%</output></div>
            <div class="dev-toggle-row"><span>Mostrar etiquetas</span><button id="dev-labels" class="dev-switch on"></button></div>
            <div class="dev-toggle-row"><span>Mostrar coordenadas</span><button id="dev-coords" class="dev-switch on"></button></div>
            <div class="dev-toggle-row"><span>Ajustar a cuadrícula</span><button id="dev-snap" class="dev-switch"></button></div>
            <div class="dev-toggle-row"><span>Mantener proporción</span><button id="dev-ratio" class="dev-switch on"></button></div>
          </div>
          <div class="dev-box dev-help">
            <h4>ⓘ ¿Cómo mover una zona?</h4>
            <ol><li>Mantén pulsado 3 segundos la zona para desbloquear.</li><li>Arrástrala a la nueva posición.</li><li>Puedes redimensionar con Tamaño + / −.</li><li>Pulsa Fijar cambios para guardar.</li></ol>
            <div class="dev-tip">💡 Al desbloquear se emitirá una vibración triple y la zona parpadeará hasta fijarse.</div>
          </div>
        </div>
        <div id="dev-status" class="dev-status">Visualización desactivada</div>
      </div>
    </section>
    <section class="dev-page" data-view="grid"><div class="dev-card"><div class="dev-page-section"><h3>▦ Cuadrícula</h3><p>Activa una referencia visual para alinear con precisión las zonas.</p><div class="dev-page-row"><button id="dev-grid" class="dev-mini-btn">Mostrar cuadrícula</button><label>Separación <input id="dev-grid-size" type="range" min="8" max="64" value="24"> <b id="dev-grid-v">24px</b></label></div></div></div></section>
    <section class="dev-page" data-view="test"><div class="dev-card"><div class="dev-page-section"><h3>🎮 Pruebas de controles</h3><p>Los indicadores se iluminan al pulsar los controles reales del emulador.</p><div id="dev-test-list" class="dev-test-list"></div></div></div></section>
    <section class="dev-page" data-view="info"><div class="dev-card"><div class="dev-page-section"><h3>ⓘ Información de posición</h3><p>Coordenadas y tamaño actual de cada sensor táctil.</p><div id="dev-info-data" class="dev-info-list"></div></div></div></section>
    <section class="dev-page" data-view="fine"><div class="dev-card"><div class="dev-page-section"><h3>☷ Ajuste fino</h3><p>Selecciona una zona con Mover zonas y ajústala píxel a píxel.</p><div class="dev-page-row"><button id="fine-left" class="dev-mini-btn">← X−</button><button id="fine-right" class="dev-mini-btn">X+ →</button><button id="fine-up" class="dev-mini-btn">↑ Y−</button><button id="fine-down" class="dev-mini-btn">Y+ ↓</button><button id="fine-center" class="dev-mini-btn">◎ Centrar</button></div><div class="dev-line"><label>Tamaño seleccionado</label><input id="fine-size" type="range" min="50" max="180" value="100"><output id="fine-size-v">100%</output></div></div></div></section>
    <section class="dev-page" data-view="look"><div class="dev-card"><div class="dev-page-section"><h3>◉ Apariencia</h3><p>Ajusta la visualización de las zonas durante la depuración.</p><div class="dev-line"><label>Opacidad</label><input id="look-opacity" type="range" min="20" max="100" value="70"><output id="look-opacity-v">70%</output></div><div class="dev-page-row"><button id="look-labels" class="dev-mini-btn on">Etiquetas</button><button id="look-coords" class="dev-mini-btn on">Coordenadas</button></div></div></div></section>
    <section class="dev-page" data-view="system"><div class="dev-card"><div class="dev-page-section"><h3>▣ Sistema</h3><div id="dev-system" class="dev-data"></div></div></div></section>
    <section class="dev-page" data-view="extra"><div class="dev-card"><div class="dev-page-section"><h3>🔧 Herramientas extra</h3><p>Exportación y mantenimiento del perfil activo.</p><div class="dev-page-row"><button id="extra-copy" class="dev-mini-btn">Copiar coordenadas</button><button id="dev-realign" class="dev-mini-btn">Releer controles</button><button id="extra-reset" class="dev-mini-btn">Restablecer perfil</button></div></div></div></section>
  </main>
</div>`;
document.body.appendChild(panel);

const $=s=>panel.querySelector(s);
const boxes=new Map();
let saved={};
let visible=false;
let edit=false;
let selected=null;
let labels=true;
let coords=true;
let snap=false;
let ratio=true;
let opacity=.70;
let globalSize=1;

function load(){
  try{
    const local=JSON.parse(localStorage.getItem(profileKey())||'null');
    saved=local||clone(DEFAULT_TOUCH_POSITIONS[family()]);
  }catch(_){saved=clone(DEFAULT_TOUCH_POSITIONS[family()]);}
  $('#dev-profile').textContent=(family()==='sp'?'SP':'Personalizado')+' Touch Lab';
}
load();

function addBox(key,target){
  const b=document.createElement('div');
  b.className='dev-hitbox hidden';
  b.dataset.key=key;
  document.body.appendChild(b);
  boxes.set(key,{b,target,unlocked:false,state:'Fija',base:null});
}
controls.forEach(el=>addBox(el.dataset.key,el));
if(menuButton)addBox('MENU',menuButton);

function profileRect(key,target){
  const p=saved[key];
  if(p)return{left:p.x*innerWidth,top:p.y*innerHeight,width:p.w*innerWidth,height:p.h*innerHeight};
  const r=target.getBoundingClientRect();
  return{left:r.left,top:r.top,width:r.width,height:r.height};
}
function labelFor(key,r){
  if(!labels)return'';
  const name=(key==='MENU'?'MENÚ':key)+' (TÁCTIL)';
  if(edit&&coords)return`${name}\n(${Math.round(r.left)}, ${Math.round(r.top)}) ${Math.round(r.width)}×${Math.round(r.height)}`;
  return name;
}
function applyBoxLabel(key,entry){
  const r=entry.b.getBoundingClientRect();
  entry.b.textContent=labelFor(key,r);
  entry.b.classList.toggle('dev-no-label',!labels);
}
function layout(){
  boxes.forEach((entry,key)=>{
    const r=profileRect(key,entry.target);
    if(!entry.base)entry.base={w:r.width,h:r.height};
    if(!entry.b.classList.contains('moving-now')){
      const w=saved[key]?r.width:(r.width*globalSize);
      const h=saved[key]?r.height:(r.height*globalSize);
      Object.assign(entry.b.style,{left:r.left+'px',top:r.top+'px',width:w+'px',height:h+'px',opacity:String(opacity)});
    }
    entry.b.classList.toggle('hidden',!visible);
    entry.b.classList.toggle('editable',edit);
    applyBoxLabel(key,entry);
  });
  updateInfoPanel();
  refreshPositionPage();
}
function fitPanel(){
  const r=canvas.getBoundingClientRect();
  const scale=Math.max(.1,Math.min(r.width/780,r.height/520));
  const w=780*scale,h=520*scale;
  panel.style.left=(r.left+(r.width-w)/2)+'px';
  panel.style.top=(r.top+(r.height-h)/2)+'px';
  panel.style.transform=`scale(${scale})`;
}
function openPanel(){load();fitPanel();layout();panel.hidden=false;document.body.classList.add('ml3d-dev-open');}
function closePanel(){panel.hidden=true;document.body.classList.remove('ml3d-dev-open');}
function status(t){$('#dev-status').innerHTML=t;}

function show(v){
  visible=v;
  $('#dev-visible').classList.toggle('on',v);
  boxes.forEach(e=>e.b.classList.toggle('hidden',!v));
  layout();
  if(!edit)status(v?'Sensores visibles':'Visualización desactivada');
}
function setState(entry,state){
  entry.state=state;
  entry.b.classList.toggle('unlocking',state==='Desbloqueando (3s)');
  entry.b.classList.toggle('moving',state==='En movimiento');
  entry.b.classList.toggle('armed',state==='Parpadeando');
  updateInfoPanel();
}
function setEdit(v){
  edit=v;
  $('#dev-edit').classList.toggle('on',v);
  $('#dev-lock').classList.toggle('on',!v);
  boxes.forEach(e=>{
    e.b.classList.toggle('editable',v);
    if(!v){e.unlocked=false;setState(e,'Fija');}
  });
  info.classList.toggle('dev-hidden',!v);
  legend.classList.toggle('dev-hidden',!v);
  editbar.classList.toggle('dev-hidden',!v);
  if(v){show(true);status('Mover zonas activo · mantén una zona 3 s para liberarla');}
  else status(visible?'Sensores visibles · zonas fijas':'Visualización desactivada');
  layout();
}
function saveRect(key,b){
  const r=b.getBoundingClientRect();
  saved[key]={x:r.left/innerWidth,y:r.top/innerHeight,w:r.width/innerWidth,h:r.height/innerHeight};
}
function persist(){
  boxes.forEach((e,k)=>saveRect(k,e.b));
  localStorage.setItem(profileKey(),JSON.stringify(saved));
  boxes.forEach(e=>{e.unlocked=false;setState(e,'Fija');});
  setEdit(false);
  status('Cambios fijados en <b>'+(family()==='sp'?'SP':'Personalizado')+'</b>');
}
function reset(){
  saved=clone(DEFAULT_TOUCH_POSITIONS[family()]);
  localStorage.removeItem(profileKey());
  selected=null;
  globalSize=1;
  $('#dev-size').value='100';$('#dev-size-v').textContent='100%';
  boxes.forEach(e=>{e.base=null;e.unlocked=false;setState(e,'Fija');});
  setEdit(false);layout();status('Zonas restablecidas al perfil predeterminado');
}
function exportCoords(){
  const out={profile:family(),viewport:{width:innerWidth,height:innerHeight},positions:{}};
  boxes.forEach((e,k)=>{const r=e.b.getBoundingClientRect();out.positions[k]={x:r.left/innerWidth,y:r.top/innerHeight,w:r.width/innerWidth,h:r.height/innerHeight};});
  const text=JSON.stringify(out,null,2);
  const done=()=>status('Coordenadas copiadas · pégalas en el chat');
  if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).then(done).catch(()=>prompt('Copia estas coordenadas:',text));
  else prompt('Copia estas coordenadas:',text);
}

const info=document.createElement('aside');
info.className='dev-zone-info dev-hidden';
info.innerHTML='<h4>Zona seleccionada</h4><div class="kv">Control:<b id="zi-key">—</b></div><div class="kv">Posición:<b id="zi-pos">—</b></div><div class="kv">Tamaño:<b id="zi-size">—</b></div><div class="kv">Estado:<b id="zi-state">—</b></div><div class="dev-zone-tools"><button id="zi-center">Centrar</button><button id="zi-plus">Tamaño +</button><button id="zi-minus">−</button></div>';
document.body.appendChild(info);
const legend=document.createElement('aside');
legend.className='dev-legend dev-hidden';
legend.innerHTML='<h4>Leyenda de estados</h4><div><i class="dev-dot" style="background:#22d884"></i>Fija</div><div><i class="dev-dot" style="background:#f4b41b"></i>En movimiento</div><div><i class="dev-dot" style="background:#ff7b18"></i>Desbloqueando (3s)</div><div><i class="dev-dot" style="background:#ff3030"></i>Parpadeando</div><div><i class="dev-dot" style="background:#087df0"></i>Pulsada</div>';
document.body.appendChild(legend);
const editbar=document.createElement('div');
editbar.className='dev-editbar dev-hidden';
editbar.innerHTML='<b>● Modo edición: ACTIVO</b><span id="dev-unlocked">Zonas desbloqueadas: 0/'+boxes.size+'</span><span id="dev-res"></span>';
document.body.appendChild(editbar);
const gridOverlay=document.createElement('div');
gridOverlay.className='dev-grid-overlay dev-hidden';
document.body.appendChild(gridOverlay);

function updateInfoPanel(){
  editbar.querySelector('#dev-res').textContent=`Resolución: ${innerWidth} × ${innerHeight}`;
  editbar.querySelector('#dev-unlocked').textContent=`Zonas desbloqueadas: ${[...boxes.values()].filter(e=>e.unlocked).length}/${boxes.size}`;
  if(!selected||!boxes.has(selected)){
    info.querySelector('#zi-key').textContent='—';
    info.querySelector('#zi-pos').textContent='—';
    info.querySelector('#zi-size').textContent='—';
    info.querySelector('#zi-state').textContent='—';
    return;
  }
  const e=boxes.get(selected),r=e.b.getBoundingClientRect();
  info.querySelector('#zi-key').textContent=selected==='MENU'?'MENÚ':selected;
  info.querySelector('#zi-pos').textContent=`(${Math.round(r.left)}, ${Math.round(r.top)})`;
  info.querySelector('#zi-size').textContent=`${Math.round(r.width)} × ${Math.round(r.height)}`;
  info.querySelector('#zi-state').textContent=e.state;
  $('#fine-size-v').textContent=Math.round(r.width)+'px';
}
function resizeSelected(factor){
  if(!selected||!boxes.has(selected))return;
  const e=boxes.get(selected),b=e.b,r=b.getBoundingClientRect();
  const nw=Math.max(20,Math.min(innerWidth,r.width*factor));
  const nh=ratio?Math.max(20,Math.min(innerHeight,r.height*factor)):r.height;
  b.style.left=Math.max(0,Math.min(innerWidth-nw,r.left+(r.width-nw)/2))+'px';
  b.style.top=Math.max(0,Math.min(innerHeight-nh,r.top+(r.height-nh)/2))+'px';
  b.style.width=nw+'px';b.style.height=nh+'px';
  saveRect(selected,b);applyBoxLabel(selected,e);updateInfoPanel();refreshPositionPage();
}
function setSelectedSize(percent){
  if(!selected||!boxes.has(selected))return;
  const e=boxes.get(selected),b=e.b,r=b.getBoundingClientRect();
  if(!e.base)e.base={w:r.width,h:r.height};
  const factor=percent/100;
  const nw=Math.max(20,e.base.w*factor),nh=Math.max(20,(ratio?e.base.h*factor:r.height));
  b.style.left=Math.max(0,Math.min(innerWidth-nw,r.left+(r.width-nw)/2))+'px';
  b.style.top=Math.max(0,Math.min(innerHeight-nh,r.top+(r.height-nh)/2))+'px';
  b.style.width=nw+'px';b.style.height=nh+'px';
  saveRect(selected,b);applyBoxLabel(selected,e);updateInfoPanel();refreshPositionPage();
}
function moveSelected(dx,dy){
  if(!selected||!boxes.has(selected))return;
  const e=boxes.get(selected),b=e.b,r=b.getBoundingClientRect();
  b.style.left=Math.max(0,Math.min(innerWidth-r.width,r.left+dx))+'px';
  b.style.top=Math.max(0,Math.min(innerHeight-r.height,r.top+dy))+'px';
  saveRect(selected,b);applyBoxLabel(selected,e);updateInfoPanel();refreshPositionPage();
}
function centerSelected(){
  if(!selected||!boxes.has(selected))return;
  const e=boxes.get(selected),b=e.b,r=b.getBoundingClientRect();
  b.style.left=(innerWidth-r.width)/2+'px';
  saveRect(selected,b);applyBoxLabel(selected,e);updateInfoPanel();refreshPositionPage();
}
function refreshPositionPage(){
  const host=$('#dev-info-data');if(!host)return;
  host.innerHTML='';
  boxes.forEach((e,k)=>{
    const r=e.b.getBoundingClientRect(),d=document.createElement('div');
    d.className='dev-info-item';
    d.textContent=`${k==='MENU'?'MENÚ':k}\nX ${Math.round(r.left)} · Y ${Math.round(r.top)}\n${Math.round(r.width)} × ${Math.round(r.height)} px\n${e.state}`;
    host.appendChild(d);
  });
}
function selectPage(id){
  panel.querySelectorAll('.dev-nav button').forEach(b=>b.classList.toggle('on',b.dataset.page===id));
  panel.querySelectorAll('.dev-page').forEach(p=>p.classList.toggle('on',p.dataset.view===id));
  if(id==='info')refreshPositionPage();
}
panel.querySelectorAll('.dev-nav button').forEach(b=>b.addEventListener('click',()=>selectPage(b.dataset.page)));

const testList=$('#dev-test-list');
boxes.forEach((_,k)=>{const s=document.createElement('span');s.className='dev-test-key';s.dataset.test=k;s.textContent=k==='MENU'?'MENÚ':k;testList.appendChild(s);});
$('#dev-system').textContent=`Perfil: ${family()==='sp'?'SP':'Personalizado'}\nViewport: ${innerWidth} × ${innerHeight}\nPixel ratio: ${devicePixelRatio||1}\nPlataforma: ${navigator.platform||'—'}\nVibración: ${navigator.vibrate?'disponible':'no disponible'}\nAlmacenamiento: ${profileKey()}`;

$('.dev-close').onclick=closePanel;
$('#dev-visible').onclick=()=>show(!visible);
$('#dev-lock').onclick=()=>setEdit(false);
$('#dev-edit').onclick=()=>setEdit(!edit);
$('#dev-fix').onclick=persist;
$('#dev-reset').onclick=reset;
$('#dev-copy').onclick=exportCoords;
$('#extra-copy').onclick=exportCoords;
$('#extra-reset').onclick=reset;
$('#dev-realign').onclick=()=>{boxes.forEach(e=>e.base=null);layout();status('Posiciones releídas desde la interfaz');};
$('#dev-grid').onclick=()=>{const v=gridOverlay.classList.toggle('dev-hidden');$('#dev-grid').classList.toggle('on',!v);$('#dev-grid').textContent=v?'Mostrar cuadrícula':'Ocultar cuadrícula';};
$('#dev-grid-size').oninput=e=>{const v=+e.target.value;$('#dev-grid-v').textContent=v+'px';gridOverlay.style.backgroundSize=`${v}px ${v}px`;};
$('#dev-size').oninput=e=>{globalSize=+e.target.value/100;$('#dev-size-v').textContent=e.target.value+'%';boxes.forEach((entry,key)=>{if(saved[key])return;const r=entry.target.getBoundingClientRect();entry.b.style.width=r.width*globalSize+'px';entry.b.style.height=r.height*globalSize+'px';applyBoxLabel(key,entry);});};
function setOpacity(v){opacity=+v/100;$('#dev-opacity').value=v;$('#look-opacity').value=v;$('#dev-opacity-v').textContent=v+'%';$('#look-opacity-v').textContent=v+'%';boxes.forEach(e=>e.b.style.opacity=String(opacity));}
$('#dev-opacity').oninput=e=>setOpacity(e.target.value);
$('#look-opacity').oninput=e=>setOpacity(e.target.value);
function toggleButton(btn,state){btn.classList.toggle('on',state);}
$('#dev-labels').onclick=()=>{labels=!labels;toggleButton($('#dev-labels'),labels);toggleButton($('#look-labels'),labels);layout();};
$('#look-labels').onclick=()=>{labels=!labels;toggleButton($('#dev-labels'),labels);toggleButton($('#look-labels'),labels);layout();};
$('#dev-coords').onclick=()=>{coords=!coords;toggleButton($('#dev-coords'),coords);toggleButton($('#look-coords'),coords);layout();};
$('#look-coords').onclick=()=>{coords=!coords;toggleButton($('#dev-coords'),coords);toggleButton($('#look-coords'),coords);layout();};
$('#dev-snap').onclick=()=>{snap=!snap;toggleButton($('#dev-snap'),snap);};
$('#dev-ratio').onclick=()=>{ratio=!ratio;toggleButton($('#dev-ratio'),ratio);};
$('#fine-left').onclick=()=>moveSelected(-1,0);
$('#fine-right').onclick=()=>moveSelected(1,0);
$('#fine-up').onclick=()=>moveSelected(0,-1);
$('#fine-down').onclick=()=>moveSelected(0,1);
$('#fine-center').onclick=centerSelected;
$('#fine-size').oninput=e=>setSelectedSize(+e.target.value);
info.querySelector('#zi-center').onclick=centerSelected;
info.querySelector('#zi-plus').onclick=()=>resizeSelected(1.08);
info.querySelector('#zi-minus').onclick=()=>resizeSelected(.92);

boxes.forEach((entry,key)=>{
  const b=entry.b;
  let timer=0,pid=null,dx=0,dy=0,sx=0,sy=0;
  b.addEventListener('pointerdown',e=>{
    if(!edit)return;
    e.preventDefault();e.stopPropagation();
    selected=key;
    pid=e.pointerId;
    const r=b.getBoundingClientRect();
    dx=e.clientX-r.left;dy=e.clientY-r.top;sx=e.clientX;sy=e.clientY;
    setState(entry,'Desbloqueando (3s)');
    try{b.setPointerCapture(pid);}catch(_){}
    clearTimeout(timer);
    timer=setTimeout(()=>{
      entry.unlocked=true;
      setState(entry,'Parpadeando');
      navigator.vibrate?.([45,55,45,55,45]);
      updateInfoPanel();
    },3000);
  },{passive:false});
  b.addEventListener('pointermove',e=>{
    if(!edit||e.pointerId!==pid)return;
    if(!entry.unlocked){
      if(Math.hypot(e.clientX-sx,e.clientY-sy)>18){clearTimeout(timer);setState(entry,'Fija');}
      return;
    }
    e.preventDefault();
    let x=e.clientX-dx,y=e.clientY-dy;
    if(snap){const g=+$('#dev-grid-size').value;x=Math.round(x/g)*g;y=Math.round(y/g)*g;}
    x=Math.max(0,Math.min(innerWidth-b.offsetWidth,x));
    y=Math.max(0,Math.min(innerHeight-b.offsetHeight,y));
    b.classList.add('moving-now');
    b.style.left=x+'px';b.style.top=y+'px';
    setState(entry,'En movimiento');
    saveRect(key,b);applyBoxLabel(key,entry);updateInfoPanel();refreshPositionPage();
  },{passive:false});
  const end=e=>{
    if(pid!==null&&e.pointerId!==pid)return;
    clearTimeout(timer);pid=null;b.classList.remove('moving-now');
    if(entry.unlocked)setState(entry,'En movimiento');else setState(entry,'Fija');
  };
  b.addEventListener('pointerup',end);b.addEventListener('pointercancel',end);b.addEventListener('lostpointercapture',end);
});

controls.forEach(el=>{
  const k=el.dataset.key;
  el.addEventListener('pointerdown',()=>{
    const x=boxes.get(k);
    if(x&&visible&&!edit){x.b.classList.add('hit');x.state='Pulsada';setTimeout(()=>{x.b.classList.remove('hit');x.state='Fija';},160);}
    testList.querySelector(`[data-test="${CSS.escape(k)}"]`)?.classList.add('on');
  },{passive:true});
  ['pointerup','pointercancel'].forEach(ev=>el.addEventListener(ev,()=>testList.querySelector(`[data-test="${CSS.escape(k)}"]`)?.classList.remove('on'),{passive:true}));
});
if(menuButton){
  menuButton.addEventListener('pointerdown',()=>testList.querySelector('[data-test="MENU"]')?.classList.add('on'),{passive:true});
  ['pointerup','pointercancel'].forEach(ev=>menuButton.addEventListener(ev,()=>testList.querySelector('[data-test="MENU"]')?.classList.remove('on'),{passive:true}));
}

panel.addEventListener('pointerdown',e=>e.stopPropagation());
panel.addEventListener('click',e=>e.stopPropagation());
addEventListener('resize',()=>{fitPanel();layout();});
addEventListener('orientationchange',()=>setTimeout(()=>{fitPanel();layout();},180));
show(false);setEdit(false);fitPanel();

let hold=0;
function activeBrand(b){return family()==='custom'?b.classList.contains('bottom-brand'):b.classList.contains('sp-code-brand');}
brands.forEach(b=>{
  b.addEventListener('pointerdown',e=>{
    if(!activeBrand(b))return;
    e.preventDefault();clearTimeout(hold);
    hold=setTimeout(()=>{openPanel();navigator.vibrate?.(35);},4000);
  },{passive:false});
  ['pointerup','pointercancel','pointerleave'].forEach(t=>b.addEventListener(t,()=>clearTimeout(hold),{passive:true}));
});
})();