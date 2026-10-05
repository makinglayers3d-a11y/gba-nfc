// compositor.js — Personajes del lobby por capas.
// Módulo ES sin dependencias. Monta la hoja de sprites de un personaje a partir de su configuración
// (ver personaje.schema.json) con las mismas reglas que el probador.
//
//   import { Compositor } from "./compositor.js";
//   const comp = await Compositor.create("assets/");          // carpeta con manifest.json
//   const hoja = await comp.componer(config);                 // canvas 512x384 (8 frames) o 256x384 (4 frames)
//   const reposo = await comp.componer({...config, frames: 4});  // columna 0 = reposo
//
// Funciona en el hilo principal y en Web Workers (usa OffscreenCanvas si existe).

const MAT = ["none","skin","hair","streak","iris","jacket","fur","accent","shirt","pants","shoe_light","shoe_dark",
  "outline","underwear","erase","patch","acc_main","acc_detail","hide_hair"];
const MI = Object.fromEntries(MAT.map((m, i) => [m, i]));

// ---------------------------------------------------------------- colores
function hex2rgb(h){h=h.replace("#","");return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]}
function rgb2hsl(r,g,b){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b);let h=0,s=0;const l=(mx+mn)/2;
 if(mx!==mn){const d=mx-mn;s=l>.5?d/(2-mx-mn):d/(mx+mn);
  if(mx===r)h=(g-b)/d+(g<b?6:0);else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;h/=6}
 return [h,s,l]}
function hue2(p,q,t){if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p}
function hsl2rgb(h,s,l){if(s===0){const v=Math.round(l*255);return [v,v,v]}const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;
 return [Math.round(hue2(p,q,h+1/3)*255),Math.round(hue2(p,q,h)*255),Math.round(hue2(p,q,h-1/3)*255)]}
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
function rgbHex(c){return "#"+c.map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,"0")).join("")}
function shade(hex,f){const [h,s,l]=rgb2hsl(...hex2rgb(hex));return hsl2rgb(h,s,clamp(l*f))}

// Recoloreado conservando luces y sombras. base = [h,s,l,"#hex"] del material en esa capa.
function makeMap(base,tHex,hueVar){
 const t=rgb2hsl(...hex2rgb(tHex));const tl=clamp(t[2],0.03,0.95);const hv=hueVar===undefined?0.04:hueVar;
 return (r,g,b)=>{const [h,s,l]=rgb2hsl(r,g,b);
  let dh=h-base[0];dh=((dh+0.5)%1+1)%1-0.5;dh=Math.max(-hv,Math.min(hv,dh));const nh=((t[0]+dh)%1+1)%1;
  const ns=clamp(t[1]+(s-base[1])*0.5);
  let nl,hh=nh,ss=ns;
  if(base[2]<0.3){ // originales muy oscuros (pelo negro): proporcional por debajo del tono base, suave por encima
   nl=l<=base[2]?tl*l/Math.max(base[2],0.02):tl+(1-tl)*Math.pow((l-base[2])/(1-base[2]),1.3)*0.8;
   if(l<base[2]&&tl>0.35){const k=1-l/Math.max(base[2],0.02);hh=((nh-0.06*k)%1+1)%1;ss=clamp(ns+0.15*k);nl=Math.max(nl,tl*0.28)}
  }else{const ratio=l/Math.max(base[2],0.02);nl=clamp(1-Math.pow(1-tl,ratio));}
  return hsl2rgb(t[1]<0.04?0:hh,ss,clamp(nl))}}
// Pelo: los degradados rapados (tonos de piel) conservan parte de su color; el resto cambia entero.
function hairMap(base,tHex,skinL){
 const f=makeMap(base,tHex,0.012);
 return (r,g,b)=>{const c=f(r,g,b);const [h,s,l]=rgb2hsl(r,g,b);
  const warm=(h<0.13||h>0.95)&&s>0.15;
  const w=warm?clamp((skinL-l)/Math.max(0.05,skinL-base[2])):1;
  const ww=Math.pow(w,0.7);
  return [Math.round(c[0]*ww+r*(1-ww)),Math.round(c[1]*ww+g*(1-ww)),Math.round(c[2]*ww+b*(1-ww))]}}

// ---------------------------------------------------------------- configuración pública -> interna
const COLOR_MAT={piel:"skin",iris:"iris",pelo:"hair",mechas:"streak",prendaSuperior:"jacket",cuello:"fur",
  camisetaInterior:"shirt",detalles:"accent",prendaInferior:"pants",calzado:"shoe_light",suela:"shoe_dark",ropaInterior:"underwear"};
export const CONFIG_POR_DEFECTO={version:1,cuerpo:"A",frames:8,peinado:"original",arriba:"bomber",abajo:"cargo",calzado:"originales",
  complementos:{cabeza:"nada",gafas:"nada",auriculares:false,cinta:false},colores:{},sinMechas:false};

export function normalizar(cfg){
 const c={...CONFIG_POR_DEFECTO,...(cfg||{})};
 c.complementos={...CONFIG_POR_DEFECTO.complementos,...(cfg&&cfg.complementos||{})};
 c.colores={...(cfg&&cfg.colores||{})};
 if(c.frames!==4&&c.frames!==8)c.frames=8;
 if(c.cuerpo!=="A"&&c.cuerpo!=="B")c.cuerpo="A";
 return c;
}
function toLook(cfg){
 const c=normalizar(cfg);const mat={};
 for(const [k,m] of Object.entries(COLOR_MAT))if(c.colores[k])mat[m]=c.colores[k];
 const cc=c.complementos;
 return {body:c.cuerpo,frames:c.frames,
  hair:c.peinado==="original"?"original":"hair_"+c.peinado,
  top:c.arriba==="nada"?"none":"top_"+c.arriba,
  bottom:c.abajo==="nada"?"none":"bottom_"+c.abajo,
  shoes:c.calzado==="nada"?"none":"shoes_"+c.calzado,
  mat,nostreak:!!c.sinMechas,
  accHat:cc.cabeza&&cc.cabeza!=="nada"?"acc_"+cc.cabeza:"none",
  accEye:cc.gafas&&cc.gafas!=="nada"?"acc_"+cc.gafas:"none",
  accPhones:!!cc.auriculares,accBand:!!cc.cinta,
  cHat:c.colores.sombrero||null,cEye:c.colores.gafas||null,cPhones:c.colores.auriculares||null,cBand:c.colores.cinta||null};
}

// ---------------------------------------------------------------- reglas de capas (qué se dibuja y en qué orden)
const LONG=new Set(["hair_melena","hair_bob","hair_trenzas"]);
function plan(look){
 const order=["base"];
 if(look.bottom!=="none")order.push(look.bottom);
 if(look.shoes!=="none")order.push(look.shoes);
 if(look.top!=="none")order.push(look.top);
 let hairL=look.hair!=="original"?look.hair:null;
 const hatOn=look.accHat!=="none",beanie=look.accHat==="acc_gorro";
 const styleL=hairL;
 // combinaciones dibujadas juntas (peinado + sombrero generados en la misma imagen)
 let comboK=null;
 if(hatOn&&(styleL==="hair_melena"||styleL==="hair_bob")&&["acc_pescador","acc_gorro","acc_paja"].includes(look.accHat))comboK=styleL+"_"+look.accHat.slice(4);
 else if(hatOn&&(styleL==="hair_rizado"||styleL==="hair_coletas")&&["acc_pescador","acc_paja"].includes(look.accHat))comboK=styleL+"_"+look.accHat.slice(4);
 else if(hatOn&&(styleL==="hair_rizado"||styleL==="hair_coletas"||styleL==="hair_bob")&&["acc_gorra","acc_gorra_atras"].includes(look.accHat))comboK=styleL+"_"+look.accHat.slice(4);
 else if(!hatOn&&styleL==="hair_rizado"&&look.accBand)comboK="hair_rizado_cinta";
 const comboBand=comboK==="hair_rizado_cinta";
 if(comboK){hairL=comboK;order.push(hairL)}
 else if(hatOn){hairL="hair_calvo";order.push(hairL);order.push("__extra__")}  // cabeza calva + pelo del peinado bajo la línea del sombrero
 else if(hairL)order.push(hairL);
 const accCol={};
 if(look.accBand&&!comboBand){order.push("acc_cinta");accCol["acc_cinta"]=look.cBand}
 if(look.accEye!=="none"){order.push(look.accEye);accCol[look.accEye]=look.cEye}
 if(look.accPhones){order.push("acc_auriculares");accCol["acc_auriculares"]=look.cPhones}
 if(look.accHat!=="none"&&!(comboK&&!comboBand)){order.push(look.accHat);accCol[look.accHat]=look.cHat}
 return {order,hairL,styleL,hatOn,beanie,comboK,comboBand,accCol};
}
function layersNeeded(look){
 const p=plan(look);const s=new Set(p.order.filter(l=>l!=="__extra__"));
 if(p.hatOn){s.add("hair_calvo");s.add(look.accHat);if(p.styleL&&!p.comboK)s.add(p.styleL)}
 return [...s];
}

// ---------------------------------------------------------------- composición
function composeInto(out,W,H,look,MB,L){
 const o=out;const p=plan(look);const {order,hairL,styleL,hatOn,beanie,comboK,comboBand,accCol}=p;
 const nc=W/64;
 let lineY=null,headL=null,headR=null,chin=null,hx0=null,hx1=null;
 if(hatOn&&!comboK){
  const HP=L[look.accHat].px,HK=L[look.accHat].mask;
  const HM=new Set([MI.acc_main,MI.acc_detail,MI.outline]);
  lineY=new Int16Array(W*4).fill(-1);hx0=new Int16Array(4*nc).fill(99);hx1=new Int16Array(4*nc).fill(-1);
  const CP0=L.hair_calvo.px,CK0=L.hair_calvo.mask;
  const headPx=q=>CP0[q+3]&&CK0[q]!==MI.erase&&CK0[q]!==MI.patch;
  for(let cy=0;cy<4;cy++)for(let cx=0;cx<nc;cx++){
   const bot=new Int16Array(64).fill(-1);
   for(let x=0;x<64;x++){const X=cx*64+x;let contact=-1,low=-1;
    for(let y=cy*96;y<cy*96+95;y++){const i=(y*W+X)*4;if(!(HP[i+3]&&HM.has(HK[i])))continue;low=y;
     const j=i+W*4;if(!(HP[j+3]&&HM.has(HK[j]))&&headPx(j)&&contact<0)contact=y}
    bot[x]=(contact>=0&&!beanie)?contact:low}   // línea: donde el sombrero se apoya en la cabeza (gorro de lana: su borde más bajo)
   let x0=64,x1=-1;for(let x=0;x<64;x++)if(bot[x]>=0){x0=Math.min(x0,x);x1=Math.max(x1,x)}
   hx0[cy*nc+cx]=x0;hx1[cy*nc+cx]=x1;
   let lowAll=-1;for(let x=0;x<64;x++)if(bot[x]>lowAll)lowAll=bot[x];
   const midX=(x0+x1)/2;
   for(let x=0;x<64;x++){let b=bot[x]>=0?bot[x]:(beanie?lowAll:(x<x0?bot[x0]:bot[x1]));
    if(beanie&&((cy===1&&x>midX)||(cy===2&&x<midX))){
     if(bot[x]<0)b=lowAll;
     else{let m=bot[x];for(const d of[-1,1]){const q=x+d;if(q>=0&&q<64&&bot[q]>m)m=bot[q]}b=m}}
    lineY[cy*W+cx*64+x]=x1<0?cy*96:b+1}}
  const CP=L.hair_calvo.px,CK=L.hair_calvo.mask;
  chin=new Int16Array(W*4).fill(0);
  headL=new Int16Array(W*H/64).fill(9999);headR=new Int16Array(W*H/64).fill(-1);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4;if(!CP[i+3]||CK[i]===MI.erase||CK[i]===MI.patch)continue;
   const cx=(x/64)|0,k=y*nc+cx;const lx=x%64;if(lx<headL[k])headL[k]=lx;if(lx>headR[k])headR[k]=lx;
   const ck=((y/96)|0)*nc+cx;if(y>chin[ck])chin[ck]=y}
 }
 const hairBase=MB[hairL||"base"];
 const HAIRI=new Set([MI.hair,MI.streak]);
 const longSt=LONG.has(styleL||"");
 for(const ly0 of order){
  const extra=ly0==="__extra__";const ly=extra?(styleL||"base"):ly0;
  const isHair=ly===hairL||extra;const isAcc=ly.startsWith("acc_");
  const P=L[ly].px,K=L[ly].mask,LB=MB[ly]||{};
  const maps={};
  if(isAcc){const c=accCol[ly];
   for(const mat of MAT){const base=LB[mat];if(!base)continue;
    if(mat==="skin"&&look.mat.skin&&look.mat.skin.toLowerCase()!==base[3])maps[mat]=makeMap(base,look.mat.skin);
    if(c&&mat==="acc_main")maps[mat]=makeMap(base,c);
    if(c&&mat==="acc_detail")maps[mat]=makeMap(base,rgbHex(shade(c,0.6)));}}
  else
  for(const mat of MAT){const base=LB[mat];if(!base)continue;
   if(mat==="streak"&&look.nostreak){const hc=look.mat.hair||hairBase.hair[3];const t2=rgb2hsl(...hex2rgb(hc));
    maps[mat]=(r,g,b)=>{const [,,l]=rgb2hsl(r,g,b);const tl=clamp(t2[2]*1.25,0.03,0.9);const nl=clamp(1-Math.pow(1-tl,l/base[2]));return hsl2rgb(t2[0],clamp(t2[1]),nl)};continue}
   if(look.mat[mat]&&look.mat[mat].toLowerCase()!==base[3]){
    if(mat==="hair"){const sk=(LB.skin||MB.base.skin);maps[mat]=hairMap(base,look.mat[mat],sk?sk[2]:0.72)}
    else maps[mat]=makeMap(base,look.mat[mat]);}}
  const cc=comboBand?look.cBand:look.cHat;
  if(comboK&&ly===comboK&&cc){
   if(LB.acc_main)maps.acc_main=makeMap(LB.acc_main,cc);
   if(LB.acc_detail)maps.acc_detail=makeMap(LB.acc_detail,rgbHex(shade(cc,0.6)));}
  const cache=new Map();
  const isHat=hatOn&&ly===look.accHat;
  for(let i=0;i<W*H*4;i+=4){
   const a=P[i+3];if(!a)continue;const mi=K[i];const mat=MAT[mi];
   if(mat==="erase"){if(!isHair)o[i+3]=0;continue}   // borrar píxeles de la base (ropa original); en peinados se aplica abajo
   if(mat==="patch"||mat==="hide_hair")continue;
   if(extra){const px=(i>>2)%W,py=((i>>2)/W)|0,cx=(px/64)|0,cy=(py/96)|0;
    if(!HAIRI.has(mi)){if(mi!==MI.outline)continue;let nb=false;for(const d of [4,-4,W*4,-W*4]){const q=i+d;if(q>=0&&q<W*H*4&&P[q+3]&&HAIRI.has(K[q])){nb=true;break}}if(!nb)continue}
    if(py<lineY[cy*W+px])continue;
    const k=py*nc+cx,lx=px%64,inHead=headR[k]>=0&&lx>=headL[k]-1&&lx<=headR[k]+1;
    let hang=false;
    if(longSt){if(cy===0||cy===3)hang=true;else{const c=cy*nc+cx;hang=lx>=hx0[c]&&lx<=hx1[c]}}
    if(!(inHead||hang||(!beanie&&(cy===0||cy===3))))continue}
   if(isHat&&mat==="skin")continue;
   let r=P[i],g=P[i+1],b=P[i+2];
   const f=maps[mat];if(f){const key=mi*16777216+(r<<16|g<<8|b);let c=cache.get(key);if(!c){c=f(r,g,b);cache.set(key,c)}r=c[0];g=c[1];b=c[2]}
   o[i]=r;o[i+1]=g;o[i+2]=b;o[i+3]=a}
  // el peinado borra la cabeza/pelo propios de la base y parchea el cuerpo, antes de dibujar la ropa
  if(ly==="base"&&hairL){const HK=L[hairL].mask,HP=L[hairL].px;const sm=maps.skin;
   for(let i=0;i<W*H*4;i+=4){if(!HP[i+3])continue;const mm=HK[i];
    if(mm===MI.erase)o[i+3]=0;
    else if(mm===MI.patch){let c=[HP[i],HP[i+1],HP[i+2]];if(sm)c=sm(c[0],c[1],c[2]);o[i]=c[0];o[i+1]=c[1];o[i+2]=c[2];o[i+3]=255}}}
 }
}

// ---------------------------------------------------------------- carga de imágenes
function makeCanvas(w,h){
 if(typeof OffscreenCanvas!=="undefined")return new OffscreenCanvas(w,h);
 const c=document.createElement("canvas");c.width=w;c.height=h;return c;
}
async function loadPixels(url){
 const r=await fetch(url);if(!r.ok)throw new Error("No se pudo cargar "+url);
 const bmp=await createImageBitmap(await r.blob());
 const c=makeCanvas(bmp.width,bmp.height);const x=c.getContext("2d",{willReadFrequently:true});x.drawImage(bmp,0,0);
 const px=x.getImageData(0,0,bmp.width,bmp.height).data;bmp.close&&bmp.close();
 return {w:c.width,h:c.height,px};
}

export class Compositor{
 constructor(baseUrl,manifest){this.baseUrl=baseUrl;this.manifest=manifest;this._cache=new Map()}
 static async create(baseUrl="assets/"){
  if(!baseUrl.endsWith("/"))baseUrl+="/";
  const r=await fetch(baseUrl+"manifest.json");if(!r.ok)throw new Error("No se encontró manifest.json en "+baseUrl);
  return new Compositor(baseUrl,await r.json());
 }
 async _layer(body,tag,name){
  const key=body+"|"+tag+"|"+name;
  if(!this._cache.has(key)){
   const dir=`${this.baseUrl}${body}/${tag}frames/${name}`;
   this._cache.set(key,Promise.all([loadPixels(dir+".png"),loadPixels(dir+"_mascara.png")]).then(([s,m])=>{
    // la máscara guarda el índice de material en el canal rojo
    const mask=new Uint8Array(m.px.length);for(let i=0;i<m.px.length;i+=4)mask[i]=m.px[i];
    return {w:s.w,px:s.px,mask};}));
  }
  return this._cache.get(key);
 }
 /** Carga por adelantado las capas de una configuración (útil antes de mostrar a un jugador). */
 async precargar(cfg){const look=toLook(cfg);const body="cuerpo"+look.body;
  await Promise.all(layersNeeded(look).map(n=>this._layer(body,String(look.frames),n)));}
 /** Devuelve un canvas con la hoja del personaje (celdas de 64x96; filas abajo, izquierda, derecha, arriba). */
 async componer(cfg){
  const look=toLook(cfg);const body="cuerpo"+look.body;const tag=String(look.frames);
  const MB={};for(const [k,v] of Object.entries(this.manifest.capas[body]))MB[k]=v.colores_base;
  const names=layersNeeded(look);
  for(const n of names)if(!MB[n])throw new Error("Capa desconocida: "+n);
  const L={};await Promise.all(names.map(async n=>{L[n]=await this._layer(body,tag,n)}));
  const W=L.base.w,H=384;
  const cv=makeCanvas(W,H);const ctx=cv.getContext("2d");const img=ctx.createImageData(W,H);
  composeInto(img.data,W,H,look,MB,L);
  ctx.putImageData(img,0,0);
  return cv;
 }
 /** Datos para animar la hoja. */
 info(cfg){const c=normalizar(cfg);const f=this.manifest.frames[String(c.frames)];
  return {frameAncho:64,frameAlto:96,columnas:c.frames,filas:{abajo:0,izquierda:1,derecha:2,arriba:3},msPorFrame:f.ms_por_frame};}
 /** Libera la caché de imágenes. */
 vaciarCache(){this._cache.clear()}
}
export {MAT as MATERIALES};
