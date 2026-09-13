"use strict";

(function () {
  const LOGO_TIME = 3800;
  const WARNING_TIME = 2500;
  const FADE_TIME = 2000;

  /*
   * La animación del logo no debe empezar mientras se inserta el cartucho.
   * El fondo del cartucho es totalmente negro y el logo queda congelado
   * hasta que ml3dInitialCartridgePromise termina.
   */
  const style = document.createElement("style");
  style.textContent = `
    .ml3d-cartridge-scene {
      background: #000 !important;
    }

    #boot-screen:not(.boot-active) #boot-logo {
      animation: none !important;
      opacity: 0 !important;
      transform: scale(.65) translateY(8px) !important;
    }

    #boot-screen:not(.boot-active) .boot-letter {
      animation: none !important;
      opacity: 0 !important;
      transform: translateY(8px) scale(.92) !important;
    }

    #boot-screen.cartridge-wait {
      background: #000 !important;
      opacity: 1 !important;
      visibility: visible !important;
    }

    #boot-screen.cartridge-wait #boot-logo-screen,
    #boot-screen.cartridge-wait #update-screen {
      opacity: 0 !important;
      visibility: hidden !important;
    }

    #boot-screen.boot-active #boot-logo {
      animation: bootLogoAppear 1.4s cubic-bezier(.16,1,.3,1) .15s forwards !important;
    }

    #boot-screen.boot-active .boot-letter {
      animation: bootLetterAppear .35s ease var(--letter-delay) forwards !important;
    }
  `;
  document.head.appendChild(style);

  window.gbaBootIntro = {
    started: false,

    start() {
      if (this.started) {
        return Promise.resolve();
      }

      this.started = true;

      const bootScreen = document.getElementById("boot-screen");

      if (bootScreen) {
        bootScreen.classList.remove(
          "boot-active",
          "update-active",
          "boot-finished"
        );
        bootScreen.classList.add("cartridge-wait");
      }

      return Promise.resolve(
        window.ml3dInitialCartridgeHandoffPromise ||
        window.ml3dInitialCartridgePromise
      )
        .catch(() => {})
        .then(async () => {
          if (window.ML3DConsoleTransitions) {
            await window.ML3DConsoleTransitions.playInitialIntro();
          }
        })
        .catch(() => {})
        .then(() => new Promise((resolve) => {
          if (!bootScreen) {
            resolve();
            return;
          }

          /* El logo empieza únicamente cuando el cartucho y la apertura han terminado. */
          bootScreen.classList.remove("cartridge-wait");
          bootScreen.classList.add("boot-active");

          window.setTimeout(() => {
            bootScreen.classList.add("update-active");
          }, LOGO_TIME);

          window.setTimeout(() => {
            bootScreen.classList.add("boot-finished");
          }, LOGO_TIME + WARNING_TIME);

          window.setTimeout(() => {
            resolve();
          }, LOGO_TIME + WARNING_TIME + FADE_TIME);
        }));
    }
  };
})();
