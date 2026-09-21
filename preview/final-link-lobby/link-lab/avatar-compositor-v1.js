(() => {
'use strict';
if(window.__ml3dAvatarCompositorV1)return;window.__ml3dAvatarCompositorV1=true;

const HAIR_W=32,HAIR_H=32;
const HAIR_ATLAS='./assets/avatar-modular/hair-atlas-v1.png?v=3';
const PILOT_HAIR_ATLAS='./assets/avatar-modular/hair-pilot-v3-base-exact.png?v=1';
const PILOT_GRID=4;
const PILOT_DIR_ROW={down:0,up:1,left:2,right:3};
const HAIR_DR={down:0,left:1,right:2,up:3};
const DEF={skin:'#efc3a1',hair:1,hairColor:'#4a3024',hairOffsetX:0,hairOffsetY:0,hairScale:1};
const api=()=>window.ML3DAvatarFinal;
const clamp=n=>Math.max(0,Math.min(255,Math.round(n)));
const rgb=h=>{const n=parseInt(String(h||'#fff').replace('#','').padEnd(6,'f'),16)||0xffffff;return{r:(n>>16)&255,g:(n>>8)&255,b:n&255}};
const light=(h,a=.3)=>{const c=rgb(h);return'#'+[c.r,c.g,c.b].map(v=>clamp(v+(255-v)*a).toString(16).padStart(2,'0')).join('')};

function profile(){
  return {...DEF,...(api()?.getProfile?.()||{})};
}
const setProfile=patch=>api()?.setProfile?.(patch);

let hairAtlas=null,pilotHairAtlas=null,pilotReady=false,ready=false,previewHairAdjust=null;
const raw=new Map(),tinted=new Map();
const hairNumber=(v,fallback,min,max)=>{const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback};
function hairAdjust(p,override=null){
  const source=override||p||{};
  return{
    x:hairNumber(source.x??source.hairOffsetX,0,-24,24),
    y:hairNumber(source.y??source.hairOffsetY,0,-24,24),
    scale:hairNumber(source.scale??source.hairScale,1,.45,2)
  };
}

function load(){
  return new Promise(res=>{
    const h=new Image();
    h.decoding='async';
    h.onload=()=>{
      hairAtlas=h;ready=true;raw.clear();tinted.clear();
      const p=new Image();
      p.decoding='async';
      p.onload=()=>{pilotHairAtlas=p;pilotReady=true;raw.clear();tinted.clear();paintPreview();paintLobby()};
      p.onerror=()=>{pilotHairAtlas=null;pilotReady=false};
      p.src=PILOT_HAIR_ATLAS;
      res(true);
    };
    h.onerror=()=>{console.error('[ML3D avatar] No se pudo cargar hair-atlas-v1.png');res(false)};
    h.src=HAIR_ATLAS;
  });
}

function hairRect(v,d,f){
  const n=Number(v);
  if(!Number.isFinite(n)||n<=0)return null;
  const i=Math.max(0,Math.min(8,n-1));
  const frame=Math.max(0,Math.min(3,+f||0));
  return{x:(i*4+frame)*HAIR_W,y:(HAIR_DR[d]??0)*HAIR_H};
}
function pilotRect(d,f){
  if(!pilotReady||!pilotHairAtlas)return null;
  const row=PILOT_DIR_ROW[d]??0;
  const col=Math.max(0,Math.min(PILOT_GRID-1,+f||0));
  const sx=Math.round(pilotHairAtlas.naturalWidth*col/PILOT_GRID);
  const ex=Math.round(pilotHairAtlas.naturalWidth*(col+1)/PILOT_GRID);
  const sy=Math.round(pilotHairAtlas.naturalHeight*row/PILOT_GRID);
  const ey=Math.round(pilotHairAtlas.naturalHeight*(row+1)/PILOT_GRID);
  return{x:sx,y:sy,w:Math.max(1,ex-sx),h:Math.max(1,ey-sy)};
}

function keepMainComponent(canvas){
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const im=ctx.getImageData(0,0,canvas.width,canvas.height),data=im.data,w=canvas.width,h=canvas.height;
  const visited=new Uint8Array(w*h),queue=new Int32Array(w*h);
  let best=null;
  const opaque=i=>data[i*4+3]>=12;
  for(let start=0;start<w*h;start++){
    if(visited[start]||!opaque(start))continue;
    let head=0,tail=0;queue[tail++]=start;visited[start]=1;
    const pixels=[];
    while(head<tail){
      const idx=queue[head++],x=idx%w,y=(idx/w)|0;
      pixels.push(idx);
      for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
        if(!ox&&!oy)continue;
        const nx=x+ox,ny=y+oy;if(nx<0||nx>=w||ny<0||ny>=h)continue;
        const ni=ny*w+nx;if(visited[ni]||!opaque(ni))continue;
        visited[ni]=1;queue[tail++]=ni;
      }
    }
    if(!best||pixels.length>best.length)best=pixels;
  }
  if(!best){ctx.clearRect(0,0,w,h);return}
  const keep=new Uint8Array(w*h);for(const i of best)keep[i]=1;
  for(let i=0;i<w*h;i++)if(!keep[i])data[i*4+3]=0;
  ctx.putImageData(im,0,0);
}

function rawHair(v,d='down',f=0){
  if(!ready)return null;
  const n=Number(v);
  const key=[v,d,f,pilotReady&&n===1?'pilot':'main'].join('|');
  if(raw.has(key))return raw.get(key);
  const c=document.createElement('canvas');
  const pilot=n===1&&pilotReady;
  c.width=pilot?64:HAIR_W;
  c.height=pilot?96:HAIR_H;
  const x=c.getContext('2d',{willReadFrequently:true});
  x.imageSmoothingEnabled=false;
  if(pilot){
    const pr=pilotRect(d,f);if(!pr)return null;
    x.drawImage(pilotHairAtlas,pr.x,pr.y,pr.w,pr.h,0,0,64,96);
  }else{
    const r=hairRect(v,d,f);if(!r)return null;
    x.drawImage(hairAtlas,r.x,r.y,HAIR_W,HAIR_H,0,0,HAIR_W,HAIR_H);
    keepMainComponent(c);
  }
  raw.set(key,c);
  return c;
}

function tintHair(v,d,f,pri,acc){
  const key=[v,d,f,pri,acc].join('|');
  if(tinted.has(key))return tinted.get(key);
  const s=rawHair(v,d,f);if(!s)return null;
  const c=document.createElement('canvas');c.width=s.width;c.height=s.height;
  const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(s,0,0);
  const im=x.getImageData(0,0,c.width,c.height),dd=im.data,p=rgb(pri),a=rgb(acc||light(pri));
  for(let i=0;i<dd.length;i+=4){
    if(dd[i+3]<8)continue;
    const lum=(dd[i]+dd[i+1]+dd[i+2])/3;
    if(lum<34){const q=clamp(8+lum*.45);dd[i]=dd[i+1]=dd[i+2]=q;continue}
    const t=Math.max(0,Math.min(1,(lum-130)/110)),sh=.42+(lum/255)*.78;
    dd[i]=clamp((p.r+(a.r-p.r)*t)*sh);
    dd[i+1]=clamp((p.g+(a.g-p.g)*t)*sh);
    dd[i+2]=clamp((p.b+(a.b-p.b)*t)*sh);
  }
  x.putImageData(im,0,0);tinted.set(key,c);return c;
}

function skin(base,color){
  const o=document.createElement('canvas');o.width=base.width;o.height=base.height;
  const bi=base.getContext('2d',{willReadFrequently:true}).getImageData(0,0,base.width,base.height),ox=o.getContext('2d',{willReadFrequently:true}),di=ox.createImageData(base.width,base.height),co=rgb(color);
  for(let i=0;i<bi.data.length;i+=4){
    const r=bi.data[i],g=bi.data[i+1],b=bi.data[i+2],a=bi.data[i+3];
    if(a<15||!(r>g*1.02&&g>b*.96&&r>70&&(r-b)>10))continue;
    const sh=Math.max(.52,Math.min(1.34,(r*.299+g*.587+b*.114)/185));
    di.data[i]=clamp(co.r*sh);di.data[i+1]=clamp(co.g*sh);di.data[i+2]=clamp(co.b*sh);di.data[i+3]=a;
  }
  ox.putImageData(di,0,0);return o;
}

function baseBounds(base){
  const ctx=base.getContext('2d',{willReadFrequently:true});
  const data=ctx.getImageData(0,0,base.width,base.height).data;
  let x0=base.width,y0=base.height,x1=-1,y1=-1;
  for(let y=0;y<base.height;y++)for(let x=0;x<base.width;x++){
    if(data[(y*base.width+x)*4+3]<12)continue;
    x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);
  }
  if(x1<x0)return{x:0,y:0,w:base.width,h:base.height};
  return{x:x0,y:y0,w:x1-x0+1,h:y1-y0+1};
}

function drawHairFixed(ctx,piece,base,p=profile(),override=null){
  if(!piece)return;
  if(Number(p.hair)===1&&pilotReady&&piece.width===64&&piece.height===96){
    ctx.drawImage(piece,0,0,64,96,0,0,64,96);
    return;
  }
  const b=baseBounds(base),adj=hairAdjust(p,override);
  const baseSize=Math.max(1,Math.round(Math.min(b.w*1.32,b.h*.58)));
  const size=Math.max(1,Math.round(baseSize*adj.scale));
  const cx=b.x+b.w/2;
  const dx=Math.round(cx-size/2+adj.x);
  const dy=Math.round(b.y-2+adj.y);
  ctx.drawImage(piece,0,0,piece.width,piece.height,dx,dy,size,size);
}

function compose(base,p=profile(),d='down',f=0,override=null){
  const o=document.createElement('canvas');o.width=base.width;o.height=base.height;
  const x=o.getContext('2d');x.imageSmoothingEnabled=false;
  x.drawImage(base,0,0);
  x.drawImage(skin(base,p.skin),0,0);
  drawHairFixed(x,tintHair(p.hair,d,f,p.hairColor,light(p.hairColor,.34)),base,p,override);
  return o;
}

function ensure(h,cls,w,hg){
  let c=h.querySelector(`:scope > .${cls}`);
  if(!c){c=document.createElement('canvas');c.className=cls;c.setAttribute('aria-hidden','true');h.append(c)}
  if(c.width!==w)c.width=w;if(c.height!==hg)c.height=hg;return c;
}
function state(base){
  const p=String(base?.dataset.paintKey||'male:rows:down:0').split(':');
  return{dir:['down','up','left','right'].includes(p[2])?p[2]:'down',frame:+p[3]||0};
}
function visBase(h){return h.querySelector(':scope > .avatar-v5-canvas')}

function paintLobby(){
  if(!ready)return;const p=profile();
  document.querySelectorAll('#playersLayer .player.local').forEach(pl=>{
    const h=pl.querySelector(':scope > .avatar-base-host'),b=h&&visBase(h);if(!h||!b)return;
    pl.classList.add('avatar-v3-runtime');
    h.querySelector(':scope > .avatar-v3-final-canvas')?.remove();
    const st=state(b),c=ensure(h,'avatar-v3-overlay-canvas',64,96),x=c.getContext('2d');
    x.imageSmoothingEnabled=false;x.clearRect(0,0,c.width,c.height);
    x.drawImage(skin(b,p.skin),0,0,64,96);
    drawHairFixed(x,tintHair(p.hair,st.dir,st.frame,p.hairColor,light(p.hairColor,.34)),b,p);
    h.classList.add('avatar-v3-composed');
  });
}
function paintPreview(){
  if(!ready)return;
  const r=document.getElementById('avatarFinalPreview'),b=r?.querySelector(':scope > .avatar-v5-preview');if(!r||!b)return;
  const fin=compose(b,profile(),'down',0,previewHairAdjust),c=ensure(r,'avatar-v3-final-preview',fin.width,fin.height),x=c.getContext('2d');
  x.imageSmoothingEnabled=false;x.clearRect(0,0,c.width,c.height);x.drawImage(fin,0,0);r.classList.add('avatar-v3-composed');
}
function thumbFor(k,v){
  const c=document.createElement('canvas');c.width=96;c.height=96;
  if(k!=='hair'||!ready)return c;
  const p=profile(),piece=tintHair(v,'down',0,p.hairColor,light(p.hairColor,.42));if(!piece)return c;
  const x=c.getContext('2d');x.imageSmoothingEnabled=false;
  if(Number(v)===1&&pilotReady&&piece.width===64&&piece.height===96){
    x.drawImage(piece,0,0,64,96,20,4,56,84);
  }else{
    x.drawImage(piece,0,0,piece.width,piece.height,8,8,80,80);
  }
  return c;
}

window.ML3DAvatarCompositor={
  ready:()=>ready,profile,setProfile,compose,paintLobby,paintPreview,thumbFor,
  setPreviewHairAdjust(value){previewHairAdjust=value?hairAdjust(profile(),value):null;paintPreview()},
  getPreviewHairAdjust(){return previewHairAdjust?{...previewHairAdjust}:null},
  pilotReady:()=>pilotReady
};
load().then(()=>{paintPreview();paintLobby()});
})();