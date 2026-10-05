(() => {
  "use strict";

  /* ML3D Link dentro de la pantalla del emulador (?embed=1).

     - Quita los controles propios del lobby: manda el emulador.
     - Reduce el lobby a un menú de cuatro entradas navegable con la cruceta.
     - Traduce los botones del emulador a lo que ya entiende rooms.js
       (flechas para moverse, "l" personaje, "r" chat, click en SELECT).
     - Añade el selector de juego de la sala y el aviso cuando alguien no
       lleva el mismo cartucho, comparado por huella (hash).
     No reparte juegos: cada jugador carga el suyo.
     El resto de la lógica del lobby no se toca. */

  if (new URLSearchParams(location.search).get("embed") !== "1") return;

  const CHILD = "ml3d-lobby";
  const PARENT = "ml3d-emulator";
  const byId = (id) => document.getElementById(id);
  const DIRECTIONS = { UP: "ArrowUp", DOWN: "ArrowDown", LEFT: "ArrowLeft", RIGHT: "ArrowRight" };

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
`;

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
    return [byId("avatarModal"), byId("selectModal")]
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
      if (peer.game) list.add(peer.game);
    }
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
    if (missing.length) return `SIN ESE JUEGO: ${missing.join(", ")} · QUE LO CARGUE EN SU EMULADOR`;

    /* Mismo título no es mismo cartucho: dos versiones o dos regiones del
       mismo juego divergen en cuanto empieza la partida. Se comparan las
       huellas de quienes ya lo tienen cargado; quien aún no lo ha cargado no
       tiene huella todavía y no bloquea aquí, pero la sesión lo vuelve a
       comprobar al conectar el cable. */
    const huellas = new Map();
    if (context.romHash) huellas.set(context.romHash, ["TÚ"]);
    for (const peer of known) {
      if (!peer.hash) continue;
      if (!huellas.has(peer.hash)) huellas.set(peer.hash, []);
      huellas.get(peer.hash).push(peer.name.toUpperCase());
    }
    if (huellas.size > 1) {
      const grupos = [...huellas.values()].map((quienes) => quienes.join("+"));
      return `CARTUCHOS DISTINTOS: ${grupos.join(" ≠ ")} · TODOS CON LA MISMA COPIA`;
    }
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

  /* Cambia lo que sabemos de los demas: repinta el selector de juego. */
  function setupGames() {
    games()?.onChange(refreshGameCorner);
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
    setupGames();

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
    refreshView();
    resetCursor();
    post({ type: "ready" });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
