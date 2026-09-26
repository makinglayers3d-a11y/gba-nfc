(() => {
  "use strict";

  const CORE_JS = "https://cdn.jsdelivr.net/npm/@wasm-gaming/mgba-wasm@0.1.1/dist/mgba/mgba.js";
  const CORE_WASM = "https://cdn.jsdelivr.net/npm/@wasm-gaming/mgba-wasm@0.1.1/dist/mgba/mgba.wasm";
  const AUDIO_SCRATCH_FRAMES = 4096;
  const MAX_FRAMES_PER_TICK = 5;

  const KEY_BITS = {
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

  const WORKLET_SOURCE = `
class ML3DMgbaSink extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = 65536;
    this.buf = new Float32Array(this.cap * 2);
    this.pos = 0;
    this.w = 0;
    this.ratio = 1;
    this.port.onmessage = (event) => {
      const msg = event.data;
      if (msg && typeof msg === "object" && Number.isFinite(msg.rate)) {
        this.ratio = Math.max(0.05, msg.rate / sampleRate);
        return;
      }
      const samples = msg;
      if (!samples || typeof samples.length !== "number") return;
      const frames = samples.length >> 1;
      for (let i = 0; i < frames; i++) {
        if (this.w - this.pos >= this.cap - 2) {
          this.pos += 1;
        }
        const idx = (this.w % this.cap) * 2;
        this.buf[idx] = samples[i * 2] / 32768;
        this.buf[idx + 1] = samples[i * 2 + 1] / 32768;
        this.w++;
      }
    };
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const left = out[0];
    const right = out[1] || left;
    for (let i = 0; i < left.length; i++) {
      if (this.pos + 1 < this.w) {
        const base = Math.floor(this.pos);
        const frac = this.pos - base;
        const a = (base % this.cap) * 2;
        const b = ((base + 1) % this.cap) * 2;
        left[i] = this.buf[a] + (this.buf[b] - this.buf[a]) * frac;
        right[i] = this.buf[a + 1] + (this.buf[b + 1] - this.buf[a + 1]) * frac;
        this.pos += this.ratio;
      } else {
        left[i] = 0;
        right[i] = 0;
      }
    }
    return true;
  }
}
registerProcessor("ml3d-mgba-sink", ML3DMgbaSink);
`;

  let scriptPromise = null;
  let mod = null;
  let canvas = null;
  let ctx = null;
  let imageData = null;
  let audioCtx = null;
  let sink = null;
  let gain = null;
  let audioPtr = 0;
  let rafId = 0;
  let persistTimer = null;
  let active = false;
  let paused = false;
  let currentSystem = null;
  let currentNamespace = "";
  let keyMask = 0;
  let speed = 0.9;
  let volume = 1;
  let coreRate = 0;
  let framerate = 59.7275;
  let clockStart = 0;
  let emulatedFrames = 0;

  function clamp(value, min, max) {
    return Math.min(Math.max(Number(value), min), max);
  }

  function sanitizeNamespace(filename, saveId) {
    const raw = String(saveId || filename || "game").toLowerCase();
    return raw.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "game";
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      const end = Math.min(offset + chunk, bytes.length);
      for (let i = offset; i < end; i++) binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function saveStorageKey() {
    return "ml3d-mgba-save:" + currentNamespace;
  }

  function loadClassicScript() {
    if (typeof window.createMgbaModule === "function") return Promise.resolve();
    if (scriptPromise) return scriptPromise;

    scriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-ml3d-mgba-core="1"]');
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = CORE_JS;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.dataset.ml3dMgbaCore = "1";
      script.addEventListener("load", resolve, { once: true });
      script.addEventListener("error", () => reject(new Error("No se pudo cargar mGBA.")), { once: true });
      document.head.appendChild(script);
    });

    return scriptPromise;
  }

  function heapAlloc(bytes) {
    const ptr = mod._malloc(bytes.length);
    mod.HEAPU8.set(bytes, ptr);
    return ptr;
  }

  function heapString(value) {
    const size = mod.lengthBytesUTF8(value) + 1;
    const ptr = mod._malloc(size);
    mod.stringToUTF8(value, ptr, size);
    return ptr;
  }

  async function createAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    audioCtx = new AudioContextClass();

    if (!audioCtx.audioWorklet || typeof AudioWorkletNode !== "function") {
      console.warn("mGBA: AudioWorklet no disponible; se ejecutará sin audio.");
      return;
    }

    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
    try {
      await audioCtx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }

    sink = new AudioWorkletNode(audioCtx, "ml3d-mgba-sink", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });
    gain = audioCtx.createGain();
    gain.gain.value = volume;
    sink.connect(gain).connect(audioCtx.destination);
  }

  function syncAudioRate() {
    if (!mod || !sink) return;
    const next = Number(mod._mgbawasm_sample_rate()) || 0;
    if (next > 0) coreRate = next;
    if (coreRate > 0) {
      sink.port.postMessage({ rate: coreRate * speed });
    }
  }

  function drainAudio() {
    if (!mod || !sink || !audioPtr) return;

    for (;;) {
      const frames = mod._mgbawasm_read_audio(audioPtr, AUDIO_SCRATCH_FRAMES);
      if (frames <= 0) break;
      const start = audioPtr >> 1;
      const chunk = mod.HEAP16.slice(start, start + frames * 2);
      sink.port.postMessage(chunk, [chunk.buffer]);
      if (frames < AUDIO_SCRATCH_FRAMES) break;
    }
  }

  function renderFrame() {
    if (!mod || !ctx || !canvas) return;

    const width = mod._mgbawasm_video_width() | 0;
    const height = mod._mgbawasm_video_height() | 0;
    if (width <= 0 || height <= 0) return;

    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    if (!imageData || imageData.width !== width || imageData.height !== height) {
      imageData = ctx.createImageData(width, height);
    }

    const ptr = mod._mgbawasm_video_ptr() | 0;
    const src = mod.HEAPU8.subarray(ptr, ptr + width * height * 4);
    imageData.data.set(src);
    ctx.putImageData(imageData, 0, 0);
  }

  function runFrames(count) {
    if (!mod) return;
    for (let i = 0; i < count; i++) {
      mod._mgbawasm_run_frame();
      drainAudio();
    }
    syncAudioRate();
  }

  function tick(now) {
    if (!active || paused || !mod) return;
    rafId = requestAnimationFrame(tick);

    if (!clockStart) {
      clockStart = now;
      emulatedFrames = 0;
    }

    const targetFps = framerate * speed;
    const due = Math.floor(((now - clockStart) / 1000) * targetFps);
    let frames = due - emulatedFrames;
    frames = Math.max(0, Math.min(MAX_FRAMES_PER_TICK, frames));

    if (frames > 0) {
      runFrames(frames);
      emulatedFrames += frames;
      renderFrame();
    }
  }

  function resetPacingClock() {
    clockStart = performance.now();
    emulatedFrames = 0;
  }

  function persistSave() {
    if (!mod || !currentNamespace) return false;
    try {
      const size = mod._mgbawasm_sram_save() | 0;
      if (size <= 0) return false;
      const ptr = mod._mgbawasm_sram_ptr() | 0;
      if (!ptr) return false;
      const bytes = new Uint8Array(size);
      bytes.set(mod.HEAPU8.subarray(ptr, ptr + size));
      localStorage.setItem(saveStorageKey(), bytesToBase64(bytes));
      return true;
    } catch (error) {
      console.warn("mGBA: no se pudo guardar SRAM:", error);
      return false;
    }
  }

  function restoreSave() {
    if (!mod || !currentNamespace) return false;
    try {
      const encoded = localStorage.getItem(saveStorageKey());
      if (!encoded) return false;
      const bytes = base64ToBytes(encoded);
      const ptr = heapAlloc(bytes);
      const ok = mod._mgbawasm_sram_load(ptr, bytes.length);
      mod._free(ptr);
      return Boolean(ok);
    } catch (error) {
      console.warn("mGBA: no se pudo restaurar SRAM:", error);
      return false;
    }
  }

  async function start({ rom, filename, saveId, canvas: targetCanvas, system, volume: initialVolume = 1, speed: initialSpeed = 0.9 }) {
    await stop();

    canvas = targetCanvas;
    ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) throw new Error("No se pudo abrir el canvas para mGBA.");

    currentSystem = system;
    currentNamespace = sanitizeNamespace(filename, saveId);
    volume = clamp(initialVolume, 0, 1);
    speed = clamp(initialSpeed, 0.1, 4);

    await loadClassicScript();
    if (typeof window.createMgbaModule !== "function") {
      throw new Error("El runtime mGBA no está disponible.");
    }

    mod = await window.createMgbaModule({
      locateFile(path) {
        if (String(path).endsWith(".wasm")) return CORE_WASM;
        return new URL(path, CORE_JS).href;
      }
    });

    mod._mgbawasm_init();
    mod._mgbawasm_set_log_level(1);

    const bytes = rom instanceof Uint8Array ? rom : new Uint8Array(rom);
    const romPtr = heapAlloc(bytes);
    const gbModelPtr = system === "gbc" ? heapString("CGB") : 0;
    const platform = system === "gba" ? 0 : 1;

    const loaded = mod._mgbawasm_load(
      romPtr,
      bytes.length,
      0,
      0,
      platform,
      gbModelPtr,
      1
    );

    mod._free(romPtr);
    if (gbModelPtr) mod._free(gbModelPtr);

    if (!loaded) {
      mod._mgbawasm_unload();
      mod = null;
      throw new Error("mGBA no pudo cargar la ROM.");
    }

    framerate = mod._mgbawasm_framerate_micro() / 1e6 || 59.7275;
    audioPtr = mod._malloc(AUDIO_SCRATCH_FRAMES * 4);

    await createAudio();
    restoreSave();

    keyMask = 0;
    mod._mgbawasm_set_keys(0);

    active = true;
    paused = false;
    resetPacingClock();

    // Prebuffer a few emulated frames before the audio clock starts.
    runFrames(4);
    renderFrame();

    if (audioCtx?.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }

    rafId = requestAnimationFrame(tick);
    persistTimer = window.setInterval(persistSave, 10000);
    return true;
  }

  async function stop() {
    if (persistTimer) {
      clearInterval(persistTimer);
      persistTimer = null;
    }
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }

    if (mod) {
      persistSave();
      try { mod._mgbawasm_set_keys(0); } catch (_) {}
      try { mod._mgbawasm_unload(); } catch (_) {}
      if (audioPtr) {
        try { mod._free(audioPtr); } catch (_) {}
      }
    }

    audioPtr = 0;
    mod = null;
    active = false;
    paused = false;
    currentSystem = null;
    currentNamespace = "";
    keyMask = 0;
    imageData = null;

    try { sink?.disconnect(); } catch (_) {}
    try { gain?.disconnect(); } catch (_) {}
    try { await audioCtx?.close?.(); } catch (_) {}

    sink = null;
    gain = null;
    audioCtx = null;
    canvas = null;
    ctx = null;
  }

  function press(name) {
    if (!active || !mod) return;
    const bit = KEY_BITS[name];
    if (bit === undefined) return;
    keyMask |= 1 << bit;
    mod._mgbawasm_set_keys(keyMask);
    if (audioCtx?.state === "suspended") audioCtx.resume().catch(() => {});
  }

  function release(name) {
    if (!active || !mod) return;
    const bit = KEY_BITS[name];
    if (bit === undefined) return;
    keyMask &= ~(1 << bit);
    mod._mgbawasm_set_keys(keyMask);
  }

  function setVolume(value) {
    volume = clamp(value, 0, 1);
    if (gain) gain.gain.value = volume;
  }

  function setSpeed(value) {
    speed = clamp(value, 0.1, 4);
    resetPacingClock();
    syncAudioRate();
  }

  function pause() {
    if (!active || paused) return;
    paused = true;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    persistSave();
    audioCtx?.suspend?.().catch(() => {});
  }

  function resume() {
    if (!active || !paused) return;
    paused = false;
    resetPacingClock();
    audioCtx?.resume?.().catch(() => {});
    rafId = requestAnimationFrame(tick);
  }

  function reset() {
    if (!active || !mod) return;
    mod._mgbawasm_reset();
    resetPacingClock();
  }

  window.ML3DMgbaCompat = {
    start,
    stop,
    press,
    release,
    pause,
    resume,
    reset,
    setVolume,
    setSpeed,
    save: persistSave,
    isActive: () => active,
    getSystem: () => currentSystem,
    getSpeed: () => speed
  };
})();
