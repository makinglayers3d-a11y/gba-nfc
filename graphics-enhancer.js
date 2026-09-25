(() => {
  "use strict";

  /*
   * ML3Demuler graphics enhancer.
   *
   * ULTRA GPU path is adapted from Hyllian's xBR-lv2 shader
   * (Copyright 2011-2016 Hyllian, MIT license).
   * See vendor/hyllian-xbr-LICENSE.txt.
   */

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

  const overlay2d = document.createElement("canvas");
  overlay2d.id = "ml3d-enhanced-screen";
  overlay2d.setAttribute("aria-hidden", "true");
  source.insertAdjacentElement("afterend", overlay2d);

  const overlayGL = document.createElement("canvas");
  overlayGL.id = "ml3d-enhanced-screen-gl";
  overlayGL.setAttribute("aria-hidden", "true");
  overlay2d.insertAdjacentElement("afterend", overlayGL);

  const style = document.createElement("style");
  style.id = "ml3d-graphics-enhancer-style";
  style.textContent = `
    #ml3d-enhanced-screen,
    #ml3d-enhanced-screen-gl{
      position:absolute;
      inset:0;
      z-index:2;
      display:none;
      width:100%;
      height:100%;
      background:#000;
      pointer-events:none;
    }

    #ml3d-enhanced-screen{
      image-rendering:pixelated;
      image-rendering:crisp-edges;
    }

    #ml3d-enhanced-screen-gl{
      image-rendering:auto;
    }

    .screen-frame.ml3d-graphics-active #screen{
      opacity:0;
    }

    .screen-frame.ml3d-graphics-2d #ml3d-enhanced-screen{
      display:block;
    }

    .screen-frame.ml3d-graphics-gl #ml3d-enhanced-screen-gl{
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

  const ctx2d = overlay2d.getContext("2d", {
    alpha: false,
    desynchronized: true
  });

  const capture = document.createElement("canvas");
  const captureCtx = capture.getContext("2d", {
    alpha: false,
    willReadFrequently: true
  });

  const gpuInput = document.createElement("canvas");
  const gpuInputCtx = gpuInput.getContext("2d", {
    alpha: false,
    desynchronized: true
  });

  let mode = "original";
  let rafId = 0;
  let lastW = 0;
  let lastH = 0;

  let worker = null;
  let workerBusy = false;
  let workerFailed = false;
  let workerFrameId = 0;
  let lastPresentedWorkerFrame = 0;
  let hdImageData = null;
  let scale2xImageData = null;
  let hdLastRun = 0;
  let hdInterval = 1000 / 30;

  let glState = null;
  let ultraUnavailable = false;

  function readStoredMode() {
    const requested = new URLSearchParams(location.search).get("graphics");
    if (VALID_MODES.has(requested)) return requested;

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

  function nativeResolution() {
    if (window.__gba) {
      return { width: 240, height: 160 };
    }

    return { width: 160, height: 144 };
  }

  function ensureCaptureSize(w, h) {
    if (capture.width !== w) capture.width = w;
    if (capture.height !== h) capture.height = h;
  }

  function prepareGPUInput(w, h) {
    if (gpuInput.width !== w) gpuInput.width = w;
    if (gpuInput.height !== h) gpuInput.height = h;

    gpuInputCtx.imageSmoothingEnabled = false;
    gpuInputCtx.clearRect(0, 0, w, h);
    gpuInputCtx.drawImage(source, 0, 0, w, h);

    return gpuInput;
  }

  function ensure2DSize(w, h) {
    if (overlay2d.width !== w) overlay2d.width = w;
    if (overlay2d.height !== h) overlay2d.height = h;
  }

  function grabSourceFrame(w, h) {
    ensureCaptureSize(w, h);
    captureCtx.imageSmoothingEnabled = false;
    captureCtx.clearRect(0, 0, w, h);
    captureCtx.drawImage(source, 0, 0, w, h);
    return captureCtx.getImageData(0, 0, w, h);
  }

  function presentXBRBuffer(buffer, width, height) {
    ensure2DSize(width, height);

    if (
      !hdImageData ||
      hdImageData.width !== width ||
      hdImageData.height !== height
    ) {
      hdImageData = ctx2d.createImageData(width, height);
    }

    hdImageData.data.set(new Uint8ClampedArray(buffer));
    ctx2d.putImageData(hdImageData, 0, 0);
  }

  function initWorker() {
    if (worker || workerFailed || typeof Worker !== "function") return;

    try {
      worker = new Worker("graphics-enhancer-worker.js?v=xbr-3");

      worker.onmessage = (event) => {
        const data = event.data || {};

        if (data.type === "error") {
          workerFailed = true;
          workerBusy = false;
          worker?.terminate();
          worker = null;
          updateNoteForMode();
          return;
        }

        if (data.type !== "frame") return;

        workerBusy = false;

        if (
          mode !== "hd" ||
          data.mode !== "hd" ||
          data.id < lastPresentedWorkerFrame ||
          !data.buffer
        ) {
          return;
        }

        lastPresentedWorkerFrame = data.id;
        presentXBRBuffer(data.buffer, data.width, data.height);
      };

      worker.onerror = () => {
        workerFailed = true;
        workerBusy = false;
        worker?.terminate();
        worker = null;
        updateNoteForMode();
      };
    } catch (_) {
      workerFailed = true;
      worker = null;
    }
  }

  function dispatchHDWorker(w, h, now) {
    if (!worker || workerBusy) return false;
    if (now - hdLastRun < hdInterval) return true;

    try {
      const input = grabSourceFrame(w, h);
      const id = ++workerFrameId;
      workerBusy = true;
      hdLastRun = now;

      worker.postMessage(
        {
          type: "scale",
          id,
          mode: "hd",
          factor: 2,
          blendColors: false,
          width: w,
          height: h,
          buffer: input.data.buffer
        },
        [input.data.buffer]
      );

      return true;
    } catch (_) {
      workerFailed = true;
      workerBusy = false;
      worker?.terminate();
      worker = null;
      return false;
    }
  }

  function renderHDSynchronous(w, h, now) {
    if (now - hdLastRun < hdInterval) return true;
    if (typeof window.xBRjs?.xbr2x !== "function") return false;

    try {
      const input = grabSourceFrame(w, h);
      const input32 = new Uint32Array(
        input.data.buffer,
        input.data.byteOffset,
        input.data.byteLength / 4
      );

      const output = window.xBRjs.xbr2x(
        input32,
        w,
        h,
        {
          blendColors: false,
          scaleAlpha: false
        }
      );

      presentXBRBuffer(output.buffer, w * 2, h * 2);
      hdLastRun = now;
      return true;
    } catch (_) {
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

    ensure2DSize(outW, outH);

    if (
      !scale2xImageData ||
      scale2xImageData.width !== outW ||
      scale2xImageData.height !== outH
    ) {
      scale2xImageData = ctx2d.createImageData(outW, outH);
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

    ctx2d.putImageData(scale2xImageData, 0, 0);
  }

  function renderSharp(w, h) {
    const rect = source.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.max(w, Math.round(rect.width * dpr));
    const targetH = Math.max(h, Math.round(rect.height * dpr));

    ensure2DSize(targetW, targetH);
    ctx2d.imageSmoothingEnabled = false;
    ctx2d.clearRect(0, 0, overlay2d.width, overlay2d.height);
    ctx2d.drawImage(source, 0, 0, overlay2d.width, overlay2d.height);
  }

  function compileShader(gl, type, shaderSource) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, shaderSource);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "Shader error";
      gl.deleteShader(shader);
      throw new Error(message);
    }

    return shader;
  }

  function initUltraGPU() {
    if (glState) return true;
    if (ultraUnavailable) return false;

    let gl = null;

    try {
      gl = overlayGL.getContext("webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: "high-performance"
      });
    } catch (_) {
      gl = null;
    }

    if (!gl) {
      ultraUnavailable = true;
      return false;
    }

    const vertexSource = `
      attribute vec2 aPosition;
      varying highp vec2 vTexCoord;

      void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
        vTexCoord = vec2(
          (aPosition.x + 1.0) * 0.5,
          1.0 - ((aPosition.y + 1.0) * 0.5)
        );
      }
    `;

    const fragmentSource = `
      #ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
      #else
      precision mediump float;
      #endif

      varying vec2 vTexCoord;
      uniform sampler2D uTexture;
      uniform vec2 uTextureSize;
      uniform float uScale;

      const float XBR_EQ_THRESHOLD = 15.0;
      const float XBR_EQ_THRESHOLD2 = 2.0;
      const float XBR_LV2_COEFFICIENT = 2.0;
      const vec3 RGBW = vec3(14.352, 28.176, 5.472);

      vec4 df(vec4 A, vec4 B) {
        return abs(A - B);
      }

      vec4 diff4(vec4 A, vec4 B) {
        return step(vec4(0.00001), abs(A - B));
      }

      vec4 eq4(vec4 A, vec4 B) {
        return step(abs(A - B), vec4(XBR_EQ_THRESHOLD));
      }

      vec4 neq4(vec4 A, vec4 B) {
        return vec4(1.0) - eq4(A, B);
      }

      vec4 eq2(vec4 A, vec4 B) {
        return step(abs(A - B), vec4(XBR_EQ_THRESHOLD2));
      }

      vec4 neq2(vec4 A, vec4 B) {
        return vec4(1.0) - eq2(A, B);
      }

      vec4 wd(
        vec4 a, vec4 b, vec4 c, vec4 d,
        vec4 e, vec4 f, vec4 g, vec4 h
      ) {
        return df(a,b) + df(a,c) + df(d,e) + df(d,f) + 4.0 * df(g,h);
      }

      vec4 weightedDistance(
        vec4 a, vec4 b, vec4 c, vec4 d,
        vec4 e, vec4 f, vec4 g, vec4 h,
        vec4 i, vec4 j, vec4 k, vec4 l
      ) {
        return df(a,b) + df(a,c) + df(d,e) + df(d,f) +
          df(i,j) + df(k,l) + 2.0 * df(g,h);
      }

      float colorDiff(vec3 a, vec3 b) {
        vec3 d = abs(a - b);
        return d.r + d.g + d.b;
      }

      float colorSimilarity(vec3 a, vec3 b) {
        return 1.0 - smoothstep(0.035, 0.16, colorDiff(a, b));
      }

      float luma(vec3 c) {
        return dot(c, vec3(0.299, 0.587, 0.114));
      }

      float chroma(vec3 c) {
        return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
      }

      float grayScore(vec3 c) {
        return 1.0 - smoothstep(0.035, 0.14, chroma(c));
      }

      vec3 nearestLocalColor(
        vec3 x,
        vec3 A, vec3 B, vec3 C,
        vec3 D, vec3 E, vec3 F,
        vec3 G, vec3 H, vec3 I
      ) {
        vec3 best = A;
        float bestD = colorDiff(x, A);

        float d = colorDiff(x, B);
        if (d < bestD) { bestD = d; best = B; }

        d = colorDiff(x, C);
        if (d < bestD) { bestD = d; best = C; }

        d = colorDiff(x, D);
        if (d < bestD) { bestD = d; best = D; }

        d = colorDiff(x, E);
        if (d < bestD) { bestD = d; best = E; }

        d = colorDiff(x, F);
        if (d < bestD) { bestD = d; best = F; }

        d = colorDiff(x, G);
        if (d < bestD) { bestD = d; best = G; }

        d = colorDiff(x, H);
        if (d < bestD) { bestD = d; best = H; }

        d = colorDiff(x, I);
        if (d < bestD) { bestD = d; best = I; }

        return best;
      }

      vec3 binaryLocalContrast(
        vec3 x,
        vec3 A, vec3 B, vec3 C,
        vec3 D, vec3 E, vec3 F,
        vec3 G, vec3 H, vec3 I
      ) {
        vec3 dark = A;
        vec3 light = A;
        float darkL = luma(A);
        float lightL = darkL;

        float v = luma(B);
        if (v < darkL) { darkL = v; dark = B; }
        if (v > lightL) { lightL = v; light = B; }

        v = luma(C);
        if (v < darkL) { darkL = v; dark = C; }
        if (v > lightL) { lightL = v; light = C; }

        v = luma(D);
        if (v < darkL) { darkL = v; dark = D; }
        if (v > lightL) { lightL = v; light = D; }

        v = luma(E);
        if (v < darkL) { darkL = v; dark = E; }
        if (v > lightL) { lightL = v; light = E; }

        v = luma(F);
        if (v < darkL) { darkL = v; dark = F; }
        if (v > lightL) { lightL = v; light = F; }

        v = luma(G);
        if (v < darkL) { darkL = v; dark = G; }
        if (v > lightL) { lightL = v; light = G; }

        v = luma(H);
        if (v < darkL) { darkL = v; dark = H; }
        if (v > lightL) { lightL = v; light = H; }

        v = luma(I);
        if (v < darkL) { darkL = v; dark = I; }
        if (v > lightL) { lightL = v; light = I; }

        float xL = luma(x);
        return abs(xL - darkL) <= abs(xL - lightL) ? dark : light;
      }

      vec3 samplePixel(vec2 coord, vec2 texel, float x, float y) {
        return texture2D(uTexture, coord + texel * vec2(x, y)).rgb;
      }

      void main() {
        vec2 texel = 1.0 / uTextureSize;
        vec2 pixel = vTexCoord * uTextureSize;
        vec2 fp = fract(pixel);
        vec2 coord = vTexCoord - (fp - vec2(0.5)) * texel;

        vec3 A1 = samplePixel(coord, texel, -1.0, -2.0);
        vec3 B1 = samplePixel(coord, texel,  0.0, -2.0);
        vec3 C1 = samplePixel(coord, texel,  1.0, -2.0);

        vec3 A = samplePixel(coord, texel, -1.0, -1.0);
        vec3 B = samplePixel(coord, texel,  0.0, -1.0);
        vec3 C = samplePixel(coord, texel,  1.0, -1.0);

        vec3 D = samplePixel(coord, texel, -1.0,  0.0);
        vec3 E = samplePixel(coord, texel,  0.0,  0.0);
        vec3 F = samplePixel(coord, texel,  1.0,  0.0);

        vec3 G = samplePixel(coord, texel, -1.0,  1.0);
        vec3 H = samplePixel(coord, texel,  0.0,  1.0);
        vec3 I = samplePixel(coord, texel,  1.0,  1.0);

        vec3 G5 = samplePixel(coord, texel, -1.0,  2.0);
        vec3 H5 = samplePixel(coord, texel,  0.0,  2.0);
        vec3 I5 = samplePixel(coord, texel,  1.0,  2.0);

        vec3 A0 = samplePixel(coord, texel, -2.0, -1.0);
        vec3 D0 = samplePixel(coord, texel, -2.0,  0.0);
        vec3 G0 = samplePixel(coord, texel, -2.0,  1.0);

        vec3 C4 = samplePixel(coord, texel,  2.0, -1.0);
        vec3 F4 = samplePixel(coord, texel,  2.0,  0.0);
        vec3 I4 = samplePixel(coord, texel,  2.0,  1.0);

        vec4 b = vec4(
          dot(B, RGBW),
          dot(D, RGBW),
          dot(H, RGBW),
          dot(F, RGBW)
        );

        vec4 c = vec4(
          dot(C, RGBW),
          dot(A, RGBW),
          dot(G, RGBW),
          dot(I, RGBW)
        );

        vec4 d = b.yzwx;
        vec4 e = vec4(dot(E, RGBW));
        vec4 f = b.wxyz;
        vec4 g = c.zwxy;
        vec4 h = b.zwxy;
        vec4 i = c.wxyz;

        vec4 i4 = vec4(
          dot(I4, RGBW),
          dot(C1, RGBW),
          dot(A0, RGBW),
          dot(G5, RGBW)
        );

        vec4 i5 = vec4(
          dot(I5, RGBW),
          dot(C4, RGBW),
          dot(A1, RGBW),
          dot(G0, RGBW)
        );

        vec4 h5 = vec4(
          dot(H5, RGBW),
          dot(F4, RGBW),
          dot(B1, RGBW),
          dot(D0, RGBW)
        );

        vec4 f4 = h5.yzwx;
        vec4 c1 = i4.yzwx;
        vec4 g0 = i5.wxyz;
        vec4 b1 = h5.zwxy;
        vec4 d0 = h5.wxyz;

        vec4 Ao = vec4( 1.0, -1.0, -1.0, 1.0 );
        vec4 Bo = vec4( 1.0,  1.0, -1.0,-1.0 );
        vec4 Co = vec4( 1.5,  0.5, -0.5, 0.5 );

        vec4 Ax = vec4( 1.0, -1.0, -1.0, 1.0 );
        vec4 Bx = vec4( 0.5,  2.0, -0.5,-2.0 );
        vec4 Cx = vec4( 1.0,  1.0, -0.5, 0.0 );

        vec4 Ay = vec4( 1.0, -1.0, -1.0, 1.0 );
        vec4 By = vec4( 2.0,  0.5, -2.0,-0.5 );
        vec4 Cy = vec4( 2.0,  0.0, -1.0, 0.5 );

        vec4 Az = vec4( 6.0, -2.0, -6.0, 2.0 );
        vec4 Bz = vec4( 2.0,  6.0, -2.0,-6.0 );
        vec4 Cz = vec4( 5.0,  3.0, -3.0,-1.0 );

        vec4 Aw = vec4( 2.0, -6.0, -2.0, 6.0 );
        vec4 Bw = vec4( 6.0,  2.0, -6.0,-2.0 );
        vec4 Cw = vec4( 5.0, -1.0, -3.0, 3.0 );

        vec4 delta = vec4(1.0 / uScale);
        vec4 deltaL = vec4(
          0.5 / uScale,
          1.0 / uScale,
          0.5 / uScale,
          1.0 / uScale
        );
        vec4 deltaU = deltaL.yxwz;

        const vec4 Ci = vec4(0.25);
        vec4 fx = Ao * fp.y + Bo * fp.x;
        vec4 fxL = Ax * fp.y + Bx * fp.x;
        vec4 fxU = Ay * fp.y + By * fp.x;
        vec4 fx3L = Az * fp.y + Bz * fp.x;
        vec4 fx3U = Aw * fp.y + Bw * fp.x;

        vec4 irlv0 = diff4(e,f) * diff4(e,h);

        vec4 irlv1 = irlv0 * (
          neq4(f,b) * neq4(f,c) +
          neq4(h,d) * neq4(h,g) +
          eq4(e,i) * (
            neq4(f,f4) * neq4(f,i4) +
            neq4(h,h5) * neq4(h,i5)
          ) +
          eq4(e,g) +
          eq4(e,c)
        );

        vec4 irlv2l = diff4(e,g) * diff4(d,g);
        vec4 irlv2u = diff4(e,c) * diff4(b,c);

        vec4 irlv3l = eq2(g,g0) * neq2(d0,g0);
        vec4 irlv3u = eq2(c,c1) * neq2(b1,c1);

        vec4 fx45i = clamp(
          (fx + delta - Co - Ci) / (2.0 * delta),
          0.0,
          1.0
        );

        vec4 fx45 = clamp(
          (fx + delta - Co) / (2.0 * delta),
          0.0,
          1.0
        );

        vec4 fx30 = clamp(
          (fxL + deltaL - Cx) / (2.0 * deltaL),
          0.0,
          1.0
        );

        vec4 fx60 = clamp(
          (fxU + deltaU - Cy) / (2.0 * deltaU),
          0.0,
          1.0
        );

        vec4 fx15 = smoothstep(
          Cz - delta,
          Cz + delta,
          fx3L
        );

        vec4 fx75 = smoothstep(
          Cw - delta,
          Cw + delta,
          fx3U
        );

        vec4 wd1 = weightedDistance(
          e, c, g, i, f4, h5, h, f, b, d, i4, i5
        );

        vec4 wd2 = weightedDistance(
          h, d, i5, f, b, i4, e, i, g, h5, c, f4
        );

        vec4 edri = step(wd1, wd2) * irlv0;
        vec4 edr = step(wd1 + vec4(0.1), wd2) *
          step(vec4(0.5), irlv1);

        vec4 edrL =
          step(XBR_LV2_COEFFICIENT * df(f,g), df(h,c)) *
          irlv2l *
          edr;

        vec4 edrU =
          step(XBR_LV2_COEFFICIENT * df(h,c), df(f,g)) *
          irlv2u *
          edr;

        fx45 = edr * fx45;
        fx30 = edrL * fx30;
        fx60 = edrU * fx60;
        fx45i = edri * fx45i;

        vec4 fx15Final = edr * edrL * irlv3l * fx15;
        vec4 fx75Final = edr * edrU * irlv3u * fx75;

        vec4 px = step(df(e,f), df(e,h));

        // Preserve thin strokes and micro-detail. Large coherent contours
        // still receive strong xBR smoothing.
        float centerAnchor = max(
          max(
            max(colorSimilarity(E, A), colorSimilarity(E, B)),
            max(colorSimilarity(E, C), colorSimilarity(E, D))
          ),
          max(
            max(colorSimilarity(E, F), colorSimilarity(E, G)),
            max(colorSimilarity(E, H), colorSimilarity(E, I))
          )
        );

        float orthogonalAnchor =
          colorSimilarity(E, B) +
          colorSimilarity(E, D) +
          colorSimilarity(E, F) +
          colorSimilarity(E, H);

        float thinStroke =
          1.0 - smoothstep(1.15, 2.75, orthogonalAnchor);

        vec4 edgeCoherence = vec4(
          colorSimilarity(H, F),
          colorSimilarity(B, F),
          colorSimilarity(B, D),
          colorSimilarity(D, H)
        );

        float changedNeighbours =
          step(0.11, colorDiff(E, A)) +
          step(0.11, colorDiff(E, B)) +
          step(0.11, colorDiff(E, C)) +
          step(0.11, colorDiff(E, D)) +
          step(0.11, colorDiff(E, F)) +
          step(0.11, colorDiff(E, G)) +
          step(0.11, colorDiff(E, H)) +
          step(0.11, colorDiff(E, I));

        float textureGuard =
          1.0 - smoothstep(5.0, 7.0, changedNeighbours);

        float thinLocalGuard =
          mix(0.16, 1.0, 1.0 - thinStroke);

        float thinDiagonalGuard =
          mix(0.62, 1.0, 1.0 - thinStroke);

        vec4 localStrength =
          max(max(fx30, fx60), max(fx45, fx45i)) *
          0.55 *
          thinLocalGuard;

        // Long diagonals remain stronger than local corner smoothing.
        vec4 diagonalContinuity =
          max(fx15Final, fx75Final) *
          0.88 *
          thinDiagonalGuard;

        vec4 geometricStrength =
          max(localStrength, diagonalContinuity);

        vec4 coherenceGuard =
          mix(vec4(0.10), vec4(1.0), edgeCoherence);

        float detailGuard =
          mix(0.08, 1.0, centerAnchor) *
          mix(0.28, 1.0, textureGuard);

        vec4 strength =
          geometricStrength *
          coherenceGuard *
          detailGuard;

        vec3 res1 = E;
        res1 = mix(res1, mix(H, F, px.x), strength.x);
        res1 = mix(res1, mix(B, D, px.z), strength.z);

        vec3 res2 = E;
        res2 = mix(res2, mix(F, B, px.y), strength.y);
        res2 = mix(res2, mix(D, H, px.w), strength.w);

        vec3 res = mix(
          res1,
          res2,
          step(colorDiff(E, res1), colorDiff(E, res2))
        );

        // Absolute protection for isolated micro-details.
        float isolatedDetail =
          (1.0 - smoothstep(0.08, 0.28, centerAnchor)) *
          smoothstep(4.5, 7.0, changedNeighbours);

        float preserveFineDetail =
          max(isolatedDetail, thinStroke * textureGuard);

        res = mix(res, E, preserveFineDetail * 0.93);

        // Detect monochrome, high-contrast regions such as small white/black
        // lettering. In these regions interpolation must not invent gray
        // transition pixels: snap to one of the original local endpoints.
        float lumA = luma(A);
        float lumB = luma(B);
        float lumC = luma(C);
        float lumD = luma(D);
        float lumE = luma(E);
        float lumF = luma(F);
        float lumG = luma(G);
        float lumH = luma(H);
        float lumI = luma(I);

        float lumMin = min(
          min(min(lumA, lumB), min(lumC, lumD)),
          min(min(lumE, lumF), min(lumG, min(lumH, lumI)))
        );

        float lumMax = max(
          max(max(lumA, lumB), max(lumC, lumD)),
          max(max(lumE, lumF), max(lumG, max(lumH, lumI)))
        );

        float grayRatio = (
          grayScore(A) + grayScore(B) + grayScore(C) +
          grayScore(D) + grayScore(E) + grayScore(F) +
          grayScore(G) + grayScore(H) + grayScore(I)
        ) / 9.0;

        float monochromeContrast =
          smoothstep(0.58, 0.74, lumMax - lumMin) *
          smoothstep(0.72, 0.92, grayRatio);

        vec3 snapped = binaryLocalContrast(
          res,
          A, B, C,
          D, E, F,
          G, H, I
        );

        // Thin monochrome text gets the strongest binary snap.
        float binarySnap =
          monochromeContrast *
          mix(0.86, 1.0, max(thinStroke, isolatedDetail));

        res = mix(res, snapped, binarySnap);

        gl_FragColor = vec4(res, 1.0);
      }
    `;

    try {
      const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
      const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

      const program = gl.createProgram();
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || "WebGL link error");
      }

      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([
          -1, -1,
           1, -1,
          -1,  1,
           1,  1
        ]),
        gl.STATIC_DRAW
      );

      gl.useProgram(program);

      const aPosition = gl.getAttribLocation(program, "aPosition");
      gl.enableVertexAttribArray(aPosition);
      gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

      const texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      const uTexture = gl.getUniformLocation(program, "uTexture");
      const uTextureSize = gl.getUniformLocation(program, "uTextureSize");
      const uScale = gl.getUniformLocation(program, "uScale");

      gl.uniform1i(uTexture, 0);

      glState = {
        gl,
        program,
        texture,
        uTextureSize,
        uScale,
        texW: 0,
        texH: 0
      };

      overlayGL.addEventListener(
        "webglcontextlost",
        (event) => {
          event.preventDefault();
          glState = null;
          ultraUnavailable = true;

          if (mode === "ultra") {
            setMode("hd");
          }
        },
        { once: true }
      );

      return true;
    } catch (error) {
      console.warn("ML3D Graphics: ULTRA GPU no disponible.", error);
      glState = null;
      ultraUnavailable = true;
      return false;
    }
  }

  function renderUltraGPU(w, h) {
    if (!initUltraGPU() || !glState) return false;

    const inputCanvas = prepareGPUInput(w, h);
    const rect = source.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);

    const desiredW = Math.max(w * 2, Math.round(rect.width * dpr));
    const desiredH = Math.max(h * 2, Math.round(rect.height * dpr));

    const outW = Math.min(w * 4, desiredW);
    const outH = Math.min(h * 4, desiredH);

    if (overlayGL.width !== outW) overlayGL.width = outW;
    if (overlayGL.height !== outH) overlayGL.height = outH;

    const { gl } = glState;

    gl.viewport(0, 0, outW, outH);
    gl.useProgram(glState.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glState.texture);

    if (glState.texW !== w || glState.texH !== h) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        inputCanvas
      );

      glState.texW = w;
      glState.texH = h;
    } else {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        inputCanvas
      );
    }

    gl.uniform2f(glState.uTextureSize, w, h);
    // Hyllian's xBR is tuned around scale 3 even when output is 4x.
    // This widens the interpolation corridor and avoids segmented diagonals.
    gl.uniform1f(glState.uScale, 3.35);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    return true;
  }

  function renderHD(w, h, now) {
    initWorker();

    if (worker && !workerFailed && dispatchHDWorker(w, h, now)) {
      return;
    }

    if (renderHDSynchronous(w, h, now)) {
      return;
    }

    renderScale2xFallback(w, h);
  }

  function updateVisibleSurface() {
    if (!frame) return;

    const active = mode !== "original";

    frame.classList.toggle("ml3d-graphics-active", active);
    frame.classList.remove("ml3d-graphics-2d", "ml3d-graphics-gl");

    if (!active) {
      source.style.opacity = "";
      overlay2d.style.display = "none";
      overlayGL.style.display = "none";
      return;
    }

    source.style.opacity = "0";

    if (mode === "ultra") {
      frame.classList.add("ml3d-graphics-gl");
      overlayGL.style.display = "block";
      overlay2d.style.display = "none";
    } else {
      frame.classList.add("ml3d-graphics-2d");
      overlay2d.style.display = "block";
      overlayGL.style.display = "none";
    }
  }

  function renderFrame(now) {
    rafId = requestAnimationFrame(renderFrame);

    if (mode === "original") return;

    const native = nativeResolution();
    const w = native.width;
    const h = native.height;

    if (w !== lastW || h !== lastH) {
      lastW = w;
      lastH = h;
      hdImageData = null;
      scale2xImageData = null;
      workerFrameId = 0;
      lastPresentedWorkerFrame = 0;

      if (glState) {
        glState.texW = 0;
        glState.texH = 0;
      }
    }

    try {
      if (mode === "ultra") {
        if (!renderUltraGPU(w, h)) {
          setMode("hd");
        }
      } else if (mode === "hd") {
        renderHD(w, h, now);
      } else {
        renderSharp(source.width | 0, source.height | 0);
      }
    } catch (error) {
      console.warn("ML3D Graphics: no se pudo procesar el fotograma.", error);

      if (mode === "ultra") {
        ultraUnavailable = true;
        setMode("hd");
      } else {
        setMode("original");
      }
    }
  }

  function updateButtons() {
    document.querySelectorAll("[data-ml3d-graphics-mode]").forEach((button) => {
      const active = button.dataset.ml3dGraphicsMode === mode;

      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");

      if (button.dataset.ml3dGraphicsMode === "hd") {
        button.title = "xBR 2× fiel";
      } else if (button.dataset.ml3dGraphicsMode === "ultra") {
        button.title = "xBR GPU 4×: mejora fuerte sin ralentizar la emulación";
      }
    });
  }

  function updateNoteForMode() {
    if (mode === "original") {
      setNote("Imagen original del núcleo.");
    } else if (mode === "sharp") {
      setNote("NÍTIDO: escalado nearest-neighbor limpio.");
    } else if (mode === "hd") {
      setNote("HD: xBR 2× conservador.");
    } else {
      setNote("ULTRA: xBR GPU 4× en tiempo real.");
    }
  }

  function setMode(nextMode, persist = true) {
    if (!VALID_MODES.has(nextMode)) nextMode = "original";

    if (nextMode === "ultra" && !initUltraGPU()) {
      nextMode = "hd";
    }

    mode = nextMode;

    if (mode === "hd") {
      initWorker();
    }

    if (mode === "original") {
      overlay2d.width = 1;
      overlay2d.height = 1;
      overlayGL.width = 1;
      overlayGL.height = 1;
      hdImageData = null;
      scale2xImageData = null;
    }

    updateVisibleSurface();
    updateButtons();
    updateNoteForMode();

    if (persist) writeStoredMode(mode);

    window.dispatchEvent(new CustomEvent("ml3dgraphicschange", {
      detail: {
        mode,
        label: MODE_LABELS[mode],
        backend:
          mode === "ultra"
            ? "xbr-gpu"
            : mode === "hd"
              ? worker && !workerFailed
                ? "xbr2x-worker"
                : "xbr2x"
              : "2d"
      }
    }));
  }

  function installMenu() {
    const menuCard = document.querySelector("#menu .menu-card");

    if (
      !menuCard ||
      document.getElementById("ml3d-graphics-control")
    ) {
      return;
    }

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

    if (audio) {
      audio.insertAdjacentElement("beforebegin", section);
    } else {
      menuCard.appendChild(section);
    }

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
      if (mode === "ultra") return "xbr-gpu";
      if (mode === "hd") {
        return worker && !workerFailed
          ? "xbr2x-worker"
          : "xbr2x";
      }
      return "2d";
    },
    getDisplayCanvas: () => {
      if (mode === "original") return source;

      if (mode === "ultra") {
        const native = nativeResolution();
        renderUltraGPU(native.width, native.height);
        return overlayGL;
      }

      return overlay2d;
    },
    modes: { ...MODE_LABELS }
  };

  installMenu();
  setMode(readStoredMode(), false);
  rafId = requestAnimationFrame(renderFrame);

  window.addEventListener(
    "beforeunload",
    () => {
      if (rafId) cancelAnimationFrame(rafId);
      worker?.terminate();
    },
    { once: true }
  );
})();
