"use strict";

(function () {
  let corePromise = null;
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

      const realCore = window.gbaGB;

      if (
        !realCore ||
        realCore === facade ||
        typeof realCore.startBuffer !== "function"
      ) {
        throw new Error("No se pudo inicializar el núcleo GB/GBC.");
      }

      if (typeof realCore.setVolume === "function") {
        realCore.setVolume(pendingVolume);
      }

      return realCore;
    })().catch((error) => {
      corePromise = null;
      throw error;
    });

    return corePromise;
  }

  const facade = {
    async start(romPath) {
      const realCore = await ensureCore();
      return realCore.start(romPath);
    },

    async startBuffer(romBuffer, filename, saveId, useLegacySave) {
      const realCore = await ensureCore();
      return realCore.startBuffer(
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

      if (
        corePromise &&
        window.gbaGB &&
        window.gbaGB !== facade &&
        typeof window.gbaGB.setVolume === "function"
      ) {
        window.gbaGB.setVolume(pendingVolume);
      }
    },

    stop() {
      if (
        window.gbaGB &&
        window.gbaGB !== facade &&
        typeof window.gbaGB.stop === "function"
      ) {
        window.gbaGB.stop();
      }
    },

    isPaused() {
      if (
        window.gbaGB &&
        window.gbaGB !== facade &&
        typeof window.gbaGB.isPaused === "function"
      ) {
        return window.gbaGB.isPaused();
      }

      return true;
    },

    pause() {
      if (
        window.gbaGB &&
        window.gbaGB !== facade &&
        typeof window.gbaGB.pause === "function"
      ) {
        window.gbaGB.pause();
      }
    },

    resume() {
      if (
        window.gbaGB &&
        window.gbaGB !== facade &&
        typeof window.gbaGB.resume === "function"
      ) {
        window.gbaGB.resume();
      }
    },

    keyDown(keyName) {
      if (
        window.gbaGB &&
        window.gbaGB !== facade &&
        typeof window.gbaGB.keyDown === "function"
      ) {
        window.gbaGB.keyDown(keyName);
      }
    },

    keyUp(keyName) {
      if (
        window.gbaGB &&
        window.gbaGB !== facade &&
        typeof window.gbaGB.keyUp === "function"
      ) {
        window.gbaGB.keyUp(keyName);
      }
    },

    isRunning() {
      if (
        window.gbaGB &&
        window.gbaGB !== facade &&
        typeof window.gbaGB.isRunning === "function"
      ) {
        return window.gbaGB.isRunning();
      }

      return false;
    }
  };

  window.gbaGB = facade;
  window.ml3dEnsureGbCore = ensureCore;
})();
