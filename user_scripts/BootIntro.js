"use strict";

(function () {
  const GAME_LIST_API =
    "https://api.github.com/repos/makinglayers3d-a11y/gba-nfc/contents/games";
  const GAME_LIST_FALLBACK = "games-catalog.json?v=20260914-1";
  const nativeFetch = window.fetch.bind(window);

  if (new URLSearchParams(window.location.search).get("dev") === "1") {
    const accessNamePromptScript = document.createElement("script");
    accessNamePromptScript.src = "access-name-prompt.js?v=20260914-1";
    document.head.appendChild(accessNamePromptScript);
  }

  /*
   * El selector usa la API pública de GitHub como fuente principal. En redes
   * donde api.github.com no es accesible, utiliza un catálogo servido por el
   * propio GitHub Pages para que el menú de juegos siga funcionando.
   */
  window.fetch = async function ml3dFetch(input, init) {
    const requestUrl =
      typeof input === "string"
        ? input
        : input && typeof input.url === "string"
          ? input.url
          : "";

    if (requestUrl !== GAME_LIST_API) {
      return nativeFetch(input, init);
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3000);

    try {
      const response = await nativeFetch(input, {
        ...(init || {}),
        signal: controller.signal
      });

      if (response.ok) {
        return response;
      }
    } catch (error) {
      console.warn(
        "ML3D: API de juegos no disponible; usando catálogo local.",
        error
      );
    } finally {
      window.clearTimeout(timeout);
    }

    return nativeFetch(GAME_LIST_FALLBACK, {
      cache: "no-store"
    });
  };

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
