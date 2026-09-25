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
      image-rendering:pixelated;
      image-rendering:crisp-edges;
    }
    .screen-frame.ml3d-graphics-active #screen{
      opacity:0;
    }
    .screen-frame.ml3d-graphics-2d #ml3d-enhanced-screen,
    .screen-frame.ml3d-graphics-gl #ml3d-enhanced-screen-gl{
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
      min-height:2.5em;
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

  const ctx = overlay2d.getContext("2d", {
    alpha: false,
    desynchronized: true
  });
  const capture = document.createElement("canvas");
  const captureCtx = capture.getContext("2d", {
    willReadFrequently: true,
    alpha: false
  });

  let mode = "original";
  let rafId = 0;
  let lastW = 0;
  let lastH = 0;
  let hdImageData = null;

  let glState = null;
  let hdBackend = "pending";
  let perfSamples = [];
  let lastFallbackAttempt = 0;

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

  function ensureOverlay2DSize(w, h, multiplier) {
    const targetW = Math.max(1, Math.round(w * multiplier));
    const targetH = Math.max(1, Math.round(h * multiplier));
    if (overlay2d.width !== targetW) overlay2d.width = targetW;
    if (overlay2d.height !== targetH) overlay2d.height = targetH;
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
    ensureOverlay2DSize(w, h, 2);

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

    ctx.putImageData(hdImageData, 0, 0);
  }

  function renderSharp(w, h) {
    const rect = source.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.max(w, Math.round(rect.width * dpr));
    const cssH = Math.max(h, Math.round(rect.height * dpr));

    if (overlay2d.width !== cssW) overlay2d.width = cssW;
    if (overlay2d.height !== cssH) overlay2d.height = cssH;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, overlay2d.width, overlay2d.height);
    ctx.drawImage(source, 0, 0, overlay2d.width, overlay2d.height);
  }

  function renderLCD(w, h) {
    ensureOverlay2DSize(w, h, 2);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, overlay2d.width, overlay2d.height);
    ctx.drawImage(source, 0, 0, overlay2d.width, overlay2d.height);

    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "rgba(16, 24, 22, 0.16)";
    for (let y = 1; y < overlay2d.height; y += 2) {
      ctx.fillRect(0, y, overlay2d.width, 1);
    }
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = "rgba(220, 255, 238, 0.035)";
    for (let x = 0; x < overlay2d.width; x += 3) {
      ctx.fillRect(x, 0, 1, overlay2d.height);
    }
    ctx.restore();
  }

  function compileShader(gl, type, shaderSource) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, shaderSource);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "Shader desconocido";
      gl.deleteShader(shader);
      throw new Error(message);
    }

    return shader;
  }

  function initWebGL() {
    if (glState) return true;
    if (hdBackend === "scale2x") return false;

    let gl = null;
    try {
      gl = overlayGL.getContext("webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance"
      });
    } catch (_) {
      gl = null;
    }

    if (!gl) {
      hdBackend = "scale2x";
      return false;
    }

    try {
      const vertexSource = `
        attribute vec2 aPosition;
        varying highp vec2 vUV;

        void main() {
          gl_Position = vec4(aPosition, 0.0, 1.0);
          vUV = vec2(
            (aPosition.x + 1.0) * 0.5,
            1.0 - ((aPosition.y + 1.0) * 0.5)
          );
        }
      `;

      const fragmentSource = `
        precision mediump float;

        varying highp vec2 vUV;
        uniform sampler2D uTexture;
        uniform vec2 uTexel;
        uniform vec2 uSourceSize;

        float colorDistance(vec3 a, vec3 b) {
          vec3 d = abs(a - b);
          return dot(d, vec3(0.299, 0.587, 0.114));
        }

        float similarity(float d) {
          return 1.0 - smoothstep(0.055, 0.19, d);
        }

        float difference(float d) {
          return smoothstep(0.075, 0.28, d);
        }

        void main() {
          vec2 pixel = vUV * uSourceSize;
          vec2 p = fract(pixel);
          vec2 baseUV = (floor(pixel) + vec2(0.5)) / uSourceSize;

          vec3 E  = texture2D(uTexture, baseUV).rgb;
          vec3 B  = texture2D(uTexture, baseUV + vec2(0.0, -uTexel.y)).rgb;
          vec3 D  = texture2D(uTexture, baseUV + vec2(-uTexel.x, 0.0)).rgb;
          vec3 F  = texture2D(uTexture, baseUV + vec2(uTexel.x, 0.0)).rgb;
          vec3 H  = texture2D(uTexture, baseUV + vec2(0.0, uTexel.y)).rgb;
          vec3 A  = texture2D(uTexture, baseUV + vec2(-uTexel.x, -uTexel.y)).rgb;
          vec3 C  = texture2D(uTexture, baseUV + vec2(uTexel.x, -uTexel.y)).rgb;
          vec3 G  = texture2D(uTexture, baseUV + vec2(-uTexel.x, uTexel.y)).rgb;
          vec3 I  = texture2D(uTexture, baseUV + vec2(uTexel.x, uTexel.y)).rgb;

          vec3 outColor = E;

          float tlNeighbors = similarity(colorDistance(B, D));
          float tlCenter = difference(min(colorDistance(E, B), colorDistance(E, D)));
          float tlSupport = max(
            similarity(colorDistance(A, B)),
            similarity(colorDistance(A, D))
          );
          float tlCorner = 1.0 - smoothstep(0.18, 0.72, max(p.x, p.y));
          float tl = tlNeighbors * tlCenter * max(0.68, tlSupport) * tlCorner;
          outColor = mix(outColor, (B + D) * 0.5, tl * 0.86);

          float trNeighbors = similarity(colorDistance(B, F));
          float trCenter = difference(min(colorDistance(E, B), colorDistance(E, F)));
          float trSupport = max(
            similarity(colorDistance(C, B)),
            similarity(colorDistance(C, F))
          );
          float trCorner = 1.0 - smoothstep(0.18, 0.72, max(1.0 - p.x, p.y));
          float tr = trNeighbors * trCenter * max(0.68, trSupport) * trCorner;
          outColor = mix(outColor, (B + F) * 0.5, tr * 0.86);

          float blNeighbors = similarity(colorDistance(D, H));
          float blCenter = difference(min(colorDistance(E, D), colorDistance(E, H)));
          float blSupport = max(
            similarity(colorDistance(G, D)),
            similarity(colorDistance(G, H))
          );
          float blCorner = 1.0 - smoothstep(0.18, 0.72, max(p.x, 1.0 - p.y));
          float bl = blNeighbors * blCenter * max(0.68, blSupport) * blCorner;
          outColor = mix(outColor, (D + H) * 0.5, bl * 0.86);

          float brNeighbors = similarity(colorDistance(F, H));
          float brCenter = difference(min(colorDistance(E, F), colorDistance(E, H)));
          float brSupport = max(
            similarity(colorDistance(I, F)),
            similarity(colorDistance(I, H))
          );
          float brCorner = 1.0 - smoothstep(0.18, 0.72, max(1.0 - p.x, 1.0 - p.y));
          float br = brNeighbors * brCenter * max(0.68, brSupport) * brCorner;
          outColor = mix(outColor, (F + H) * 0.5, br * 0.86);

          gl_FragColor = vec4(outColor, 1.0);
        }
      `;

      const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
      const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
      const program = gl.createProgram();

      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || "No se pudo enlazar el programa WebGL.");
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

      gl.useProgram(program);
      gl.uniform1i(gl.getUniformLocation(program, "uTexture"), 0);

      glState = {
        gl,
        program,
        texture,
        uTexel: gl.getUniformLocation(program, "uTexel"),
        uSourceSize: gl.getUniformLocation(program, "uSourceSize")
      };
      hdBackend = "webgl";
      perfSamples = [];
      return true;
    } catch (error) {
      console.warn("ML3D Graphics: WebGL HD no disponible; se usará Scale2x.", error);
      glState = null;
      hdBackend = "scale2x";
      return false;
    }
  }

  function ensureGLSize(w, h) {
    const rect = source.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const desiredW = Math.max(w * 2, Math.round(rect.width * dpr));
    const desiredH = Math.max(h * 2, Math.round(rect.height * dpr));
    const targetW = Math.min(w * 4, desiredW);
    const targetH = Math.min(h * 4, desiredH);

    if (overlayGL.width !== targetW) overlayGL.width = targetW;
    if (overlayGL.height !== targetH) overlayGL.height = targetH;
  }

  function recordWebGLCost(costMs) {
    perfSamples.push(costMs);
    if (perfSamples.length > 90) perfSamples.shift();
    if (perfSamples.length < 90) return;

    const avg = perfSamples.reduce((sum, value) => sum + value, 0) / perfSamples.length;
    if (avg > 9.5) {
      console.warn(
        "ML3D Graphics: el shader HD es costoso en este dispositivo; activando Scale2x compatible."
      );
      hdBackend = "scale2x";
      lastFallbackAttempt = performance.now();
      frame?.classList.remove("ml3d-graphics-gl");
      frame?.classList.add("ml3d-graphics-2d");
      setNote("HD: modo compatible Scale2x para mantener el rendimiento.");
    }
  }

  function renderWebGL(w, h) {
    if (!initWebGL() || !glState) {
      renderScale2x(w, h);
      return false;
    }

    const started = performance.now();
    ensureGLSize(w, h);

    const gl = glState.gl;
    gl.viewport(0, 0, overlayGL.width, overlayGL.height);
    gl.useProgram(glState.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glState.texture);

    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source
    );

    gl.uniform2f(glState.uTexel, 1 / w, 1 / h);
    gl.uniform2f(glState.uSourceSize, w, h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    recordWebGLCost(performance.now() - started);
    return true;
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

    if (mode === "hd" && hdBackend !== "scale2x") {
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

    const w = source.width | 0;
    const h = source.height | 0;
    if (!w || !h) return;

    if (w !== lastW || h !== lastH) {
      lastW = w;
      lastH = h;
      hdImageData = null;
    }

    try {
      if (mode === "hd") {
        if (hdBackend === "scale2x") {
          renderScale2x(w, h);

          if (
            glState &&
            now - lastFallbackAttempt > 12000 &&
            perfSamples.length >= 30
          ) {
            perfSamples = [];
            hdBackend = "webgl";
            updateVisibleSurface();
            setNote("HD: reconstrucción de bordes por shader WebGL.");
          }
        } else {
          const rendered = renderWebGL(w, h);
          if (!rendered || hdBackend === "scale2x") {
            updateVisibleSurface();
            renderScale2x(w, h);
          }
        }
      } else if (mode === "lcd") {
        renderLCD(w, h);
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
    });
  }

  function updateNoteForMode() {
    if (mode === "original") {
      setNote("Imagen original del núcleo, sin procesamiento adicional.");
    } else if (mode === "sharp") {
      setNote("NÍTIDO: escalado limpio sin suavizar los píxeles.");
    } else if (mode === "lcd") {
      setNote("LCD: píxel definido con trama ligera de pantalla portátil.");
    } else if (hdBackend === "scale2x") {
      setNote("HD: modo compatible Scale2x para mantener el rendimiento.");
    } else {
      setNote("HD: reconstrucción de diagonales y bordes por shader WebGL.");
    }
  }

  function setMode(nextMode, persist = true) {
    if (!VALID_MODES.has(nextMode)) nextMode = "original";
    mode = nextMode;

    if (mode === "hd" && hdBackend === "pending") {
      initWebGL();
    }

    if (mode === "original") {
      overlay2d.width = 1;
      overlay2d.height = 1;
      hdImageData = null;
    }

    updateVisibleSurface();
    updateButtons();
    updateNoteForMode();

    if (persist) writeStoredMode(mode);

    window.dispatchEvent(new CustomEvent("ml3dgraphicschange", {
      detail: {
        mode,
        label: MODE_LABELS[mode],
        backend: mode === "hd" ? hdBackend : "2d"
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
      <h3>Gráficos</h3>
      <div class="ml3d-graphics-modes" role="group" aria-label="Calidad gráfica">
        <button type="button" data-ml3d-graphics-mode="original">ORIGINAL</button>
        <button type="button" data-ml3d-graphics-mode="sharp">NÍTIDO</button>
        <button type="button" data-ml3d-graphics-mode="hd">HD</button>
        <button type="button" data-ml3d-graphics-mode="lcd">LCD</button>
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
    getBackend: () => mode === "hd" ? hdBackend : "2d",
    getDisplayCanvas: () => {
      if (mode === "original") return source;
      if (mode === "hd" && hdBackend !== "scale2x") return overlayGL;
      return overlay2d;
    },
    modes: { ...MODE_LABELS }
  };

  installMenu();
  setMode(readStoredMode(), false);
  rafId = requestAnimationFrame(renderFrame);

  window.addEventListener("beforeunload", () => {
    if (rafId) cancelAnimationFrame(rafId);
  }, { once: true });
})();
