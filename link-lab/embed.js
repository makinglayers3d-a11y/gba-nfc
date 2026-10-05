(() => {
  "use strict";

  /* ML3D Link dentro de la pantalla del emulador (?embed=1).

     - Quita los controles propios del lobby: manda el emulador.
     - Reduce el lobby a un menú de cuatro entradas navegable con la cruceta.
     - Traduce los botones del emulador a lo que ya entiende rooms.js
       (flechas para moverse, "l" personaje, "r" chat, click en SELECT).
     - Añade el selector de juego de la sala y el aviso cuando alguien no
       lleva el mismo cartucho, comparado por huella (hash).
     - Enseña el código de la sala, su QR y un lector de QR para entrar.
     - Si un jugador no tiene el juego de la sala con ese nombre, le deja
       decir cuál es el suyo; y si no lo tiene, pedírselo a quien lo cargó
       desde un archivo propio. Un juego de la biblioteca no se envía.
     El resto de la lógica del lobby no se toca. */

  if (new URLSearchParams(location.search).get("embed") !== "1") return;

  const CHILD = "ml3d-lobby";
  const PARENT = "ml3d-emulator";
  const byId = (id) => document.getElementById(id);
  const DIRECTIONS = { UP: "ArrowUp", DOWN: "ArrowDown", LEFT: "ArrowLeft", RIGHT: "ArrowRight" };

  const MENU = [
    { id: "create", label: "CREAR SALA", nodes: ["#createCard"] },
    { id: "code", label: "ENTRAR POR CÓDIGO", nodes: ["#codeJoinBlock"] },
    { id: "qr", label: "ESCANEAR QR", nodes: [] },
    { id: "nearby", label: "BUSCAR CERCA", nodes: ["#searchNearbyBlock", "#roomsList"] },
    { id: "received", label: "JUEGOS RECIBIDOS", nodes: [], hidden: true },
    { id: "settings", label: "AJUSTES", nodes: [".api-card", ".log-card"] },
    { id: "join", label: "UNIRSE A LA SALA", nodes: ["#joinCard"], hidden: true }
  ];

  let cursorIndex = 0;
  let activePanel = null;
  let context = { game: "", romFilename: "", romLoaded: false, romHash: "", system: "gba", library: [], source: "", aliases: {}, envioRoms: false, recibidas: [] };

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

  /* Tiene el juego quien lo lleva cargado, quien lo tiene en su biblioteca o
     quien ha dicho que es otro de los suyos con distinto nombre. */
  const hasGame = (who, wanted) =>
    gameKey(who.game) === wanted ||
    (who.library || []).some((name) => gameKey(name) === wanted) ||
    (who.tiene || []).includes(wanted) ||
    Boolean(who.aliases && who.aliases[wanted]);

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
    <div class="embed-dialog" id="embedDialog" hidden>
      <div class="embed-dialog-card">
        <p class="embed-dialog-text" id="embedDialogText"></p>
        <div class="embed-dialog-qr" id="embedDialogQr" hidden></div>
        <select class="embed-dialog-select" id="embedDialogSelect" aria-label="Tus juegos" hidden></select>
        <div class="embed-dialog-actions" id="embedDialogActions"></div>
      </div>
    </div>
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
      if (item.id === "qr") {
        const estado = document.createElement("p");
        estado.className = "hint";
        estado.id = "embedQrEstado";
        const video = document.createElement("video");
        video.id = "embedQrVideo";
        video.className = "embed-qr-video";
        video.muted = true;
        video.playsInline = true;
        panel.append(estado, video);
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
      if (item.hidden && !(item.id === "received" && context.recibidas.length)) continue;
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
    return [byId("embedDialog"), byId("avatarModal"), byId("selectModal")]
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
    if (activePanel === "qr") iniciaEscaner();
    else paraEscaner();
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
    actualizaMiSala();
  }

  function refreshTitle() {
    const title = byId("embedTitle");
    if (!title) return;
    const roomName = byId("lobbyRoomName")?.textContent?.trim();
    /* El código de la sala va en la barra: es lo que hay que decirle a quien
       quiere entrar, y la barra de la sala donde lo pinta rooms.js está oculta
       en esta vista. Va delante del nombre para que nunca lo corte el borde. */
    const roomCode = byId("lobbyRoomCode")?.textContent?.trim();
    title.textContent = inRoom() && roomName
      ? [roomCode, roomName].filter(Boolean).join(" · ")
      : "ML3D LINK";
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
    /* El juego abierto puede venir con extensión y el de la biblioteca sin
       ella: son el mismo. Se guarda uno por clave, sin extensión. */
    const porClave = new Map();
    const anota = (name) => {
      const limpio = String(name || "").replace(/\.(gba|gbc|gb)$/i, "").trim();
      const clave = gameKey(limpio);
      if (clave && !porClave.has(clave)) porClave.set(clave, limpio);
    };
    for (const name of context.library || []) anota(name);
    anota(context.game);
    for (const peer of games()?.peers() || []) anota(peer.game);
    return [...porClave.values()].sort((a, b) => a.localeCompare(b, "es"));
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
      /* El juego de la sala puede llevar extensión: se elige el que coincide
         por clave. */
      const igual = [...select.options].find((option) => option.value && gameKey(option.value) === gameKey(wanted));
      select.value = igual ? igual.value : "";
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
    if (missing.length) {
      /* A los demás se les abre el aviso para que digan cuál es su juego o
         lo pidan; a uno mismo, también. */
      games()?.check(roomGame());
      revisaMiJuego(true);
      return `SIN ESE JUEGO: ${missing.join(", ")} · SE LE HA AVISADO`;
    }

    /* Mismo título no es mismo cartucho: dos versiones o dos regiones del
       mismo juego divergen en cuanto empieza la partida. Se comparan las
       huellas de quienes ya lo tienen cargado; quien aún no lo ha cargado no
       tiene huella todavía y no bloquea aquí, pero la sesión lo vuelve a
       comprobar al conectar el cable. */
    const huellas = new Map();
    const miHuella = huellaPara({ ...context, hash: context.romHash, sala: miSala }, wanted);
    if (miHuella) huellas.set(miHuella, ["TÚ"]);
    for (const peer of known) {
      const suya = huellaPara(peer, wanted);
      if (!suya) continue;
      if (!huellas.has(suya)) huellas.set(suya, []);
      huellas.get(suya).push(peer.name.toUpperCase());
    }
    if (huellas.size > 1) {
      const grupos = [...huellas.values()].map((quienes) => quienes.join("+"));
      return `CARTUCHOS DISTINTOS: ${grupos.join(" ≠ ")} · TODOS CON LA MISMA COPIA`;
    }
    return "";
  }

  /* ---------- huella del juego de la sala ---------- */

  /* Huella de la copia que un jugador usará para el juego de la sala: la que
     ha anunciado para ese juego o, si lo tiene abierto, la del juego abierto.
     La de otro juego que tenga abierto no cuenta. */
  function huellaPara(who, wanted) {
    if (who.sala && who.sala.key === wanted && who.sala.hash) return who.sala.hash;
    if (who.hash && gameKey(who.game) === wanted) return who.hash;
    return "";
  }

  let miSala = null;
  let salaPedida = "";
  let pedidos = 0;
  const esperas = new Map();

  /* Pide a la página del emulador la huella de un juego de este dispositivo. */
  function pideHuella(nombre) {
    return new Promise((resolve) => {
      const id = ++pedidos;
      const timer = setTimeout(() => { esperas.delete(id); resolve(""); }, 60000);
      esperas.set(id, (hash) => { clearTimeout(timer); resolve(hash); });
      post({ type: "hash-request", id, name: nombre });
    });
  }

  function llegaHuella(data) {
    const listo = esperas.get(data.id);
    if (!listo) return;
    esperas.delete(data.id);
    listo(String(data.hash || ""));
  }

  /* Quien tiene el juego de la sala calcula la huella de su copia y la
     anuncia, la tenga abierta o no. Así se sabe antes de empezar si todos
     llevan el mismo cartucho. */
  async function actualizaMiSala() {
    const wanted = inRoom() ? gameKey(roomGame()) : "";
    const nombre = wanted && hasGame(context, wanted) ? (context.aliases?.[wanted] || roomGame()) : "";
    const pedido = wanted + "::" + nombre;
    if (pedido === salaPedida) return;
    salaPedida = pedido;
    miSala = null;
    if (nombre) {
      const hash = await pideHuella(nombre);
      if (salaPedida !== pedido) return;
      /* Sin huella no se da por comprobado: se reintenta al próximo cambio. */
      if (hash) miSala = { key: wanted, hash };
      else salaPedida = "";
    }
    publicaJuegos();
  }

  /* Huella de la sala según los demás. Espera un poco: quien acaba de elegir
     el juego puede estar todavía calculando la suya. */
  async function huellaDeLaSala(wanted, esperaMs = 8000) {
    const limite = Date.now() + esperaMs;
    for (;;) {
      for (const peer of games()?.peers() || []) {
        const suya = huellaPara(peer, wanted);
        if (suya) return suya;
      }
      if (Date.now() >= limite) return "";
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  /* "ES ESTE": antes de dar por bueno que el juego elegido es el de la sala,
     se compara su huella con la de la sala. Mismo título no es mismo cartucho,
     y título distinto todavía menos. */
  async function confirmaEquivalencia(wanted, nombre, elegido) {
    toast("COMPROBANDO QUE ES EL MISMO CARTUCHO…", 12000);
    const [mia, sala] = await Promise.all([pideHuella(elegido), huellaDeLaSala(wanted)]);
    if (gameKey(roomGame()) !== wanted) return;

    if (mia && sala && mia !== sala) {
      dialogo({
        texto: `CARTUCHOS DISTINTOS: TU «${elegido.toUpperCase()}» NO ES LA MISMA COPIA QUE «${nombre.toUpperCase()}» DE LA SALA. LOS DOS NECESITAN LA MISMA.`,
        botones: [
          { texto: "ELEGIR OTRO", principal: true, accion: () => revisaMiJuego(true) },
          { texto: "CANCELAR" }
        ]
      });
      return;
    }

    context = { ...context, aliases: { ...context.aliases, [wanted]: elegido } };
    post({ type: "set-alias", key: wanted, name: elegido });
    publicaJuegos();
    actualizaMiSala();
    /* Sin las dos huellas no se puede comparar aquí; el arranque lo vuelve a
       mirar con las de todos. */
    toast(mia && sala
      ? `«${nombre.toUpperCase()}» ES TU «${elegido.toUpperCase()}» · MISMO CARTUCHO`
      : `«${nombre.toUpperCase()}» ES TU «${elegido.toUpperCase()}» · SE COMPROBARÁ AL EMPEZAR`, 3600);
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

    for (const menu of [hostMenu, byId("guestMenu")]) {
      if (!menu) continue;
      const qr = document.createElement("button");
      qr.type = "button";
      qr.className = "embed-qr-button top-gap";
      qr.textContent = "CÓDIGO QR DE LA SALA";
      qr.addEventListener("click", () => {
        byId("selectModal").hidden = true;
        muestraQr();
      });
      menu.prepend(qr);
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
    games()?.onChange(() => {
      refreshGameCorner();
      revisaMiJuego(false);
    });
    games()?.onCheck(() => revisaMiJuego(true));
    games()?.onRequest(atiendePeticion);
    games()?.onTransfer(sigueEnvio);
    games()?.onOffer(llegaOferta);
    games()?.onAccept(ofertaAceptada);
  }

  /* ---------- diálogo ---------- */

  let dialogoCancelar = null;

  function cierraDialogo() {
    const box = byId("embedDialog");
    if (!box || box.hidden) return;
    box.hidden = true;
    dialogoCancelar = null;
    resetCursor();
    refreshHelp();
  }

  /* Un aviso con botones, manejable con la cruceta como el resto del lobby.
     `opciones` llena un desplegable; `qr` es un SVG ya generado. */
  function dialogo({ texto, opciones = [], qr = "", botones = [], alCancelar = null }) {
    const box = byId("embedDialog");
    if (!box) return;
    byId("embedDialogText").textContent = texto;

    const select = byId("embedDialogSelect");
    select.textContent = "";
    select.hidden = !opciones.length;
    for (const name of opciones) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.append(option);
    }

    const zonaQr = byId("embedDialogQr");
    zonaQr.hidden = !qr;
    zonaQr.innerHTML = qr;

    const acciones = byId("embedDialogActions");
    acciones.textContent = "";
    for (const boton of botones) {
      const el = document.createElement("button");
      el.type = "button";
      el.textContent = boton.texto;
      if (boton.principal) el.className = "primary";
      el.addEventListener("click", () => {
        const valor = select.hidden ? "" : select.value;
        cierraDialogo();
        boton.accion?.(valor);
      });
      acciones.append(el);
    }

    dialogoCancelar = alCancelar;
    box.hidden = false;
    resetCursor();
    refreshHelp();
  }

  /* ---------- quien no tiene el juego de la sala ---------- */

/* Envío de juegos entre jugadores. Lo enciende o lo apaga la página del
     emulador (context.envioRoms). Apagado no se ofrece pedir un juego, no se
     atiende ninguna petición y no se acepta ninguno que llegue. */
  const envioRoms = () => context.envioRoms === true;

  let avisadoDe = "";

  /* Jugadores que tienen cargado el juego de la sala desde un archivo suyo:
     son los únicos que pueden enviarlo. */
  function quienPuedeEnviar(wanted) {
    if (!envioRoms()) return [];
    return (games()?.peers() || []).filter((peer) => peer.origen === "local" && gameKey(peer.game) === wanted);
  }

  function revisaMiJuego(forzar) {
    if (!inRoom()) { avisadoDe = ""; return; }
    const nombre = roomGame();
    const wanted = gameKey(nombre);
    if (!wanted || hasGame(context, wanted)) { avisadoDe = ""; return; }
    if (!forzar && avisadoDe === wanted) return;
    avisadoDe = wanted;

    const mios = [];
    const vistos = new Set();
    for (const name of [context.game, ...(context.library || [])]) {
      const limpio = String(name || "").replace(/\.(gba|gbc|gb)$/i, "").trim();
      const clave = gameKey(limpio);
      if (!clave || vistos.has(clave)) continue;
      vistos.add(clave);
      mios.push(limpio);
    }
    mios.sort((a, b) => a.localeCompare(b, "es"));

    const origen = quienPuedeEnviar(wanted)[0] || null;
    const botones = [];
    let aviso = "";
    if (mios.length) {
      botones.push({
        texto: "ES ESTE",
        principal: true,
        accion: (elegido) => {
          if (elegido) confirmaEquivalencia(wanted, nombre, elegido);
        }
      });
    }
    if (origen) {
      botones.push({
        texto: "SOLICITAR ROM",
        accion: () => {
          pedidoA = origen.name;
          const enviado = games()?.request(origen.name, nombre);
          toast(enviado ? `PETICIÓN ENVIADA A ${origen.name.toUpperCase()}` : "NO SE PUDO ENVIAR LA PETICIÓN", 3200);
        }
      });
    }
    botones.push({ texto: "CANCELAR" });
    if (origen) aviso = " COMPARTE SOLO JUEGOS SOBRE LOS QUE TENGAS DERECHOS.";

    let texto = `LA SALA JUEGA A «${nombre.toUpperCase()}» Y NO LO ENCUENTRO CON ESE NOMBRE EN TU DISPOSITIVO.`;
    if (mios.length) texto += " SI LO TIENES CON OTRO NOMBRE, ELÍGELO.";
    if (origen) texto += ` SI NO LO TIENES, ${origen.name.toUpperCase()} PUEDE ENVIÁRTELO.`;
    else if (!mios.length) texto += " CÁRGALO EN TU EMULADOR PARA JUGAR.";

    dialogo({ texto: texto + aviso, opciones: mios, botones });
  }

  /* Lo que este jugador cuenta a los demás sobre sus juegos. */
  function publicaJuegos() {
    games()?.setLocal({
      game: context.game,
      hash: context.romHash,
      system: context.system,
      library: context.library,
      tiene: Object.keys(context.aliases || {}).filter((clave) => context.aliases[clave]),
      origen: context.romLoaded ? context.source : "",
      sala: miSala
    });
  }

  /* ---------- envío del juego ---------- */

  let enviandoA = "";   /* a quién ha dicho este jugador que le envía */
  let oferta = null;    /* juego declarado y ofrecido, a la espera de que lo acepten */
  let pedidoA = "";     /* a quién le ha pedido el juego este jugador */

  const megas = (bytes) => (bytes / 1048576).toFixed(1).replace(".", ",") + " MB";

  /* Alguien pide el juego. Solo se ofrece si es el de la sala y se cargó desde
     un archivo propio; la página del emulador lo vuelve a comprobar antes de
     dar los bytes, y no entrega uno recibido de otro jugador. Antes de enviar,
     quien envía declara que tiene derecho a compartirlo. */
  function atiendePeticion({ from, game }) {
    const mio = envioRoms() && context.romLoaded && context.source === "local" && gameKey(context.game) === gameKey(game);
    if (!mio) {
      games()?.deny(from, "ESE JUEGO NO SE PUEDE ENVIAR.");
      return;
    }
    const no = () => games()?.deny(from, "NO HA QUERIDO ENVIARLO.");
    dialogo({
      texto: `${from.toUpperCase()} NO TIENE «${String(game).toUpperCase()}» Y TE LO PIDE. AL ENVIARLO DECLARAS QUE TIENES DERECHO A COMPARTIR ESTE JUEGO Y QUE LO COMPARTES BAJO TU RESPONSABILIDAD.`,
      botones: [
        { texto: "NO ENVIAR", principal: true, accion: no },
        { texto: "DECLARO QUE TENGO DERECHO Y LO ENVÍO", accion: () => { enviandoA = from; post({ type: "rom-request" }); } }
      ],
      alCancelar: no
    });
  }

  /* La página entrega el juego cargado, con su huella. No se envía todavía:
     se ofrece, y solo sale cuando el otro lo acepta. */
  function entregaRom(data) {
    const destino = enviandoA;
    enviandoA = "";
    if (!destino) return;
    if (data.denied || !data.bytes || !data.hash) {
      games()?.deny(destino, "ESE JUEGO NO SE PUEDE ENVIAR.");
      toast(data.reason === "recibida"
        ? "ESE JUEGO LO RECIBISTE DE OTRO JUGADOR: NO SE PUEDE REENVIAR"
        : "ESE JUEGO NO SE PUEDE ENVIAR", 4200);
      return;
    }
    const bytes = new Uint8Array(data.bytes);
    oferta = {
      destino,
      rom: { bytes, name: String(data.filename || "juego.gba"), system: String(data.system || "gba") }
    };
    games()?.offer(destino, { name: oferta.rom.name, size: bytes.length, hash: String(data.hash) });
    toast(`ESPERANDO A QUE ${destino.toUpperCase()} ACEPTE`, 6000);
  }

  function ofertaAceptada({ from }) {
    if (!envioRoms() || !oferta || oferta.destino !== from) return;
    const { rom } = oferta;
    oferta = null;
    games()?.sendRom(from, rom).catch((error) => console.error("ML3D Link: envío del juego:", error));
  }

  /* Al que lo pidió le llega qué le van a enviar. Solo se atiende si viene de
     quien se lo pidió, y no se recibe nada hasta que acepte. */
  function llegaOferta({ from, name, size, hash }) {
    if (!envioRoms() || pedidoA !== from || !hash || size <= 0) {
      games()?.deny(from, "NO HABÍA PEDIDO ESE JUEGO.");
      return;
    }
    pedidoA = "";
    const no = () => games()?.deny(from, "NO HA ACEPTADO EL JUEGO.");
    dialogo({
      texto: `${from.toUpperCase()} QUIERE ENVIARTE «${name.replace(/\.(gba|gbc|gb)$/i, "").toUpperCase()}» (${megas(size)}). SE GUARDARÁ SOLO EN ESTE DISPOSITIVO Y NO PODRÁS REENVIARLO. AL ACEPTAR TE HACES RESPONSABLE DE SU USO.`,
      botones: [
        { texto: "RECHAZAR", principal: true, accion: no },
        { texto: "ACEPTAR Y RECIBIR", accion: () => games()?.accept(from, { size, hash }) }
      ],
      alCancelar: no
    });
  }

  async function sigueEnvio(paso) {
    if (!envioRoms()) return;
    const tanto = Math.round((paso.progress || 0) * 100);
    if (paso.state === "start") toast(`RECIBIENDO «${String(paso.name).toUpperCase()}»…`, 4000);
    else if (paso.state === "progress") toast(`RECIBIENDO ${tanto}%`, 4000);
    else if (paso.state === "sending") toast(`ENVIANDO ${tanto}%`, 4000);
    else if (paso.state === "sent") toast("JUEGO ENVIADO", 3200);
    else if (paso.state === "denied") {
      oferta = null;
      toast(paso.reason || "NO SE HA ENVIADO EL JUEGO", 4200);
    } else if (paso.state === "done") {
      /* Lo que ha llegado tiene que ser lo que se aceptó. */
      const digest = await crypto.subtle.digest("SHA-256", paso.bytes);
      const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      if (!paso.hash || hash !== paso.hash) {
        toast("EL JUEGO RECIBIDO NO COINCIDE CON EL ANUNCIADO · DESCARTADO", 5000);
        return;
      }
      toast("JUEGO RECIBIDO · GUARDÁNDOLO", 4000);
      post({ type: "load-rom", bytes: paso.bytes.buffer, filename: paso.name, hash, de: paso.from }, [paso.bytes.buffer]);
    }
  }

  /* ---------- juegos recibidos ---------- */

  function pintaRecibidos() {
    const panel = panelFor("received");
    if (!panel) return;
    panel.querySelectorAll(".embed-received, .hint").forEach((el) => el.remove());
    const nota = document.createElement("p");
    nota.className = "hint";
    nota.textContent = context.recibidas.length
      ? "Guardados solo en este dispositivo. No se pueden reenviar."
      : "No hay juegos recibidos.";
    panel.append(nota);
    for (const juego of context.recibidas) {
      const fila = document.createElement("div");
      fila.className = "embed-received";
      const nombre = document.createElement("span");
      nombre.textContent = `${juego.nombre.replace(/\.(gba|gbc|gb)$/i, "")} · ${megas(juego.size || 0)}${juego.de ? " · de " + juego.de : ""}`;
      const jugar = document.createElement("button");
      jugar.type = "button";
      jugar.textContent = "JUGAR";
      jugar.addEventListener("click", () => post({ type: "play-received", name: juego.nombre }));
      const borrar = document.createElement("button");
      borrar.type = "button";
      borrar.className = "danger";
      borrar.textContent = "BORRAR";
      borrar.addEventListener("click", () => dialogo({
        texto: `¿BORRAR «${juego.nombre.toUpperCase()}» DE ESTE DISPOSITIVO?`,
        botones: [
          { texto: "NO", principal: true },
          { texto: "BORRAR", accion: () => post({ type: "delete-received", name: juego.nombre }) }
        ]
      }));
      fila.append(nombre, jugar, borrar);
      panel.append(fila);
    }
  }

  /* ---------- QR de la sala ---------- */

  const QR_PREFIJO = "ML3DLINK:";
  let qrCargando = null;

  function codigoDeSala() {
    return String(byId("lobbyRoomCode")?.textContent || "").replace(/^Código\s*/i, "").trim();
  }

  /* El generador de QR pesa 56 KB y casi nunca hace falta: se trae al pedirlo. */
  function cargaQr() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (!qrCargando) {
      qrCargando = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "../vendor/qrcode-generator.js?v=1.4.4";
        script.onload = () => resolve(window.qrcode);
        script.onerror = () => { qrCargando = null; reject(new Error("no se pudo cargar el generador de QR")); };
        document.head.append(script);
      });
    }
    return qrCargando;
  }

  async function muestraQr() {
    const codigo = codigoDeSala();
    if (!codigo) { toast("TODAVÍA NO HAY SALA"); return; }
    let svg = "";
    try {
      const qrcode = await cargaQr();
      const qr = qrcode(0, "M");
      qr.addData(QR_PREFIJO + codigo);
      qr.make();
      svg = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch (error) {
      console.error("ML3D Link: QR:", error);
    }
    dialogo({
      texto: svg
        ? `CÓDIGO ${codigo} · QUE EL OTRO JUGADOR LO ESCANEE DESDE «ESCANEAR QR»`
        : `CÓDIGO ${codigo} · NO SE PUDO DIBUJAR EL QR`,
      qr: svg,
      botones: [{ texto: "CERRAR", principal: true }]
    });
  }

  /* ---------- lector de QR ---------- */

  let qrStream = null;
  let qrTimer = null;

  function paraEscaner() {
    if (qrTimer) { clearInterval(qrTimer); qrTimer = null; }
    if (qrStream) {
      for (const track of qrStream.getTracks()) track.stop();
      qrStream = null;
    }
    const video = byId("embedQrVideo");
    if (video) video.srcObject = null;
  }

  function codigoDelQr(texto) {
    const limpio = String(texto || "").trim();
    if (!limpio.toUpperCase().startsWith(QR_PREFIJO)) return "";
    const codigo = limpio.slice(QR_PREFIJO.length).trim();
    return /^[A-Za-z0-9_-]{4,16}$/.test(codigo) ? codigo : "";
  }

  async function iniciaEscaner() {
    paraEscaner();
    const estado = byId("embedQrEstado");
    const video = byId("embedQrVideo");
    if (!estado || !video) return;
    if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) {
      estado.textContent = "Este navegador no puede leer códigos QR. Entra con «ENTRAR POR CÓDIGO».";
      return;
    }
    estado.textContent = "Abriendo la cámara…";
    try {
      qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    } catch {
      estado.textContent = "No se pudo abrir la cámara. Da permiso de cámara o entra con el código.";
      return;
    }
    if (activePanel !== "qr") { paraEscaner(); return; }
    video.srcObject = qrStream;
    await video.play().catch(() => {});
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    estado.textContent = "Apunta al QR de la sala.";
    qrTimer = setInterval(async () => {
      let vistos = [];
      try { vistos = await detector.detect(video); } catch { return; }
      const codigo = vistos.map((item) => codigoDelQr(item.rawValue)).find(Boolean);
      if (!codigo) return;
      paraEscaner();
      const campo = byId("roomCode");
      if (campo) campo.value = codigo;
      closePanel();
      toast(`CÓDIGO ${codigo} LEÍDO`);
      byId("joinByCode")?.click();
    }, 300);
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
      if (modal.id === "embedDialog") {
        const cancelar = dialogoCancelar;
        cierraDialogo();
        cancelar?.();
        return;
      }
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
      library: Array.isArray(data.library) ? data.library.map(String) : context.library,
      source: String(data.romSource || ""),
      aliases: data.aliases && typeof data.aliases === "object" ? data.aliases : context.aliases,
      envioRoms: data.envioRoms === true,
      recibidas: Array.isArray(data.recibidas) ? data.recibidas : []
    };
    const firma = context.recibidas.map((juego) => juego.nombre).join("|");
    if (firma !== applyContext.firma) {
      applyContext.firma = firma;
      buildMenu();
      pintaRecibidos();
      paintCursor();
    }

    const note = byId("embedNote");
    if (note) {
      /* No hace falta tener un juego abierto para entrar: el de la sala se
         abre solo al iniciar la conexión. */
      note.textContent = context.romLoaded
        ? `Juego cargado: ${(context.game || context.romFilename).replace(/\.(gba|gbc|gb)$/i, "")}`
        : "Sin juego abierto: el de la sala se abrirá al iniciar la conexión.";
      note.classList.remove("embed-note-warn");
    }
    const gameInput = byId("gameName");
    if (gameInput && !gameInput.value && context.game) gameInput.value = context.game;

    publicaJuegos();
    refreshGameCorner();
    revisaMiJuego(false);
    actualizaMiSala();
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== PARENT) return;

    if (data.type === "input") handleInput(String(data.key || ""), Boolean(data.down));
    else if (data.type === "context") applyContext(data);
    else if (data.type === "rom-bytes") entregaRom(data);
    else if (data.type === "hash-result") llegaHuella(data);
    else if (data.type === "rom-saved") {
      toast(data.ok ? "JUEGO GUARDADO EN ESTE DISPOSITIVO" : "NO SE PUDO GUARDAR EL JUEGO", 4200);
    }
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
    const roomCode = byId("lobbyRoomCode");
    if (roomCode) {
      new MutationObserver(refreshTitle).observe(roomCode, {
        childList: true, characterData: true, subtree: true
      });
    }
    const gameName = byId("lobbyGameName");
    if (gameName) {
      new MutationObserver(() => {
        refreshGameCorner();
        revisaMiJuego(false);
        actualizaMiSala();
      }).observe(gameName, {
        childList: true, characterData: true, subtree: true
      });
    }

    window.addEventListener("ml3d-lobby-aviso", (event) => {
      const aviso = event.detail || {};
      if (aviso.tipo !== "ubicacion-imprecisa") return;
      toast(aviso.accion === "buscar"
        ? `TU UBICACIÓN ES IMPRECISA (~${aviso.km} KM): PUEDE QUE NO VEAS SALAS CERCANAS. ENTRA CON EL CÓDIGO O EL QR.`
        : `TU UBICACIÓN ES IMPRECISA (~${aviso.km} KM): NADIE TE ENCONTRARÁ BUSCANDO CERCA. PASA EL CÓDIGO O EL QR.`, 9000);
    });

    setupSelectMenu();
    refreshView();
    resetCursor();
    post({ type: "ready" });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
