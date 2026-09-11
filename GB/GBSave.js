(() => {
  "use strict";

  const SAVE_PREFIX = "gba-gb-save:";

  let currentKey = null;
  let currentEmulator = null;
  let saveTimer = null;

  function saveKey(romPath) {
    return SAVE_PREFIX + romPath;
  }

  function saveCurrent() {
    if (!currentEmulator || !currentKey) {
      return;
    }

    try {
      if (typeof currentEmulator.getExtRam !== "function") {
        return;
      }

      const extRam = currentEmulator.getExtRam();

      if (!extRam || extRam.byteLength === 0) {
        return;
      }

      localStorage.setItem(
        currentKey,
        JSON.stringify(Array.from(extRam))
      );
    } catch (error) {
      console.error(
        "No se pudo guardar la partida GB/GBC:",
        error
      );
    }
  }

  function loadFor(romPath, gbEmulator) {
    const encoded =
      localStorage.getItem(saveKey(romPath));

    if (!encoded || !gbEmulator) {
      return;
    }

    try {
      const bytes =
        new Uint8Array(JSON.parse(encoded));

      if (
        typeof gbEmulator.loadExtRam ===
        "function"
      ) {
        gbEmulator.loadExtRam(bytes);

        console.log(
          "Partida GB/GBC restaurada:",
          romPath
        );
      }
    } catch (error) {
      console.error(
        "No se pudo restaurar la partida GB/GBC:",
        error
      );
    }
  }

  function startSaveTimer() {
    clearInterval(saveTimer);

    saveTimer = window.setInterval(() => {
      saveCurrent();
    }, 5000);
  }

  function stopSaveTimer() {
    if (saveTimer) {
      clearInterval(saveTimer);
      saveTimer = null;
    }
  }

  const originalStart =
    window.gbaGB &&
    window.gbaGB.start;

  if (!originalStart) {
    console.error(
      "GBSave: no se encontró window.gbaGB.start"
    );

    return;
  }

  window.gbaGB.start = async function (romPath) {
    stopSaveTimer();

    saveCurrent();

    const gbEmulator =
      await originalStart.call(
        this,
        romPath
      );

    currentKey =
      saveKey(romPath);

    currentEmulator =
      gbEmulator;

    loadFor(
      romPath,
      gbEmulator
    );

    startSaveTimer();

    return gbEmulator;
  };

  window.gbaGB.save = function () {
  saveCurrent();
};

  window.addEventListener(
    "pagehide",
    saveCurrent
  );

  window.addEventListener(
    "beforeunload",
    saveCurrent
  );
})();
