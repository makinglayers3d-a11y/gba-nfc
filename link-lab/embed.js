(() => {
  "use strict";

  /* ML3D Link dentro de la pantalla del emulador (?embed=1).

     - Quita los controles propios del lobby: manda el emulador.
     - Reduce el lobby a un menú de cuatro entradas navegable con la cruceta.
     - Traduce los botones del emulador a lo que ya entiende rooms.js
       (flechas para moverse, "l" personaje, "r" chat, click en SELECT).
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

  function post(message) {
    try {
      window.parent?.postMessage({ source: CHILD, ...message }, location.origin);
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
    <footer class="embed-help" id="embedHelp"></footer>`;

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
    /* La tarjeta del servidor y el registro son <details>: en el menú sobra
       el plegado, ya están detrás de una entrada. */
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
    return [byId("avatarModal"), byId("selectModal")].find((modal) => modal && !modal.hidden) || null;
  }

  function chatOpen() {
    return !byId("chatComposer")?.hidden;
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
    else if (inRoom()) help.textContent = "✛ ANDAR · A MENÚ · L PERSONAJE · R CHAT · B JUEGO";
    else help.textContent = "✛ MOVER · A ELEGIR · B ATRÁS";
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

  /* Izquierda/derecha cambian el valor de un desplegable sin abrirlo. */
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
      else if (key === "A" || key === "SELECT" || key === "START") byId("selectButton")?.click();
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
    const note = byId("embedNote");
    const game = String(data.game || "").trim();
    if (note) {
      note.textContent = data.romLoaded
        ? `Juego cargado: ${game || data.romFilename}`
        : "Sin juego cargado: carga una ROM antes de iniciar la conexión.";
      note.classList.toggle("embed-note-warn", !data.romLoaded);
    }
    const gameInput = byId("gameName");
    if (gameInput && !gameInput.value && game) gameInput.value = game;
    const hostGame = byId("hostGameInput");
    if (hostGame && !hostGame.value && game) hostGame.value = game;
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

    /* El estado de conexión y los errores viven en la barra y al pie; sus
       tarjetas originales se quedan vacías y ocultas por CSS. */
    const bar = byId("embedBar");
    const status = document.querySelector(".status-card .status");
    if (status && bar) bar.prepend(status);
    const errorBox = byId("errorBox");
    if (errorBox) root.append(errorBox);

    byId("embedBack").addEventListener("click", () => post({ type: "close" }));

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
    watch(byId("selectModal"));
    watch(byId("chatComposer"));

    const roomName = byId("lobbyRoomName");
    if (roomName) {
      new MutationObserver(refreshTitle).observe(roomName, {
        childList: true, characterData: true, subtree: true
      });
    }

    refreshView();
    resetCursor();
    post({ type: "ready" });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
