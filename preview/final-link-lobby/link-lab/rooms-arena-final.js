(() => {
  "use strict";

  const FINAL_URL = "./assets/arena-final/ml3d-link-arena-final-6144x4096.webp?v=2";

  function boot() {
    const stage = document.getElementById("lobbyStage");
    if (!stage) return;

    let image = stage.querySelector(".arena-bg");
    if (!image) {
      image = new Image();
      image.className = "arena-bg";
      image.alt = "";
      image.decoding = "async";
      image.draggable = false;
      stage.prepend(image);
    }

    image.onload = () => {
      stage.classList.add("arena-asset-ready", "arena-final-ready");
      stage.classList.remove("arena-asset-error");
    };

    image.onerror = () => {
      stage.classList.add("arena-asset-error");
      console.warn("ML3D Link: no se pudo cargar la arena final 6K.");
    };

    image.src = FINAL_URL;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
