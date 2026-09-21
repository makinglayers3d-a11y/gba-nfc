(() => {
'use strict';
if(window.__ml3dAvatarAssetThumbsV2)return;window.__ml3dAvatarAssetThumbsV2=true;
const compositor=()=>window.ML3DAvatarCompositor;
function install(){
  const c=compositor();if(!c)return false;
  c.assetThumbFor=(kind,value)=>c.thumbFor?.(kind,value);
  return true;
}
if(!install()){const timer=setInterval(()=>{if(install())clearInterval(timer)},30);setTimeout(()=>clearInterval(timer),5000)}
})();