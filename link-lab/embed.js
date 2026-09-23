(() => {
  "use strict";

  /* ML3D Link dentro de la pantalla del emulador (?embed=1).

     - Quita los controles propios del lobby: manda el emulador.
     - Reduce el lobby a un menú de cuatro entradas navegable con la cruceta.
     - Traduce los botones del emulador a lo que ya entiende rooms.js
       (flechas para moverse, "l" personaje, "r" chat, click en SELECT).
     - Añade el selector de juego de la sala, el aviso cuando alguien no lo
       tiene cargado y el reparto de una ROM entre jugadores.
     El resto de la lógica del lobby no se toca. */

  if (new URLSearchParams(location.search).get("embed") !== "1") return;

  const CHILD = "ml3d-lobby";
  const PARENT = "ml3d-emulator";
  const byId = (id) => document.getElementById(id);
  const DIRECTIONS = { UP: "ArrowUp", DOWN: "ArrowDown", LEFT: "ArrowLeft", RIGHT: "ArrowRight" };
  /* Rango, en porcentaje del escenario, para que salga el botón A. */
  const REACH_X = 14;
  const REACH_Y = 13;

  const MENU = [
    { id: "create", label: "CREAR SALA", nodes: ["#createCard"] },
    { id: "code", label: "ENTRAR POR CÓDIGO", nodes: ["#codeJoinBlock"] },
    { id: "nearby", label: "BUSCAR CERCA", nodes: ["#searchNearbyBlock", "#roomsList"] },
    { id: "settings", label: "AJUSTES", nodes: [".api-card", ".log-card"] },
    { id: "join", label: "UNIRSE A LA SALA", nodes: ["#joinCard"], hidden: true }
  ];

  let cursorIndex = 0;
  let activePanel = null;
  let context = { game: "", romFilename: "", romLoaded: false, romHash: "", system: "gba", library: [] };
  let promptTarget = null;
  let pendingRom = null;

  const games = () => window.ML3DRoomGames;
  const cleanName = (value) => String(value || "").replace(/\s*★$/, "").trim();
  /* Misma normalización que app.js para comparar títulos con nombres de
     archivo: sin extensión, sin tildes y sin signos. */
  const gameKey = (value) => String(value || "")
    .replace(/\.(gba|gbc|gb)$/i, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();

  const hasGame = (who, wanted) =>
    gameKey(who.game) === wanted || (who.library || []).some((name) => gameKey(name) === wanted);

  function post(message, transfer) {
    try {
      window.parent?.postMessage({ source: CHILD, ...message }, location.origin, transfer);
    } catch {}
  }

  /* ---------- estructura ---------- */

  const root = document.createElement("div");
  root.className = "embed-root";
  root.innerHTML = `
    <header class="embed-bar" id="embedBar">
      <span class="embed-title" id="embedTitle">ML3D LINK</span>
      <button type="button" class="embed-back" id="embedBack" aria-label="Volver al emulador">VOLVER ✕</button>
    </header>
    <div class="embed-view" id="embedView">
      <nav class="embed-menu" id="embedMenu"></nav>
      <div class="embed-panels" id="embedPanels"></div>
    </div>
    <footer class="embed-help" id="embedHelp"></footer>
    <div class="embed-game" id="embedGame" hidden>
      <span class="embed-game-tag">JUEGO</span>
      <select class="embed-game-select" id="embedGameSelect" aria-label="Juego de la sala"></select>
      <span class="embed-game-value" id="embedGameValue"></span>
    </div>
    <p class="embed-toast" id="embedToast" hidden></p>
    <input type="file" id="embedShareInput" accept=".gba,.gbc,.gb" hidden>
    <div class="modal embed-modal" id="embedShareModal" hidden>
      <div class="modal-card">
        <div class="modal-head"><h2 id="embedShareTitle">JUEGO COMPARTIDO</h2></div>
        <p class="embed-share-name" id="embedShareName"></p>
        <p class="hint" id="embedShareHint"></p>
        <div class="embed-share-actions" id="embedShareActions"></div>
      </div>
    </div>`;

  function panelFor(id) {
    return id ? byId(`embedPanel-${id}`) : null;
  }

  function buildPanels() {
    const panels = byId("embedPanels");
    for (const item of MENU) {
      const panel = document.createElement("section");
      panel.className = "embed-panel";
      panel.id = `embedPanel-${item.id}`;
      panel.hidden = true;
      const head = document.createElement("h2");
      head.textContent = item.label;
      panel.append(head);
      for (const selector of item.nodes) {
        const node = document.querySelector(selector);
        if (node) panel.append(node);
      }
      panels.append(panel);
    }
    document.querySelectorAll(".embed-panel details").forEach((details) => {
      details.open = true;
    });
  }

  function buildMenu() {
    const menu = byId("embedMenu");
    menu.textContent = "";
    for (const item of MENU) {
      if (item.hidden) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "embed-menu-item";
      button.dataset.panel = item.id;
      button.textContent = item.label;
      button.addEventListener("click", () => openPanel(item.id));
      menu.append(button);
    }
    const note = document.createElement("p");
    note.className = "embed-note";
    note.id = "embedNote";
    menu.append(note);
  }

  /* ---------- vistas ---------- */

  function inRoom() {
    return !byId("lobbyShell")?.hidden;
  }

  function openModalEl() {
    return [byId("embedShareModal"), byId("avatarModal"), byId("selectModal")]
      .find((modal) => modal && !modal.hidden) || null;
  }

  function chatOpen() {
    return !byId("chatComposer")?.hidden;
  }

  function isHost() {
    return Boolean(document.querySelector(".player.local .player-name-text")?.textContent?.includes("★"));
  }

  function openPanel(id) {
    activePanel = id || null;
    for (const item of MENU) {
      const panel = panelFor(item.id);
      if (panel) panel.hidden = item.id !== activePanel;
    }
    byId("embedMenu").hidden = Boolean(activePanel);
    resetCursor();
    refreshHelp();
  }

  function closePanel() {
    openPanel(null);
  }

  function refreshView() {
    const room = inRoom();
    document.body.classList.toggle("embed-in-room", room);
    if (room) {
      byId("embedMenu").hidden = true;
      for (const item of MENU) {
        const panel = panelFor(item.id);
        if (panel) panel.hidden = true;
      }
      activePanel = null;
    } else if (!activePanel) {
      byId("embedMenu").hidden = false;
    }
    refreshTitle();
    refreshHelp();
    refreshGameCorner();
  }

  function refreshTitle() {
    const title = byId("embedTitle");
    if (!title) return;
    const roomName = byId("lobbyRoomName")?.textContent?.trim();
    title.textContent = inRoom() && roomName ? roomName : "ML3D LINK";
  }

  function refreshHelp() {
    const help = byId("embedHelp");
    if (!help) return;
    if (chatOpen()) help.textContent = "ESCRIBE · B CERRAR";
    else if (openModalEl()) help.textContent = "✛ MOVER · A ELEGIR · B CERRAR";
    else if (inRoom()) help.textContent = "✛ ANDAR · SELECT MENÚ · L PERSONAJE · R CHAT · B JUEGO";
    else help.textContent = "✛ MOVER · A ELEGIR · B ATRÁS";
  }

  function toast(text, ms = 2600) {
    const box = byId("embedToast");
    if (!box) return;
    box.textContent = text;
    box.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { box.hidden = true; }, ms);
  }

  /* ---------- cursor ---------- */

  function isVisible(el) {
    return Boolean(el.offsetParent || el.getClientRects().length);
  }

  function cursorRoot() {
    const modal = openModalEl();
    if (modal) return modal;
    if (activePanel) return panelFor(activePanel);
    return byId("embedMenu");
  }

  function cursorItems() {
    const container = cursorRoot();
    if (!container) return [];
    return [...container.querySelectorAll("button, input, select, textarea, summary, a[href]")]
      .filter((el) => !el.disabled && !el.hidden && isVisible(el));
  }

  function paintCursor() {
    document.querySelectorAll(".embed-cursor").forEach((el) => el.classList.remove("embed-cursor"));
    const items = cursorItems();
    if (!items.length) return;
    if (cursorIndex >= items.length) cursorIndex = items.length - 1;
    const current = items[cursorIndex];
    current.classList.add("embed-cursor");
    current.scrollIntoView({ block: "nearest" });
  }

  function resetCursor() {
    cursorIndex = 0;
    paintCursor();
  }

  function moveCursor(step) {
    const items = cursorItems();
    if (!items.length) return;
    cursorIndex = (cursorIndex + step + items.length) % items.length;
    paintCursor();
  }

  function adjustValue(step) {
    const el = cursorItems()[cursorIndex];
    if (!(el instanceof HTMLSelectElement)) return;
    const next = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + step));
    if (next === el.selectedIndex) return;
    el.selectedIndex = next;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function activateCursor() {
    const el = cursorItems()[cursorIndex];
    if (!el) return;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.focus();
      el.select?.();
      return;
    }
    el.click();
  }

  /* ---------- juego de la sala ---------- */

  function roomGame() {
    const fromToolbar = byId("lobbyGameName")?.textContent?.trim() || "";
    if (fromToolbar && !/^sin juego/i.test(fromToolbar)) return fromToolbar;
    return "";
  }

  function gameOptions() {
    const list = new Set();
    if (context.game) list.add(context.game);
    for (const name of context.library || []) list.add(String(name).replace(/\.(gba|gbc|gb)$/i, ""));
    for (const peer of games()?.peers() || []) {
      if (peer.sharing?.name) list.add(peer.sharing.name);
      if (peer.game) list.add(peer.game);
    }
    const shared = games()?.local?.sharing?.name;
    if (shared) list.add(shared);
    return [...list].filter(Boolean).sort((a, b) => a.localeCompare(b, "es"));
  }

  function refreshGameCorner() {
    const box = byId("embedGame");
    if (!box) return;
    box.hidden = !inRoom();
    if (box.hidden) return;

    const select = byId("embedGameSelect");
    const value = byId("embedGameValue");
    const host = isHost();
    select.hidden = !host;
    value.hidden = host;

    const current = roomGame();
    if (!host) {
      value.textContent = current || "SIN JUEGO";
      return;
    }

    const options = gameOptions();
    const wanted = current || "";
    const signature = options.join("|") + "::" + wanted;
    if (select.dataset.signature !== signature) {
      select.dataset.signature = signature;
      select.textContent = "";
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "SIN JUEGO";
      select.append(empty);
      for (const name of options) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        select.append(option);
      }
      select.value = wanted;
    }
  }

  function applyGameChoice(name) {
    const input = byId("hostGameInput");
    const apply = byId("applyGame");
    if (!input || !apply) return;
    input.value = name;
    apply.click();
    toast(name ? `JUEGO: ${name.toUpperCase()}` : "SALA SIN JUEGO");
  }

  /* Quién no puede jugar todavía: sin juego elegido, o alguien que no lo tiene
     cargado en su emulador. */
  function startProblem() {
    const wanted = gameKey(roomGame());
    if (!wanted) return "ELIGE UN JUEGO EN LA ESQUINA INFERIOR DERECHA";

    const others = [...document.querySelectorAll("#playersLayer .player")].filter((el) => !el.classList.contains("local"));
    const known = games()?.peers() || [];
    if (known.length < others.length) return "ESPERANDO LOS DATOS DE LOS DEMÁS JUGADORES";

    /* Vale con tenerlo: el emulador lo abre solo al acabar la cuenta atrás.
       Lo que no vale es no tenerlo ni cargado ni en la biblioteca. */
    const missing = [];
    if (!hasGame(context, wanted)) missing.push("TÚ");
    for (const peer of known) {
      if (!hasGame(peer, wanted)) missing.push(peer.name.toUpperCase());
    }
    if (missing.length) return `SIN ESE JUEGO: ${missing.join(", ")} · COMPÁRTELO DESDE EL MENÚ`;
    return "";
  }

  /* ---------- menú SELECT ---------- */

  function setupSelectMenu() {
    const card = document.querySelector("#selectModal .select-menu-card");
    if (!card || card.dataset.embedMenu) return;
    card.dataset.embedMenu = "1";

    const hostMenu = byId("hostMenu");
    const start = byId("startSession");
    if (hostMenu && start) {
      const main = document.createElement("div");
      main.className = "embed-select-main";
      main.append(start);
      hostMenu.prepend(main);
    }

    for (const menu of [byId("hostMenu"), byId("guestMenu")]) {
      if (!menu) continue;
      const share = document.createElement("button");
      share.type = "button";
      share.className = "embed-share-button";
      share.textContent = "COMPARTIR JUEGO";
      share.addEventListener("click", () => byId("embedShareInput").click());
      const main = menu.querySelector(".embed-select-main");
      if (main) main.append(share);
      else menu.prepend(share);
    }

    /* La validación va antes que el handler de rooms.js: este listener se
       registra primero porque rooms.js se evalúa después del loader. */
    start?.addEventListener("click", (event) => {
      const problem = startProblem();
      if (!problem) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      toast(problem, 3200);
    }, true);
  }

  /* ---------- compartir juego ---------- */

  function playerElements() {
    return [...document.querySelectorAll("#playersLayer .player")];
  }

  function playerPosition(el) {
    return {
      x: Number.parseFloat(el.style.left) || 0,
      y: Number.parseFloat(el.style.top) || 0
    };
  }

  function sharingFor(el) {
    if (el.classList.contains("local")) return games()?.local?.sharing || null;
    const name = cleanName(el.querySelector(".player-name-text")?.textContent);
    return games()?.peers().find((peer) => peer.name === name)?.sharing || null;
  }

  function syncShareBubbles() {
    if (!inRoom()) return;
    const localEl = document.querySelector("#playersLayer .player.local");
    let target = null;

    for (const el of playerElements()) {
      const sharing = sharingFor(el);
      let bubble = el.querySelector(":scope > .embed-share-bubble");
      if (!sharing) {
        bubble?.remove();
        el.querySelector(":scope > .embed-prompt")?.remove();
        continue;
      }
      if (!bubble) {
        bubble = document.createElement("div");
        bubble.className = "embed-share-bubble";
        bubble.innerHTML = '<strong>COMPARTIENDO JUEGO</strong><span></span>';
        el.append(bubble);
      }
      bubble.querySelector("span").textContent = sharing.name || "";

      const near = localEl && el !== localEl &&
        Math.abs(playerPosition(el).x - playerPosition(localEl).x) < REACH_X &&
        Math.abs(playerPosition(el).y - playerPosition(localEl).y) < REACH_Y;

      let prompt = el.querySelector(":scope > .embed-prompt");
      if (near) {
        if (!prompt) {
          prompt = document.createElement("div");
          prompt.className = "embed-prompt";
          prompt.innerHTML = '<span class="embed-prompt-key">A</span><span class="embed-prompt-text">DESCARGAR</span>';
          el.append(prompt);
        }
        target = {
          name: cleanName(el.querySelector(".player-name-text")?.textContent),
          sharing
        };
      } else {
        prompt?.remove();
      }
    }

    promptTarget = target;
  }

  function shareModal() {
    return byId("embedShareModal");
  }

  function openShareDialog(target) {
    const modal = shareModal();
    if (!modal || !target) return;
    byId("embedShareTitle").textContent = "JUEGO COMPARTIDO";
    byId("embedShareName").textContent = target.sharing.name || "Juego";
    byId("embedShareHint").textContent = `${target.name} comparte este juego · ${Math.round((target.sharing.size || 0) / 1048576)} MB`;
    const actions = byId("embedShareActions");
    actions.textContent = "";

    const download = document.createElement("button");
    download.type = "button";
    download.className = "primary";
    download.textContent = "DESCARGAR JUEGO";
    download.addEventListener("click", () => {
      byId("embedShareHint").textContent = "Pidiendo el juego…";
      actions.textContent = "";
      if (!games()?.request(target.name)) {
        byId("embedShareHint").textContent = "No hay conexión con quien comparte.";
      }
    });
    actions.append(download);

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "CERRAR";
    cancel.addEventListener("click", () => closeShareDialog());
    actions.append(cancel);

    modal.hidden = false;
    resetCursor();
    refreshHelp();
  }

  function closeShareDialog() {
    const modal = shareModal();
    if (modal) modal.hidden = true;
    refreshHelp();
  }

  function offerLoad(name, system, bytes) {
    pendingRom = { name, system, bytes };
    const modal = shareModal();
    if (!modal) return;
    byId("embedShareTitle").textContent = "JUEGO DESCARGADO";
    byId("embedShareName").textContent = name;
    byId("embedShareHint").textContent = "¿Lo cargo ahora en el emulador?";
    const actions = byId("embedShareActions");
    actions.textContent = "";

    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "primary";
    yes.textContent = "CARGAR AHORA";
    yes.addEventListener("click", () => {
      const rom = pendingRom;
      pendingRom = null;
      closeShareDialog();
      if (!rom) return;
      toast("CARGANDO EL JUEGO…");
      post({ type: "load-rom", filename: rom.name, system: rom.system, bytes: rom.bytes });
    });

    const no = document.createElement("button");
    no.type = "button";
    no.textContent = "AHORA NO";
    no.addEventListener("click", () => {
      pendingRom = null;
      closeShareDialog();
    });

    actions.append(yes, no);
    modal.hidden = false;
    resetCursor();
  }

  function saveToDevice(name, bytes) {
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function setupSharing() {
    byId("embedShareInput").addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      if (!/\.(gba|gbc|gb)$/i.test(file.name)) {
        toast("SOLO .GBA, .GB O .GBC", 3000);
        return;
      }
      toast("PREPARANDO EL JUEGO…");
      try {
        const info = await games().share(file);
        byId("selectModal").hidden = true;
        toast(`COMPARTIENDO ${String(info.name).toUpperCase()}`, 3200);
        syncShareBubbles();
      } catch (error) {
        console.error(error);
        toast("NO SE PUDO LEER EL ARCHIVO", 3200);
      }
    });

    games()?.onTransfer((event) => {
      if (event.state === "start") {
        byId("embedShareHint").textContent = "Descargando 0%";
      } else if (event.state === "progress") {
        byId("embedShareHint").textContent = `Descargando ${Math.round(event.progress * 100)}%`;
      } else if (event.state === "done") {
        saveToDevice(event.name, event.bytes);
        offerLoad(event.name, event.system, event.bytes);
      } else if (event.state === "sending") {
        if (event.progress >= 1) toast("JUEGO ENVIADO");
      }
    });

    games()?.onChange(() => {
      syncShareBubbles();
      refreshGameCorner();
    });
  }

  /* ---------- entrada desde el emulador ---------- */

  function sendLobbyKey(key, down) {
    window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", {
      key,
      bubbles: true,
      cancelable: true
    }));
  }

  function tapLobbyKey(key) {
    sendLobbyKey(key, true);
    sendLobbyKey(key, false);
  }

  function goBack() {
    if (chatOpen()) {
      byId("chatComposer").hidden = true;
      byId("lobbyStage")?.focus({ preventScroll: true });
      refreshHelp();
      return;
    }
    const modal = openModalEl();
    if (modal) {
      modal.hidden = true;
      pendingRom = null;
      resetCursor();
      refreshHelp();
      return;
    }
    if (activePanel) {
      closePanel();
      return;
    }
    post({ type: "close" });
  }

  function handleInput(key, down) {
    if (chatOpen()) {
      if (key === "B" && down) goBack();
      return;
    }

    /* En la sala, la cruceta anda: se reenvía tal cual a rooms.js. */
    if (inRoom() && !openModalEl()) {
      if (DIRECTIONS[key]) {
        sendLobbyKey(DIRECTIONS[key], down);
        return;
      }
      if (!down) return;
      if (key === "L") tapLobbyKey("l");
      else if (key === "R") tapLobbyKey("r");
      else if (key === "SELECT") byId("selectButton")?.click();
      else if (key === "A") { if (promptTarget) openShareDialog(promptTarget); }
      else if (key === "B") goBack();
      return;
    }

    if (!down) return;
    if (key === "UP") moveCursor(-1);
    else if (key === "DOWN") moveCursor(1);
    else if (key === "LEFT") adjustValue(-1);
    else if (key === "RIGHT") adjustValue(1);
    else if (key === "A" || key === "START") activateCursor();
    else if (key === "B" || key === "SELECT") goBack();
  }

  function applyContext(data) {
    context = {
      ...context,
      game: String(data.game || "").trim(),
      romFilename: String(data.romFilename || ""),
      romLoaded: Boolean(data.romLoaded),
      romHash: String(data.romHash || ""),
      system: String(data.system || "gba"),
      library: Array.isArray(data.library) ? data.library.map(String) : context.library
    };

    const note = byId("embedNote");
    if (note) {
      note.textContent = context.romLoaded
        ? `Juego cargado: ${context.game || context.romFilename}`
        : "Sin juego cargado: carga una ROM antes de iniciar la conexión.";
      note.classList.toggle("embed-note-warn", !context.romLoaded);
    }
    const gameInput = byId("gameName");
    if (gameInput && !gameInput.value && context.game) gameInput.value = context.game;

    games()?.setLocal({
      game: context.game,
      hash: context.romHash,
      system: context.system,
      library: context.library
    });
    refreshGameCorner();
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== PARENT) return;

    if (data.type === "input") handleInput(String(data.key || ""), Boolean(data.down));
    else if (data.type === "context") applyContext(data);
    else if (data.type === "visible" && data.visible) {
      refreshView();
      paintCursor();
    }
  });

  /* ---------- arranque ---------- */

  function boot() {
    document.body.classList.add("ml3d-embed");
    document.body.prepend(root);
    buildPanels();
    buildMenu();

    const bar = byId("embedBar");
    const status = document.querySelector(".status-card .status");
    if (status && bar) bar.prepend(status);
    const errorBox = byId("errorBox");
    if (errorBox) root.append(errorBox);

    byId("embedBack").addEventListener("click", () => post({ type: "close" }));
    byId("embedGameSelect").addEventListener("change", (event) => applyGameChoice(event.target.value));
    setupSharing();

    const watch = (el, onChange) => {
      if (!el) return;
      new MutationObserver(() => {
        onChange?.(el);
        refreshView();
        paintCursor();
      }).observe(el, { attributes: true, attributeFilter: ["hidden"] });
    };
    watch(byId("lobbyShell"));
    watch(byId("joinCard"), (el) => { if (!el.hidden) openPanel("join"); });
    watch(byId("avatarModal"));
    watch(byId("selectModal"), () => setupSelectMenu());
    watch(byId("chatComposer"));

    const roomName = byId("lobbyRoomName");
    if (roomName) {
      new MutationObserver(refreshTitle).observe(roomName, {
        childList: true, characterData: true, subtree: true
      });
    }
    const gameName = byId("lobbyGameName");
    if (gameName) {
      new MutationObserver(refreshGameCorner).observe(gameName, {
        childList: true, characterData: true, subtree: true
      });
    }

    setupSelectMenu();
    setInterval(syncShareBubbles, 180);
    refreshView();
    resetCursor();
    post({ type: "ready" });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
