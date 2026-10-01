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

/* De donde se baja de verdad un juego o una caratula.
 *
 * Las rutas logicas ("games/X.gba") se conservan tal cual en todo el codigo:
 * de ellas cuelgan el identificador de las partidas guardadas, el sistema y el
 * nombre que se muestra. Cambiarlas por direcciones del worker romperia las
 * partidas de quien ya tiene alguna. Asi que solo se traducen en el momento de
 * descargar, y nada mas. */
function urlDeContenido(rutaLogica) {
  const contenido = window.ML3DContenido;
  const ruta = String(rutaLogica || "");
  if (contenido) {
    if (ruta.startsWith("games/")) {
      const url = contenido.urlJuego(ruta.slice("games/".length));
      if (url) return url;
    } else if (ruta.startsWith("covers/")) {
      const url = contenido.urlCaratula(ruta.slice("covers/".length));
      if (url) return url;
    }
  }
  /* Sin acceso o sin worker: la ruta publica de siempre, que sigue existiendo
     mientras no se retire el contenido del repositorio. */
  return ruta;
}

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
  /* Con el lobby abierto sobre la pantalla, los botones son suyos. Va lo
     primero: si no, no hay forma de manejar el lobby desde un movil, donde el
     unico mando son los botones de la propia pantalla. */
  if (window.ML3DLobbyOverlay?.handleKey(keyName, true)) return;

  if (window.ML3DMgbaCompat?.isActive?.()) {
    window.ML3DMgbaCompat.press(keyName);
    return;
  }

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

  const value = keyMap[keyName];

  if (value === undefined) return;

  /* La sesión Link ya no depende de parámetros en la URL: el lobby la
     configura en caliente, así que se consulta siempre. Va antes de mirar
     `emulator`, que es null cuando el juego corre sobre mGBA: la sesión
     tiene sus propios núcleos y no necesita el de IodineGBA. */
  if (window.ML3DLocalLinkSession?.handleLocalKey) {
    const consumed = window.ML3DLocalLinkSession.handleLocalKey(value, true);
    if (consumed) return;
  }

  if (!emulator) return;

  emulator.keyDown(value);
}

 function releaseKey(keyName) {
  /* Igual que en pressKey: el lobby abierto se queda los botones. */
  if (window.ML3DLobbyOverlay?.handleKey(keyName, false)) return;

  if (window.ML3DMgbaCompat?.isActive?.()) {
    window.ML3DMgbaCompat.release(keyName);
    return;
  }

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

  const value = keyMap[keyName];

  if (value === undefined) return;

  /* La sesión Link ya no depende de parámetros en la URL: el lobby la
     configura en caliente, así que se consulta siempre. Va antes de mirar
     `emulator`, que es null cuando el juego corre sobre mGBA: la sesión
     tiene sus propios núcleos y no necesita el de IodineGBA. */
  if (window.ML3DLocalLinkSession?.handleLocalKey) {
    const consumed = window.ML3DLocalLinkSession.handleLocalKey(value, false);
    if (consumed) return;
  }

  if (!emulator) return;

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

  if (window.ML3DMgbaCompat?.isActive?.()) {
    window.ML3DMgbaCompat.setVolume(effectiveVolume);
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
  
/* --- Soporte para el juego que pide la sala Link ---------------------------
   Traído de test/lobby-en-emulador-2026-09-23 (cee9f8b), que es donde vive el
   lobby de cuatro jugadores. Solo esto: el resto de aquel app.js no sirve
   porque se cortó antes de que mGBA llegara a main y quita sus ganchos. */
function normalizeGameName(value) {
  return String(value || "")
    .replace(/\.(gba|gbc|gb)$/i, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

let libraryCatalog = null;

async function findLibraryRom(normalizedName) {
  if (!libraryCatalog) {
    try {
      const response = await fetch("games-catalog.json", { cache: "no-store" });
      const entries = await response.json();
      libraryCatalog = (Array.isArray(entries) ? entries : [])
        .map((entry) => String(entry?.name || entry || ""))
        .filter((name) => /\.(gba|gbc|gb)$/i.test(name));
    } catch (error) {
      console.warn("ML3D Link: no se pudo leer el catálogo de juegos.", error);
      libraryCatalog = [];
    }
  }
  return libraryCatalog.find((name) => normalizeGameName(name) === normalizedName) || "";
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
  /* Abre el juego que la sala ha elegido, si no es el que ya está puesto, y si
     lo es lo reinicia limpio. Lo llama LocalLinkSession al configurarse. */
  async prepareForLink(game) {
    const wanted = normalizeGameName(game);
    if (!wanted || wanted === normalizeGameName(selected?.name)) {
      return this.restartForLink();
    }

    const filename = await findLibraryRom(wanted);
    if (!filename) {
      console.warn("ML3D Link: la sala pide un juego que no está en esta biblioteca:", game);
      return this.restartForLink();
    }

    const response = await fetch(urlDeContenido("games/" + filename), { cache: "force-cache" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return startRomFromBytes(bytes, filename, {
      system: systemFromFilename(filename),
      saveId: filename.replace(/\.(gba|gbc|gb)$/i, ""),
      displayName: filename.replace(/\.(gba|gbc|gb)$/i, ""),
      source: "remote",
      romPath: "games/" + filename,
      skipSaveRestore: true
    });
  },
  /* Devuelve la pantalla al camino normal cuando la sesión Link termina: el
     runtime multi-instancia se la ha quedado y hay que recuperar el núcleo de
     siempre, esta vez restaurando la partida guardada. */
  async resumeNormal() {
    if (currentSystem !== "gba" || !currentGbaRomBytes || !currentGbaRomFilename) return false;
    return startRomFromBytes(currentGbaRomBytes.slice(), currentGbaRomFilename, {
      system: "gba",
      saveId: currentSaveId,
      displayName: selected.name,
      source: currentSource,
      romPath: selected.rom
    });
  },
  /* Reinicia la ROM actual sin partida guardada, que es como debe empezar una
     sesión Link: LocalLinkSession lo llama al configurarse desde el lobby. */
  async restartForLink() {
    if (currentSystem !== "gba" || !currentGbaRomBytes || !currentGbaRomFilename) return false;
    return startRomFromBytes(currentGbaRomBytes.slice(), currentGbaRomFilename, {
      system: "gba",
      saveId: currentSaveId,
      displayName: selected.name,
      source: currentSource,
      romPath: selected.rom,
      skipSaveRestore: true
    });
  },
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
    if (window.ml3dStartupGateLocked) return;
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
    if (window.ml3dStartupGateLocked) {
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

    if (window.ML3DMgbaCompat?.isActive?.()) {
      try {
        await window.ML3DMgbaCompat.stop();
      } catch (error) {
        console.warn("No se pudo detener mGBA compat limpiamente:", error);
      }
      window.__gba = null;
    }

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

  function applyCalibratedGbaPace(legacySpeedValue) {
    if (!emulator) return;

    const legacySpeed = Number(legacySpeedValue);
    const safeLegacySpeed =
      Number.isFinite(legacySpeed) && legacySpeed > 0
        ? legacySpeed
        : 0.9;

    emulator.setSpeed(1);
    emulator.setIntervalRate(16 * safeLegacySpeed);
  }

  function isIOSWebKit() {
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    const touchMac = platform === "MacIntel" && navigator.maxTouchPoints > 1;
    const detected = /iPad|iPhone|iPod/i.test(ua) || touchMac;
    document.documentElement.classList.toggle("ml3d-ios", detected);
    return detected;
  }

  // Mark iOS before any menu interaction so Safari gets the stable touch path
  // even when the menu is opened before a ROM has started.
  isIOSWebKit();

  function shouldUseMgbaCompat() {
    // mGBA's browser/WASM runtime can stall shortly after startup on iOS
    // WebKit. Keep iPhone/iPad on the proven legacy cores while preserving
    // mGBA for single-player on the rest of the platforms.
    if (isIOSWebKit()) return false;
    return !linkRoomActive;
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

    /* Antes de bifurcar por núcleo: la sesión Link pide la ROM por
       ML3DLinkRuntime.romBytes, y solo se guardaba en la rama de IodineGBA.
       Con el juego normal en mGBA salía null y el enlace no llegaba a armarse. */
    if (system === "gba") {
      currentGbaRomBytes = rom.slice();
      currentGbaRomFilename = filename;
    }

    if (shouldUseMgbaCompat()) {
      if (!window.ML3DMgbaCompat?.start) {
        throw new Error("Falta el núcleo mGBA de compatibilidad.");
      }

      canvas.width = system === "gba" ? 240 : 160;
      canvas.height = system === "gba" ? 160 : 144;

      const effectiveVolume =
        audioMuted
          ? 0
          : audioVolume * (gameMenuAudioDucked ? GAME_MENU_VOLUME_FACTOR : 1);

      const storedSpeedRaw = localStorage.getItem("gba-speed");
      let savedSpeed = Number(storedSpeedRaw == null ? "0.9" : storedSpeedRaw);
      if (!Number.isFinite(savedSpeed) || savedSpeed <= 0) {
        savedSpeed = 0.9;
        localStorage.setItem("gba-speed", "0.9");
      }
      if (speedSelect) speedSelect.value = String(savedSpeed);

      await window.ML3DMgbaCompat.start({
        rom,
        filename,
        displayName: selected.name,
        saveId: currentSaveId,
        canvas,
        system,
        volume: effectiveVolume,
        speed: savedSpeed
      });

      emulator = null;
      window.__gba = system === "gba" ? { compatCore: "mgba" } : null;
    } else if (system === "gb" || system === "gbc") {
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
      if (!Number.isFinite(savedSpeed) || savedSpeed <= 0) {
        savedSpeed = 0.9;
        localStorage.setItem("gba-speed", "0.9");
      }

      applyCalibratedGbaPace(savedSpeed);
      if (speedSelect) speedSelect.value = String(savedSpeed);
      emulator.attachPlayStatusHandler(() => {});
      emulator.settings.offthreadGfxEnabled = false;
      emulator.settings.SKIPBoot = true;
      const blitter = new GfxGlueCode(240, 160);
      blitter.attachCanvas(canvas);
      emulator.attachGraphicsFrameHandler(blitter);
      emulator.attachROM(rom);
      if (audioInput) {
        emulator.attachAudioHandler(audioInput);
        emulator.enableAudio();
      }
      emulator.play();

      /* En una partida Link los núcleos de cada jugador arrancan desde la ROM
         limpia: restaurar la partida guardada los desincronizaría. */
      if (!linkRoomActive && options.skipSaveRestore !== true) {
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

      const response = await fetch(urlDeContenido(selected.rom), {
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

     if (window.ML3DMgbaCompat?.isActive?.()) {
      window.ML3DMgbaCompat.setSpeed(speed);
    } else if (emulator) {
      applyCalibratedGbaPace(speed);
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
  let menuCloseInProgress = false;

  async function closeMenuAnimated() {
    if (!menu.open || menuCloseInProgress) return;

    const card = menu.querySelector(".menu-card");
    menuCloseInProgress = true;
    menu.classList.add("menu-closing-comic");

    await new Promise((resolve) => {
      if (!card) {
        resolve();
        return;
      }

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        card.removeEventListener("animationend", onAnimationEnd);
        resolve();
      };
      const onAnimationEnd = (event) => {
        if (event.target === card) finish();
      };

      card.addEventListener("animationend", onAnimationEnd);
      window.setTimeout(finish, 420);
    });

    if (menu.open) menu.close();
    menu.classList.remove("menu-closing-comic");
    menuCloseInProgress = false;
  }

  closeMenu.addEventListener("click", (event) => {
    event.preventDefault();
    void closeMenuAnimated();
  });

  async function exportLegacySaveForDevice() {
  try {
    const isGBFamily = currentSystem === "gb" || currentSystem === "gbc";

    if (isGBFamily) {
      window.gbaGB?.save?.();
      const encoded = localStorage.getItem("gba-gb-save:" + currentSaveId);
      return encoded ? new Uint8Array(JSON.parse(encoded)) : null;
    }

    if (emulator) {
      emulator.exportSave();
      const prefix = "gba-save:" + currentSaveId + ":";
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key || !key.startsWith(prefix)) continue;
        const encoded = localStorage.getItem(key);
        if (encoded) return base64ToBytes(encoded);
      }
    }
  } catch (error) {
    console.warn("No se pudo preparar el save para exportación:", error);
  }
  return null;
}

function currentLocalSaveContext() {
  return {
    running: Boolean(
      window.ML3DMgbaCompat?.isActive?.() ||
      emulator ||
      (window.gbaGB && typeof window.gbaGB.isRunning === "function" && window.gbaGB.isRunning())
    ),
    core: window.ML3DMgbaCompat?.isActive?.() ? "mgba" : "legacy",
    system: currentSystem,
    displayName: selected?.name || currentGbaRomFilename || "partida",
    filename: currentGbaRomFilename || selected?.rom || "",
    saveId: currentSaveId,
    mgbaNamespace: window.ML3DMgbaCompat?.getNamespace?.() || "",
    exportLegacySave: exportLegacySaveForDevice
  };
}

window.ML3DLocalSave?.setContextProvider?.(currentLocalSaveContext);

async function manualSaveToDevice() {
  try {
    // Keep the browser save first, regardless of the external-backup choice.
    if (window.ML3DMgbaCompat?.isActive?.()) {
      await window.ML3DMgbaCompat.flushSave?.();
    } else if (currentSystem === "gb" || currentSystem === "gbc") {
      window.gbaGB?.save?.();
    } else if (emulator) {
      emulator.exportSave();
    }

    return await window.ML3DLocalSave?.manualSave?.();
  } catch (error) {
    console.error("Error guardando la partida:", error);
    return false;
  }
}

window.gbaManualSaveToDevice = manualSaveToDevice;

if (saveGameButton) {
  saveGameButton.addEventListener("click", async () => {
    await manualSaveToDevice();
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

    if (window.ML3DMgbaCompat?.isActive?.()) {
      window.ML3DMgbaCompat.pause();
    }

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

    if (window.ML3DMgbaCompat?.isActive?.()) {
      window.ML3DMgbaCompat.resume();
    }

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

    if (window.ML3DMgbaCompat?.isActive?.()) {
      window.ML3DMgbaCompat.stop();
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

  const bootScreen =
    document.getElementById("boot-screen");

  if (params.get("noticePreview") === "1") {
    if (bootScreen) {
      bootScreen.classList.add("boot-finished");
      bootScreen.style.display = "none";
      bootScreen.style.visibility = "hidden";
      bootScreen.style.opacity = "0";
      bootScreen.style.pointerEvents = "none";
    }
    status.hidden = true;
    status.style.display = "none";
    document.documentElement.classList.add("ml3d-notice-preview-mode");
    window.__ML3D_NOTICE_PREVIEW_READY__ = true;
    return;
  }

  if (params.get("demo")) {
    if (!window.ml3dDemoGate || typeof window.ml3dDemoGate.ensureAccess !== "function") {
      status.hidden = false;
      status.style.display = "";
      status.textContent = "No se pudo iniciar el control de la demo.";
      return;
    }
    const demoGranted = await window.ml3dDemoGate.ensureAccess(params);
    if (!demoGranted) return;
  }

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

  if (typeof window.ml3dReleaseStartupGate === "function") {
    window.ml3dReleaseStartupGate();
  }
  await Promise.resolve(window.ml3dStartupGatePromise).catch(() => {});

  const menuOnly =
    params.get("menu") === "1";

  const skipIntro =
    params.get("skipintro") === "1";

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
