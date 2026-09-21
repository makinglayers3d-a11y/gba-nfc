(() => {
  "use strict";

  if (window.__ml3dAvatarMotionSmoothing) return;
  window.__ml3dAvatarMotionSmoothing = true;

  const style = document.createElement("style");
  style.textContent = `
    /* rooms.js actualiza left/top por pasos cada 55 ms. Interpolamos el
       elemento jugador completo entre esos puntos; las poses del sprite
       permanecen nítidas y no se mezclan entre sí. */
    #playersLayer .player {
      transition-property: left, top !important;
      transition-duration: 62ms !important;
      transition-timing-function: linear !important;
      transition-delay: 0ms !important;
      will-change: left, top;
    }
  `;
  document.head.appendChild(style);
})();
