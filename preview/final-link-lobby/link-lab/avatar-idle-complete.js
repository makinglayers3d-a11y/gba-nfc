(() => {
  "use strict";

  if (window.__ml3dAvatarIdleCompleteV2) return;
  window.__ml3dAvatarIdleCompleteV2 = true;

  const PROFILE_KEY = "ml3d-link-avatar-final-v1";
  const SHEETS = {
    male: "./assets/avatar-base/male-base.png?v=4",
    female: "./assets/avatar-base/female-base.png?v=4"
  };
  const DIR_INDEX = { down: 0, up: 1, left: 2, right: 3 };
  const GRID = 4;
  const BASE_W = 64;
  const BASE_H = 96;
  const IDLE_W = 72;
  const IDLE_H = 96;
  const NORMAL_BG_THRESHOLD = 58;
  const COMPLETE_BG_THRESHOLD = 42;
  const ALPHA = 20;
  const compiled = new Map();
  let compiledByBase = null;

  const style = document.createElement("style");
  style.textContent = `
    .avatar-idle-complete-canvas {
      display:none;
      position:absolute;
      left:50%;
      bottom:0;
      width:63px;
      height:84px;
      transform:translateX(-50%);
      image-rendering:pixelated;
      image-rendering:crisp-edges;
      pointer-events:none;
    }
    .player.local .avatar-idle-complete-canvas {
      filter:drop-shadow(0 0 4px rgba(88,190,255,.88));
    }
    #playersLayer .player:not(.ml3d-walking)[data-ml3d-direction="down"] .avatar-v5-canvas,
    #playersLayer .player:not(.ml3d-walking)[data-ml3d-direction="up"] .avatar-v5-canvas {
      opacity:0!important;
      visibility:hidden!important;
    }
    #playersLayer .player:not(.ml3d-walking)[data-ml3d-direction="down"] .avatar-idle-complete-canvas,
    #playersLayer .player:not(.ml3d-walking)[data-ml3d-direction="up"] .avatar-idle-complete-canvas {
      display:block!important;
      opacity:1!important;
      visibility:visible!important;
    }
    @media(max-width:560px){
      .avatar-idle-complete-canvas { width:54px; height:72px; }
    }
  `;
  document.head.appendChild(style);

  function localBase() {
    try {
      return JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}").base === "female" ? "female" : "male";
    } catch {
      return "male";
    }
  }

  function selectedBase() {
    const selected = document.querySelector("#avatarFinalBase button.selected");
    if (!selected) return localBase();
    return /MUJER/i.test(selected.textContent || "") ? "female" : "male";
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
      image.src = src;
    });
  }

  function cloneCanvas(source) {
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0);
    return canvas;
  }

  function borderRef(data, w, h) {
    const points = [[0,0],[w-1,0],[0,h-1],[w-1,h-1],[w>>1,0],[w>>1,h-1],[0,h>>1],[w-1,h>>1]];
    let r=0,g=0,b=0,a=0;
    for (const [x,y] of points) {
      const i=(y*w+x)*4;
      r+=data[i]; g+=data[i+1]; b+=data[i+2]; a+=data[i+3];
    }
    return { r:r/points.length, g:g/points.length, b:b/points.length, a:a/points.length };
  }

  function colorDistance(r,g,b,ref) {
    const dr=r-ref.r, dg=g-ref.g, db=b-ref.b;
    return Math.sqrt(dr*dr+dg*dg+db*db);
  }

  function clearBackground(canvas, threshold) {
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    const w=canvas.width,h=canvas.height,img=ctx.getImageData(0,0,w,h),d=img.data,ref=borderRef(d,w,h);
    if (ref.a < 24) return;
    const seen=new Uint8Array(w*h),q=new Int32Array(w*h); let head=0,tail=0;
    const bg=(n)=>{ const p=n*4; return d[p+3]<24 || colorDistance(d[p],d[p+1],d[p+2],ref)<=threshold; };
    const push=(n)=>{ if(n<0||n>=seen.length||seen[n]||!bg(n))return; seen[n]=1; q[tail++]=n; };
    for(let x=0;x<w;x++){push(x);push((h-1)*w+x);} for(let y=0;y<h;y++){push(y*w);push(y*w+w-1);}
    while(head<tail){ const n=q[head++],x=n%w,y=(n/w)|0; d[n*4+3]=0; if(x>0)push(n-1);if(x+1<w)push(n+1);if(y>0)push(n-w);if(y+1<h)push(n+w); }
    ctx.putImageData(img,0,0);
  }

  function components(canvas) {
    const ctx=canvas.getContext("2d",{willReadFrequently:true}),img=ctx.getImageData(0,0,canvas.width,canvas.height),d=img.data,w=canvas.width,h=canvas.height;
    const seen=new Uint8Array(w*h),q=new Int32Array(w*h),out=[];
    const fg=(n)=>d[n*4+3]>=ALPHA;
    for(let start=0;start<w*h;start++){
      if(seen[start]||!fg(start))continue;
      let head=0,tail=0,area=0,minX=w,minY=h,maxX=-1,maxY=-1,sumX=0,sumY=0; const px=[];
      seen[start]=1;q[tail++]=start;
      while(head<tail){
        const n=q[head++],x=n%w,y=(n/w)|0; px.push(n);area++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);sumX+=x;sumY+=y;
        for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){if(!ox&&!oy)continue;const nx=x+ox,ny=y+oy;if(nx<0||nx>=w||ny<0||ny>=h)continue;const ni=ny*w+nx;if(seen[ni]||!fg(ni))continue;seen[ni]=1;q[tail++]=ni;}
      }
      out.push({pixels:px,area,minX,minY,maxX,maxY,cx:sumX/area,cy:sumY/area});
    }
    return {img,out};
  }

  function keepMainSubject(canvas) {
    const ctx=canvas.getContext("2d",{willReadFrequently:true}),w=canvas.width,h=canvas.height,{img,out}=components(canvas);
    if(!out.length)return;
    const cx=w/2,cy=h*.58;
    const score=(c)=>{const dx=Math.abs(c.cx-cx)/Math.max(1,w/2),dy=Math.abs(c.cy-cy)/Math.max(1,h/2),hh=c.maxY-c.minY+1;return c.area*Math.max(.08,1-(dx*.85+dy*.35))*(.7+.3*Math.min(1,hh/Math.max(1,h*.5)));};
    const main=[...out].sort((a,b)=>score(b)-score(a))[0];
    const mw=main.maxX-main.minX+1,mh=main.maxY-main.minY+1,padX=Math.max(8,Math.round(mw*.24)),padY=Math.max(8,Math.round(mh*.18)),floor=Math.max(6,main.area*.006),keep=new Uint8Array(w*h);
    for(const c of out){const near=c.area>=floor&&c.maxX>=main.minX-padX&&c.minX<=main.maxX+padX&&c.maxY>=main.minY-padY&&c.minY<=main.maxY+padY;if(c===main||near)for(const n of c.pixels)keep[n]=1;}
    const d=img.data;for(let n=0;n<w*h;n++)if(!keep[n])d[n*4+3]=0;ctx.putImageData(img,0,0);
  }

  function bounds(canvas) {
    const ctx=canvas.getContext("2d",{willReadFrequently:true}),d=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1;
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){if(d[(y*canvas.width+x)*4+3]<ALPHA)continue;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
    if(maxX<minX)return{x:0,y:0,w:canvas.width,h:canvas.height,anchorX:canvas.width/2};
    const hh=maxY-minY+1,feetStart=Math.max(minY,maxY-Math.max(4,Math.round(hh*.22)));let sum=0,count=0;
    for(let y=feetStart;y<=maxY;y++)for(let x=minX;x<=maxX;x++){if(d[(y*canvas.width+x)*4+3]<ALPHA)continue;sum+=x;count++;}
    return{x:minX,y:minY,w:maxX-minX+1,h:hh,anchorX:count?sum/count:(minX+maxX)/2};
  }

  function cropToRegion(canvas, x0, y0, x1, y1) {
    const ctx=canvas.getContext("2d",{willReadFrequently:true}),img=ctx.getImageData(0,0,canvas.width,canvas.height),d=img.data,w=canvas.width,h=canvas.height;
    const minX=Math.max(0,Math.floor(x0)),minY=Math.max(0,Math.floor(y0)),maxX=Math.min(w-1,Math.ceil(x1)),maxY=Math.min(h-1,Math.ceil(y1));
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(x<minX||x>maxX||y<minY||y>maxY)d[(y*w+x)*4+3]=0;
    ctx.putImageData(img,0,0);
  }

  function maskDistance(a,b){
    const da=a.getContext("2d",{willReadFrequently:true}).getImageData(0,0,a.width,a.height).data,db=b.getContext("2d",{willReadFrequently:true}).getImageData(0,0,b.width,b.height).data;
    let diff=0,union=0;for(let i=3;i<da.length;i+=4){const aa=da[i]>=ALPHA,bb=db[i]>=ALPHA;if(aa||bb)union++;if(aa!==bb)diff++;}return union?diff/union:1;
  }

  function groupingScore(frames,mode){
    let total=0,pairs=0;
    for(let dir=0;dir<GRID;dir++){
      const group=[];for(let f=0;f<GRID;f++)group.push(mode==="rows"?frames[dir][f]:frames[f][dir]);
      for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++){total+=maskDistance(group[i],group[j]);pairs++;}
    }
    return pairs?total/pairs:Infinity;
  }

  async function compile(base) {
    if(compiled.has(base))return compiled.get(base);
    const promise=(async()=>{
      const image=await loadImage(SHEETS[base]);
      const raw=Array.from({length:GRID},()=>Array(GRID));
      let maxW=1,maxH=1;

      for(let row=0;row<GRID;row++){
        const sy=Math.round(image.naturalHeight*row/GRID),ey=Math.round(image.naturalHeight*(row+1)/GRID);
        for(let col=0;col<GRID;col++){
          const sx=Math.round(image.naturalWidth*col/GRID),ex=Math.round(image.naturalWidth*(col+1)/GRID),cw=Math.max(1,ex-sx),ch=Math.max(1,ey-sy);

          const normal=document.createElement("canvas");normal.width=cw;normal.height=ch;
          const nctx=normal.getContext("2d",{willReadFrequently:true});nctx.imageSmoothingEnabled=false;nctx.drawImage(image,sx,sy,cw,ch,0,0,cw,ch);clearBackground(normal,NORMAL_BG_THRESHOLD);keepMainSubject(normal);
          const normalBounds=bounds(normal);maxW=Math.max(maxW,normalBounds.w);maxH=Math.max(maxH,normalBounds.h);

          const overX=Math.min(10,Math.max(4,Math.round(cw*.04))),overY=Math.min(7,Math.max(3,Math.round(ch*.035)));
          const osx=Math.max(0,sx-overX),osy=Math.max(0,sy-overY),oex=Math.min(image.naturalWidth,ex+overX),oey=Math.min(image.naturalHeight,ey+overY);
          const complete=document.createElement("canvas");complete.width=Math.max(1,oex-osx);complete.height=Math.max(1,oey-osy);
          const cctx=complete.getContext("2d",{willReadFrequently:true});cctx.imageSmoothingEnabled=false;cctx.drawImage(image,osx,osy,complete.width,complete.height,0,0,complete.width,complete.height);clearBackground(complete,COMPLETE_BG_THRESHOLD);
          const shiftX=sx-osx,shiftY=sy-osy;
          cropToRegion(complete,normalBounds.x+shiftX-12,normalBounds.y+shiftY-7,normalBounds.x+shiftX+normalBounds.w+11,normalBounds.y+shiftY+normalBounds.h+6);
          const completeBounds=bounds(complete);
          raw[row][col]={normal,normalBounds,complete,completeBounds,shiftX,shiftY};
        }
      }

      const scale=Math.min((BASE_W-10)/maxW,(BASE_H-8)/maxH);
      const normalFrames=Array.from({length:GRID},()=>Array(GRID));
      const idleFrames=Array.from({length:GRID},()=>Array(GRID));

      for(let row=0;row<GRID;row++)for(let col=0;col<GRID;col++){
        const item=raw[row][col],nb=item.normalBounds;
        const normalOut=document.createElement("canvas");normalOut.width=BASE_W;normalOut.height=BASE_H;
        let ctx=normalOut.getContext("2d");ctx.imageSmoothingEnabled=false;
        const ndw=Math.max(1,Math.round(nb.w*scale)),ndh=Math.max(1,Math.round(nb.h*scale)),nanchor=(nb.anchorX-nb.x)*scale,ndx=Math.round(BASE_W/2-nanchor),ndy=BASE_H-ndh-2;
        ctx.drawImage(item.normal,nb.x,nb.y,nb.w,nb.h,ndx,ndy,ndw,ndh);normalFrames[row][col]=normalOut;

        const cb=item.completeBounds,idleOut=document.createElement("canvas");idleOut.width=IDLE_W;idleOut.height=IDLE_H;ctx=idleOut.getContext("2d");ctx.imageSmoothingEnabled=false;
        const cdw=Math.max(1,Math.round(cb.w*scale)),cdh=Math.max(1,Math.round(cb.h*scale));
        const anchorInComplete=nb.anchorX+item.shiftX-cb.x;
        const cdx=Math.round(IDLE_W/2-anchorInComplete*scale),cdy=IDLE_H-cdh-2;
        ctx.drawImage(item.complete,cb.x,cb.y,cb.w,cb.h,cdx,cdy,cdw,cdh);idleFrames[row][col]=idleOut;
      }

      const rs=groupingScore(normalFrames,"rows"),cs=groupingScore(normalFrames,"cols"),orientation=cs+.015<rs?"cols":"rows";
      return{normalFrames,idleFrames,orientation};
    })();
    compiled.set(base,promise);return promise;
  }

  function sourceFrame(sheet,direction,frame=0){const dir=DIR_INDEX[direction]??0;return sheet.orientation==="rows"?sheet.idleFrames[dir][frame]:sheet.idleFrames[frame][dir];}

  function parsePaintKey(canvas){const p=String(canvas?.dataset.paintKey||"").split(":");return{base:p[0]==="female"?"female":"male",direction:["down","up","left","right"].includes(p[2])?p[2]:"down"};}

  function ensureIdleCanvas(player){
    const host=player.querySelector(":scope > .avatar-base-host");if(!host)return null;
    let canvas=host.querySelector(":scope > .avatar-idle-complete-canvas");
    if(!canvas){canvas=document.createElement("canvas");canvas.width=IDLE_W;canvas.height=IDLE_H;canvas.className="avatar-idle-complete-canvas";canvas.setAttribute("aria-hidden","true");host.append(canvas);}return canvas;
  }

  function paintFull(canvas,source){const ctx=canvas.getContext("2d");ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0,canvas.width,canvas.height);}

  function paintContained(canvas,source,padding){
    const ctx=canvas.getContext("2d");ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,canvas.width,canvas.height);
    const scale=Math.min((canvas.width-padding*2)/BASE_W,(canvas.height-padding*2)/BASE_H),dw=Math.round(IDLE_W*scale),dh=Math.round(IDLE_H*scale),dx=Math.round((canvas.width-dw)/2),dy=Math.round((canvas.height-dh)/2);
    ctx.drawImage(source,dx,dy,dw,dh);
  }

  function repaintPlayer(player){
    if(player.classList.contains("ml3d-walking"))return;
    const direction=player.dataset.ml3dDirection||"down";if(direction!=="down"&&direction!=="up")return;
    const v5=player.querySelector(":scope > .avatar-base-host > .avatar-v5-canvas");if(!v5)return;
    const info=parsePaintKey(v5),sheet=compiledByBase?.[info.base]||compiledByBase?.male;if(!sheet)return;
    const canvas=ensureIdleCanvas(player);if(!canvas)return;
    const key=`${info.base}:${sheet.orientation}:${direction}:0`;if(canvas.dataset.idleKey===key)return;canvas.dataset.idleKey=key;paintFull(canvas,sourceFrame(sheet,direction,0));
  }

  function repaintEditor(){
    if(!compiledByBase)return;
    const preview=document.querySelector("#avatarFinalPreview > canvas.avatar-v5-preview");
    if(preview){const base=selectedBase(),sheet=compiledByBase[base]||compiledByBase.male;if(sheet)paintContained(preview,sourceFrame(sheet,"down",0),14);}
    document.querySelectorAll("#avatarFinalBase button").forEach(button=>{const canvas=button.querySelector(":scope > canvas.avatar-v5-choice");if(!canvas)return;const base=/MUJER/i.test(button.textContent||"")?"female":"male",sheet=compiledByBase[base]||compiledByBase.male;if(sheet)paintContained(canvas,sourceFrame(sheet,"down",0),5);});
  }

  async function boot(){
    const [m,f]=await Promise.allSettled([compile("male"),compile("female")]);
    compiledByBase={male:m.status==="fulfilled"?m.value:null,female:f.status==="fulfilled"?f.value:null};
    document.addEventListener("click",e=>{if(e.target.closest("#avatarButton,#avatarFinalBase button,#saveAvatarFinal")){setTimeout(repaintEditor,0);setTimeout(repaintEditor,50);}});
    const tick=()=>{document.querySelectorAll("#playersLayer .player").forEach(repaintPlayer);const modal=document.getElementById("avatarModal");if(modal&&!modal.hidden)repaintEditor();requestAnimationFrame(tick);};
    requestAnimationFrame(tick);
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();
