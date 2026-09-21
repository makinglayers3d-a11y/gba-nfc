(() => {
  "use strict";
  if (globalThis.__ml3dBaseLoaderInstalled) return;
  globalThis.__ml3dBaseLoaderInstalled = true;

  const script = document.createElement("script");
  script.src = "./avatar-base.js?v=4";
  script.async = false;
  script.dataset.ml3dBaseLoader = "1";

  const current = document.currentScript;
  if (current?.parentNode) current.parentNode.insertBefore(script, current.nextSibling);
  else document.head.append(script);
})();
