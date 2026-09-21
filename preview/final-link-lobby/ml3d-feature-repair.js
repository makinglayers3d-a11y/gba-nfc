(()=>{
'use strict';
function formatDuration(seconds){const m=Math.floor((seconds||0)/60);return m<60?`${m} min`:`${Math.floor(m/60)} h ${m%60} min`}
function statsFor(detail){const ids=[detail?.id,detail?.filename,detail?.name].filter(Boolean);for(const id of ids){try{const v=JSON.parse(localStorage.getItem(`ml3d-game-stats:${id}`)||'null');if(v)return v}catch(_){}}return {}}
function render(detail){const overlay=document.getElementById('gba-game-menu');if(!overlay||!detail)return;let info=overlay.querySelector('.ml3d-game-info');if(!info){info=document.createElement('aside');info.className='ml3d-game-info';overlay.appendChild(info)}const stats=statsFor(detail);const system=detail.system||'GAME BOY ADVANCE';info.innerHTML=`<small>${system} · ${formatDuration(stats.seconds)}</small><em>${stats.lastPlayed?'Última partida: '+new Date(stats.lastPlayed).toLocaleDateString('es-ES'):'Sin partidas registradas'}</em>`}
window.addEventListener('ml3d-game-selection-changed',e=>render(e.detail));
// Keep the visual screenshot save confirmation bound even if another menu listener changes.
document.addEventListener('click',e=>{const b=e.target.closest('#save-game');if(!b||typeof window.ml3dSaveWithCapture!=='function')return;e.preventDefault();e.stopImmediatePropagation();window.ml3dSaveWithCapture()},true);
})();