(() => {
  "use strict";

  if (window.__ml3dAvatarRendererV5) return;
  window.__ml3dAvatarRendererV5 = true;

  const PROFILE_KEY = "ml3d-link-avatar-final-v1";
  const SHEETS = {
    male: "./assets/avatar-base/male-base.png?v=4",
    female: "./assets/avatar-base/female-base.png?v=4"
  };
  const DIR_INDEX = { down: 0, up: 1, left: 2, right: 3 };
  const GRID = 4;
  const W = 64;
  const H = 96;
  const PREVIEW_W = 128;
  const PREVIEW_H = 168;
  const BG_THRESHOLD = 58;
  const ALPHA = 20;
  const EPS = 0.001;
  const MOVE_HOLD_MS = 210;
  const SIDE_FRAME_MS = 88;
  const VERTICAL_FRAME_MS = 76;
  const SIDE_WALK = [0, 1, 2, 3];
  const VERTICAL_WALK = [0, 1, 2, 3, 2, 1];
  const SIDE_TAU_MS = 58;
  const VERTICAL_TAU_MS = 42;
  const TELEPORT_DISTANCE = 72;

  const compiled = new Map();
  const stateByPlayer = new Map();
  let compiledByBase = null;
  let lastEditorPaint = 0;

  const style = document.createElement("style");
  style.textContent = `
    .avatar-base-host > .avatar-base-canvas,
    .avatar-base-host > .avatar-clean-canvas,
    .avatar-base-host > .avatar-v3-canvas,
    .avatar-base-host > .avatar-v4-smooth {
      opacity:0!important;
      visibility:hidden!important;
    }
    .avatar-v5-canvas {
      position:absolute;
      left:50%;
      bottom:0;
      width:56px;
      height:84px;
      transform:translateX(-50%);
      image-rendering:pixelated;
      image-rendering:crisp-edges;
      pointer-events:none;
      will-change:margin-left,bottom;
    }
    .player.local .avatar-v5-canvas {
      filter:drop-shadow(0 0 4px rgba(88,190,255,.88));
    }

    #avatarFinalPreview > canvas:not(.avatar-v5-preview) {
      display:none!important;
    }
    #avatarFinalBase button > canvas:not(.avatar-v5-choice) {
      display:none!important;
    }
    #avatarFinalPreview > canvas.avatar-v5-preview {
      display:block!important;
      visibility:visible!important;
      opacity:1!important;
      position:relative!important;
      width:112px!important;
      height:147px!important;
      margin:auto!important;
      image-rendering:pixelated;
      image-rendering:crisp-edges;
      filter:drop-shadow(0 9px 8px rgba(0,0,0,.38));
    }
    #avatarFinalBase button > canvas.avatar-v5-choice {
      display:block!important;
      visibility:visible!important;
      opacity:1!important;
      position:relative!important;
      width:40px!important;
      height:60px!important;
      flex:0 0 auto;
      image-rendering:pixelated;
      image-rendering:crisp-edges;
    }

    @media(max-width:560px){
      .avatar-v5-canvas { width:48px; height:72px; }
      #avatarFinalPreview > canvas.avatar-v5-preview {
        width:96px!important;
        height:126px!important;
      }
      #avatarFinalBase button > canvas.avatar-v5-choice {
        width:34px!important;
        height:51px!important;
      }
    }
  `;
  document.head.appendChild(style);

  function localBase() {
    try {
      return JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}").base === "female"
        ? "female"
        : "male";
    } catch {
      return "male";
    }
  }

  function selectedBase() {
    const selected = document.querySelector("#avatarFinalBase button.selected");
    if (!selected) return localBase();
    return /MUJER/i.test(selected.textContent || "") ? "female" : "male";
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
      image.src = src;
    });
  }

  function borderRef(data, w, h) {
    const points = [
      [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
      [w >> 1, 0], [w >> 1, h - 1], [0, h >> 1], [w - 1, h >> 1]
    ];
    let r = 0, g = 0, b = 0, a = 0;
    for (const [x, y] of points) {
      const i = (y * w + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      a += data[i + 3];
    }
    return {
      r: r / points.length,
      g: g / points.length,
      b: b / points.length,
      a: a / points.length
    };
  }

  function colorDistance(r, g, b, ref) {
    const dr = r - ref.r;
    const dg = g - ref.g;
    const db = b - ref.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  function clearBackground(canvas) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const w = canvas.width;
    const h = canvas.height;
    const image = ctx.getImageData(0, 0, w, h);
    const data = image.data;
    const ref = borderRef(data, w, h);
    if (ref.a < 24) return;

    const visited = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0;
    let tail = 0;

    const isBackground = (index) => {
      const p = index * 4;
      return data[p + 3] < 24 ||
        colorDistance(data[p], data[p + 1], data[p + 2], ref) <= BG_THRESHOLD;
    };
    const push = (index) => {
      if (
        index < 0 ||
        index >= visited.length ||
        visited[index] ||
        !isBackground(index)
      ) return;
      visited[index] = 1;
      queue[tail++] = index;
    };

    for (let x = 0; x < w; x += 1) {
      push(x);
      push((h - 1) * w + x);
    }
    for (let y = 0; y < h; y += 1) {
      push(y * w);
      push(y * w + w - 1);
    }

    while (head < tail) {
      const index = queue[head++];
      const x = index % w;
      const y = (index / w) | 0;
      data[index * 4 + 3] = 0;
      if (x > 0) push(index - 1);
      if (x + 1 < w) push(index + 1);
      if (y > 0) push(index - w);
      if (y + 1 < h) push(index + w);
    }

    ctx.putImageData(image, 0, 0);
  }

  function connectedComponents(canvas) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    const w = canvas.width;
    const h = canvas.height;
    const visited = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    const components = [];
    const isForeground = (index) => data[index * 4 + 3] >= ALPHA;

    for (let start = 0; start < w * h; start += 1) {
      if (visited[start] || !isForeground(start)) continue;

      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      visited[start] = 1;

      const pixels = [];
      let area = 0;
      let minX = w;
      let minY = h;
      let maxX = -1;
      let maxY = -1;
      let sumX = 0;
      let sumY = 0;

      while (head < tail) {
        const index = queue[head++];
        const x = index % w;
        const y = (index / w) | 0;
        pixels.push(index);
        area += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        sumX += x;
        sumY += y;

        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            if (!ox && !oy) continue;
            const nx = x + ox;
            const ny = y + oy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const ni = ny * w + nx;
            if (visited[ni] || !isForeground(ni)) continue;
            visited[ni] = 1;
            queue[tail++] = ni;
          }
        }
      }

      components.push({
        pixels,
        area,
        minX,
        minY,
        maxX,
        maxY,
        cx: sumX / area,
        cy: sumY / area
      });
    }

    return { image, components };
  }

  function keepMainSubject(canvas) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const w = canvas.width;
    const h = canvas.height;
    const { image, components } = connectedComponents(canvas);
    if (!components.length) return;

    const centerX = w / 2;
    const centerY = h * 0.58;
    const score = (component) => {
      const dx = Math.abs(component.cx - centerX) / Math.max(1, w / 2);
      const dy = Math.abs(component.cy - centerY) / Math.max(1, h / 2);
      const height = component.maxY - component.minY + 1;
      return component.area *
        Math.max(0.08, 1 - (dx * 0.85 + dy * 0.35)) *
        (0.7 + 0.3 * Math.min(1, height / Math.max(1, h * 0.5)));
    };

    const main = [...components].sort((a, b) => score(b) - score(a))[0];
    const mainW = main.maxX - main.minX + 1;
    const mainH = main.maxY - main.minY + 1;
    const padX = Math.max(8, Math.round(mainW * 0.24));
    const padY = Math.max(8, Math.round(mainH * 0.18));
    const areaFloor = Math.max(6, main.area * 0.006);
    const keep = new Uint8Array(w * h);

    for (const component of components) {
      const near =
        component.area >= areaFloor &&
        component.maxX >= main.minX - padX &&
        component.minX <= main.maxX + padX &&
        component.maxY >= main.minY - padY &&
        component.minY <= main.maxY + padY;
      if (component === main || near) {
        for (const index of component.pixels) keep[index] = 1;
      }
    }

    const data = image.data;
    for (let index = 0; index < w * h; index += 1) {
      if (!keep[index]) data[index * 4 + 3] = 0;
    }
    ctx.putImageData(image, 0, 0);
  }

  function bounds(canvas) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (data[(y * canvas.width + x) * 4 + 3] < ALPHA) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    if (maxX < minX) {
      return {
        x: 0,
        y: 0,
        w: canvas.width,
        h: canvas.height,
        anchorX: canvas.width / 2
      };
    }

    const height = maxY - minY + 1;
    const feetStart = Math.max(minY, maxY - Math.max(4, Math.round(height * 0.22)));
    let feetSumX = 0;
    let feetCount = 0;

    for (let y = feetStart; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (data[(y * canvas.width + x) * 4 + 3] < ALPHA) continue;
        feetSumX += x;
        feetCount += 1;
      }
    }

    return {
      x: minX,
      y: minY,
      w: maxX - minX + 1,
      h: height,
      anchorX: feetCount ? feetSumX / feetCount : (minX + maxX) / 2
    };
  }

  function maskDistance(a, b) {
    const dataA = a.getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, a.width, a.height).data;
    const dataB = b.getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, b.width, b.height).data;
    let different = 0;
    let union = 0;

    for (let i = 3; i < dataA.length; i += 4) {
      const aa = dataA[i] >= ALPHA;
      const bb = dataB[i] >= ALPHA;
      if (aa || bb) union += 1;
      if (aa !== bb) different += 1;
    }
    return union ? different / union : 1;
  }

  function groupingScore(frames, mode) {
    let total = 0;
    let pairs = 0;
    for (let direction = 0; direction < GRID; direction += 1) {
      const group = [];
      for (let frame = 0; frame < GRID; frame += 1) {
        group.push(mode === "rows"
          ? frames[direction][frame]
          : frames[frame][direction]);
      }
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          total += maskDistance(group[i], group[j]);
          pairs += 1;
        }
      }
    }
    return pairs ? total / pairs : Infinity;
  }

  async function compile(base) {
    if (compiled.has(base)) return compiled.get(base);

    const promise = (async () => {
      const image = await loadImage(SHEETS[base]);
      const raw = Array.from({ length: GRID }, () => Array(GRID));
      let maxW = 1;
      let maxH = 1;

      for (let row = 0; row < GRID; row += 1) {
        const sy = Math.round(image.naturalHeight * row / GRID);
        const ey = Math.round(image.naturalHeight * (row + 1) / GRID);
        for (let col = 0; col < GRID; col += 1) {
          const sx = Math.round(image.naturalWidth * col / GRID);
          const ex = Math.round(image.naturalWidth * (col + 1) / GRID);
          const cell = document.createElement("canvas");
          cell.width = Math.max(1, ex - sx);
          cell.height = Math.max(1, ey - sy);
          const ctx = cell.getContext("2d", { willReadFrequently: true });
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(
            image,
            sx,
            sy,
            cell.width,
            cell.height,
            0,
            0,
            cell.width,
            cell.height
          );
          clearBackground(cell);
          keepMainSubject(cell);
          const frameBounds = bounds(cell);
          maxW = Math.max(maxW, frameBounds.w);
          maxH = Math.max(maxH, frameBounds.h);
          raw[row][col] = { cell, frameBounds };
        }
      }

      const scale = Math.min((W - 10) / maxW, (H - 8) / maxH);
      const frames = Array.from({ length: GRID }, () => Array(GRID));

      for (let row = 0; row < GRID; row += 1) {
        for (let col = 0; col < GRID; col += 1) {
          const { cell, frameBounds } = raw[row][col];
          const out = document.createElement("canvas");
          out.width = W;
          out.height = H;
          const ctx = out.getContext("2d");
          ctx.imageSmoothingEnabled = false;

          const dw = Math.max(1, Math.round(frameBounds.w * scale));
          const dh = Math.max(1, Math.round(frameBounds.h * scale));
          const anchorOffset = (frameBounds.anchorX - frameBounds.x) * scale;
          const dx = Math.round(W / 2 - anchorOffset);
          const dy = H - dh - 2;

          ctx.drawImage(
            cell,
            frameBounds.x,
            frameBounds.y,
            frameBounds.w,
            frameBounds.h,
            dx,
            dy,
            dw,
            dh
          );
          frames[row][col] = out;
        }
      }

      const rowsScore = groupingScore(frames, "rows");
      const colsScore = groupingScore(frames, "cols");
      const orientation = colsScore + 0.015 < rowsScore ? "cols" : "rows";
      return { frames, orientation };
    })();

    compiled.set(base, promise);
    return promise;
  }

  function sourceFrame(sheet, direction, frame) {
    const dir = DIR_INDEX[direction] ?? 0;
    return sheet.orientation === "rows"
      ? sheet.frames[dir][frame]
      : sheet.frames[frame][dir];
  }

  function paint(canvas, sheet, direction, frame) {
    const source = sourceFrame(sheet, direction, frame);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }

  function paintContained(canvas, sheet, direction, frame, padding = 12) {
    const source = sourceFrame(sheet, direction, frame);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const scale = Math.min(
      (canvas.width - padding * 2) / W,
      (canvas.height - padding * 2) / H
    );
    const dw = Math.round(W * scale);
    const dh = Math.round(H * scale);
    const dx = Math.round((canvas.width - dw) / 2);
    const dy = Math.round((canvas.height - dh) / 2);
    ctx.drawImage(source, dx, dy, dw, dh);
  }

  function resolveBase(player) {
    if (player.classList.contains("local")) return localBase();
    const key = player.querySelector(".avatar-base-canvas")?.dataset.paintKey || "";
    return key.startsWith("female:") ? "female" : "male";
  }

  function ensurePlayerCanvas(player) {
    let host = player.querySelector(":scope > .avatar-base-host");
    if (!host) {
      const wrap = player.querySelector(".avatar-wrap");
      if (!wrap) return null;
      host = document.createElement("div");
      host.className = "avatar-base-host";
      wrap.before(host);
    }

    let canvas = host.querySelector(":scope > .avatar-v5-canvas");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      canvas.className = "avatar-v5-canvas";
      canvas.setAttribute("aria-hidden", "true");
      host.append(canvas);
    }
    return canvas;
  }

  function position(player) {
    return {
      x: Number.parseFloat(player.style.left) || 0,
      y: Number.parseFloat(player.style.top) || 0
    };
  }

  function directionFrom(previous, next) {
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    if (Math.abs(dx) <= EPS && Math.abs(dy) <= EPS) {
      return previous.dir || "down";
    }
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx < 0 ? "left" : "right";
    }
    return dy < 0 ? "up" : "down";
  }

  function ensurePreviewCanvas(root, className, width, height, compatibilityClass) {
    let canvas = root.querySelector(`:scope > .${className}`);
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = `${className} ${compatibilityClass}`;
      root.append(canvas);
    }
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    return canvas;
  }

  function refreshEditor() {
    if (!compiledByBase) return;

    const preview = document.getElementById("avatarFinalPreview");
    if (preview) {
      const base = selectedBase();
      const sheet = compiledByBase[base] || compiledByBase.male;
      if (sheet) {
        const canvas = ensurePreviewCanvas(
          preview,
          "avatar-v5-preview",
          PREVIEW_W,
          PREVIEW_H,
          "avatar-base-preview-canvas"
        );
        paintContained(canvas, sheet, "down", 0, 14);
      }
    }

    document.querySelectorAll("#avatarFinalBase button").forEach((button) => {
      const base = /MUJER/i.test(button.textContent || "") ? "female" : "male";
      const sheet = compiledByBase[base] || compiledByBase.male;
      if (!sheet) return;
      const canvas = ensurePreviewCanvas(
        button,
        "avatar-v5-choice",
        W,
        H,
        "avatar-base-choice-canvas"
      );
      paintContained(canvas, sheet, "down", 0, 5);
    });
  }

  function installEditorSync() {
    document.addEventListener("click", (event) => {
      if (event.target.closest("#avatarButton,#avatarFinalBase button,#saveAvatarFinal")) {
        setTimeout(refreshEditor, 0);
        setTimeout(refreshEditor, 40);
      }
    });

    const modal = document.getElementById("avatarModal");
    if (modal) {
      new MutationObserver(() => refreshEditor()).observe(modal, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "hidden"]
      });
    }
    refreshEditor();
  }

  function smoothVisualPosition(state, target, direction, now) {
    const dt = Math.min(50, Math.max(0, now - state.lastNow));
    const jump = Math.hypot(target.x - state.targetX, target.y - state.targetY);

    if (!state.initialized || jump >= TELEPORT_DISTANCE) {
      state.visualX = target.x;
      state.visualY = target.y;
      state.initialized = true;
      return;
    }

    const lateral = direction === "left" || direction === "right";
    const tau = lateral ? SIDE_TAU_MS : VERTICAL_TAU_MS;
    const alpha = 1 - Math.exp(-dt / Math.max(1, tau));
    state.visualX += (target.x - state.visualX) * alpha;
    state.visualY += (target.y - state.visualY) * alpha;

    if (Math.abs(target.x - state.visualX) < 0.01) state.visualX = target.x;
    if (Math.abs(target.y - state.visualY) < 0.01) state.visualY = target.y;
  }

  async function boot() {
    const [maleResult, femaleResult] = await Promise.allSettled([
      compile("male"),
      compile("female")
    ]);

    compiledByBase = {
      male: maleResult.status === "fulfilled" ? maleResult.value : null,
      female: femaleResult.status === "fulfilled" ? femaleResult.value : null
    };

    installEditorSync();

    const tick = (now) => {
      const activeIds = new Set();
      const modal = document.getElementById("avatarModal");
      if (modal && !modal.hidden && now - lastEditorPaint > 90) {
        refreshEditor();
        lastEditorPaint = now;
      }

      document.querySelectorAll("#playersLayer .player").forEach((player) => {
        const canvas = ensurePlayerCanvas(player);
        if (!canvas) return;

        const id =
          player.dataset.playerId ||
          player.querySelector(".player-name-text")?.textContent ||
          "local";
        activeIds.add(id);

        const pos = position(player);
        const previous = stateByPlayer.get(id) || {
          x: pos.x,
          y: pos.y,
          targetX: pos.x,
          targetY: pos.y,
          visualX: pos.x,
          visualY: pos.y,
          dir: "down",
          moving: false,
          lastMove: -Infinity,
          walkStart: now,
          lastNow: now,
          initialized: false
        };

        const moved =
          Math.abs(pos.x - previous.x) > EPS ||
          Math.abs(pos.y - previous.y) > EPS;
        const dir = moved ? directionFrom(previous, pos) : previous.dir;
        const lastMove = moved ? now : previous.lastMove;
        const moving =
          moved ||
          player.classList.contains("is-moving") ||
          now - lastMove <= MOVE_HOLD_MS;
        const walkStart = moving && previous.moving ? previous.walkStart : now;

        previous.targetX = pos.x;
        previous.targetY = pos.y;
        smoothVisualPosition(previous, pos, dir, now);

        const offsetX = previous.visualX - pos.x;
        const offsetY = previous.visualY - pos.y;
        canvas.style.marginLeft = `${offsetX.toFixed(3)}px`;
        canvas.style.bottom = `${(-offsetY).toFixed(3)}px`;

        const lateral = dir === "left" || dir === "right";
        const sequence = lateral ? SIDE_WALK : VERTICAL_WALK;
        const frameMs = lateral ? SIDE_FRAME_MS : VERTICAL_FRAME_MS;
        const frameIndex = moving
          ? Math.floor((now - walkStart) / frameMs) % sequence.length
          : 0;
        const frame = moving ? sequence[frameIndex] : 0;

        const base = resolveBase(player);
        const sheet = compiledByBase[base] || compiledByBase.male;
        if (sheet) {
          const paintKey = `${base}:${sheet.orientation}:${dir}:${frame}`;
          if (canvas.dataset.paintKey !== paintKey) {
            canvas.dataset.paintKey = paintKey;
            paint(canvas, sheet, dir, frame);
          }
        }

        player.dataset.ml3dDirection = dir;
        player.classList.toggle("ml3d-walking", moving);

        stateByPlayer.set(id, {
          ...previous,
          x: pos.x,
          y: pos.y,
          dir,
          moving,
          lastMove,
          walkStart,
          lastNow: now
        });
      });

      for (const id of stateByPlayer.keys()) {
        if (!activeIds.has(id)) stateByPlayer.delete(id);
      }

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
