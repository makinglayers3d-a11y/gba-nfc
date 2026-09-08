(() => {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const game = (params.get("game") || "pokemon").toLowerCase();

  const title = document.getElementById("game-title");
  const status = document.getElementById("status");
  const menu = document.getElementById("menu");
  const menuButton = document.getElementById("menu-button");
  const closeMenu = document.getElementById("close-menu");
  const fullscreenButton = document.getElementById("fullscreen");
  const reloadButton = document.getElementById("reload-game");
  const speedSelect = document.getElementById("speed-select");
  const canvas = document.getElementById("screen");

  const volumeSlider = document.getElementById("volume-slider");
const volumeValue = document.getElementById("volume-value");
const muteButton = document.getElementById("mute-button");
  
const backgroundColors = document.getElementById("background-colors");
const buttonColors = document.getElementById("button-colors");
  const gameConfig = {
    pokemon: {
      name: "Pokémon",
      rom: "games/PokemonRF.gba"
    }
  };

  const selected = gameConfig[game] || gameConfig.pokemon;

  const savedBackground = localStorage.getItem("gba-background");
const savedButtonColor = localStorage.getItem("gba-button-color");



if (savedBackground) {
  document.documentElement.style.setProperty("--bg", savedBackground);
}

if (savedButtonColor) {
  document.documentElement.style.setProperty("--button", savedButtonColor);
}
  title.textContent = selected.name;
  status.textContent = "Cargando Pokémon…";

  canvas.width = 240;
  canvas.height = 160;

 let emulator = null;
let timer = null;
let saveTimer = null;
let startTime = 0;

let audioInput = null;
let audioVolume = 1;
let audioMuted = false;
let previousVolume = 1;

const savedVolume = Number(
  localStorage.getItem("gba-volume") || "1"
);

if (Number.isFinite(savedVolume)) {
  audioVolume = Math.min(Math.max(savedVolume, 0), 1);
}  
  
  let fullscreenRequested = false;
  let fullscreenTransition = false;
  const SAVE_PREFIX = "gba-save:";
const SAVE_TYPE_PREFIX = "gba-save-type:";

function saveKey(name) {
  return SAVE_PREFIX + game + ":" + name;
}

function saveTypeKey(name) {
  return SAVE_TYPE_PREFIX + game + ":" + name;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(
      offset,
      Math.min(offset + chunkSize, bytes.length)
    );

    for (let i = 0; i < chunk.length; i++) {
      binary += String.fromCharCode(chunk[i]);
    }
  }

  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function saveGame(name, save) {
  try {
    if (!save) return;

    const bytes = save instanceof Uint8Array
      ? save
      : new Uint8Array(save);

    localStorage.setItem(saveKey(name), bytesToBase64(bytes));
  } catch (error) {
    console.error("No se pudo guardar la partida:", error);
  }
}

function loadGameSave(name, callback) {
  try {
    const encoded = localStorage.getItem(saveKey(name));

    if (!encoded) {
      callback(null);
      return;
    }

    callback(base64ToBytes(encoded));
  } catch (error) {
    console.error("No se pudo cargar la partida:", error);
    callback(null);
  }
}

function saveGameType(name, saveType) {
  try {
    localStorage.setItem(saveTypeKey(name), JSON.stringify(saveType));
  } catch (error) {
    console.error("No se pudo guardar el tipo de partida:", error);
  }
}

function loadGameType(name, callback) {
  try {
    const stored = localStorage.getItem(saveTypeKey(name));

    if (!stored) {
      callback(null);
      return;
    }

    callback(JSON.parse(stored));
  } catch (error) {
    console.error("No se pudo cargar el tipo de partida:", error);
    callback(null);
  }
}

  /*
   * Mapa de botones IodineGBA:
   * 0 A
   * 1 B
   * 2 SELECT
   * 3 START
   * 4 RIGHT
   * 5 LEFT
   * 6 UP
   * 7 DOWN
   * 8 R
   * 9 L
   */
  const keyMap = {
    A: 0,
    B: 1,
    SELECT: 2,
    START: 3,
    RIGHT: 4,
    LEFT: 5,
    UP: 6,
    DOWN: 7,
    R: 8,
    L: 9
  };

  function pressKey(keyName) {
    if (!emulator) return;

    const value = keyMap[keyName];

    if (value === undefined) return;

    emulator.keyDown(value);
  }

  function releaseKey(keyName) {
    if (!emulator) return;

    const value = keyMap[keyName];

    if (value === undefined) return;

    emulator.keyUp(value);
  }

  function updateVolumeUI() {
  const percentage = Math.round(audioVolume * 100);

  if (volumeSlider) {
    volumeSlider.value = String(percentage);
  }

  if (volumeValue) {
    volumeValue.textContent = percentage + "%";
  }

  if (muteButton) {
    muteButton.textContent = audioMuted ? "Activar sonido" : "Silenciar";
  }
}

function applyVolume(volume) {
  volume = Math.min(Math.max(Number(volume), 0), 1);

  audioVolume = volume;

  if (audioInput) {
    audioInput.setVolume(audioMuted ? 0 : audioVolume);
  }

  localStorage.setItem("gba-volume", String(audioVolume));

  updateVolumeUI();
}
  
  /*
   * Pantalla completa con el primer toque/clic.
   * El navegador exige interacción del usuario.
   */
 async function enterFullscreen() {
  if (fullscreenRequested) return;

  fullscreenRequested = true;

  try {
    if (
      !document.fullscreenElement &&
      document.documentElement.requestFullscreen
    ) {
      fullscreenTransition = true;
      await document.documentElement.requestFullscreen();
    }
  } catch (error) {
    console.log("Pantalla completa no disponible:", error);
  } finally {
    fullscreenTransition = false;
  }
}
  /*
   * Intentamos entrar en pantalla completa con la primera interacción.
   */

  /*
window.addEventListener(
  "pointerdown",
  () => {
    enterFullscreen();
  },
  {
    once: true,
    passive: true
  }
);
*/

  function initializeAudio() {
  if (!emulator || audioInput) return;

  try {
    const audioUnlockElement = document.getElementById("controls");
    const audioMixer = new GlueCodeMixer(audioUnlockElement);

    audioInput = new GlueCodeMixerInput(audioMixer);

    emulator.attachAudioHandler(audioInput);
    emulator.enableAudio();

    applyVolume(audioVolume);
  } catch (error) {
    console.error("No se pudo iniciar el audio:", error);
  }
}
  
  function unlockAudio() {
  try {
    const context = XAudioJSWebAudioContextHandle;

    if (context && context.state === "suspended") {
      context.resume().catch(() => {});
    }
  } catch (error) {
    console.log("No se pudo desbloquear el audio:", error);
  }
}
  
document.querySelectorAll("[data-key]").forEach((button) => {
  const keyName = button.dataset.key;
  let pressed = false;

 function press() {
  if (pressed) return;

  pressed = true;
  button.classList.add("pressed");

  initializeAudio();
  unlockAudio();

  pressKey(keyName);
}

  function release() {
    if (!pressed) return;

    pressed = false;
    button.classList.remove("pressed");
    releaseKey(keyName);
  }

  
  button.addEventListener(
    "touchstart",
    (event) => {
      event.preventDefault();
      unlockAudio();
      press();
    },
    { passive: false }
  );

  button.addEventListener(
    "touchend",
    (event) => {
      event.preventDefault();
      release();
    },
    { passive: false }
  );

  button.addEventListener(
    "touchcancel",
    (event) => {
      event.preventDefault();
      release();
    },
    { passive: false }
  );
});

   

   

  /*
   * Teclado físico.
   */
  const keyboardMap = {
    x: "A",
    z: "B",
    Enter: "START",
    Shift: "SELECT",
    ArrowRight: "RIGHT",
    ArrowLeft: "LEFT",
    ArrowUp: "UP",
    ArrowDown: "DOWN",
    s: "R",
    a: "L"
  };

  const keyboardPressed = new Set();

  window.addEventListener("keydown", (event) => {
    const keyName = keyboardMap[event.key];

    if (!keyName || keyboardPressed.has(event.key)) {
      return;
    }

    event.preventDefault();

    keyboardPressed.add(event.key);
    pressKey(keyName);
  });

  window.addEventListener("keyup", (event) => {
    const keyName = keyboardMap[event.key];

    if (!keyName) {
      return;
    }

    event.preventDefault();

    keyboardPressed.delete(event.key);
    releaseKey(keyName);
  });

  /*
   * Carga del juego.
   */
  async function loadGame() {
    try {
      status.hidden = false;
      status.style.display = "";
      status.textContent = "Cargando Pokémon…";

      const response = await fetch(selected.rom, {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const rom = new Uint8Array(await response.arrayBuffer());

      if (rom.length < 1024) {
        throw new Error("ROM inválida");
      }

      if (typeof GameBoyAdvanceEmulator !== "function") {
        throw new Error("Falta GameBoyAdvanceEmulator");
      }

      if (typeof GameBoyAdvanceMemory !== "function") {
        throw new Error("Falta GameBoyAdvanceMemory");
      }

      emulator = new GameBoyAdvanceEmulator();
      

      

emulator.attachSaveExportHandler((name, save) => {
  if (name.startsWith("TYPE_")) {
    saveGameType(name.substring(5), save);
  } else {
    saveGame(name, save);
  }
});

emulator.attachSaveImportHandler((name, callback, errorCallback) => {
  errorCallback();
});
      
      /*
       * Velocidad guardada.
       * 95% es el valor inicial.
       */
      const savedSpeed = Number(
        localStorage.getItem("gba-speed") || "0.95"
      );

      emulator.setSpeed(savedSpeed);

      if (speedSelect) {
        speedSelect.value = String(savedSpeed);
      }

      emulator.attachPlayStatusHandler(() => {});

      /*
       * Arranque sin BIOS.
       */
      emulator.settings.offthreadGfxEnabled = false;
      emulator.settings.SKIPBoot = true;

      const blitter = new GfxGlueCode(240, 160);

      blitter.attachCanvas(canvas);

      emulator.attachGraphicsFrameHandler(blitter);
      emulator.attachROM(rom);

      emulator.settings.SKIPBoot = true;

     emulator.play();

/*
 * Cargar partida guardada después de iniciar el emulador.
 */
try {
  const gameName = emulator.getGameName();

  if (gameName) {
    loadGameSave(gameName, (save) => {
      if (!save) return;

      loadGameType(gameName, (saveType) => {
        if (!saveType) return;

        try {
          emulator.IOCore.saves.importSave(
            new Uint8Array(save),
            saveType[0] | 0
          );

          console.log("Partida restaurada:", gameName);
        } catch (error) {
          console.error("Error restaurando partida:", error);
        }
      });
    });
  }
} catch (error) {
  console.error("Error cargando partida guardada:", error);
}

window.__gba = emulator;

      /*
       * Temporizador estable.
       *
       * IodineGBA espera el tiempo transcurrido,
       * no performance.now() absoluto.
       */
      startTime = Date.now();

      timer = window.setInterval(() => {
        if (!emulator) return;

        const elapsed = (Date.now() - startTime) >>> 0;

        emulator.timerCallback(elapsed);
      }, 8);

      saveTimer = window.setInterval(() => {
  if (!emulator) return;

  try {
    emulator.exportSave();
  } catch (error) {
    console.error("Guardado automático:", error);
  }
}, 10000);
      
      status.hidden = true;
      status.style.display = "none";

      console.log(
        "Juego iniciado:",
        selected.rom,
        rom.length,
        "bytes",
        "velocidad:",
        savedSpeed
      );
    } catch (error) {
      console.error(error);

      status.hidden = false;
      status.style.display = "";
      status.textContent =
        "Error al iniciar el juego: " + error.message;
    }
  }

  menuButton.addEventListener("click", () => {
    menu.showModal();
  });

  speedSelect.addEventListener("change", () => {
    const speed = Number(speedSelect.value);

    if (!Number.isFinite(speed)) {
      return;
    }

     if (emulator) {
      emulator.setSpeed(speed);
    }

    localStorage.setItem("gba-speed", String(speed));
  });
if (volumeSlider) {
  volumeSlider.addEventListener("input", () => {
    const volume = Number(volumeSlider.value) / 100;

    audioMuted = false;
    applyVolume(volume);
  });
}

if (muteButton) {
  muteButton.addEventListener("click", () => {
    if (!audioMuted) {
      previousVolume = audioVolume;
      audioMuted = true;

      if (audioInput) {
        audioInput.setVolume(0);
      }

      updateVolumeUI();
    } else {
      audioMuted = false;
      applyVolume(previousVolume > 0 ? previousVolume : 1);
    }
  });
}

updateVolumeUI();
  closeMenu.addEventListener("click", () => {
    menu.close();
  });

  fullscreenButton.addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) {
      fullscreenTransition = true;
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (error) {
    console.error("Fullscreen:", error);
  } finally {
    fullscreenTransition = false;
  }
});

   function shutdownEmulator() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
if (saveTimer) {
  clearInterval(saveTimer);
  saveTimer = null;
}
    if (emulator) {
      try {
        /*
         * pause() provoca el export del save.
         */
        emulator.pause();
      } catch (error) {
        console.error("Cierre del emulador:", error);
      }
    }
  }

  window.addEventListener("pagehide", shutdownEmulator);
  window.addEventListener("beforeunload", shutdownEmulator);


   
/* =========================
 * Personalización de colores
 * ========================= */

if (backgroundColors) {
  backgroundColors.querySelectorAll(".color-swatch").forEach((button) => {
    button.addEventListener("click", () => {
      const color = button.dataset.bg;

      if (!color) return;

      document.documentElement.style.setProperty("--bg", color);
      localStorage.setItem("gba-background", color);

      backgroundColors
        .querySelectorAll(".color-swatch")
        .forEach((item) => item.classList.remove("selected"));

      button.classList.add("selected");
    });
  });
}

if (buttonColors) {
  buttonColors.querySelectorAll(".color-swatch").forEach((button) => {
    button.addEventListener("click", () => {
      const color = button.dataset.button;

      if (!color) return;

      document.documentElement.style.setProperty("--button", color);
      localStorage.setItem("gba-button-color", color);

      buttonColors
        .querySelectorAll(".color-swatch")
        .forEach((item) => item.classList.remove("selected"));

      button.classList.add("selected");
    });
  });
}
  loadGame();
})();
