(() => {
  "use strict";

  const style = document.createElement("style");
  style.textContent = `
    .ml3d-access-overlay,
    .ml3d-access-card {
      touch-action: auto !important;
    }

    .ml3d-access-name {
      touch-action: manipulation !important;
      user-select: text !important;
      -webkit-user-select: text !important;
      -webkit-touch-callout: default !important;
    }
  `;
  document.head.appendChild(style);

  let lastPointerTarget = null;

  document.addEventListener("pointerdown", (event) => {
    lastPointerTarget = event.target;
  }, true);

  document.addEventListener("touchstart", (event) => {
    lastPointerTarget = event.target;
  }, true);

  document.addEventListener("focusout", (event) => {
    const input = event.target;

    if (!(input instanceof HTMLInputElement) || !input.classList.contains("ml3d-access-name")) {
      return;
    }

    window.setTimeout(() => {
      if (!document.body.contains(input)) {
        return;
      }

      const form = input.closest(".ml3d-access-form");
      if (!form || form.hidden) {
        return;
      }

      const target = lastPointerTarget;
      const userMovedFocus = target && target !== input && !input.contains(target);
      if (userMovedFocus) {
        return;
      }

      if (document.activeElement !== input) {
        try {
          input.focus({ preventScroll: true });
        } catch (_) {
          input.focus();
        }
      }
    }, 40);
  }, true);
})();