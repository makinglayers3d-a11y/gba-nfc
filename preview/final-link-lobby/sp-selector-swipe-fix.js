(() => {
  "use strict";

  const STYLE_ID = "ml3d-sp-swipe-fix-styles";

  function applyFix() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        #ml3d-appearance-selector [data-panel="sp"] {
          min-width: 0 !important;
          max-width: 100% !important;
          overflow: hidden !important;
        }

        #ml3d-appearance-selector .ml3d-sp-swatches {
          display: flex !important;
          flex-wrap: nowrap !important;
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          overflow-x: auto !important;
          overflow-y: hidden !important;
          touch-action: pan-x !important;
          -webkit-overflow-scrolling: touch !important;
          overscroll-behavior-x: contain;
          scrollbar-width: none;
        }

        #ml3d-appearance-selector .ml3d-sp-swatches::-webkit-scrollbar {
          display: none;
        }

        #ml3d-appearance-selector .ml3d-sp-swatches > button[data-sp] {
          flex: 0 0 38px !important;
          width: 38px !important;
          min-width: 38px !important;
          height: 38px !important;
          min-height: 38px !important;
          touch-action: pan-x !important;
          -webkit-user-select: none !important;
          user-select: none !important;
        }
      `;
      document.head.appendChild(style);
    }

    const row = document.querySelector("#ml3d-appearance-selector .ml3d-sp-swatches");
    if (!row || row.dataset.ml3dSwipeFix === "1") return;
    row.dataset.ml3dSwipeFix = "1";

    let dragging = false;
    let startX = 0;
    let startScroll = 0;
    let moved = false;

    row.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      dragging = true;
      moved = false;
      startX = event.clientX;
      startScroll = row.scrollLeft;
      row.setPointerCapture?.(event.pointerId);
    });

    row.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const delta = event.clientX - startX;
      if (Math.abs(delta) > 3) moved = true;
      row.scrollLeft = startScroll - delta;
      if (moved) event.preventDefault();
    });

    const stopDrag = (event) => {
      if (!dragging) return;
      dragging = false;
      if (row.hasPointerCapture?.(event.pointerId)) {
        row.releasePointerCapture(event.pointerId);
      }
    };

    row.addEventListener("pointerup", stopDrag);
    row.addEventListener("pointercancel", stopDrag);

    row.addEventListener("click", (event) => {
      if (!moved) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      moved = false;
    }, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyFix, { once: true });
  } else {
    applyFix();
  }

  const observer = new MutationObserver(() => applyFix());
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
