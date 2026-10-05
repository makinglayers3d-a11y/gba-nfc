"use strict";

(function () {
  let corePromise = null;
  let realCore = null;
  let pendingVolume = 1;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-ml3d-gb-src="${src}"]`);

      if (existing) {
        if (existing.dataset.loaded === "1") {
          resolve();
          return;
        }

        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener(
          "error",
          () => reject(new Error("No se pudo cargar " + src)),
          { once: true }
        );
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.dataset.ml3dGbSrc = src;

      script.addEventListener(
        "load",
        () => {
          script.dataset.loaded = "1";
          resolve();
        },
        { once: true }
      );

      script.addEventListener(
        "error",
        () => reject(new Error("No se pudo cargar " + src)),
        { once: true }
      );

      document.head.appendChild(script);
    });
  }

  async function ensureCore() {
    if (realCore) {
      return realCore;
    }

    if (corePromise) {
      return corePromise;
    }

    corePromise = (async () => {
      /*
       * Safari antiguo expone únicamente webkitAudioContext.
       * simple.js espera AudioContext.
       */
      if (
        typeof window.AudioContext !== "function" &&
        typeof window.webkitAudioContext === "function"
      ) {
        window.AudioContext = window.webkitAudioContext;
      }

      await loadScript("GB/binjgb.js");
      await loadScript("GB/simple.js?v=playback-compat-1");

      const loadedCore = window.gbaGB;

      if (
        !loadedCore ||
        loadedCore === facade ||
        typeof loadedCore.startBuffer !== "function"
      ) {
        throw new Error("No se pudo inicializar el núcleo GB/GBC.");
      }

      /*
       * simple.js publica su propio window.gbaGB. Conservamos ese objeto como
       * núcleo real, pero restauramos la fachada para no perder los wrappers
       * de GBSave.js (save, stop y temporizador de guardado).
       */
      realCore = loadedCore;
      window.gbaGB = facade;

      if (typeof realCore.setVolume === "function") {
        realCore.setVolume(pendingVolume);
      }

      return realCore;
    })().catch((error) => {
      corePromise = null;
      realCore = null;
      window.gbaGB = facade;
      throw error;
    });

    return corePromise;
  }

  const facade = {
    async start(romPath) {
      const core = await ensureCore();
      return core.start(romPath);
    },

    async startBuffer(romBuffer, filename, saveId, useLegacySave) {
      const core = await ensureCore();
      return core.startBuffer(
        romBuffer,
        filename,
        saveId,
        useLegacySave
      );
    },

    setVolume(volume) {
      pendingVolume = Math.min(
        Math.max(Number(volume), 0),
        1
      );

      if (realCore && typeof realCore.setVolume === "function") {
        realCore.setVolume(pendingVolume);
      }
    },

    stop() {
      if (realCore && typeof realCore.stop === "function") {
        return realCore.stop();
      }
    },

    isPaused() {
      if (realCore && typeof realCore.isPaused === "function") {
        return realCore.isPaused();
      }

      return true;
    },

    pause() {
      if (realCore && typeof realCore.pause === "function") {
        return realCore.pause();
      }
    },

    resume() {
      if (realCore && typeof realCore.resume === "function") {
        return realCore.resume();
      }
    },

    keyDown(keyName) {
      if (realCore && typeof realCore.keyDown === "function") {
        return realCore.keyDown(keyName);
      }
    },

    keyUp(keyName) {
      if (realCore && typeof realCore.keyUp === "function") {
        return realCore.keyUp(keyName);
      }
    },

    isRunning() {
      if (realCore && typeof realCore.isRunning === "function") {
        return realCore.isRunning();
      }

      return false;
    }
  };

  window.gbaGB = facade;
  window.ml3dEnsureGbCore = ensureCore;
})();
