(() => {
  "use strict";

  const menuButton = document.getElementById("menu-button");
  const saveButton = document.getElementById("save-game");
  const muteButton = document.getElementById("mute-button");
  const hapticButton = document.getElementById("haptic-button");
  const speedSelect = document.getElementById("speed-select");
  const canvas = document.getElementById("screen");
  const settingsMenu = document.getElementById("menu");
  const closeMenuButton = document.getElementById("close-menu");
  const params = new URLSearchParams(location.search);
  const activeId = params.get("rom") || params.get("game") || "pokemon";
  const statsKey = `ml3d-game-stats:${activeId}`;
  let radialOpen = false;
  let longPressTimer = 0;
  let longPressTriggered = false;
  let previewTimer = 0;

  const CARTRIDGE_TYPES = Object.freeze({
    gba: Object.freeze({
      base: "assets/cartridges/gba-base-dynamic.png",
      fallback: "assets/cartridges/gba-fallback.png"
    })
  });

  const CARTRIDGE_COLORS = Object.freeze({
    black: "#202226",
    gray: "#666a70",
    blue: "#24569a",
    red: "#8e2732",
    purple: "#603b86",
    green: "#326448",
    gold: "#b58a2a"
  });

  /*
   * Catálogo cerrado: ningún valor de la URL se utiliza para construir rutas.
   * Las próximas etiquetas solo necesitan una entrada nueva con su imagen y
   * sus rectángulos de recorte/destino.
   */
  const CARTRIDGE_LABELS = Object.freeze({
    ml3d: Object.freeze({
      src: "assets/cartridges/gba-fallback.png",
      crop: Object.freeze([185, 280, 1168, 490]),
      destination: Object.freeze([185, 235, 1168, 490])
    }),
    gold: Object.freeze({
      src: "assets/cartridges/labels/ml3d-gold.png",
      crop: Object.freeze([0, 0, 1536, 604]),
      destination: Object.freeze([185, 235, 1168, 490])
    }),
    blue: Object.freeze({
      src: "assets/cartridges/labels/ml3d-blue.png",
      crop: Object.freeze([0, 0, 1536, 604]),
      destination: Object.freeze([185, 235, 1168, 490])
    }),
    ml3dholo: Object.freeze({
      src: "assets/cartridges/labels/ml3dholo.png",
      crop: Object.freeze([0, 0, 1536, 631]),
      destination: Object.freeze([185, 235, 1168, 490])
    }),
    zafiro: Object.freeze({
      src: "assets/cartridges/labels/pokemon-zafiro-es.png",
      crop: Object.freeze([0, 0, 1536, 787]),
      destination: Object.freeze([185, 235, 1168, 490])
    }),
    "rojo-fuego": Object.freeze({
      src: "assets/cartridges/labels/pokemon-rojo-fuego-es.png",
      crop: Object.freeze([0, 0, 1536, 775]),
      destination: Object.freeze([185, 235, 1168, 490])
    }),
    esmeralda: Object.freeze({
      src: "assets/cartridges/labels/pokemon-esmeralda-es.png",
      crop: Object.freeze([0, 0, 1536, 775]),
      destination: Object.freeze([185, 235, 1168, 490])
    }),
    rubi: Object.freeze({
      src: "assets/cartridges/labels/pokemon-rubi-es.png",
      crop: Object.freeze([0, 0, 1536, 604]),
      destination: Object.freeze([185, 235, 1168, 490])
    }),
    "verde-hoja": Object.freeze({
      src: "assets/cartridges/labels/pokemon-verde-hoja-es.png",
      crop: Object.freeze([0, 0, 1536, 604]),
      destination: Object.freeze([185, 235, 1168, 490])
    }),
    "minish-cap": Object.freeze({
      src: "assets/cartridges/labels/zelda-minish-cap-eur.png",
      crop: Object.freeze([0, 0, 1536, 604]),
      destination: Object.freeze([185, 235, 1168, 490])
    })
  });

  function own(catalog, key) {
    return Object.prototype.hasOwnProperty.call(catalog, key);
  }

  function cartridgeSelection() {
    const type = (params.get("cartType") || "").toLowerCase();
    const color = (params.get("cartColor") || "").toLowerCase();
    const label = (params.get("cartLabel") || "").toLowerCase();
    const valid = own(CARTRIDGE_TYPES, type) &&
      own(CARTRIDGE_COLORS, color) && own(CARTRIDGE_LABELS, label);

    return valid ? { dynamic: true, type, color, label } : {
      dynamic: false,
      type: "gba"
    };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  async function renderCartridge(canvas, selection) {
    const context = canvas.getContext("2d");
    const type = CARTRIDGE_TYPES[selection.type];
    canvas.width = 1536;
    canvas.height = 930;

    if (!selection.dynamic) {
      const fallback = await loadImage(type.fallback);
      context.drawImage(fallback, 0, 70, 1536, 860, 0, 0, 1536, 930);
      return;
    }

    const label = CARTRIDGE_LABELS[selection.label];
    const [base, labelImage] = await Promise.all([
      loadImage(type.base),
      loadImage(label.src)
    ]);

    /* Recorta solo el margen negro exterior; el PNG fuente queda intacto. */
    context.drawImage(base, 0, 120, 1536, 930, 0, 0, 1536, 930);

    /* "color" conserva la luminosidad original: relieve, textura y sombras. */
    context.save();
    context.globalCompositeOperation = "color";
    context.fillStyle = CARTRIDGE_COLORS[selection.color];
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();

    context.drawImage(labelImage, ...label.crop, ...label.destination);
  }

  function vibrate(pattern) {
    if (
      localStorage.getItem("gba-vibration-enabled") === "true" &&
      typeof navigator.vibrate === "function"
    ) {
      navigator.vibrate(pattern);
    }
  }

  function playCartridgeSound(delay = 0) {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const context = new AudioContext();
      context.resume().catch(() => {});
      const now = context.currentTime + delay;
      const gain = context.createGain();
      const osc = context.createOscillator();
      const click = context.createOscillator();
      osc.type = "triangle";
      click.type = "square";
      osc.frequency.setValueAtTime(190, now);
      osc.frequency.exponentialRampToValueAtTime(520, now + .16);
      click.frequency.setValueAtTime(90, now);
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.16, now + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, now + .28);
      osc.connect(gain);
      click.connect(gain);
      gain.connect(context.destination);
      osc.start(now);
      click.start(now);
      click.stop(now + .055);
      osc.stop(now + .3);
      window.setTimeout(() => context.close().catch(() => {}), (delay * 1000) + 500);
    } catch (_) {}
  }

  window.ml3dPlayCartridgeInsert = function (game, onLeaving) {
    return new Promise((resolve) => {
      const scene = document.createElement("div");
      scene.className = "ml3d-cartridge-scene";
      scene.innerHTML = `
        <div class="ml3d-cartridge">
          <canvas class="ml3d-cartridge-render" aria-label="Cartucho Game Boy Advance"></canvas>
        </div>
        <div class="ml3d-cartridge-message">CARTUCHO RECONOCIDO</div>`;
      document.body.appendChild(scene);

      const cartridge = scene.querySelector(".ml3d-cartridge");
      const canvas = scene.querySelector(".ml3d-cartridge-render");

      renderCartridge(canvas, cartridgeSelection())
        .catch(async () => {
          /* Un fallo de carga también termina siempre en el fallback seguro. */
          await renderCartridge(canvas, { dynamic: false, type: "gba" });
        })
        .catch(() => {})
        .finally(() => {
          cartridge.classList.add("has-render");
          playCartridgeSound(.7);
          window.setTimeout(() => {
            scene.classList.add("recognized");
            vibrate([28, 34, 58]);
          }, 1450);
          window.setTimeout(() => {
            if (typeof onLeaving === "function") {
              document.body.classList.add("ml3d-cartridge-handoff");
            }
            scene.classList.add("leaving");
            if (typeof onLeaving === "function") onLeaving();
          }, 3000);
          window.setTimeout(() => {
            scene.remove();
            if (typeof onLeaving === "function") {
              document.body.classList.remove("ml3d-cartridge-handoff");
            }
            resolve();
          }, 3350);
        });
    });
  };

  function saveCurrentGame() {
    try {
      if (window.gbaGB && typeof window.gbaGB.save === "function") {
        window.gbaGB.save();
      }
      if (window.__gba && typeof window.__gba.exportSave === "function") {
        window.__gba.exportSave();
      }
    } catch (error) {
      console.error("No se pudo preparar la ranura:", error);
    }
  }

  function relevantSaveKeys() {
    const keys = [];
    const slug = params.get("game") || "pokemon";
    const rom = params.get("rom");
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      if (
        key.startsWith(`gba-save:${slug}:`) ||
        key.startsWith(`gba-save-type:${slug}:`) ||
        (rom && key === `gba-gb-save:games/${rom}`)
      ) {
        keys.push(key);
      }
    }
    return keys;
  }

  function slotKey(slot) {
    return `ml3d-visual-save:${activeId}:${slot}`;
  }

  function readSlot(slot) {
    try {
      return JSON.parse(localStorage.getItem(slotKey(slot)) || "null");
    } catch (_) {
      return null;
    }
  }

  function captureThumbnail() {
    try {
      return canvas.toDataURL("image/jpeg", .58);
    } catch (_) {
      return "";
    }
  }

  function writeSlot(slot) {
    saveCurrentGame();
    window.setTimeout(() => {
      const saves = {};
      relevantSaveKeys().forEach((key) => {
        saves[key] = localStorage.getItem(key);
      });
      const payload = {
        createdAt: Date.now(),
        thumbnail: captureThumbnail(),
        saves
      };
      try {
        localStorage.setItem(slotKey(slot), JSON.stringify(payload));
        vibrate([18, 28, 36]);
        renderSaveSlots();
      } catch (error) {
        alert("No hay espacio suficiente para guardar esta ranura.");
      }
    }, 180);
  }

  function loadSlot(slot) {
    const payload = readSlot(slot);
    if (!payload) return;
    Object.entries(payload.saves || {}).forEach(([key, value]) => {
      if (value !== null) localStorage.setItem(key, value);
    });
    const url = new URL(location.href);
    url.searchParams.set("skipintro", "1");
    url.searchParams.delete("menu");
    location.href = url.toString();
  }

  function ensureSaveDialog() {
    let dialog = document.getElementById("ml3d-save-dialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "ml3d-save-dialog";
    dialog.innerHTML = `
      <section class="ml3d-save-card">
        <header><h2>Partidas guardadas</h2><button type="button" data-close>×</button></header>
        <div class="ml3d-save-slots"></div>
      </section>`;
    document.body.appendChild(dialog);
    dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    return dialog;
  }

  function renderSaveSlots() {
    const dialog = ensureSaveDialog();
    const host = dialog.querySelector(".ml3d-save-slots");
    host.innerHTML = "";
    for (let slot = 1; slot <= 3; slot += 1) {
      const data = readSlot(slot);
      const item = document.createElement("article");
      item.className = "ml3d-save-slot";
      const date = data ? new Date(data.createdAt).toLocaleString("es-ES", {dateStyle:"short", timeStyle:"short"}) : "Ranura vacía";
      item.innerHTML = `
        <div class="ml3d-save-thumb">${data && data.thumbnail ? `<img src="${data.thumbnail}" alt="Captura de la ranura ${slot}">` : "<span>ML3D</span>"}</div>
        <div class="ml3d-save-copy"><strong>Ranura ${slot}</strong><small>${date}</small></div>
        <div class="ml3d-save-actions"><button type="button" data-save>Guardar</button>${data ? "<button type=\"button\" data-load>Cargar</button>" : ""}</div>`;
      item.querySelector("[data-save]").addEventListener("click", () => writeSlot(slot));
      const load = item.querySelector("[data-load]");
      if (load) load.addEventListener("click", () => loadSlot(slot));
      host.appendChild(item);
    }
  }

  function openSaveManager() {
    renderSaveSlots();
    ensureSaveDialog().showModal();
  }

  function saveWithCapture() {
    const thumbnail = captureThumbnail();
    const title =
      document.getElementById("game-title")?.textContent?.trim() ||
      activeId.replace(/\.(gba|gbc|gb)$/i, "");
    const lowerId = activeId.toLowerCase();
    const system =
      lowerId.endsWith(".gbc")
        ? "GAME BOY COLOR"
        : lowerId.endsWith(".gb")
          ? "GAME BOY"
          : "GAME BOY ADVANCE";
    const date = new Date().toLocaleString("es-ES", {
      dateStyle: "short",
      timeStyle: "short"
    });

    saveCurrentGame();
    vibrate([18, 28, 36]);

    const showCapture = () => {
      const target = menuButton.getBoundingClientRect();
      const targetX = target.left + target.width / 2;
      const targetY = target.top + target.height / 2;
      const capture = document.createElement("div");
      capture.className = "ml3d-save-capture";
      capture.style.setProperty(
        "--capture-x",
        `${targetX - window.innerWidth / 2}px`
      );
      capture.style.setProperty(
        "--capture-y",
        `${targetY - window.innerHeight / 2}px`
      );
      capture.innerHTML = `
        <div class="ml3d-save-capture-screen">
          ${thumbnail ? `<img src="${thumbnail}" alt="">` : "<b>ML3D</b>"}
          <i></i>
        </div>
        <strong>${title}</strong>
        <span>${system}</span>
        <small>Guardado · ${date}</small>`;
      document.body.appendChild(capture);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => capture.classList.add("fly"));
      });
      window.setTimeout(() => capture.remove(), 4050);
    };

    if (settingsMenu && settingsMenu.open && closeMenuButton) {
      closeMenuButton.click();
      window.setTimeout(showCapture, 410);
    } else {
      showCapture();
    }
  }

  window.ml3dSaveWithCapture = saveWithCapture;

  document.addEventListener("click", (event) => {
    if (event.target.closest("#save-game")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      saveWithCapture();
    }
  }, true);

  function closeRadial() {
    const radial = document.getElementById("ml3d-radial-menu");
    if (radial) radial.remove();
    radialOpen = false;
  }

  function radialAction(action) {
    closeRadial();
    if (action === "save") saveWithCapture();
    if (action === "sound" && muteButton) muteButton.click();
    if (action === "haptic" && hapticButton) hapticButton.click();
    if (action === "games" && typeof window.gbaOpenGameSelector === "function") window.gbaOpenGameSelector();
    if (action === "turbo" && speedSelect) {
      const turbo = speedSelect.value !== "1.5";
      if (turbo) localStorage.setItem("ml3d-speed-before-turbo", speedSelect.value);
      speedSelect.value = turbo ? "1.5" : (localStorage.getItem("ml3d-speed-before-turbo") || ".95");
      speedSelect.dispatchEvent(new Event("change", {bubbles:true}));
    }
  }

  function openRadial() {
    closeRadial();
    radialOpen = true;
    vibrate(28);
    const radial = document.createElement("div");
    radial.id = "ml3d-radial-menu";
    radial.setAttribute("role", "menu");
    radial.innerHTML = `
      <button data-action="games"><span>🎮</span>Juegos</button>
      <button data-action="save"><span>▣</span>Guardar</button>
      <button data-action="sound"><span>♪</span>Sonido</button>
      <button data-action="haptic"><span>⌁</span>Vibración</button>
      <button data-action="turbo"><span>»</span>Turbo</button>
      <i>ML3D</i>`;
    document.body.appendChild(radial);
    radial.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => radialAction(button.dataset.action));
    });
  }

  if (menuButton) {
    menuButton.addEventListener("pointerdown", () => {
      longPressTriggered = false;
      clearTimeout(longPressTimer);
      longPressTimer = window.setTimeout(() => {
        longPressTriggered = true;
        openRadial();
      }, 460);
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((type) => {
      menuButton.addEventListener(type, () => clearTimeout(longPressTimer));
    });
    menuButton.addEventListener("click", (event) => {
      if (radialOpen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRadial();
        longPressTriggered = false;
        return;
      }

      if (longPressTriggered) {
        event.preventDefault();
        event.stopImmediatePropagation();
        longPressTriggered = false;
      }
    }, true);
  }

  document.addEventListener("pointerdown", (event) => {
    if (radialOpen && !event.target.closest("#ml3d-radial-menu") && !event.target.closest("#menu-button")) closeRadial();
  });

  function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  }

  function readStats(id) {
    try { return JSON.parse(localStorage.getItem(`ml3d-game-stats:${id}`) || "{}"); }
    catch (_) { return {}; }
  }

  function updateStats() {
    const stats = readStats(activeId);
    stats.seconds = (stats.seconds || 0) + 15;
    stats.lastPlayed = Date.now();
    localStorage.setItem(statsKey, JSON.stringify(stats));
  }
  window.setInterval(updateStats, 15000);

  function updateGameInfo(detail) {
    const overlay = document.getElementById("gba-game-menu");
    if (!overlay || !detail) return;
    let info = overlay.querySelector(".ml3d-game-info");
    if (!info) {
      info = document.createElement("aside");
      info.className = "ml3d-game-info";
      overlay.appendChild(info);
    }
    const id = detail.id || detail.filename || detail.name;
    const stats = readStats(id);
    const baseName = (detail.filename || detail.name || "")
      .replace(/\.(gba|gbc|gb)$/i, "");
    const previewUrl =
      "previews/" + encodeURIComponent(baseName + ".mp4");

    info.innerHTML = `
      <div class="ml3d-live-preview">
        <b>ML3D</b>
        <video muted loop playsinline preload="metadata" src="${previewUrl}"></video>
        <span></span>
      </div>
      <small>${detail.system} · ${formatDuration(stats.seconds || 0)}</small>
      <em>${stats.lastPlayed ? "Última partida: " + new Date(stats.lastPlayed).toLocaleDateString("es-ES") : "Sin partidas registradas"}</em>`;

    const video = info.querySelector("video");

    video.addEventListener("canplay", () => {
      video.classList.add("ready");
      video.play().catch(() => {});
    });

    video.addEventListener("error", () => {
      video.remove();
    });
  }

  /* La vista previa queda desactivada temporalmente. */

  function playInitialCartridge(onLeaving) {
    if (params.get("skipintro") === "1") {
      onLeaving();
      return Promise.resolve();
    }

    const lowerId = activeId.toLowerCase();
    const system =
      lowerId.endsWith(".gbc")
        ? "GAME BOY COLOR"
        : lowerId.endsWith(".gb")
          ? "GAME BOY"
          : "GAME BOY ADVANCE";

    return window.ml3dPlayCartridgeInsert({
      filename: activeId,
      name: activeId.replace(/\.(gba|gbc|gb)$/i, ""),
      system
    }, onLeaving);
  }

  let releaseInitialHandoff;
  window.ml3dInitialCartridgeHandoffPromise = new Promise((resolve) => {
    releaseInitialHandoff = resolve;
  });
  window.ml3dInitialCartridgePromise =
    playInitialCartridge(releaseInitialHandoff);
})();
