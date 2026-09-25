(() => {
  "use strict";

  const STORAGE_KEY = "ml3d-graphics-mode";
  const VALID_MODES = new Set(["original", "sharp", "hd", "ultra"]);
  const MODE_LABELS = {
    original: "ORIGINAL",
    sharp: "NÍTIDO",
    hd: "HD",
    ultra: "ULTRA"
  };

  const source = document.getElementById("screen");
  if (!source) return;

  const frame = source.closest(".screen-frame");
  const overlay = document.createElement("canvas");
  overlay.id = "ml3d-enhanced-screen";
  overlay.setAttribute("aria-hidden", "true");
  source.insertAdjacentElement("afterend", overlay);

  const style = document.createElement("style");
  style.id = "ml3d-graphics-enhancer-style";
  style.textContent = `
    #ml3d-enhanced-screen{
      position:absolute;
      inset:0;
      z-index:2;
      display:none;
      width:100%;
      height:100%;
      background:#000;
      pointer-events:none;
      image-rendering:pixelated;
      image-rendering:crisp-edges;
    }
    .screen-frame.ml3d-graphics-ultra #ml3d-enhanced-screen{
      image-rendering:auto;
    }
    .screen-frame.ml3d-graphics-active #screen{
      opacity:0;
    }
    .screen-frame.ml3d-graphics-active #ml3d-enhanced-screen{
      display:block;
    }
    .screen-frame #status{
      z-index:20;
    }
    .ml3d-graphics-control{
      display:grid;
      grid-template-columns:56px minmax(0,1fr);
      align-items:center;
      gap:7px;
      margin:8px 0 0;
    }
    .ml3d-graphics-title{
      color:#fff;
      font-size:.72rem;
      font-weight:800;
      line-height:1;
    }
    .ml3d-graphics-modes{
      display:grid;
      grid-template-columns:repeat(4,minmax(0,1fr));
      gap:4px;
      min-width:0;
    }
    #menu .ml3d-graphics-modes button{
      min-width:0;
      min-height:30px;
      height:30px;
      padding:3px 2px;
      font-size:.61rem;
      font-weight:900;
      line-height:1;
      letter-spacing:0;
    }
    #menu .ml3d-graphics-modes button.active{
      border-color:#d8ffff!important;
      box-shadow:0 0 14px #63f4ff,inset 0 0 12px #a9ffff45!important;
      filter:brightness(1.16);
    }
    .ml3d-graphics-note{
      position:absolute;
      width:1px;
      height:1px;
      padding:0;
      margin:-1px;
      overflow:hidden;
      clip:rect(0,0,0,0);
      white-space:nowrap;
      border:0;
    }
    @media (max-width:380px){
      .ml3d-graphics-control{
        grid-template-columns:48px minmax(0,1fr);
        gap:5px;
      }
      .ml3d-graphics-title{
        font-size:.66rem;
      }
      #menu .ml3d-graphics-modes button{
        font-size:.56rem;
      }
    }
  `;
  document.head.appendChild(style);

  const ctx = overlay.getContext("2d", {
    alpha: false,
    desynchronized: true
  });

  const capture = document.createElement("canvas");
  const captureCtx = capture.getContext("2d", {
    alpha: false,
    willReadFrequently: true
  });

  let mode = "original";
  let rafId = 0;
  let lastW = 0;
  let lastH = 0;

  let worker = null;
  let workerReady = false;
  let workerBusy = false;
  let workerFailed = false;
  let workerFrameId = 0;
  let lastPresentedWorkerFrame = 0;

  let syncLastRun = 0;
  let syncInterval = 1000 / 30;
  let syncCosts = [];
  let hdImageData = null;
  let scale2xImageData = null;

  function readStoredMode() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) || "original";
      return VALID_MODES.has(saved) ? saved : "original";
    } catch (_) {
      return "original";
    }
  }

  function writeStoredMode(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (_) {}
  }

  function setNote(text) {
    const note = document.getElementById("ml3d-graphics-note");
    if (note) note.textContent = text;
  }

  function ensureCaptureSize(w, h) {
    if (capture.width !== w) capture.width = w;
    if (capture.height !== h) capture.height = h;
  }

  function ensureOverlaySize(w, h) {
    if (overlay.width !== w) overlay.width = w;
    if (overlay.height !== h) overlay.height = h;
  }

  function grabSourceFrame(w, h) {
    ensureCaptureSize(w, h);
    captureCtx.imageSmoothingEnabled = false;
    captureCtx.clearRect(0, 0, w, h);
    captureCtx.drawImage(source, 0, 0, w, h);
    return captureCtx.getImageData(0, 0, w, h);
  }

  function presentXBRBuffer(buffer, width, height) {
    ensureOverlaySize(width, height);

    if (
      !hdImageData ||
      hdImageData.width !== width ||
      hdImageData.height !== height
    ) {
      hdImageData = ctx.createImageData(width, height);
    }

    hdImageData.data.set(new Uint8ClampedArray(buffer));
    ctx.putImageData(hdImageData, 0, 0);
  }

  function initWorker() {
    if (worker || workerFailed || typeof Worker !== "function") return;

    try {
      worker = new Worker("graphics-enhancer-worker.js?v=xbr-2");

      worker.onmessage = (event) => {
        const data = event.data || {};

        if (data.type === "error") {
          console.warn("ML3D Graphics xBR worker:", data.message);
          workerFailed = true;
          workerBusy = false;
          worker?.terminate();
          worker = null;
          updateNoteForMode();
          return;
        }

        if (data.type !== "frame") return;

        workerReady = true;
        workerBusy = false;

        if (
          (mode !== "hd" && mode !== "ultra") ||
          data.mode !== mode ||
          data.id < lastPresentedWorkerFrame ||
          !data.buffer
        ) {
          return;
        }

        lastPresentedWorkerFrame = data.id;
        presentXBRBuffer(data.buffer, data.width, data.height);
      };

      worker.onerror = (event) => {
        console.warn("ML3D Graphics: xBR worker no disponible.", event.message);
        workerFailed = true;
        workerBusy = false;
        worker?.terminate();
        worker = null;
        updateNoteForMode();
      };
    } catch (error) {
      console.warn("ML3D Graphics: no se pudo crear el worker xBR.", error);
      workerFailed = true;
      worker = null;
    }
  }

  function dispatchXBRWorker(w, h, targetMode) {
    if (!worker || workerBusy) return false;

    try {
      const input = grabSourceFrame(w, h);
      const id = ++workerFrameId;
      const ultra = targetMode === "ultra";
      workerBusy = true;

      worker.postMessage(
        {
          type: "scale",
          id,
          mode: targetMode,
          factor: ultra ? 4 : 2,
          blendColors: ultra,
          width: w,
          height: h,
          buffer: input.data.buffer
        },
        [input.data.buffer]
      );

      return true;
    } catch (error) {
      console.warn("ML3D Graphics: error enviando fotograma a xBR.", error);
      workerFailed = true;
      workerBusy = false;
      worker?.terminate();
      worker = null;
      return false;
    }
  }

  function renderXBRSynchronous(w, h, now, targetMode) {
    if (now - syncLastRun < syncInterval) return true;

    const ultra = targetMode === "ultra";
    const scaler = ultra ? window.xBRjs?.xbr4x : window.xBRjs?.xbr2x;
    if (typeof scaler !== "function") return false;

    const started = performance.now();

    try {
      const input = grabSourceFrame(w, h);
      const input32 = new Uint32Array(
        input.data.buffer,
        input.data.byteOffset,
        input.data.byteLength / 4
      );

      const factor = ultra ? 4 : 2;
      const output = scaler(
        input32,
        w,
        h,
        {
          blendColors: ultra,
          scaleAlpha: false
        }
      );

      presentXBRBuffer(output.buffer, w * factor, h * factor);
      syncLastRun = now;

      const cost = performance.now() - started;
      syncCosts.push(cost);
      if (syncCosts.length > 24) syncCosts.shift();

      if (syncCosts.length >= 12) {
        const average =
          syncCosts.reduce((sum, value) => sum + value, 0) /
          syncCosts.length;

        syncInterval =
          ultra
            ? average > 40
              ? 1000 / 12
              : average > 24
                ? 1000 / 18
                : 1000 / 30
            : average > 24
              ? 1000 / 20
              : average > 13
                ? 1000 / 30
                : 1000 / 60;
      }

      return true;
    } catch (error) {
      console.warn("ML3D Graphics: xBR síncrono falló.", error);
      return false;
    }
  }

  function samePixel(data, a, b) {
    return data[a] === data[b] &&
      data[a + 1] === data[b + 1] &&
      data[a + 2] === data[b + 2] &&
      data[a + 3] === data[b + 3];
  }

  function copyPixel(src, srcIndex, dst, dstIndex) {
    dst[dstIndex] = src[srcIndex];
    dst[dstIndex + 1] = src[srcIndex + 1];
    dst[dstIndex + 2] = src[srcIndex + 2];
    dst[dstIndex + 3] = src[srcIndex + 3];
  }

  function renderScale2xFallback(w, h) {
    const input = grabSourceFrame(w, h);
    const outW = w * 2;
    const outH = h * 2;

    ensureOverlaySize(outW, outH);

    if (
      !scale2xImageData ||
      scale2xImageData.width !== outW ||
      scale2xImageData.height !== outH
    ) {
      scale2xImageData = ctx.createImageData(outW, outH);
    }

    const src = input.data;
    const dst = scale2xImageData.data;

    for (let y = 0; y < h; y++) {
      const yUp = y > 0 ? y - 1 : y;
      const yDown = y < h - 1 ? y + 1 : y;

      for (let x = 0; x < w; x++) {
        const xLeft = x > 0 ? x - 1 : x;
        const xRight = x < w - 1 ? x + 1 : x;

        const e = (y * w + x) * 4;
        const b = (yUp * w + x) * 4;
        const d = (y * w + xLeft) * 4;
        const f = (y * w + xRight) * 4;
        const hpx = (yDown * w + x) * 4;

        let e0 = e;
        let e1 = e;
        let e2 = e;
        let e3 = e;

        if (!samePixel(src, b, hpx) && !samePixel(src, d, f)) {
          if (samePixel(src, d, b)) e0 = d;
          if (samePixel(src, b, f)) e1 = f;
          if (samePixel(src, d, hpx)) e2 = d;
          if (samePixel(src, hpx, f)) e3 = f;
        }

        const row0 = ((y * 2) * outW + x * 2) * 4;
        const row1 = (((y * 2) + 1) * outW + x * 2) * 4;
        copyPixel(src, e0, dst, row0);
        copyPixel(src, e1, dst, row0 + 4);
        copyPixel(src, e2, dst, row1);
        copyPixel(src, e3, dst, row1 + 4);
      }
    }

    ctx.putImageData(scale2xImageData, 0, 0);
  }

  function renderSharp(w, h) {
    const rect = source.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.max(w, Math.round(rect.width * dpr));
    const targetH = Math.max(h, Math.round(rect.height * dpr));

    ensureOverlaySize(targetW, targetH);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.drawImage(source, 0, 0, overlay.width, overlay.height);
  }

  function renderLCD(w, h) {
    const outW = w * 2;
    const outH = h * 2;
    ensureOverlaySize(outW, outH);

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, outW, outH);
    ctx.drawImage(source, 0, 0, outW, outH);

    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "rgba(16,24,22,.16)";
    for (let y = 1; y < outH; y += 2) {
      ctx.fillRect(0, y, outW, 1);
    }
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = "rgba(220,255,238,.035)";
    for (let x = 0; x < outW; x += 3) {
      ctx.fillRect(x, 0, 1, outH);
    }
    ctx.restore();
  }

  function renderXBRMode(w, h, now, targetMode) {
    initWorker();

    if (worker && !workerFailed) {
      dispatchXBRWorker(w, h, targetMode);
      return;
    }

    if (renderXBRSynchronous(w, h, now, targetMode)) return;
    renderScale2xFallback(w, h);
  }

  function renderFrame(now) {
    rafId = requestAnimationFrame(renderFrame);
    if (mode === "original") return;

    const w = source.width | 0;
    const h = source.height | 0;
    if (!w || !h) return;

    if (w !== lastW || h !== lastH) {
      lastW = w;
      lastH = h;
      hdImageData = null;
      scale2xImageData = null;
      workerFrameId = 0;
      lastPresentedWorkerFrame = 0;
    }

    try {
      if (mode === "hd" || mode === "ultra") {
        renderXBRMode(w, h, now, mode);
      } else {
        renderSharp(w, h);
      }
    } catch (error) {
      console.warn("ML3D Graphics: no se pudo procesar el fotograma.", error);
      setMode("original");
    }
  }

  function updateButtons() {
    document.querySelectorAll("[data-ml3d-graphics-mode]").forEach((button) => {
      const active = button.dataset.ml3dGraphicsMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");

      if (button.dataset.ml3dGraphicsMode === "hd") {
        button.title = "xBR 2× fiel: reconstruye bordes conservando la paleta";
      } else if (button.dataset.ml3dGraphicsMode === "ultra") {
        button.title = "xBR 4× agresivo: suavizado fuerte y apariencia remasterizada";
      }
    });
  }

  function updateNoteForMode() {
    if (mode === "original") {
      setNote("Imagen original del núcleo, sin procesamiento.");
    } else if (mode === "sharp") {
      setNote("NÍTIDO: escalado nearest-neighbor limpio.");
    } else if (mode === "ultra") {
      setNote("ULTRA: xBR 4× agresivo con suavizado final, cambio visual fuerte.");
    } else if (workerFailed) {
      setNote("HD: xBR 2× en modo compatible, sin modificar colores.");
    } else {
      setNote("HD: xBR 2× real, bordes reconstruidos y colores originales.");
    }
  }

  function setMode(nextMode, persist = true) {
    if (!VALID_MODES.has(nextMode)) nextMode = "original";
    mode = nextMode;

    const active = mode !== "original";
    frame?.classList.toggle("ml3d-graphics-active", active);
    source.style.opacity = active ? "0" : "";
    overlay.style.display = active ? "block" : "none";

    frame?.classList.toggle("ml3d-graphics-ultra", mode === "ultra");

    if (mode === "hd" || mode === "ultra") {
      initWorker();
    }

    if (!active) {
      overlay.width = 1;
      overlay.height = 1;
      hdImageData = null;
      scale2xImageData = null;
    }

    updateButtons();
    updateNoteForMode();

    if (persist) writeStoredMode(mode);

    window.dispatchEvent(new CustomEvent("ml3dgraphicschange", {
      detail: {
        mode,
        label: MODE_LABELS[mode],
        backend:
          mode === "hd" || mode === "ultra"
            ? worker && !workerFailed
              ? mode === "ultra"
                ? "xbr4x-worker"
                : "xbr2x-worker"
              : mode === "ultra" && window.xBRjs?.xbr4x
                ? "xbr4x"
                : window.xBRjs?.xbr2x
                  ? "xbr2x"
                  : "scale2x"
            : "2d"
      }
    }));
  }

  function installMenu() {
    const menuCard = document.querySelector("#menu .menu-card");
    if (!menuCard || document.getElementById("ml3d-graphics-control")) return;

    const section = document.createElement("section");
    section.id = "ml3d-graphics-control";
    section.className = "ml3d-graphics-control";
    section.innerHTML = `
      <span class="ml3d-graphics-title">Gráficos</span>
      <div class="ml3d-graphics-modes" role="group" aria-label="Calidad gráfica">
        <button type="button" data-ml3d-graphics-mode="original">ORIGINAL</button>
        <button type="button" data-ml3d-graphics-mode="sharp">NÍTIDO</button>
        <button type="button" data-ml3d-graphics-mode="hd">HD</button>
        <button type="button" data-ml3d-graphics-mode="ultra">ULTRA</button>
      </div>
      <small id="ml3d-graphics-note" class="ml3d-graphics-note"></small>
    `;

    const audio = menuCard.querySelector(".audio-control");
    if (audio) audio.insertAdjacentElement("beforebegin", section);
    else menuCard.appendChild(section);

    section.addEventListener("click", (event) => {
      const button = event.target.closest("[data-ml3d-graphics-mode]");
      if (!button) return;
      setMode(button.dataset.ml3dGraphicsMode);
    });

    updateButtons();
    updateNoteForMode();
  }

  window.ML3DGraphics = {
    setMode,
    getMode: () => mode,
    getBackend: () => {
      if (mode !== "hd" && mode !== "ultra") return "2d";
      if (worker && !workerFailed) {
        return mode === "ultra" ? "xbr4x-worker" : "xbr2x-worker";
      }
      if (mode === "ultra" && window.xBRjs?.xbr4x) return "xbr4x";
      if (window.xBRjs?.xbr2x) return "xbr2x";
      return "scale2x";
    },
    getDisplayCanvas: () => mode === "original" ? source : overlay,
    modes: { ...MODE_LABELS }
  };

  installMenu();
  setMode(readStoredMode(), false);
  rafId = requestAnimationFrame(renderFrame);

  window.addEventListener("beforeunload", () => {
    if (rafId) cancelAnimationFrame(rafId);
    worker?.terminate();
  }, { once: true });
})();
