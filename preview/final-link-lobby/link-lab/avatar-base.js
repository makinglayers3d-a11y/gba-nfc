(() => {
  "use strict";

  const PROFILE_KEY = "ml3d-link-avatar-final-v1";
  const SHEETS = {
    male: "./assets/avatar-base/male-base.png?v=2",
    female: "./assets/avatar-base/female-base.png?v=2"
  };
  const DIR_ROW = { down: 0, up: 1, left: 2, right: 3 };
  const LOGICAL_W = 64;
  const LOGICAL_H = 96;
  const GRID = 4;
  const BG_THRESHOLD = 58;
  const WALK_FRAME_MS = 115;
  const WALK_HOLD_MS = 210;

  const compiled = new Map();
  const remoteProfiles = new Map();
  const stateByPlayer = new Map();

  function cleanName(value) {
    return String(value || "Jugador")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/\s+★$/, "")
      .trim()
      .slice(0, 32) || "Jugador";
  }

  function readLocalProfile() {
    try {
      const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
      return {
        name: cleanName(p.name),
        base: p.base === "female" ? "female" : "male"
      };
    } catch {
      return { name: "Jugador", base: "male" };
    }
  }

  function selectedEditorBase() {
    const selected = document.querySelector("#avatarFinalBase button.selected");
    if (!selected) return readLocalProfile().base;
    return /MUJER/i.test(selected.textContent || "") ? "female" : "male";
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`No se pudo cargar ${url}`));
      img.src = url;
    });
  }

  function colorDistance(r, g, b, ref) {
    const dr = r - ref.r;
    const dg = g - ref.g;
    const db = b - ref.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  function borderReference(data, w, h) {
    const points = [
      [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
      [Math.floor(w / 2), 0], [Math.floor(w / 2), h - 1],
      [0, Math.floor(h / 2)], [w - 1, Math.floor(h / 2)]
    ];
    let r = 0, g = 0, b = 0, a = 0;
    for (const [x, y] of points) {
      const i = (y * w + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3];
    }
    return { r: r / points.length, g: g / points.length, b: b / points.length, a: a / points.length };
  }

  function clearConnectedBackground(canvas) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const w = canvas.width;
    const h = canvas.height;
    const image = ctx.getImageData(0, 0, w, h);
    const d = image.data;
    const ref = borderReference(d, w, h);
    if (ref.a < 24) return;

    const visited = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0, tail = 0;

    const isBackground = (index) => {
      const p = index * 4;
      if (d[p + 3] < 24) return true;
      return colorDistance(d[p], d[p + 1], d[p + 2], ref) <= BG_THRESHOLD;
    };
    const push = (index) => {
      if (index < 0 || index >= visited.length || visited[index] || !isBackground(index)) return;
      visited[index] = 1;
      queue[tail++] = index;
    };

    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }

    while (head < tail) {
      const index = queue[head++];
      const x = index % w;
      const y = (index / w) | 0;
      d[index * 4 + 3] = 0;
      if (x > 0) push(index - 1);
      if (x + 1 < w) push(index + 1);
      if (y > 0) push(index - w);
      if (y + 1 < h) push(index + w);
    }
    ctx.putImageData(image, 0, 0);
  }

  function alphaBounds(canvas) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const a = data[(y * canvas.width + x) * 4 + 3];
        if (a < 20) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < minX || maxY < minY) return { x: 0, y: 0, w: canvas.width, h: canvas.height };
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  async function compileSheet(base) {
    if (compiled.has(base)) return compiled.get(base);
    const promise = (async () => {
      const image = await loadImage(SHEETS[base]);
      const rawFrames = [];
      let maxW = 1, maxH = 1;

      for (let row = 0; row < GRID; row++) {
        rawFrames[row] = [];
        const sy = Math.round(image.naturalHeight * row / GRID);
        const ey = Math.round(image.naturalHeight * (row + 1) / GRID);
        for (let col = 0; col < GRID; col++) {
          const sx = Math.round(image.naturalWidth * col / GRID);
          const ex = Math.round(image.naturalWidth * (col + 1) / GRID);
          const cell = document.createElement("canvas");
          cell.width = Math.max(1, ex - sx);
          cell.height = Math.max(1, ey - sy);
          const ctx = cell.getContext("2d", { willReadFrequently: true });
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(image, sx, sy, cell.width, cell.height, 0, 0, cell.width, cell.height);
          clearConnectedBackground(cell);
          const bounds = alphaBounds(cell);
          maxW = Math.max(maxW, bounds.w);
          maxH = Math.max(maxH, bounds.h);
          rawFrames[row][col] = { cell, bounds };
        }
      }

      const scale = Math.min((LOGICAL_W - 8) / maxW, (LOGICAL_H - 6) / maxH);
      const frames = [];
      for (let row = 0; row < GRID; row++) {
        frames[row] = [];
        for (let col = 0; col < GRID; col++) {
          const { cell, bounds } = rawFrames[row][col];
          const out = document.createElement("canvas");
          out.width = LOGICAL_W;
          out.height = LOGICAL_H;
          const ctx = out.getContext("2d");
          ctx.imageSmoothingEnabled = false;
          const dw = Math.max(1, Math.round(bounds.w * scale));
          const dh = Math.max(1, Math.round(bounds.h * scale));
          const dx = Math.round((LOGICAL_W - dw) / 2);
          const dy = LOGICAL_H - dh - 2;
          ctx.drawImage(cell, bounds.x, bounds.y, bounds.w, bounds.h, dx, dy, dw, dh);
          frames[row][col] = out;
        }
      }
      return frames;
    })();
    compiled.set(base, promise);
    return promise;
  }

  async function drawFrame(target, base, direction = "down", frame = 0) {
    if (!target?.getContext) return;
    const frames = await compileSheet(base === "female" ? "female" : "male");
    if (!target.isConnected) return;
    const row = DIR_ROW[direction] ?? 0;
    const col = ((Number(frame) || 0) % GRID + GRID) % GRID;
    const ctx = target.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(frames[row][col], 0, 0, target.width, target.height);
  }

  function playerName(el) {
    return cleanName(el.querySelector(".player-name-text")?.textContent || "Jugador");
  }

  function resolveBase(el) {
    if (el.classList.contains("local")) return readLocalProfile().base;
    return remoteProfiles.get(playerName(el))?.base || "male";
  }

  function directChildByClass(el, className) {
    for (const child of el.children) {
      if (child.classList?.contains(className)) return child;
    }
    return null;
  }

  function ensurePlayerCanvas(el) {
    const wrap = el.querySelector(".avatar-wrap");
    if (!wrap) return null;

    el.classList.add("ml3d-base-player");
    wrap.classList.add("ml3d-base-mounted");

    let host = directChildByClass(el, "avatar-base-host");
    if (!host) {
      host = document.createElement("div");
      host.className = "avatar-base-host";
      host.setAttribute("aria-hidden", "true");
      wrap.before(host);
    }

    let canvas = host.querySelector(".avatar-base-canvas");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = LOGICAL_W;
      canvas.height = LOGICAL_H;
      canvas.className = "avatar-base-canvas";
      canvas.setAttribute("aria-hidden", "true");
      host.append(canvas);
    }
    return canvas;
  }

  function positionOf(el) {
    return {
      x: Number.parseFloat(el.style.left) || 0,
      y: Number.parseFloat(el.style.top) || 0
    };
  }

  function chooseDirection(prev, next, fallback = "down") {
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    if (Math.abs(dx) < 0.02 && Math.abs(dy) < 0.02) return fallback;
    if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
    return dy < 0 ? "up" : "down";
  }

  function paintPlayer(el, now) {
    const canvas = ensurePlayerCanvas(el);
    if (!canvas) return;

    const id = el.dataset.playerId || playerName(el);
    const pos = positionOf(el);
    const previous = stateByPlayer.get(id) || {
      x: pos.x,
      y: pos.y,
      dir: "down",
      frame: 0,
      lastMove: -Infinity,
      moving: false,
      walkStartedAt: 0
    };

    const moved =
      Math.abs(pos.x - previous.x) > 0.02 ||
      Math.abs(pos.y - previous.y) > 0.02;

    const dir = chooseDirection(previous, pos, previous.dir);
    const lastMove = moved ? now : previous.lastMove;
    const movingSignal = moved || el.classList.contains("is-moving");
    const moving = movingSignal || now - lastMove <= WALK_HOLD_MS;

    let walkStartedAt = previous.walkStartedAt;
    if (moving && !previous.moving) walkStartedAt = now;
    if (!moving) walkStartedAt = 0;

    const frame = moving
      ? Math.floor((now - walkStartedAt) / WALK_FRAME_MS) % GRID
      : 0;

    const base = resolveBase(el);
    const paintKey = `${base}:${dir}:${frame}`;

    if (canvas.dataset.paintKey !== paintKey) {
      canvas.dataset.paintKey = paintKey;
      drawFrame(canvas, base, dir, frame).catch((error) => {
        canvas.dataset.paintKey = "";
        console.error(error);
      });
    }

    stateByPlayer.set(id, {
      x: pos.x,
      y: pos.y,
      dir,
      frame,
      lastMove,
      moving,
      walkStartedAt
    });
  }

  function renderPlayers(now = performance.now()) {
    const activeIds = new Set();
    document.querySelectorAll("#playersLayer .player").forEach(el => {
      const id = el.dataset.playerId || playerName(el);
      activeIds.add(id);
      paintPlayer(el, now);
    });

    for (const id of stateByPlayer.keys()) {
      if (!activeIds.has(id)) stateByPlayer.delete(id);
    }
  }

  function hideLegacyEditorFields() {
    const hiddenIds = new Set(["colorChoices", "bodyChoices", "faceChoices", "accessoryChoices"]);
    hiddenIds.forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.hidden) el.hidden = true;
    });
    document.querySelectorAll("#avatarModal .modal-card > label").forEach(label => {
      const text = (label.textContent || "").trim().toLowerCase();
      if (["color", "cuerpo", "cara", "accesorio"].includes(text) && !label.hidden) label.hidden = true;
    });
    const legacySave = document.getElementById("saveProfile");
    if (legacySave && !legacySave.hidden) legacySave.hidden = true;
    const modular = document.getElementById("avatarFinalControls");
    if (modular && !modular.hidden) modular.hidden = true;
  }

  function ensureEditorPreview() {
    const preview = document.getElementById("avatarFinalPreview");
    if (!preview) return;
    let canvas = preview.querySelector(".avatar-base-preview-canvas");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = LOGICAL_W;
      canvas.height = LOGICAL_H;
      canvas.className = "avatar-base-preview-canvas";
      preview.append(canvas);
    }
    drawFrame(canvas, selectedEditorBase(), "down", 0).catch(console.error);
  }

  function patchBaseButtons() {
    document.querySelectorAll("#avatarFinalBase button").forEach(button => {
      const base = /MUJER/i.test(button.textContent || "") ? "female" : "male";
      let canvas = button.querySelector(".avatar-base-choice-canvas");
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.width = LOGICAL_W;
        canvas.height = LOGICAL_H;
        canvas.className = "avatar-base-choice-canvas";
        button.prepend(canvas);
      }
      drawFrame(canvas, base, "down", 0).catch(console.error);
    });
  }

  function patchEditor() {
    hideLegacyEditorFields();
    ensureEditorPreview();
    patchBaseButtons();
  }

  function captureAvatarPacket(event) {
    try {
      const packet = JSON.parse(event.data);
      if (packet?.type === "avatar:final" && packet.profile) {
        const name = cleanName(packet.profile.name);
        remoteProfiles.set(name, { base: packet.profile.base === "female" ? "female" : "male" });
        renderPlayers();
      } else if (packet?.type === "lobby:snapshot" && packet.avatarFinal) {
        for (const [name, value] of Object.entries(packet.avatarFinal)) {
          remoteProfiles.set(cleanName(name), { base: value?.base === "female" ? "female" : "male" });
        }
        renderPlayers();
      }
    } catch {}
  }

  function hookDataChannels() {
    const proto = globalThis.RTCDataChannel?.prototype;
    if (!proto || proto.__ml3dBaseHook) return;
    const nativeAdd = proto.addEventListener;
    proto.addEventListener = function(type, listener, options) {
      if (type === "message" && !this.__ml3dBaseMessageHook) {
        this.__ml3dBaseMessageHook = true;
        nativeAdd.call(this, "message", captureAvatarPacket);
      }
      return nativeAdd.call(this, type, listener, options);
    };
    proto.__ml3dBaseHook = true;
  }

  async function boot() {
    hookDataChannels();
    await Promise.allSettled([compileSheet("male"), compileSheet("female")]);

    const players = document.getElementById("playersLayer");
    if (players) {
      new MutationObserver((mutations) => {
        if (mutations.some((mutation) => mutation.type === "childList")) renderPlayers();
      }).observe(players, {
        childList: true,
        subtree: false
      });
    }

    const modal = document.getElementById("avatarModal");
    if (modal) {
      new MutationObserver(() => patchEditor()).observe(modal, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class", "hidden"]
      });
    }

    document.addEventListener("click", event => {
      if (event.target.closest("#avatarButton,#avatarFinalBase button,#saveAvatarFinal")) {
        setTimeout(() => { patchEditor(); renderPlayers(); }, 0);
      }
    });

    patchEditor();
    const tick = now => {
      renderPlayers(now);
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
