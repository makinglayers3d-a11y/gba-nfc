(() => {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const linkRoomActive = Boolean(params.get("linkRoom"));
  let currentGbaRomBytes = null;
  let currentGbaRomFilename = "";

const requestedRom = params.get("rom");

const game = (params.get("game") || "pokemon").toLowerCase();

  const title = document.getElementById("game-title");
  const status = document.getElementById("status");
  const menu = document.getElementById("menu");
  const menuButton = document.getElementById("menu-button");
  const closeMenu = document.getElementById("close-menu");
  
  const reloadButton = document.getElementById("reload-game");
  const saveGameButton = document.getElementById("save-game");
  const speedSelect = document.getElementById("speed-select");
  const hapticButton = document.getElementById("haptic-button");
  const canvas = document.getElementById("screen");

  const volumeSlider = document.getElementById("volume-slider");
const volumeValue = document.getElementById("volume-value");
const muteButton = document.getElementById("mute-button");
  
const backgroundColors = document.getElementById("background-colors");
const buttonColors = document.getElementById("button-colors");
 const gameConfig = {
  pokemon: {
    name: "Pokémon FireRed",
    rom: "games/PokemonRF.gba"
  },

  mario3: {
    name: "Super Mario Bros. 3",
    rom: "games/Super Mario Bros. 3.gba"
  },

  minishcap: {
    name: "The Legend of Zelda: The Minish Cap",
    rom: "games/The Legend of Zelda - The Minish Cap.gba"
  },

  
};

let selected =
  requestedRom
    ? {
        name: requestedRom,
        rom: "games/" + requestedRom
      }
    : (gameConfig[game] || gameConfig.pokemon);

function systemFromFilename(filename) {
  const lower = String(filename || "").toLowerCase();
  if (lower.endsWith(".gbc")) return "gbc";
  if (lower.endsWith(".gb")) return "gb";
  return "gba";
}

let currentSystem = systemFromFilename(selected.rom);
let currentSaveId = game;
let currentSource = "remote";
let currentLocalRom = null;
let romStartRequest = 0;

  const savedBackground = localStorage.getItem("gba-background");
const savedButtonColor = localStorage.getItem("gba-button-color");



if (savedBackground) {
  document.documentElement.style.setProperty("--bg", savedBackground);
}

if (savedButtonColor) {
  document.documentElement.style.setProperty("--button", savedButtonColor);
}
  title.textContent = selected.name;
  
  canvas.width = 240;
  canvas.height = 160;

 let emulator = null;
let timer = null;
let saveTimer = null;
let startTime = 0;
let backgroundSuspended = false;
let resumeGbaAfterBackground = false;
let resumeGbAfterBackground = false;

let audioInput = null;
let audioVolume = 1;
let audioMuted = localStorage.getItem("gba-muted") === "true";
let previousVolume = 1;
let gameMenuAudioDucked = false;
let hapticEnabled =
  localStorage.getItem("gba-vibration-enabled") === "true";

const GAME_MENU_VOLUME_FACTOR = 0.18;

const savedVolume = Number(
  localStorage.getItem("gba-volume") || "1"
);

if (Number.isFinite(savedVolume)) {
  audioVolume = Math.min(Math.max(savedVolume, 0), 1);
}  
  

  const SAVE_PREFIX = "gba-save:";
const SAVE_TYPE_PREFIX = "gba-save-type:";

function saveKey(name) {
  return SAVE_PREFIX + currentSaveId + ":" + name;
}

function saveTypeKey(name) {
  return SAVE_TYPE_PREFIX + currentSaveId + ":" + name;
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
  const isGBFamily = currentSystem === "gb" || currentSystem === "gbc";

  if (isGBFamily) {
    if (
      window.gbaGB &&
      typeof window.gbaGB.keyDown === "function"
    ) {
      window.gbaGB.keyDown(keyName);
    }

    return;
  }

  if (!emulator) return;

  const value = keyMap[keyName];

  if (value === undefined) return;

  if (linkRoomActive && window.ML3DLocalLinkSession?.handleLocalKey) {
    const consumed = window.ML3DLocalLinkSession.handleLocalKey(value, true);
    if (consumed) return;
  }

  emulator.keyDown(value);
}

 function releaseKey(keyName) {
  const isGBFamily = currentSystem === "gb" || currentSystem === "gbc";

  if (isGBFamily) {
    if (
      window.gbaGB &&
      typeof window.gbaGB.keyUp === "function"
    ) {
      window.gbaGB.keyUp(keyName);
    }

    return;
  }

  if (!emulator) return;

  const value = keyMap[keyName];

  if (value === undefined) return;

  if (linkRoomActive && window.ML3DLocalLinkSession?.handleLocalKey) {
    const consumed = window.ML3DLocalLinkSession.handleLocalKey(value, false);
    if (consumed) return;
  }

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
    muteButton.setAttribute("aria-pressed", String(audioMuted));
  }
}

function updateHapticUI() {
  if (!hapticButton) return;

  hapticButton.classList.toggle("enabled", hapticEnabled);
  hapticButton.setAttribute("aria-pressed", String(hapticEnabled));
  hapticButton.setAttribute(
    "aria-label",
    hapticEnabled
      ? "Desactivar vibración de los controles"
      : "Activar vibración de los controles"
  );
}

function triggerHapticFeedback() {
  if (!hapticEnabled || typeof navigator.vibrate !== "function") {
    return;
  }

  navigator.vibrate(18);
}

function updateEmulatorAudioOutput() {
  const effectiveVolume =
    audioMuted
      ? 0
      : audioVolume *
        (gameMenuAudioDucked
          ? GAME_MENU_VOLUME_FACTOR
          : 1);

  if (audioInput) {
    audioInput.setVolume(effectiveVolume);
  }

  if (window.gbaGB) {
    window.gbaGB.setVolume(effectiveVolume);
  }
}

function applyVolume(volume) {
  volume = Math.min(
    Math.max(Number(volume), 0),
    1
  );

  audioVolume = volume;

  updateEmulatorAudioOutput();

  localStorage.setItem(
    "gba-volume",
    String(audioVolume)
  );

  updateVolumeUI();
}

window.gbaSetGameMenuAudioDucked = function (ducked) {
  gameMenuAudioDucked = Boolean(ducked);
  updateEmulatorAudioOutput();
};
  




 

function initializeAudio(audioUnlockElement = null) {
  if (!emulator || audioInput) return;

  try {
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

function stopGbaTimers() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  if (saveTimer) {
    clearInterval(saveTimer);
    saveTimer = null;
  }
}

function startGbaTimers() {
  if (!emulator) return;

  stopGbaTimers();
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
}
  
window.ML3DLinkRuntime = {
  get emulator() {
    return emulator;
  },
  get romBytes() {
    return currentGbaRomBytes ? currentGbaRomBytes.slice() : null;
  },
  get romFilename() {
    return currentGbaRomFilename;
  },
  stopTimers: stopGbaTimers,
  startTimers: startGbaTimers,
  flushAudio() {
    try {
      emulator?.submitAudioBuffer?.();
    } catch {}
  }
};

document.querySelectorAll("[data-key]").forEach((button) => {
  const keyName = button.dataset.key;
  let pressed = false;

  function press() {
    if (pressed) return;

    pressed = true;
    button.classList.add("pressed");

    initializeAudio();
    unlockAudio();
    triggerHapticFeedback();

    pressKey(keyName);
  }

  function release() {
    if (!pressed) return;

    pressed = false;
    button.classList.remove("pressed");

    releaseKey(keyName);
  }

  // PC / ratón
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    press();
  });

  button.addEventListener("mouseup", (event) => {
    event.preventDefault();
    release();
  });

  button.addEventListener("mouseleave", () => {
    release();
  });

  // Móvil
  button.addEventListener(
    "touchstart",
    (event) => {
      event.preventDefault();
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
 *
 * Usamos event.code para que el teclado
 * funcione independientemente del idioma/layout.
 */
const keyboardMap = {
  KeyX: "A",
  KeyZ: "B",
  Enter: "START",
  ShiftLeft: "SELECT",
  ShiftRight: "SELECT",
  ArrowRight: "RIGHT",
  ArrowLeft: "LEFT",
  ArrowUp: "UP",
  ArrowDown: "DOWN",
  KeyS: "R",
  KeyA: "L"
};

const keyboardPressed = new Set();

function isEditableKeyboardTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

window.addEventListener(
  "keydown",
  (event) => {
    if (isEditableKeyboardTarget(event.target)) {
      return;
    }

    const keyName = keyboardMap[event.code];

    if (!keyName || keyboardPressed.has(event.code)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    keyboardPressed.add(event.code);

    /*
     * En PC no usamos #controls como desbloqueador.
     * La propia pulsación del teclado sirve como gesto
     * del usuario para iniciar WebAudio.
     */
    initializeAudio();
    unlockAudio();

    pressKey(keyName);
  },
  true
);

window.addEventListener(
  "keyup",
  (event) => {
    if (isEditableKeyboardTarget(event.target)) {
      return;
    }

    const keyName = keyboardMap[event.code];

    if (!keyName) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    keyboardPressed.delete(event.code);

    releaseKey(keyName);
  },
  true
); 

  async function stopCurrentEmulator() {
    stopGbaTimers();

    if (emulator) {
      try {
        window.ML3DLinkCable?.detachEmulator?.(emulator);
        emulator.exportSave();
        emulator.pause();
      } catch (error) {
        console.warn("No se pudo detener GBA limpiamente:", error);
      }
      emulator = null;
      window.__gba = null;
    }

    if (window.gbaGB && typeof window.gbaGB.stop === "function") {
      try {
        if (typeof window.gbaGB.save === "function") window.gbaGB.save();
        window.gbaGB.stop();
      } catch (error) {
        console.warn("No se pudo detener GB/GBC limpiamente:", error);
      }
    }
  }

  async function startRomFromBytes(bytes, filename, options = {}) {
    const requestId = ++romStartRequest;
    const rom = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const system = options.system || systemFromFilename(filename);

    if (!["gba", "gb", "gbc"].includes(system)) {
      throw new Error("Formato de ROM no compatible.");
    }
    if (rom.byteLength < 1024) {
      throw new Error("La ROM está vacía o es demasiado pequeña.");
    }

    status.hidden = false;
    status.style.display = "";
    status.textContent = "Cargando juego…";
    await stopCurrentEmulator();
    if (requestId !== romStartRequest) return false;

    currentSystem = system;
    currentSaveId = options.saveId || currentSaveId;
    currentSource = options.source || "remote";
    selected = {
      name: options.displayName || String(filename).replace(/\.(gba|gbc|gb)$/i, ""),
      rom: options.romPath || ""
    };
    title.textContent = selected.name;

    currentLocalRom = currentSource === "local"
      ? { bytes: rom.slice(), filename, system, saveId: currentSaveId, displayName: selected.name }
      : null;

    if (system === "gb" || system === "gbc") {
      canvas.width = 160;
      canvas.height = 144;
      if (!window.gbaGB || typeof window.gbaGB.startBuffer !== "function") {
        throw new Error("Falta el núcleo GB/GBC compatible con memoria.");
      }
      const buffer = rom.buffer.slice(rom.byteOffset, rom.byteOffset + rom.byteLength);
      await window.gbaGB.startBuffer(buffer, filename, currentSaveId);
      window.__gba = null;
    } else {
      canvas.width = 240;
      canvas.height = 160;
      if (typeof GameBoyAdvanceEmulator !== "function" || typeof GameBoyAdvanceMemory !== "function") {
        throw new Error("Falta el núcleo Game Boy Advance.");
      }

      emulator = new GameBoyAdvanceEmulator();
      emulator.attachSaveExportHandler((name, save) => {
        if (name.startsWith("TYPE_")) saveGameType(name.substring(5), save);
        else saveGame(name, save);
      });
      emulator.attachSaveImportHandler((name, callback, errorCallback) => errorCallback());

      const storedSpeedRaw = localStorage.getItem("gba-speed");
      let savedSpeed = Number(storedSpeedRaw == null ? "0.9" : storedSpeedRaw);

      // Calibrated ML3Demuler baseline:
      // emulator speed 0.9 is presented to the user as 100%.
      // This preserves the previous real gameplay pace while making it the
      // nominal reference point of the UI.
      if (!Number.isFinite(savedSpeed) || savedSpeed <= 0) {
        savedSpeed = 0.9;
        localStorage.setItem("gba-speed", "0.9");
      }

      emulator.setSpeed(savedSpeed);
      if (speedSelect) speedSelect.value = String(savedSpeed);
      emulator.attachPlayStatusHandler(() => {});
      emulator.settings.offthreadGfxEnabled = false;
      emulator.settings.SKIPBoot = true;
      const blitter = new GfxGlueCode(240, 160);
      blitter.attachCanvas(canvas);
      emulator.attachGraphicsFrameHandler(blitter);
      currentGbaRomBytes = rom.slice();
      currentGbaRomFilename = filename;
      emulator.attachROM(rom);
      if (audioInput) {
        emulator.attachAudioHandler(audioInput);
        emulator.enableAudio();
      }
      emulator.play();

      if (!linkRoomActive) {
        try {
          const gameName = emulator.getGameName();
          if (gameName) {
            loadGameSave(gameName, (save) => {
              if (!save || !emulator) return;
              loadGameType(gameName, (saveType) => {
                if (!saveType || !emulator) return;
                try {
                  emulator.IOCore.saves.importSave(new Uint8Array(save), saveType[0] | 0);
                } catch (error) {
                  console.error("Error restaurando partida:", error);
                }
              });
            });
          }
        } catch (error) {
          console.error("Error cargando partida guardada:", error);
        }
      }
      window.__gba = emulator;
      if (!linkRoomActive) {
        window.ML3DLinkCable?.attachEmulator?.(emulator);
        startGbaTimers();
      }
    }

    updateEmulatorAudioOutput();
    status.hidden = true;
    status.style.display = "none";
    window.dispatchEvent(new CustomEvent("ml3d-rom-started", { detail: {
      name: selected.name, filename, system, source: currentSource, saveId: currentSaveId
    }}));
    return true;
  }

  window.gbaStartLocalRom = async function ({ bytes, filename, system, saveId, displayName }) {
    try {
      return await startRomFromBytes(bytes, filename, {
        system, saveId, displayName, source: "local"
      });
    } catch (error) {
      console.error(error);
      status.hidden = false;
      status.style.display = "";
      status.textContent = "Error al iniciar la ROM local: " + error.message;
      throw error;
    }
  };

  window.gbaGetCurrentSystem = function () {
    return currentSystem;
  };

  async function applyManagedRemoteGameState() {
    const filename = String(selected.rom || "").replace(/^games\//, "");
    if (!filename) return;

    try {
      const response = await fetch("game-management.json?t=" + Date.now(), {
        cache: "no-store"
      });
      if (!response.ok) return;

      const management = await response.json();
      const meta =
        management &&
        management.games &&
        typeof management.games === "object"
          ? management.games[filename]
          : null;

      if (!meta || typeof meta !== "object") return;
      if (meta.suspended) {
        throw new Error("Este juego está suspendido temporalmente.");
      }
      if (String(meta.displayName || "").trim()) {
        selected.name = String(meta.displayName).trim();
      }
    } catch (error) {
      if (error && /suspendido temporalmente/i.test(String(error.message || ""))) {
        throw error;
      }
      console.warn("No se pudo comprobar el estado administrado del juego:", error);
    }
  }

  /* Carga remota inicial, conservando las rutas actuales de /games. */
  async function loadGame() {
    try {
      status.hidden = false;
      status.style.display = "";
      status.textContent = "Cargando juego…";

      await applyManagedRemoteGameState();

      const response = await fetch(selected.rom, {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const rom = new Uint8Array(await response.arrayBuffer());

      return await startRomFromBytes(rom, selected.rom, {
        system: systemFromFilename(selected.rom),
        saveId: systemFromFilename(selected.rom) === "gba" ? game : selected.rom,
        displayName: selected.name,
        source: "remote",
        romPath: selected.rom
      });

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
    localStorage.setItem("gba-muted", "false");
    applyVolume(volume);
  });
}

if (muteButton) {
  muteButton.addEventListener("click", () => {
    if (!audioMuted) {
      previousVolume = audioVolume;
      audioMuted = true;
    } else {
      audioMuted = false;
    }

    localStorage.setItem("gba-muted", String(audioMuted));
    updateEmulatorAudioOutput();
    updateVolumeUI();
  });
}

if (hapticButton) {
  hapticButton.addEventListener("click", () => {
    hapticEnabled = !hapticEnabled;
    localStorage.setItem(
      "gba-vibration-enabled",
      String(hapticEnabled)
    );
    updateHapticUI();

    if (hapticEnabled) {
      triggerHapticFeedback();
    }
  });
}

updateVolumeUI();
updateHapticUI();
  closeMenu.addEventListener("click", async () => {
    if (!menu.open || menu.classList.contains("menu-closing-comic")) {
      return;
    }

    const card = menu.querySelector(".menu-card");
    menu.classList.add("menu-closing-comic");

    await new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        card.removeEventListener("animationend", onAnimationEnd);
        resolve();
      };
      const onAnimationEnd = (event) => {
        if (event.target === card && event.animationName === "menuComicClose") {
          finish();
        }
      };

      card.addEventListener("animationend", onAnimationEnd);
      window.setTimeout(finish, 620);
    });

    menu.close();
    menu.classList.remove("menu-closing-comic");
  });

  if (saveGameButton) {
  saveGameButton.addEventListener("click", () => {
    const isGBFamily = currentSystem === "gb" || currentSystem === "gbc";

    try {
      if (isGBFamily) {
        if (
          window.gbaGB &&
          typeof window.gbaGB.save === "function"
        ) {
          window.gbaGB.save();
          console.log("Partida GB/GBC guardada.");
        }
      } else if (emulator) {
        emulator.exportSave();
        console.log("Partida GBA guardada.");
      }
    } catch (error) {
      console.error(
        "Error guardando la partida:",
        error
      );
    }
  });
}
  
if (reloadButton) {
  reloadButton.addEventListener("click", async () => {
    if (currentSource === "local" && currentLocalRom) {
      try {
        await startRomFromBytes(currentLocalRom.bytes, currentLocalRom.filename, {
          system: currentLocalRom.system,
          saveId: currentLocalRom.saveId,
          displayName: currentLocalRom.displayName,
          source: "local"
        });
      } catch (error) {
        console.error("Error reiniciando la ROM local:", error);
      }
      return;
    }
    try {
      if (emulator) {
        emulator.pause();
      }
    } catch (error) {
      console.error("Error preparando el reinicio:", error);
    }

    const url = new URL(window.location.href);

    /*
     * Al reiniciar queremos volver directamente
     * al juego, sin repetir logo ni advertencia.
     */
    url.searchParams.set("skipintro", "1");
    url.searchParams.delete("menu");

    window.location.href = url.toString();
  });
}
 

  function suspendEmulatorForBackground() {
    if (backgroundSuspended) return;

    backgroundSuspended = true;

    if (emulator) {
      resumeGbaAfterBackground = emulator.emulatorStatus < 0x10;

      if (resumeGbaAfterBackground) {
        try {
          emulator.pause();
        } catch (error) {
          console.error("Pausa en segundo plano GBA:", error);
        }
      }

      stopGbaTimers();
    }

    if (
      window.gbaGB &&
      typeof window.gbaGB.isPaused === "function" &&
      typeof window.gbaGB.pause === "function"
    ) {
      resumeGbAfterBackground = !window.gbaGB.isPaused();

      if (resumeGbAfterBackground) {
        window.gbaGB.pause();
      }
    }
  }

  function resumeEmulatorFromBackground(force = false) {
    if (document.hidden) return;

    if (!backgroundSuspended && !force) return;

    backgroundSuspended = false;

    const dualLinkRunning =
      linkRoomActive &&
      Boolean(window.ML3DLocalLinkSession?.active);

    const gbaNeedsRecovery =
      emulator &&
      (
        resumeGbaAfterBackground ||
        (!linkRoomActive && timer === null) ||
        emulator.emulatorStatus >= 0x10
      );

    if (gbaNeedsRecovery) {
      try {
        emulator.play();
        if (!linkRoomActive) {
          startGbaTimers();
        } else if (!dualLinkRunning) {
          // The dual Link coordinator owns emulated time.
          stopGbaTimers();
        }
        unlockAudio();
      } catch (error) {
        console.error("Reanudación GBA:", error);
      }
    }

    const gbNeedsRecovery =
      window.gbaGB &&
      typeof window.gbaGB.resume === "function" &&
      (
        resumeGbAfterBackground ||
        (
          typeof window.gbaGB.isPaused === "function" &&
          window.gbaGB.isPaused()
        )
      );

    if (gbNeedsRecovery) {
      try {
        window.gbaGB.resume();
      } catch (error) {
        console.error("Reanudación GB/GBC:", error);
      }
    }

    resumeGbaAfterBackground = false;
    resumeGbAfterBackground = false;
  }

  function scheduleEmulatorRecovery() {
    resumeEmulatorFromBackground(true);

    [100, 400, 1000].forEach((delay) => {
      window.setTimeout(() => {
        resumeEmulatorFromBackground(true);
      }, delay);
    });
  }

  function shutdownEmulator() {
    stopGbaTimers();

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

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      suspendEmulatorForBackground();
    } else {
      scheduleEmulatorRecovery();
    }
  });

  window.addEventListener("pagehide", suspendEmulatorForBackground);
  window.addEventListener("pageshow", scheduleEmulatorRecovery);
  window.addEventListener("focus", scheduleEmulatorRecovery);
  window.addEventListener("resume", scheduleEmulatorRecovery);
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

async function showMl3dStartupMessages() {
  try {
    if (window.ml3dEmulatorTools && typeof window.ml3dEmulatorTools.showStartupMessages === "function") {
      await window.ml3dEmulatorTools.showStartupMessages();
    }
  } catch (error) {
    console.warn("No se pudieron mostrar los avisos del emulador:", error);
  }
}

async function startApplication() {
  const params =
    new URLSearchParams(window.location.search);

  if (params.get("dev") === "1") {
    if (!window.ml3dDevAccess || typeof window.ml3dDevAccess.ensureAccess !== "function") {
      status.hidden = false;
      status.style.display = "";
      status.textContent = "No se pudo iniciar el control de acceso de desarrollo.";
      return;
    }
    const accessGranted = await window.ml3dDevAccess.ensureAccess(params);
    if (!accessGranted) return;
  }

  const menuOnly =
    params.get("menu") === "1";

  const skipIntro =
    params.get("skipintro") === "1";

  const bootScreen =
    document.getElementById("boot-screen");

  /*
   * NFC -> MENÚ
   *
   * Logo -> advertencia -> selector.
   *
   * Aquí NO cargamos ningún juego.
   */
  if (menuOnly) {

    if (window.gbaBootIntro) {
      await window.gbaBootIntro.start();
    }

    if (bootScreen) {
      bootScreen.classList.add("boot-finished");
      bootScreen.style.display = "none";
      bootScreen.style.visibility = "hidden";
      bootScreen.style.opacity = "0";
      bootScreen.style.pointerEvents = "none";
    }

    await showMl3dStartupMessages();

    if (window.gbaOpenGameSelector) {
      await window.gbaOpenGameSelector();
    }

    return;
  }

  /*
   * Juego elegido desde cualquier selector.
   *
   * Entra directamente al juego.
   */
  if (skipIntro) {

    if (bootScreen) {
      bootScreen.classList.add("boot-finished");
      bootScreen.style.display = "none";
      bootScreen.style.visibility = "hidden";
      bootScreen.style.opacity = "0";
      bootScreen.style.pointerEvents = "none";
    }

    await showMl3dStartupMessages();
    await loadGame();
    return;
  }

  /*
   * NFC -> JUEGO DIRECTO
   *
   * Logo -> advertencia -> juego.
   */
  if (window.gbaBootIntro) {
    await window.gbaBootIntro.start();
  }

  await showMl3dStartupMessages();
  await loadGame();
}

startApplication();
})();
