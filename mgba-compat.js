(() => {
  "use strict";

  const SDK_URL = "https://esm.sh/@wasm-gaming/mgba-wasm@0.1.1?bundle";
  const CORE_JS = "https://cdn.jsdelivr.net/npm/@wasm-gaming/mgba-wasm@0.1.1/dist/mgba/mgba.js";
  const CORE_WASM = "https://cdn.jsdelivr.net/npm/@wasm-gaming/mgba-wasm@0.1.1/dist/mgba/mgba.wasm";

  const CODE_BY_KEY = {
    A: "F13",
    B: "F14",
    SELECT: "F15",
    START: "F16",
    RIGHT: "F17",
    LEFT: "F18",
    UP: "F19",
    DOWN: "F20",
    R: "F21",
    L: "F22"
  };

  const INPUT_MAP = {
    "p1.a": "F13",
    "p1.b": "F14",
    "p1.select": "F15",
    "p1.start": "F16",
    "p1.right": "F17",
    "p1.left": "F18",
    "p1.up": "F19",
    "p1.down": "F20",
    "p1.r": "F21",
    "p1.l": "F22"
  };

  let sdkPromise = null;
  let instance = null;
  let active = false;
  let activeSystem = null;
  let activeSpeed = 0.9;
  let activeVolume = 1;

  function getSdk() {
    if (!sdkPromise) sdkPromise = import(SDK_URL);
    return sdkPromise;
  }

  function namespaceFor(filename, saveId) {
    const base = String(saveId || filename || "compat")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return "ml3d-compat-" + (base || "game");
  }

  function dispatchVirtual(code, down) {
    if (!active || !code) return;
    window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", {
      code,
      key: code,
      bubbles: true,
      cancelable: true
    }));
  }

  async function stop() {
    const current = instance;
    instance = null;
    active = false;
    activeSystem = null;
    if (current) {
      try {
        current.destroy();
      } catch (error) {
        console.warn("mGBA compat: error al detener el núcleo:", error);
      }
    }
  }

  async function start({ rom, filename, saveId, canvas, system, volume = 1, speed = 0.9 }) {
    await stop();

    // During mGBA validation, bypass all post-processing. This makes the
    // canvas a direct view of the core output and avoids mixing renderer bugs
    // with ScaleFX/xBR issues.
    try {
      window.ML3DGraphics?.setMode?.("original", false);
    } catch (_) {}

    const sdk = await getSdk();
    if (!sdk || typeof sdk.load !== "function") {
      throw new Error("No se pudo cargar el núcleo mGBA de compatibilidad.");
    }

    const bytes = rom instanceof Uint8Array ? rom : new Uint8Array(rom);
    activeVolume = Math.max(0, Math.min(1, Number(volume) || 0));
    activeSpeed = Math.max(0.1, Math.min(4, Number(speed) || 0.9));

    instance = await sdk.load({
      assets: { rom: bytes },
      canvasEl: canvas,
      storageNamespace: namespaceFor(filename, saveId),
      jsUrl: CORE_JS,
      wasmUrl: CORE_WASM,
      options: {
        system: system === "gba" ? "gba" : "auto",
        gbModel: "auto",
        skipBios: true,
        renderFilter: "pixelated",
        aspect: "native",
        interframeBlending: false,
        volume: activeVolume,
        gamepads: false,
        escMenu: false
      },
      persist: {},
      onEvent(event) {
        if (event && event.type === "exit") active = false;
      }
    });

    instance.setInput(INPUT_MAP);
    instance.start();
    active = true;
    activeSystem = system;
    return true;
  }

  function setVolume(value) {
    activeVolume = Math.max(0, Math.min(1, Number(value) || 0));
    instance?.config?.write?.("volume", activeVolume);
  }

  // The current upstream browser SDK does not expose an emulator-speed option.
  // Keep the requested value so the UI remains stable, but do not alter core
  // timing while compatibility is being validated.
  function setSpeed(value) {
    activeSpeed = Math.max(0.1, Math.min(4, Number(value) || 0.9));
  }

  function press(keyName) {
    dispatchVirtual(CODE_BY_KEY[keyName], true);
  }

  function release(keyName) {
    dispatchVirtual(CODE_BY_KEY[keyName], false);
  }

  function pause() {
    try { instance?.pause?.(); } catch (_) {}
  }

  function resume() {
    try { instance?.resume?.(); } catch (_) {}
  }

  function reset() {
    try { instance?.reset?.(); } catch (_) {}
  }

  function save() {
    // SDK persists SRAM itself. pause/resume is used as an immediate flush.
    try {
      if (instance) {
        instance.pause();
        instance.resume();
      }
    } catch (_) {}
  }

  window.ML3DMgbaCompat = {
    start,
    stop,
    press,
    release,
    pause,
    resume,
    reset,
    save,
    setVolume,
    setSpeed,
    isActive: () => active,
    getSystem: () => activeSystem,
    getSpeed: () => activeSpeed,
    getInstance: () => instance
  };
})();
