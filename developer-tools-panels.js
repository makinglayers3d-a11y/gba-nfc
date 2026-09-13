(()=>{
'use strict';

const TOUCH_DEFAULTS={
  custom:{
    L:{x:0.046875,y:0.4838864985654536,w:0.3125,h:0.06060606060606061},
    R:{x:0.640625,y:0.4838864985654536,w:0.3125,h:0.06060606060606061},
    UP:{x:0.17447916666666666,y:0.5798460945250496,w:0.13541666666666666,h:0.07503607503607504},
    LEFT:{x:0.046875,y:0.6505531652321203,w:0.13541666666666666,h:0.07503607503607504},
    RIGHT:{x:0.3020833333333333,y:0.6505531652321203,w:0.13541666666666666,h:0.07503607503607504},
    DOWN:{x:0.17447916666666666,y:0.721260235939191,w:0.13541666666666666,h:0.07503607503607504},
    B:{x:0.5625,y:0.6981722128511679,w:0.17708333333333334,h:0.09812409812409813},
    A:{x:0.7760416666666666,y:0.5798460945250496,w:0.17708333333333334,h:0.09812409812409813},
    SELECT:{x:0.24479166666666666,y:0.8345358932517135,w:0.23958333333333334,h:0.05483405483405483},
    START:{x:0.515625,y:0.8345358932517135,w:0.23958333333333334,h:0.05483405483405483},
    MENU:{x:0.84375,y:0.024531024531024532,w:0.11979166666666667,h:0.06637806637806638}
  },
  sp:{
    L:{x:0,y:0.4992384256910624,w:0.17500001192092896,h:0.07202982386469325},
    R:{x:0.8250000476837158,y:0.4992384256910624,w:0.17500001192092896,h:0.07202982386469325},
    UP:{x:0.18336226542790732,y:0.6146865558486653,w:0.11197916666666667,h:0.06782106782106782},
    LEFT:{x:0.055584490299224854,y:0.6848484936558668,w:0.10980903108914693,h:0.06649832016805894},
    RIGHT:{x:0.3106770912806193,y:0.6868606721511995,w:0.11197916666666667,h:0.06782106782106782},
    DOWN:{x:0.18459200859069824,y:0.7602453630896013,w:0.11197916666666667,h:0.06782106782106782},
    B:{x:0.5768373807271322,y:0.681633799279063,w:0.14583333333333334,h:0.08080808080808081},
    A:{x:0.7700376510620117,y:0.6543610808137176,w:0.14583333333333334,h:0.08080808080808081},
    SELECT:{x:0.3449942270914714,y:0.8944284678537608,w:0.10999711354573567,h:0.03324514997297895},
    START:{x:0.540986696879069,y:0.8944284678537608,w:0.10999711354573567,h:0.03324514997297895},
    MENU:{x:0.4539930820465088,y:0.5822992145929158,w:0.09199942151705424,h:0.05097803443369239}
  }
};

const LEGACY_SP_DEFAULT={
  L:{x:0,y:0.4992384256910624,w:0.17500001192092896,h:0.07202982386469325},
  R:{x:0.8250000476837158,y:0.4992384256910624,w:0.17500001192092896,h:0.07202982386469325},
  UP:{x:0.1897280216217041,y:0.6264149499317956,w:0.11197916666666667,h:0.06782106782106782},
  LEFT:{x:0.06924190123875935,y:0.6868686868686869,w:0.11197916666666667,h:0.06782106782106782},
  RIGHT:{x:0.2970196803410848,y:0.6851050526892812,w:0.11197916666666667,h:0.06782106782106782},
  DOWN:{x:0.18483797709147134,y:0.7491101902112645,w:0.11197916666666667,h:0.06782106782106782},
  B:{x:0.5768373807271322,y:0.681633799279063,w:0.14583333333333334,h:0.08080808080808081},
  A:{x:0.7700376510620117,y:0.6543610808137176,w:0.14583333333333334,h:0.08080808080808081},
  SELECT:{x:0.3449942270914714,y:0.8944284678537608,w:0.10999711354573567,h:0.03324514997297895},
  START:{x:0.540986696879069,y:0.8944284678537608,w:0.10999711354573567,h:0.03324514997297895},
  MENU:{x:0.4539930820465088,y:0.5822992145929158,w:0.09199942151705424,h:0.05097803443369239}
};

const TOUCH_PREFIX='ml3d-dev-touch-positions:';
Object.entries(TOUCH_DEFAULTS).forEach(([name,positions])=>{
  const key=TOUCH_PREFIX+name;
  const saved=localStorage.getItem(key);
  if(!saved||(name==='sp'&&saved===JSON.stringify(LEGACY_SP_DEFAULT))){
    localStorage.setItem(key,JSON.stringify(positions));
  }
});

const family=()=>document.body.classList.contains('ml3d-custom-skin')?'custom':'sp';
const prefsKey=()=>`ml3d-dev-bottom-panels:${family()}`;
const defaults=()=>({visible:true,info:true,legend:true,infoPos:null,legendPos:null});
function loadPrefs(){try{return Object.assign(defaults(),JSON.parse(localStorage.getItem(prefsKey())||'{}'))}catch(_){return defaults()}}
function savePrefs(p){localStorage.setItem(prefsKey(),JSON.stringify(p))}

const style=document.createElement('style');
style.textContent=`
.dev-zone-info,.dev-legend{pointer-events:auto!important}
.dev-zone-info h4,.dev-legend h4{display:flex;align-items:center;gap:5px;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}
.dev-zone-info h4:active,.dev-legend h4:active{cursor:grabbing}
.ml3d-panel-drag-mark{margin-left:auto;color:#7fa8c3;font-size:10px;font-weight:600}
.ml3d-panel-close{width:19px;height:19px;padding:0;border:1px solid #496579;border-radius:5px;background:#142a39;color:#fff;font:800 12px/1 system-ui;touch-action:manipulation}
.ml3d-user-panel-hidden{display:none!important}
#ml3d-panel-toggle{flex:0 0 auto!important;border:1px solid #527084;border-radius:5px;background:#173044;color:#fff;padding:4px 7px;font:800 9px system-ui;touch-action:manipulation}
#ml3d-panel-toggle.on{background:#075fc8;border-color:#1597ff}
body.sp-skin-test .dev-zone-info{left:max(8px,env(safe-area-inset-left));right:auto;top:auto;bottom:calc(48px + env(safe-area-inset-bottom))}
body.sp-skin-test .dev-legend{left:auto;right:max(8px,env(safe-area-inset-right));top:auto;bottom:calc(48px + env(safe-area-inset-bottom))}
body.ml3d-custom-skin .dev-zone-info{left:max(10px,env(safe-area-inset-left));right:auto;top:auto;bottom:calc(54px + env(safe-area-inset-bottom))}
body.ml3d-custom-skin .dev-legend{left:auto;right:max(10px,env(safe-area-inset-right));top:auto;bottom:calc(54px + env(safe-area-inset-bottom))}
`;
document.head.appendChild(style);

function install(){
  const panel=document.getElementById('dev-panel');
  const info=document.querySelector('.dev-zone-info');
  const legend=document.querySelector('.dev-legend');
  const bar=document.querySelector('.dev-editbar');
  if(!panel||!info||!legend||!bar||bar.dataset.ml3dPanelsInstalled)return false;
  bar.dataset.ml3dPanelsInstalled='true';

  let prefs=loadPrefs();
  const toggle=document.createElement('button');
  toggle.id='ml3d-panel-toggle';
  toggle.type='button';
  bar.appendChild(toggle);

  const panelOpen=()=>!panel.hidden;
  const movementActive=()=>!bar.classList.contains('dev-hidden');

  function applyPosition(el,pos){
    if(!pos){
      ['left','top','right','bottom'].forEach(prop=>el.style.removeProperty(prop));
      return;
    }
    const r=el.getBoundingClientRect();
    const x=Math.max(4,Math.min(innerWidth-r.width-4,pos.x*innerWidth));
    const y=Math.max(4,Math.min(innerHeight-r.height-4,pos.y*innerHeight));
    Object.assign(el.style,{left:x+'px',top:y+'px',right:'auto',bottom:'auto'});
  }

  function apply(){
    prefs=loadPrefs();
    const editing=panelOpen()&&movementActive();
    const enabled=prefs.visible&&(prefs.info||prefs.legend);
    info.classList.toggle('ml3d-user-panel-hidden',!editing||!prefs.visible||!prefs.info);
    legend.classList.toggle('ml3d-user-panel-hidden',!editing||!prefs.visible||!prefs.legend);
    toggle.classList.toggle('on',enabled);
    toggle.textContent=enabled?'Paneles ON':'Paneles OFF';
    applyPosition(info,prefs.infoPos);
    applyPosition(legend,prefs.legendPos);
  }

  function setBoth(v){
    prefs=loadPrefs();
    prefs.visible=v;
    if(v){prefs.info=true;prefs.legend=true}
    savePrefs(prefs);
    apply();
  }
  toggle.onclick=e=>{e.stopPropagation();setBoth(!(prefs.visible&&(prefs.info||prefs.legend)))};

  function decorate(el,kind){
    const h=el.querySelector('h4');
    if(!h)return;
    const mark=document.createElement('span');mark.className='ml3d-panel-drag-mark';mark.textContent='↕ mover';
    const close=document.createElement('button');close.className='ml3d-panel-close';close.type='button';close.textContent='×';close.setAttribute('aria-label','Ocultar panel');
    h.append(mark,close);
    close.addEventListener('pointerdown',e=>e.stopPropagation());
    close.onclick=e=>{
      e.stopPropagation();
      prefs=loadPrefs();
      prefs[kind]=false;
      savePrefs(prefs);
      apply();
    };

    let pid=null,dx=0,dy=0;
    h.addEventListener('pointerdown',e=>{
      if(e.target.closest('.ml3d-panel-close')||!panelOpen()||!movementActive())return;
      e.preventDefault();e.stopPropagation();
      const r=el.getBoundingClientRect();pid=e.pointerId;dx=e.clientX-r.left;dy=e.clientY-r.top;
      Object.assign(el.style,{left:r.left+'px',top:r.top+'px',right:'auto',bottom:'auto'});
      try{h.setPointerCapture(pid)}catch(_){}
    },{passive:false});
    h.addEventListener('pointermove',e=>{
      if(pid===null||e.pointerId!==pid)return;
      e.preventDefault();e.stopPropagation();
      const r=el.getBoundingClientRect();
      const x=Math.max(4,Math.min(innerWidth-r.width-4,e.clientX-dx));
      const y=Math.max(4,Math.min(innerHeight-r.height-4,e.clientY-dy));
      el.style.left=x+'px';el.style.top=y+'px';
    },{passive:false});
    const end=e=>{
      if(pid===null||(e&&e.pointerId!==pid))return;
      const r=el.getBoundingClientRect();pid=null;
      prefs=loadPrefs();
      prefs[kind+'Pos']={x:r.left/innerWidth,y:r.top/innerHeight};
      savePrefs(prefs);
    };
    h.addEventListener('pointerup',end);h.addEventListener('pointercancel',end);h.addEventListener('lostpointercapture',end);
  }
  decorate(info,'info');decorate(legend,'legend');

  const classObserver=new MutationObserver(()=>apply());
  classObserver.observe(info,{attributes:true,attributeFilter:['class']});
  classObserver.observe(legend,{attributes:true,attributeFilter:['class']});
  classObserver.observe(bar,{attributes:true,attributeFilter:['class']});

  const panelObserver=new MutationObserver(()=>{
    if(panel.hidden){
      const edit=document.querySelector('#dev-edit');
      if(edit?.classList.contains('on'))document.querySelector('#dev-lock')?.click();
      info.classList.add('dev-hidden');
      legend.classList.add('dev-hidden');
      bar.classList.add('dev-hidden');
    }
    apply();
  });
  panelObserver.observe(panel,{attributes:true,attributeFilter:['hidden']});

  new MutationObserver(()=>apply()).observe(document.body,{attributes:true,attributeFilter:['class']});
  addEventListener('resize',apply);
  addEventListener('orientationchange',()=>setTimeout(apply,180));
  apply();

  ['#dev-reset','#extra-reset'].forEach(sel=>{
    const btn=document.querySelector(sel);if(!btn)return;
    btn.addEventListener('click',()=>{
      const name=family();
      setTimeout(()=>localStorage.setItem(TOUCH_PREFIX+name,JSON.stringify(TOUCH_DEFAULTS[name])),0);
    });
  });
  return true;
}

if(!install()){
  const mo=new MutationObserver(()=>{if(install())mo.disconnect()});
  mo.observe(document.documentElement,{childList:true,subtree:true});
}
})();
