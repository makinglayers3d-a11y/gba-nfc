"use strict";

(function () {
  const GAME_LIST_API =
    "https://api.github.com/repos/makinglayers3d-a11y/gba-nfc/contents/games";
  const GAME_LIST_FALLBACK = "games-catalog.json?v=20260916-1";
  const nativeFetch = window.fetch.bind(window);

  /*
   * Compatibilidad de almacenamiento:
   * algunos WebViews exponen localStorage pero lanzan SecurityError al usarlo.
   * En ese caso usamos un almacenamiento temporal en memoria para que el
   * emulador pueda arrancar, aunque ese dispositivo no pueda persistir ajustes.
   */
  (function installSafeStorageFallback() {
    try {
      const storage = window.localStorage;
      const probeKey = "__ml3d_storage_probe__";
      storage.setItem(probeKey, "1");
      storage.removeItem(probeKey);
    } catch (error) {
      console.warn(
        "ML3D: almacenamiento persistente no disponible; usando memoria temporal.",
        error
      );

      const memoryStorage = new Map();
      const fallbackStorage = {
        get length() {
          return memoryStorage.size;
        },
        clear() {
          memoryStorage.clear();
        },
        getItem(key) {
          key = String(key);
          return memoryStorage.has(key) ? memoryStorage.get(key) : null;
        },
        key(index) {
          const keys = Array.from(memoryStorage.keys());
          return keys[index] ?? null;
        },
        removeItem(key) {
          memoryStorage.delete(String(key));
        },
        setItem(key, value) {
          memoryStorage.set(String(key), String(value));
        }
      };

      try {
        Object.defineProperty(window, "localStorage", {
          configurable: true,
          value: fallbackStorage
        });
      } catch (defineError) {
        console.warn(
          "ML3D: no se pudo instalar el fallback de almacenamiento.",
          defineError
        );
      }
    }
  })();

  /*
   * Ajuste de temporización de IodineGBA.
   *
   * app.js llama a timerCallback cada 8 ms. IodineGBA viene configurado para
   * calcular 16 ms de CPU por llamada. Alineamos el intervalo interno a 8 ms
   * antes de play() para evitar que dispositivos lentos intenten emular el
   * doble de trabajo del tiempo real.
   */
  (function patchGbaTiming() {
    if (
      typeof window.GameBoyAdvanceEmulator !== "function" ||
      !window.GameBoyAdvanceEmulator.prototype
    ) {
      return;
    }

    const proto = window.GameBoyAdvanceEmulator.prototype;

    if (proto.__ml3dTimingPatched) {
      return;
    }

    const originalPlay = proto.play;

    proto.play = function ml3dPlayWithAlignedTiming() {
      try {
        if (
          typeof this.setIntervalRate === "function" &&
          this.timerIntervalRate !== 8
        ) {
          this.setIntervalRate(8);
        }
      } catch (error) {
        console.warn("ML3D: no se pudo ajustar el temporizador GBA.", error);
      }

      return originalPlay.apply(this, arguments);
    };

    proto.__ml3dTimingPatched = true;
  })();

  /*
   * IodineGBA copiaba de nuevo la ROM completa durante la inicialización del
   * cartucho. Para ROMs normales Uint8Array alineadas (hasta 32 MiB) podemos
   * reutilizar el mismo buffer de solo lectura y ahorrar una copia completa.
   */
  (function patchGbaRomMemory() {
    if (
      typeof window.GameBoyAdvanceCartridge !== "function" ||
      !window.GameBoyAdvanceCartridge.prototype
    ) {
      return;
    }

    const proto = window.GameBoyAdvanceCartridge.prototype;

    if (proto.__ml3dRomMemoryPatched) {
      return;
    }

    const originalGetROMArray = proto.getROMArray;

    proto.getROMArray = function ml3dGetROMArray(oldArray) {
      const sourceLength =
        oldArray && typeof oldArray.length === "number"
          ? oldArray.length
          : 0;

      const romLength =
        Math.min((sourceLength >> 2) << 2, 0x2000000);

      if (
        oldArray instanceof Uint8Array &&
        oldArray.byteOffset === 0 &&
        oldArray.byteLength === romLength
      ) {
        this.ROMLength = romLength;
        this.EEPROMStart =
          romLength > 0x1000000
            ? Math.max(romLength, 0x1FFFF00)
            : 0x1000000;

        return oldArray;
      }

      return originalGetROMArray.call(this, oldArray);
    };

    proto.__ml3dRomMemoryPatched = true;
  })();

  if (new URLSearchParams(window.location.search).get("dev") === "1") {
    const accessNamePromptScript = document.createElement("script");
    accessNamePromptScript.src = "access-name-prompt.js?v=20260914-1";
    document.head.appendChild(accessNamePromptScript);
  }

  function isGameRomRequest(requestUrl) {
    if (!requestUrl) {
      return false;
    }

    if (/^games\/.+\.(gba|gbc|gb)(?:[?#].*)?$/i.test(requestUrl)) {
      return true;
    }

    try {
      const url = new URL(requestUrl, window.location.href);
      return /\/games\/[^/]+\.(gba|gbc|gb)$/i.test(url.pathname);
    } catch (error) {
      return false;
    }
  }

  function delay(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  async function fetchRomWithRetry(input, init) {
    const requestInit = {
      ...(init || {})
    };

    /*
     * "no-store" obliga a descargar otra vez ROMs de 8-32 MiB. "default"
     * permite reutilizar la caché HTTP del navegador sin cambiar las URLs.
     */
    if (!requestInit.cache || requestInit.cache === "no-store") {
      requestInit.cache = "default";
    }

    let lastResponse = null;
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await nativeFetch(input, requestInit);

        if (
          response.ok ||
          (
            response.status !== 408 &&
            response.status !== 429 &&
            response.status < 500
          )
        ) {
          return response;
        }

        lastResponse = response;
      } catch (error) {
        lastError = error;
      }

      if (attempt === 0) {
        await delay(650);
      }
    }

    if (lastResponse) {
      return lastResponse;
    }

    throw lastError || new Error("No se pudo descargar la ROM.");
  }

  /*
   * El selector usa la API pública de GitHub como fuente principal. En redes
   * donde api.github.com no es accesible, utiliza un catálogo servido por el
   * propio GitHub Pages para que el menú de juegos siga funcionando.
   *
   * Las ROMs reciben además un segundo intento y pueden reutilizar la caché.
   */
  window.fetch = async function ml3dFetch(input, init) {
    const requestUrl =
      typeof input === "string"
        ? input
        : input && typeof input.url === "string"
          ? input.url
          : "";

    if (isGameRomRequest(requestUrl)) {
      return fetchRomWithRetry(input, init);
    }

    if (requestUrl !== GAME_LIST_API) {
      return nativeFetch(input, init);
    }

    const hasAbortController =
      typeof window.AbortController === "function";

    const controller =
      hasAbortController
        ? new window.AbortController()
        : null;

    const timeout =
      controller
        ? window.setTimeout(() => controller.abort(), 3000)
        : null;

    try {
      const apiInit = {
        ...(init || {})
      };

      if (controller) {
        apiInit.signal = controller.signal;
      }

      const response = await nativeFetch(input, apiInit);

      if (response.ok) {
        return response;
      }
    } catch (error) {
      console.warn(
        "ML3D: API de juegos no disponible; usando catálogo local.",
        error
      );
    } finally {
      if (timeout !== null) {
        window.clearTimeout(timeout);
      }
    }

    return nativeFetch(GAME_LIST_FALLBACK, {
      cache: "default"
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
