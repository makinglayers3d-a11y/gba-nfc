(() => {
  "use strict";

  const STORAGE_KEY = "ml3d-graphics-mode";
  const MODE_VALUES = Object.freeze({
    original: 0,
    sharp: 1,
    hd: 2,
    lcd: 3
  });
  const VALID_MODES = new Set(Object.keys(MODE_VALUES));

  const sourceCanvas = document.getElementById("screen");
  const frame = sourceCanvas && sourceCanvas.closest(".screen-frame");
  const selector = document.getElementById("graphics-mode-select");

  if (!sourceCanvas || !frame) {
    console.warn("ML3D Graphics: no se encontró la pantalla del emulador.");
    return;
  }

  const overlay = document.createElement("canvas");
  overlay.id = "screen-enhanced";
  overlay.setAttribute("aria-hidden", "true");
  overlay.tabIndex = -1;
  sourceCanvas.insertAdjacentElement("afterend", overlay);

  let mode = readStoredMode();
  let frameSource = sourceCanvas;
  let sourceKind = "canvas";
  let gl = null;
  let program = null;
  let texture = null;
  let positionBuffer = null;
  let modeUniform = null;
  let texSizeUniform = null;
  let samplerUniform = null;
  let fallback2d = null;
  let fallbackSourceCanvas = null;
  let fallbackSourceContext = null;
  let gpuAvailable = false;
  let lastWidth = 0;
  let lastHeight = 0;
  let lastDpr = 0;
  let animationFrameId = 0;

  const vertexShaderSource = [
    "attribute vec2 a_position;",
    "varying vec2 v_uv;",
    "void main() {",
    "  gl_Position = vec4(a_position, 0.0, 1.0);",
    "  v_uv = vec2((a_position.x + 1.0) * 0.5, 1.0 - ((a_position.y + 1.0) * 0.5));",
    "}"
  ].join("\n");

  const fragmentShaderSource = [
    "precision mediump float;",
    "varying vec2 v_uv;",
    "uniform sampler2D u_texture;",
    "uniform vec2 u_texSize;",
    "uniform float u_mode;",
    "",
    "vec2 pixelUv(vec2 pixel) {",
    "  vec2 bounded = clamp(pixel, vec2(0.5), u_texSize - vec2(0.5));",
    "  return bounded / u_texSize;",
    "}",
    "",
    "vec4 samplePixel(vec2 pixel) {",
    "  return texture2D(u_texture, pixelUv(pixel));",
    "}",
    "",
    "float colorDistance(vec3 a, vec3 b) {",
    "  vec3 d = abs(a - b);",
    "  float luma = dot(d, vec3(0.299, 0.587, 0.114));",
    "  return luma * 0.70 + length(d) * 0.30;",
    "}",
    "",
    "float similar(vec3 a, vec3 b) {",
    "  return 1.0 - step(0.115, colorDistance(a, b));",
    "}",
    "",
    "vec3 bilinearPixel(vec2 sourcePos) {",
    "  vec2 i = floor(sourcePos);",
    "  vec2 f = fract(sourcePos);",
    "  vec3 c00 = samplePixel(i + vec2(0.5, 0.5)).rgb;",
    "  vec3 c10 = samplePixel(i + vec2(1.5, 0.5)).rgb;",
    "  vec3 c01 = samplePixel(i + vec2(0.5, 1.5)).rgb;",
    "  vec3 c11 = samplePixel(i + vec2(1.5, 1.5)).rgb;",
    "  vec3 top = mix(c00, c10, f.x);",
    "  vec3 bottom = mix(c01, c11, f.x);",
    "  return mix(top, bottom, f.y);",
    "}",
    "",
    "void main() {",
    "  vec2 sourcePos = v_uv * u_texSize - vec2(0.5);",
    "  vec2 center = floor(sourcePos) + vec2(0.5);",
    "  vec2 fracPos = fract(sourcePos);",
    "",
    "  vec4 e4 = samplePixel(center);",
    "  vec3 e = e4.rgb;",
    "  vec3 b = samplePixel(center + vec2(0.0, -1.0)).rgb;",
    "  vec3 d = samplePixel(center + vec2(-1.0, 0.0)).rgb;",
    "  vec3 f = samplePixel(center + vec2(1.0, 0.0)).rgb;",
    "  vec3 h = samplePixel(center + vec2(0.0, 1.0)).rgb;",
    "",
    "  if (u_mode < 1.5) {",
    "    vec3 averageNeighbours = (b + d + f + h) * 0.25;",
    "    vec3 sharpened = clamp(e + (e - averageNeighbours) * 0.28, 0.0, 1.0);",
    "    gl_FragColor = vec4(sharpened, e4.a);",
    "    return;",
    "  }",
    "",
    "  if (u_mode < 2.5) {",
    "    float diffDH = 1.0 - similar(d, h);",
    "    float diffBF = 1.0 - similar(b, f);",
    "",
    "    float condTL = similar(d, b) * diffDH * diffBF;",
    "    float condTR = similar(b, f) * (1.0 - similar(b, d)) * (1.0 - similar(f, h));",
    "    float condBL = similar(d, h) * (1.0 - similar(d, b)) * (1.0 - similar(h, f));",
    "    float condBR = similar(h, f) * diffDH * diffBF;",
    "",
    "    float leftHalf = 1.0 - step(0.5, fracPos.x);",
    "    float rightHalf = step(0.5, fracPos.x);",
    "    float topHalf = 1.0 - step(0.5, fracPos.y);",
    "    float bottomHalf = step(0.5, fracPos.y);",
    "",
    "    float wTL = condTL * leftHalf * topHalf;",
    "    float wTR = condTR * rightHalf * topHalf;",
    "    float wBL = condBL * leftHalf * bottomHalf;",
    "    float wBR = condBR * rightHalf * bottomHalf;",
    "",
    "    vec3 candidateTL = (d + b) * 0.5;",
    "    vec3 candidateTR = (b + f) * 0.5;",
    "    vec3 candidateBL = (d + h) * 0.5;",
    "    vec3 candidateBR = (h + f) * 0.5;",
    "",
    "    vec3 hd = e;",
    "    hd = mix(hd, candidateTL, wTL * 0.78);",
    "    hd = mix(hd, candidateTR, wTR * 0.78);",
    "    hd = mix(hd, candidateBL, wBL * 0.78);",
    "    hd = mix(hd, candidateBR, wBR * 0.78);",
    "",
    "    vec3 averageNeighbours = (b + d + f + h) * 0.25;",
    "    hd = clamp(hd + (hd - averageNeighbours) * 0.055, 0.0, 1.0);",
    "    gl_FragColor = vec4(hd, e4.a);",
    "    return;",
    "  }",
    "",
    "  vec3 lcd = bilinearPixel(sourcePos);",
    "  lcd = pow(clamp(lcd, 0.0, 1.0), vec3(0.94));",
    "  float luminance = dot(lcd, vec3(0.299, 0.587, 0.114));",
    "  lcd = mix(vec3(luminance), lcd, 1.035);",
    "",
    "  float triad = mod(floor(gl_FragCoord.x), 3.0);",
    "  vec3 mask = vec3(0.965);",
    "  if (triad < 1.0) mask.r = 1.025;",
    "  else if (triad < 2.0) mask.g = 1.025;",
    "  else mask.b = 1.025;",
    "",
    "  float rowMask = 0.965 + 0.035 * step(0.5, fract(gl_FragCoord.y * 0.5));",
    "  lcd = clamp(lcd * mask * rowMask, 0.0, 1.0);",
    "  gl_FragColor = vec4(lcd, e4.a);",
    "}"
  ].join("\n");

  function readStoredMode() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return VALID_MODES.has(saved) ? saved : "original";
    } catch (_) {
      return "original";
    }
  }

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) || "Error de shader desconocido";
      gl.deleteShader(shader);
      throw new Error(log);
    }
    return shader;
  }

  function initializeGpu() {
    if (gl || fallback2d) return gpuAvailable;

    gl =
      overlay.getContext("webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        premultipliedAlpha: false
      }) ||
      overlay.getContext("experimental-webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false
      });

    if (!gl) {
      fallback2d = overlay.getContext("2d", { alpha: false });
      gpuAvailable = false;
      return false;
    }

    try {
      const vertexShader = compileShader(gl.VERTEX_SHADER, vertexShaderSource);
      const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);

      program = gl.createProgram();
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);

      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || "No se pudo enlazar el programa WebGL.");
      }

      gl.useProgram(program);

      positionBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW
      );

      const positionLocation = gl.getAttribLocation(program, "a_position");
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

      texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

      samplerUniform = gl.getUniformLocation(program, "u_texture");
      modeUniform = gl.getUniformLocation(program, "u_mode");
      texSizeUniform = gl.getUniformLocation(program, "u_texSize");
      gl.uniform1i(samplerUniform, 0);

      gl.clearColor(0, 0, 0, 1);
      gpuAvailable = true;
      overlay.dataset.renderer = "webgl";
      return true;
    } catch (error) {
      console.warn("ML3D Graphics: WebGL no disponible, se usa modo compatible.", error);
      gl = null;
      program = null;
      fallback2d = overlay.getContext("2d", { alpha: false });
      gpuAvailable = false;
      overlay.dataset.renderer = "2d";
      return false;
    }
  }

  function desiredDpr() {
    const nativeDpr = Math.max(1, Number(window.devicePixelRatio) || 1);
    let limit = mode === "hd" ? 2 : 1.75;
    let dpr = Math.min(nativeDpr, limit);
    const rect = sourceCanvas.getBoundingClientRect();
    const maxPixels = 2600000;

    while (rect.width * rect.height * dpr * dpr > maxPixels && dpr > 1) {
      dpr = Math.max(1, dpr - 0.25);
    }
    return dpr;
  }

  function resizeOutputIfNeeded() {
    const rect = sourceCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;

    const dpr = desiredDpr();
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));

    if (width !== lastWidth || height !== lastHeight || dpr !== lastDpr) {
      overlay.width = width;
      overlay.height = height;
      lastWidth = width;
      lastHeight = height;
      lastDpr = dpr;
      if (gl) gl.viewport(0, 0, width, height);
    }
    return true;
  }

  function getSourceDimensions() {
    if (!frameSource) return { width: 0, height: 0 };
    if (sourceKind === "imagedata") {
      return {
        width: frameSource.width || 0,
        height: frameSource.height || 0
      };
    }
    return {
      width: frameSource.width || 0,
      height: frameSource.height || 0
    };
  }

  function uploadTexture() {
    if (!gl || !frameSource) return false;
    const size = getSourceDimensions();
    if (!size.width || !size.height) return false;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    try {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        frameSource
      );
    } catch (error) {
      console.warn("ML3D Graphics: no se pudo subir el frame a la GPU.", error);
      return false;
    }

    gl.uniform2f(texSizeUniform, size.width, size.height);
    return true;
  }

  function ensureFallbackSource() {
    if (sourceKind !== "imagedata") return frameSource;
    const size = getSourceDimensions();

    if (!fallbackSourceCanvas) {
      fallbackSourceCanvas = document.createElement("canvas");
      fallbackSourceContext = fallbackSourceCanvas.getContext("2d");
    }

    if (fallbackSourceCanvas.width !== size.width || fallbackSourceCanvas.height !== size.height) {
      fallbackSourceCanvas.width = size.width;
      fallbackSourceCanvas.height = size.height;
    }

    fallbackSourceContext.putImageData(frameSource, 0, 0);
    return fallbackSourceCanvas;
  }

  function renderFallback() {
    if (!fallback2d || !frameSource) return;
    const drawable = ensureFallbackSource();
    if (!drawable) return;

    fallback2d.save();
    fallback2d.setTransform(1, 0, 0, 1, 0, 0);
    fallback2d.clearRect(0, 0, overlay.width, overlay.height);
    fallback2d.imageSmoothingEnabled = mode === "lcd";
    if ("filter" in fallback2d) {
      fallback2d.filter =
        mode === "lcd"
          ? "saturate(0.96) contrast(1.03) brightness(1.03)"
          : mode === "sharp"
            ? "contrast(1.04)"
            : "none";
    }
    fallback2d.drawImage(drawable, 0, 0, overlay.width, overlay.height);
    fallback2d.restore();
  }

  function render() {
    if (mode === "original" || document.hidden) return;
    if (!resizeOutputIfNeeded()) return;

    initializeGpu();

    if (gl && program && uploadTexture()) {
      gl.useProgram(program);
      gl.uniform1f(modeUniform, MODE_VALUES[mode]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else {
      renderFallback();
    }
  }

  function loop() {
    render();
    animationFrameId = window.requestAnimationFrame(loop);
  }

  function updateSelector() {
    if (selector && selector.value !== mode) selector.value = mode;
    if (selector) {
      selector.dataset.graphicsMode = mode;
      selector.title =
        mode === "original"
          ? "Salida original del emulador"
          : mode === "sharp"
            ? "Píxel definido con realce ligero de contornos"
            : mode === "hd"
              ? "Escalado GPU con reconstrucción de diagonales y bordes"
              : "Suavizado y simulación ligera de pantalla LCD";
    }
  }

  function setMode(nextMode, persist = true) {
    const normalized = VALID_MODES.has(nextMode) ? nextMode : "original";
    mode = normalized;
    overlay.style.display = mode === "original" ? "none" : "block";
    frame.dataset.graphicsMode = mode;
    updateSelector();

    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, mode);
      } catch (_) {}
    }

    if (mode !== "original") {
      initializeGpu();
      render();
    }

    window.dispatchEvent(
      new CustomEvent("ml3dgraphicschange", {
        detail: { mode, webgl: gpuAvailable }
      })
    );
  }

  function useCanvasSource(canvas) {
    if (!canvas || typeof canvas.getContext !== "function") return;
    frameSource = canvas;
    sourceKind = "canvas";
  }

  function useImageDataSource(imageData) {
    if (!imageData || !imageData.data || !imageData.width || !imageData.height) return;
    frameSource = imageData;
    sourceKind = "imagedata";
  }

  if (selector) {
    selector.addEventListener("change", () => setMode(selector.value, true));
  }

  const api = {
    setMode,
    getMode: () => mode,
    useCanvasSource,
    useImageDataSource,
    getOutputCanvas: () => (mode === "original" ? sourceCanvas : overlay),
    isWebGL: () => gpuAvailable,
    render
  };

  window.ml3dGraphicsEnhancer = api;
  useCanvasSource(sourceCanvas);
  setMode(mode, false);

  if (!animationFrameId) {
    animationFrameId = window.requestAnimationFrame(loop);
  }
})();