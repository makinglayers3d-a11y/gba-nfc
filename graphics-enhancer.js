(() => {
  "use strict";

  const STORAGE_KEY = "ml3d-graphics-mode";
  const VALID_MODES = new Set(["original", "sharp", "hd", "lcd"]);
  const MODE_LABELS = {
    original: "ORIGINAL",
    sharp: "NÍTIDO",
    hd: "HD",
    lcd: "LCD"
  };

  const source = document.getElementById("screen");
  if (!source) return;

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
    .screen-frame.ml3d-graphics-active #screen{
      opacity:0;
    }
    .screen-frame.ml3d-graphics-active #ml3d-enhanced-screen{
      display:block;
    }
    .ml3d-graphics-control{
      margin:.55rem 0 .8rem;
    }
    .ml3d-graphics-control h3{
      margin:0 0 .45rem;
    }
    .ml3d-graphics-modes{
      display:grid;
      grid-template-columns:repeat(4,minmax(0,1fr));
      gap:6px;
    }
    #menu .ml3d-graphics-modes button{
      min-width:0;
      min-height:36px;
      padding:7px 4px;
      font-size:.72rem;
      font-weight:900;
      letter-spacing:.02em;
    }
    #menu .ml3d-graphics-modes button.active{
      border-color:#d8ffff!important;
      box-shadow:0 0 14px #63f4ff,inset 0 0 12px #a9ffff45!important;
      filter:brightness(1.16);
    }
    .ml3d-graphics-note{
      display:block;
      margin-top:5px;
      font-size:.68rem;
      line-height:1.25;
      opacity:.72;
    }
    @media (max-width:380px){
      .ml3d-graphics-modes{
        gap:4px;
      }
      #menu .ml3d-graphics-modes button{
        font-size:.66rem;
        padding-inline:2px;
      }
    }
  `;
  document.head.appendChild(style);

  const frame = source.closest(".screen-frame");
  const ctx = overlay.getContext("2d", { alpha: false, desynchronized: true });
  const capture = document.createElement("canvas");
  const captureCtx = capture.getContext("2d", { willReadFrequently: true, alpha: false });

  let mode = "original";
  let rafId = 0;
  let lastW = 0;
  let lastH = 0;
  let hdImageData = null;

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

  function ensureCaptureSize(w, h) {
    if (capture.width !== w) capture.width = w;
    if (capture.height !== h) capture.height = h;
  }

  function ensureOverlaySize(w, h, multiplier) {
    const targetW = Math.max(1, Math.round(w * multiplier));
    const targetH = Math.max(1, Math.round(h * multiplier));
    if (overlay.width !== targetW) overlay.width = targetW;
    if (overlay.height !== targetH) overlay.height = targetH;
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

  function renderScale2x(w, h) {
    ensureCaptureSize(w, h);
    captureCtx.imageSmoothingEnabled = false;
    captureCtx.clearRect(0, 0, w, h);
    captureCtx.drawImage(source, 0, 0, w, h);

    let input;
    try {
      input = captureCtx.getImageData(0, 0, w, h);
    } catch (_) {
      renderSharp(w, h);
      return;
    }

    const outW = w * 2;
    const outH = h * 2;
    ensureOverlaySize(w, h, 2);
    if (!hdImageData || hdImageData.width !== outW || hdImageData.height !== outH) {
      hdImageData = ctx.createImageData(outW, outH);
    }

    const src = input.data;
    const dst = hdImageData.data;

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

        let e0 = e, e1 = e, e2 = e, e3 = e;

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

    ctx.putImageData(hdImageData, 0, 0);
  }

  function renderSharp(w, h) {
    const rect = source.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.max(w, Math.round(rect.width * dpr));
    const cssH = Math.max(h, Math.round(rect.height * dpr));

    if (overlay.width !== cssW) overlay.width = cssW;
    if (overlay.height !== cssH) overlay.height = cssH;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.drawImage(source, 0, 0, overlay.width, overlay.height);
  }

  function renderLCD(w, h) {
    ensureOverlaySize(w, h, 2);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.drawImage(source, 0, 0, overlay.width, overlay.height);

    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "rgba(16, 24, 22, 0.16)";
    for (let y = 1; y < overlay.height; y += 2) {
      ctx.fillRect(0, y, overlay.width, 1);
    }
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = "rgba(220, 255, 238, 0.035)";
    for (let x = 0; x < overlay.width; x += 3) {
      ctx.fillRect(x, 0, 1, overlay.height);
    }
    ctx.restore();
  }

  function renderFrame() {
    rafId = requestAnimationFrame(renderFrame);
    if (mode === "original") return;

    const w = source.width | 0;
    const h = source.height | 0;
    if (!w || !h) return;

    if (w !== lastW || h !== lastH) {
      lastW = w;
      lastH = h;
      hdImageData = null;
    }

    try {
      if (mode === "hd") renderScale2x(w, h);
      else if (mode === "lcd") renderLCD(w, h);
      else renderSharp(w, h);
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
    });
  }

  function setMode(nextMode, persist = true) {
    if (!VALID_MODES.has(nextMode)) nextMode = "original";
    mode = nextMode;

    const active = mode !== "original";
    frame?.classList.toggle("ml3d-graphics-active", active);
    overlay.style.display = active ? "block" : "none";
    source.style.opacity = active ? "0" : "";

    if (!active) {
      overlay.width = 1;
      overlay.height = 1;
      hdImageData = null;
    }

    updateButtons();
    if (persist) writeStoredMode(mode);

    window.dispatchEvent(new CustomEvent("ml3dgraphicschange", {
      detail: { mode, label: MODE_LABELS[mode] }
    }));
  }

  function installMenu() {
    const menuCard = document.querySelector("#menu .menu-card");
    if (!menuCard || document.getElementById("ml3d-graphics-control")) return;

    const section = document.createElement("section");
    section.id = "ml3d-graphics-control";
    section.className = "ml3d-graphics-control";
    section.innerHTML = `
      <h3>Gráficos</h3>
      <div class="ml3d-graphics-modes" role="group" aria-label="Calidad gráfica">
        <button type="button" data-ml3d-graphics-mode="original">ORIGINAL</button>
        <button type="button" data-ml3d-graphics-mode="sharp">NÍTIDO</button>
        <button type="button" data-ml3d-graphics-mode="hd">HD</button>
        <button type="button" data-ml3d-graphics-mode="lcd">LCD</button>
      </div>
      <small class="ml3d-graphics-note">HD reconstruye bordes a 2×. El filtro solo afecta a la imagen del juego.</small>
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
  }

  window.ML3DGraphics = {
    setMode,
    getMode: () => mode,
    getDisplayCanvas: () => mode === "original" ? source : overlay,
    modes: { ...MODE_LABELS }
  };

  installMenu();
  setMode(readStoredMode(), false);
  rafId = requestAnimationFrame(renderFrame);

  window.addEventListener("beforeunload", () => {
    if (rafId) cancelAnimationFrame(rafId);
  }, { once: true });
})();
