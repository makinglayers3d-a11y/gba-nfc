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
  let context = { game: "", romFilename: "", romLoaded: false, romHash: "", system: "gba", library: [], source: "", aliases: {}, envioRoms: false, recibidas: [], acceso: false, libraryGba: [], salaLocal: false };

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
      <button type="button" class="embed-back embed-gesto" id="embedGesto" aria-label="Gestos" title="Gestos (G)" hidden>☺</button>
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
    <button type="button" class="embed-accion" id="embedAccion" hidden></button>
    <p class="embed-toast" id="embedToast" hidden></p>
    <div class="embed-dialog" id="embedDialog" hidden>
      <div class="embed-dialog-card">
        <p class="embed-dialog-text" id="embedDialogText"></p>
        <div class="embed-dialog-qr" id="embedDialogQr" hidden></div>
        <select class="embed-dialog-select" id="embedDialogSelect" aria-label="Opciones" hidden></select>
        <pre class="embed-dialog-detalle" id="embedDialogDetalle" hidden></pre>
        <label class="check-line embed-dialog-casilla" id="embedDialogCasilla" hidden><input type="checkbox" id="embedDialogCheck"> <span id="embedDialogCheckTexto"></span></label>
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
    /* Tu personaje, en pequeño, y EDITAR: no hace falta crear una sala para
       cambiarlo. Lo dibuja personajes.js (lienzo "personaje-retrato"). Va al
       final para el cursor y arriba a la vista (order en el CSS): subir desde
       la primera opción lleva a EDITAR. */
    const ficha = document.createElement("div");
    ficha.className = "embed-personaje";
    const retrato = document.createElement("canvas");
    retrato.className = "personaje-retrato";
    retrato.width = 64;
    retrato.height = 96;
    retrato.setAttribute("aria-hidden", "true");
    const nombre = document.createElement("span");
    nombre.className = "embed-personaje-nombre";
    nombre.id = "embedPersonajeNombre";
    nombre.textContent = byId("playerName")?.value || "Jugador";
    const editar = document.createElement("button");
    editar.type = "button";
    editar.className = "embed-personaje-editar";
    editar.id = "embedPersonajeEditar";
    editar.textContent = "EDITAR";
    editar.setAttribute("aria-label", "Editar tu personaje");
    editar.addEventListener("click", () => byId("avatarButton")?.click());
    ficha.append(retrato, nombre, editar);
    menu.append(ficha);
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
    else if (inRoom()) help.textContent = document.body.classList.contains("chat-desactivado")
      ? "✛ ANDAR · A ACCIÓN O SALTO · SELECT MENÚ · L PERSONAJE · B JUEGO"
      : "✛ ANDAR · A ACCIÓN O SALTO · SELECT MENÚ · L PERSONAJE · R CHAT · B JUEGO";
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

  /* La pantalla de personalizar el personaje lleva su propio cursor, por
     filas (personajes.js): tiras horizontales, pestañas y colores. */
  function editorDePersonaje() {
    const kit = window.ML3DPersonajes;
    return openModalEl()?.id === "avatarModal" && kit?.tecla ? kit : null;
  }

  function paintCursor() {
    if (editorDePersonaje()) { editorDePersonaje().cursor(); return; }
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

  /* ---------- juegos distintos ---------- */

  /* El anfitrión puede poner la sala en "juegos distintos": cada jugador
     lleva el suyo (Rubí contra Esmeralda). Solo con dos jugadores. */
  let mixtoHost = false;
  let miJuego = "";
  let planDicho = "";
  let eraMixto = false;

  function esMixto() {
    if (isHost()) return mixtoHost;
    return (games()?.peers() || []).some((peer) => peer.mixto);
  }

  /* Juegos de GBA que este jugador puede llevar. */
  function misJuegos() {
    const porClave = new Map();
    const anota = (name) => {
      const limpio = String(name || "").replace(/\.(gba|gbc|gb)$/i, "").trim();
      const clave = gameKey(limpio);
      if (clave && !porClave.has(clave)) porClave.set(clave, limpio);
    };
    if (context.romLoaded && /\.gba$/i.test(context.romFilename || "")) anota(context.game || context.romFilename);
    for (const name of context.libraryGba || []) anota(name);
    for (const juego of context.recibidas || []) if (/\.gba$/i.test(juego.nombre)) anota(juego.nombre);
    return [...porClave.values()].sort((a, b) => a.localeCompare(b, "es"));
  }

  /* De dónde sale un juego de este jugador: decide si se puede compartir. */
  function origenDe(nombre) {
    const clave = gameKey(nombre);
    if (!clave) return "";
    if (context.romLoaded && gameKey(context.game || context.romFilename) === clave) return context.source || "remote";
    if ((context.libraryGba || []).some((name) => gameKey(name) === clave)) return "remote";
    if ((context.recibidas || []).some((juego) => gameKey(juego.nombre) === clave)) return "recibida";
    return "";
  }

  /* La página del emulador tiene que saber qué juego lleva este jugador. */
  function dicePlan() {
    const mixto = inRoom() && esMixto();
    const dicho = (mixto ? "1" : "0") + ":" + (mixto ? miJuego : "");
    if (dicho === planDicho) return;
    planDicho = dicho;
    post({ type: "link-plan", mixed: mixto, mine: mixto ? miJuego : "" });
  }

  function eligeMiJuego(nombre) {
    miJuego = nombre;
    publicaJuegos();
    dicePlan();
    toast(nombre ? `TU JUEGO: ${nombre.toUpperCase()}` : "SIN JUEGO ELEGIDO");
  }

  /* Qué impide empezar en juegos distintos, o "" si nada. */
  function problemaMixto() {
    const others = [...document.querySelectorAll("#playersLayer .player")].filter((el) => !el.classList.contains("local"));
    if (others.length !== 1) return "JUEGOS DISTINTOS ES SOLO PARA DOS JUGADORES";
    const otro = (games()?.peers() || [])[0];
    if (!otro) return "ESPERANDO LOS DATOS DEL OTRO JUGADOR";
    if (!miJuego) return "ELIGE TU JUEGO EN LA ESQUINA INFERIOR DERECHA";
    const quien = otro.name.toUpperCase();
    if (!otro.mio || !otro.mio.name) return `FALTA QUE ${quien} ELIJA SU JUEGO`;

    const suyo = otro.mio.name.toUpperCase();
    const mio = miJuego.toUpperCase();
    const mismo = gameKey(otro.mio.name) === gameKey(miJuego);

    /* ¿Puedo yo emular su consola? */
    if (!mismo) {
      if (otro.mio.origen === "remote") {
        if (!(context.libraryGba || []).some((name) => gameKey(name) === gameKey(otro.mio.name))) {
          pideAcceso(otro.mio.name);
          return `NO TIENES ACCESO A «${suyo}» · ES DE LA BIBLIOTECA Y NO SE COMPARTE`;
        }
      } else if (otro.mio.origen === "local") {
        if (!context.envioRoms || !otro.envio) return `EL ENVÍO DE JUEGOS ESTÁ DESACTIVADO: ${quien} NO PUEDE COMPARTIR «${suyo}»`;
      } else {
        return `«${suyo}» ES UN JUEGO RECIBIDO DE OTRO JUGADOR: NO SE PUEDE COMPARTIR`;
      }
      /* ¿Puede él emular la mía? */
      const origen = origenDe(miJuego);
      if (origen === "remote") {
        if (!(otro.library || []).some((name) => gameKey(name) === gameKey(miJuego))) {
          return `${quien} NO TIENE ACCESO A «${mio}» · TIENE QUE PEDIRLO ÉL`;
        }
      } else if (origen === "local") {
        if (!context.envioRoms || !otro.envio) return `EL ENVÍO DE JUEGOS ESTÁ DESACTIVADO: NO PUEDES COMPARTIR «${mio}»`;
      } else {
        return `«${mio}» LO RECIBISTE DE OTRO JUGADOR: NO SE PUEDE COMPARTIR`;
      }
    }
    return "";
  }

  /* Juego de la biblioteca que falta: un tester puede pedirlo. */
  function pideAcceso(nombre) {
    if (!context.acceso) return;
    dialogo({
      texto: `«${nombre.toUpperCase()}» ES DE LA BIBLIOTECA Y TU ACCESO NO LO INCLUYE. CADA JUGADOR NECESITA EL SUYO: NO SE COMPARTE.`,
      botones: [
        { texto: "SOLICITAR ACCESO A ESTE JUEGO", principal: true, accion: () => { toast("ENVIANDO LA PETICIÓN…", 6000); post({ type: "game-access-request", game: nombre }); } },
        { texto: "CANCELAR" }
      ]
    });
  }

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
    const etiqueta = box.querySelector(".embed-game-tag");

    if (esMixto()) {
      /* Cada jugador elige su juego, anfitrión o no. */
      if (!eraMixto) {
        eraMixto = true;
        /* El aviso de "no tienes el juego de la sala" ya no viene a cuento. */
        cierraDialogo();
      }
      if (etiqueta) etiqueta.textContent = "MI JUEGO";
      select.hidden = false;
      value.hidden = true;
      const mios = misJuegos();
      if (miJuego && !mios.some((name) => gameKey(name) === gameKey(miJuego))) miJuego = "";
      const firma = "mixto::" + mios.join("|") + "::" + miJuego;
      if (select.dataset.signature !== firma) {
        select.dataset.signature = firma;
        select.textContent = "";
        const vacio = document.createElement("option");
        vacio.value = "";
        vacio.textContent = "ELIGE TU JUEGO";
        select.append(vacio);
        for (const name of mios) {
          const option = document.createElement("option");
          option.value = name;
          option.textContent = name;
          select.append(option);
        }
        const igual = [...select.options].find((option) => option.value && gameKey(option.value) === gameKey(miJuego));
        select.value = igual ? igual.value : "";
      }
      dicePlan();
      return;
    }
    eraMixto = false;
    if (etiqueta) etiqueta.textContent = "JUEGO";
    dicePlan();
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
    if (esMixto()) {
      const problema = problemaMixto();
      /* Si lo que falta es cosa del otro (su acceso a mi juego), que se
         entere él también: es quien puede pedirlo. */
      if (problema) games()?.check(miJuego);
      return problema;
    }
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
    if (hostMenu && !byId("embedMixto")) {
      const linea = document.createElement("label");
      linea.className = "check-line top-gap";
      const casilla = document.createElement("input");
      casilla.type = "checkbox";
      casilla.id = "embedMixto";
      casilla.checked = mixtoHost;
      casilla.addEventListener("change", () => {
        mixtoHost = casilla.checked;
        publicaJuegos();
        refreshGameCorner();
        toast(mixtoHost ? "JUEGOS DISTINTOS: CADA JUGADOR ELIGE EL SUYO" : "TODOS CON EL JUEGO DE LA SALA", 3600);
      });
      linea.append(casilla, document.createTextNode(" Juegos distintos: cada jugador lleva el suyo (2 jugadores)"));
      hostMenu.prepend(linea);
    }
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
      pintaListos();
    });
    setInterval(pintaListos, 1500);
    setInterval(pintaAccion, 300);
    combates()?.onCambio(pintaAccion);
    byId("embedAccion")?.addEventListener("click", accion);
    byId("embedGesto")?.addEventListener("click", abreGestos);
    /* Menú de la sala (SELECT): las mismas acciones, sin andar. */
    const desdeMenu = (id, que) => byId(id)?.addEventListener("click", () => { byId("selectModal").hidden = true; que(); });
    desdeMenu("salaAccion", accion);
    desdeMenu("salaDesafiar", abreDesafiar);
    desdeMenu("salaAceptar", aceptaDesdeMenu);
    desdeMenu("salaTabla", abreTabla);
    desdeMenu("salaGestos", abreGestos);
    byId("gestoButton")?.addEventListener("click", abreGestos);
    games()?.onCheck(() => {
      /* En juegos distintos: si a este jugador le falta acceso al juego del
         otro, aquí le sale la opción de pedirlo. */
      if (esMixto()) { problemaMixto(); return; }
      revisaMiJuego(true);
    });
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
  /* detalle: texto que se enseña tal cual (lo que se va a enviar).
     casilla: una casilla sin marcar; a la acción del botón le llega, después
     de la opción elegida, si quedó marcada. */
  function dialogo({ texto, opciones = [], qr = "", botones = [], alCancelar = null, detalle = "", casilla = "" }) {
    const box = byId("embedDialog");
    if (!box) return;
    box.classList.remove("embed-dialog-grande");
    byId("embedDialogText").textContent = texto;
    byId("embedDialogDetalle").hidden = !detalle;
    byId("embedDialogDetalle").textContent = detalle;
    byId("embedDialogCasilla").hidden = !casilla;
    byId("embedDialogCheckTexto").textContent = casilla;
    byId("embedDialogCheck").checked = false;

    const select = byId("embedDialogSelect");
    select.textContent = "";
    select.hidden = !opciones.length;
    for (const opcion of opciones) {
      /* Una opción es su texto, o [valor, texto]. */
      const [valor, nombre] = Array.isArray(opcion) ? opcion : [opcion, opcion];
      const option = document.createElement("option");
      option.value = valor;
      option.textContent = nombre;
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
        const marcada = !byId("embedDialogCasilla").hidden && byId("embedDialogCheck").checked;
        cierraDialogo();
        boton.accion?.(valor, marcada);
      });
      acciones.append(el);
    }

    dialogoCancelar = alCancelar;
    box.hidden = false;
    resetCursor();
    refreshHelp();
  }

  /* ---------- sala local ---------- */

  /* Dos consolas en este dispositivo, unidas por el cable. No hay sala en el
     servidor ni otro jugador: aquí solo se eligen los dos juegos y la partida
     de cada uno. Lo demás lo hace la página del emulador. */
  const archivosLocales = [null, null];   /* { name, bytes } elegidos a mano */

  function opcionesLocales() {
    const lista = [];
    if (context.romLoaded && /\.gba$/i.test(context.romFilename || "")) {
      lista.push({ kind: "loaded", name: context.game || context.romFilename, texto: "ABIERTO AHORA · " + (context.game || context.romFilename).replace(/\.gba$/i, "") });
    }
    for (const name of context.libraryGba || []) lista.push({ kind: "library", name, texto: name });
    for (const juego of context.recibidas || []) {
      if (/\.gba$/i.test(juego.nombre)) lista.push({ kind: "received", name: juego.nombre, texto: "RECIBIDO · " + juego.nombre.replace(/\.gba$/i, "") });
    }
    return lista;
  }

  function montaLocal() {
    const card = byId("createCard");
    const tipo = byId("roomKind");
    if (!card || !tipo || byId("embedLocal")) return;
    const opcion = tipo.querySelector('option[value="local"]');
    if (opcion) { opcion.hidden = false; opcion.disabled = false; }

    const caja = document.createElement("div");
    caja.id = "embedLocal";
    caja.hidden = true;
    for (const n of [0, 1]) {
      const bloque = document.createElement("div");
      bloque.className = "embed-local-consola";
      const titulo = document.createElement("label");
      titulo.textContent = "CONSOLA " + (n + 1);
      titulo.htmlFor = "embedLocalJuego" + n;
      const juego = document.createElement("select");
      juego.id = "embedLocalJuego" + n;
      const partida = document.createElement("select");
      partida.id = "embedLocalPartida" + n;
      partida.setAttribute("aria-label", "Partida de la consola " + (n + 1));
      for (const [valor, texto] of [["1", "PARTIDA 1 · la de siempre"], ["2", "PARTIDA 2 · aparte"]]) {
        const o = document.createElement("option");
        o.value = valor;
        o.textContent = texto;
        partida.append(o);
      }
      const archivo = document.createElement("button");
      archivo.type = "button";
      archivo.textContent = "ELEGIR ARCHIVO .GBA";
      const entrada = document.createElement("input");
      entrada.type = "file";
      entrada.accept = ".gba";
      entrada.hidden = true;
      archivo.addEventListener("click", () => entrada.click());
      entrada.addEventListener("change", async () => {
        const file = entrada.files && entrada.files[0];
        entrada.value = "";
        if (!file) return;
        if (!/\.gba$/i.test(file.name)) { toast("TIENE QUE SER UN JUEGO DE GBA (.GBA)", 4000); return; }
        archivosLocales[n] = { name: file.name, bytes: await file.arrayBuffer() };
        pintaLocal();
        juego.value = "file";
      });
      bloque.append(titulo, juego, partida, archivo, entrada);
      caja.append(bloque);
    }
    const nota = document.createElement("p");
    nota.className = "hint";
    nota.textContent = "Las dos consolas corren en este dispositivo, unidas por el cable. Sin internet ni ubicación; nadie más la ve. Antes de empezar se guarda una copia de las dos partidas. Para cambiar de consola: tecla Tab o el botón CAMBIAR PANTALLA.";
    const iniciar = document.createElement("button");
    iniciar.type = "button";
    iniciar.id = "embedLocalStart";
    iniciar.className = "primary top-gap";
    iniciar.textContent = "INICIAR SALA LOCAL";
    iniciar.addEventListener("click", iniciaLocal);
    const salir = document.createElement("button");
    salir.type = "button";
    salir.id = "embedLocalStop";
    salir.className = "danger top-gap";
    salir.textContent = "CERRAR LA SALA LOCAL";
    salir.addEventListener("click", () => post({ type: "local-stop" }));
    caja.append(nota, iniciar, salir);
    card.append(caja);

    tipo.addEventListener("change", pintaLocal);
    pintaLocal();
  }

  /* Con LOCAL elegido se enseñan los dos juegos y se esconde lo que es de una
     sala con otros jugadores (nombre, contraseña, aforo, confirmar). */
  function pintaLocal() {
    const caja = byId("embedLocal");
    const card = byId("createCard");
    if (!caja || !card) return;
    const local = byId("roomKind")?.value === "local";
    caja.hidden = !local;
    for (const nodo of card.children) {
      if (nodo === caja || nodo.tagName === "H2" || nodo.id === "roomKind" || nodo.htmlFor === "roomKind") continue;
      nodo.hidden = local;
    }
    if (!local) return;

    const opciones = opcionesLocales();
    for (const n of [0, 1]) {
      const select = byId("embedLocalJuego" + n);
      const propias = archivosLocales[n] ? [{ kind: "file", name: archivosLocales[n].name, texto: "ARCHIVO · " + archivosLocales[n].name.replace(/\.gba$/i, "") }] : [];
      const todas = [...propias, ...opciones];
      const firma = todas.map((o) => o.kind + ":" + o.name).join("|");
      if (select.dataset.firma !== firma) {
        const antes = select.value;
        select.dataset.firma = firma;
        select.textContent = "";
        if (!todas.length) {
          const vacio = document.createElement("option");
          vacio.value = "";
          vacio.textContent = "ELIGE UN ARCHIVO .GBA";
          select.append(vacio);
        }
        todas.forEach((o, indice) => {
          const opt = document.createElement("option");
          opt.value = o.kind === "file" ? "file" : o.kind + ":" + o.name;
          opt.textContent = o.texto;
          select.append(opt);
          /* De entrada, cada consola con un juego distinto. */
          if (!antes && indice === Math.min(n, todas.length - 1)) select.value = opt.value;
        });
        if (antes && [...select.options].some((opt) => opt.value === antes)) select.value = antes;
      }
    }
    byId("embedLocalStart").hidden = context.salaLocal;
    byId("embedLocalStop").hidden = !context.salaLocal;
  }

  function iniciaLocal() {
    const consolas = [];
    const transferir = [];
    for (const n of [0, 1]) {
      const valor = byId("embedLocalJuego" + n).value;
      const slot = Number(byId("embedLocalPartida" + n).value) === 2 ? 2 : 1;
      if (!valor) { toast("ELIGE EL JUEGO DE LA CONSOLA " + (n + 1), 4000); return; }
      if (valor === "file") {
        const elegido = archivosLocales[n];
        if (!elegido) { toast("ELIGE EL ARCHIVO DE LA CONSOLA " + (n + 1), 4000); return; }
        /* Copia: el mismo archivo puede ir a las dos consolas. */
        const copia = elegido.bytes.slice(0);
        consolas.push({ kind: "file", name: elegido.name, slot, bytes: copia });
        transferir.push(copia);
      } else {
        const corte = valor.indexOf(":");
        consolas.push({ kind: valor.slice(0, corte), name: valor.slice(corte + 1), slot });
      }
    }
    /* El mismo juego en las dos consolas con la misma partida se pisaría. */
    const igual = (a, b) => a.kind === b.kind && gameKey(a.name) === gameKey(b.name) && a.slot === b.slot;
    if (igual(consolas[0], consolas[1])) {
      toast("ES EL MISMO JUEGO CON LA MISMA PARTIDA: PON «PARTIDA 2» EN UNA CONSOLA", 6000);
      return;
    }
    toast("PREPARANDO LAS DOS CONSOLAS…", 20000);
    post({ type: "local-start", consolas }, transferir);
  }

  /* ---------- preguntas de la sala ---------- */

  /* rooms.js pregunta por aquí (admitir a un jugador, bloquear). Si llegan
     dos preguntas a la vez, la segunda espera a la primera. */
  let colaPreguntas = Promise.resolve();
  /* ---------- teclado con el foco dentro del lobby ---------- */

  /* Las teclas del emulador (X = A, Z = B, Enter = START, Mayús = SELECT) las
     recoge la página de fuera y las manda aquí. Pero si el foco está dentro
     del lobby (después de escribir en el chat o de pulsar algo con el ratón)
     la página de fuera no las ve: se atienden aquí igual. Las flechas, solo
     en menús y ventanas; andando por la sala las lleva rooms.js. */
  const TECLAS = { KeyX: "A", KeyZ: "B", Enter: "START", ShiftLeft: "SELECT", ShiftRight: "SELECT", KeyG: "G" };
  const FLECHAS = { ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT", ArrowRight: "RIGHT" };
  window.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
    const boton = TECLAS[event.code] || ((!inRoom() || openModalEl()) ? FLECHAS[event.code] : "");
    if (!boton) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    handleInput(boton, true);
  }, true);

  /* ---------- acción por cercanía ---------- */

  /* Un solo sistema para todo lo que se hace "yendo hasta allí": al acercarse
     a algo interactivo aparece el botón de acción, y A (o tocar el botón) lo
     hace. Si no hay nada cerca, A salta. Interactivo es: un jugador que
     desafía, un jugador que puede pasarte su juego y la pantalla de la sala.
     Lo mismo está en el menú de la sala, para quien no quiera andar. */
  const combates = () => window.ML3DCombates;
  const cercaPx = () => combates()?.cerca || 78;   /* en píxeles de la sala de referencia (720x480) */
  const PANTALLA = { x: 50, y: 23.5 };    /* delante del cartel del fondo */
  const distancia = (ax, ay, bx, by) => Math.hypot((ax - bx) * 7.2, (ay - by) * 4.8);

  function cercania() {
    const yo = document.querySelector("#playersLayer .player.local");
    if (!yo || !inRoom()) return null;
    const x = Number(yo.dataset.x), y = Number(yo.dataset.y);
    const estado = combates()?.estado();
    let mejor = null;
    const prueba = (cosa, cx, cy) => { const d = distancia(x, y, cx, cy); if (d <= cercaPx() && (!mejor || d < mejor.d)) mejor = { ...cosa, d }; };
    for (const el of document.querySelectorAll("#playersLayer .player:not(.local)")) {
      const id = el.dataset.playerId, ex = Number(el.dataset.x), ey = Number(el.dataset.y);
      const nombre = cleanName(el.dataset.nombre || "");
      /* un juego suyo que me puede pasar (solo con el envío de juegos encendido) */
      const peer = (games()?.peers() || []).find((p) => cleanName(p.name) === nombre);
      if (envioRoms() && peer && peer.origen === "local" && peer.game && !hasGame(context, gameKey(peer.game))) {
        prueba({ tipo: "juego", peer, texto: `PEDIR «${peer.game.replace(/\.(gba|gbc|gb)$/i, "").toUpperCase()}» A ${nombre.toUpperCase()}` }, ex, ey);
      }
    }
    prueba({ tipo: "pantalla", texto: estado?.combate ? "VER EL COMBATE" : "VER LA TABLA" }, PANTALLA.x, PANTALLA.y);
    const desafio = desafioMasCercano();
    if (desafio && desafio.d <= cercaPx() && (!mejor || desafio.d < mejor.d)) mejor = desafio;
    return mejor;
  }

  /* El desafío que podría aceptar más cercano, esté o no al alcance. */
  function desafioMasCercano() {
    const yo = document.querySelector("#playersLayer .player.local");
    const c = combates();
    const estado = c?.estado();
    if (!yo || !c?.disponible || !estado || estado.duelo || estado.combate) return null;
    let mejor = null;
    for (const el of document.querySelectorAll("#playersLayer .player:not(.local)")) {
      const id = el.dataset.playerId;
      if (!el.dataset.desafio || c.rechazado(el.dataset.desafio) || c.silenciado(id)) continue;
      const desafio = estado.desafios.find((z) => z.id === el.dataset.desafio);
      const d = distancia(Number(yo.dataset.x), Number(yo.dataset.y), Number(el.dataset.x), Number(el.dataset.y));
      if (desafio && (!mejor || d < mejor.d)) mejor = { tipo: "desafio", desafio, playerId: id, texto: `DESAFÍO DE ${desafio.nombre.toUpperCase()}`, d };
    }
    return mejor;
  }

  /* Desde el menú de la sala: el desafío más cercano, si está al alcance. */
  function aceptaDesdeMenu() {
    const c = combates();
    if (!c?.disponible) { toast("LOS DESAFÍOS SON PARA SALAS DE 3 O 4.", 3600); return; }
    const desafio = desafioMasCercano();
    if (!desafio) toast(c.estado().combate ? "YA HAY UN COMBATE EN LA SALA." : "NADIE TE DESAFÍA AHORA MISMO.", 3200);
    else if (desafio.d > cercaPx()) toast(`EL DESAFÍO DE ${desafio.desafio.nombre.toUpperCase()} NO ESTÁ A TU ALCANCE. ACÉRCATE.`, 4200);
    else aceptaDesafio(desafio);
  }

  /* Lo que haría A ahora mismo. Con un combate propio en marcha, terminarlo. */
  function accionActual() {
    const duelo = combates()?.estado().duelo;
    if (duelo && duelo.estado !== "conectando") return { tipo: "terminar", texto: duelo.mio ? "ESPERANDO AL RIVAL" : "TERMINAR EL COMBATE" };
    if (duelo) return { tipo: "espera", texto: "CONECTANDO CON EL RIVAL…" };
    return cercania();
  }
  function pintaAccion() {
    const boton = byId("embedAccion");
    if (!boton) return;
    const gesto = byId("embedGesto");
    if (gesto) gesto.hidden = !inRoom();
    const a = inRoom() && !openModalEl() && !chatOpen() ? accionActual() : null;
    boton.hidden = !a;
    if (a && boton.textContent !== "A · " + a.texto) boton.textContent = "A · " + a.texto;
    const menu = byId("salaAccion");
    if (menu) menu.textContent = a ? "ACCIÓN: " + a.texto : "ACCIÓN: SALTAR (NADA CERCA)";
    preguntaResultado();
  }
  function accion() {
    const a = accionActual();
    if (!a) { window.ML3DLobbyGestos?.envia("salto"); return; }
    if (a.tipo === "desafio") aceptaDesafio(a);
    else if (a.tipo === "juego") { pedidoA = a.peer.name; const ok = games()?.request(a.peer.name, a.peer.game); toast(ok ? `PETICIÓN ENVIADA A ${a.peer.name.toUpperCase()}` : "NO SE PUDO ENVIAR LA PETICIÓN", 3200); }
    else if (a.tipo === "pantalla") abreTabla();
    else if (a.tipo === "terminar") terminaCombate();
  }

  /* ---------- desafíos ---------- */

  function juegoParaDesafiar() {
    return String(context.romLoaded ? (context.game || context.romFilename) : "").replace(/\.(gba|gbc|gb)$/i, "");
  }
  function abreDesafiar() {
    const c = combates();
    if (!c?.disponible) { toast("LOS DESAFÍOS SON PARA SALAS DE 3 O 4. EN UNA SALA DE 2, INICIAR CONEXIÓN.", 4200); return; }
    const estado = c.estado();
    if (!estado.habilitados) { toast("EL ANFITRIÓN HA DESACTIVADO LOS DESAFÍOS.", 3200); return; }
    if (estado.desafios.some((d) => d.de === estado.yo)) {
      dialogo({ texto: "Ya tienes un desafío lanzado.", botones: [{ texto: "RETIRARLO", principal: true, accion: () => c.retira() }, { texto: "DEJARLO" }] });
      return;
    }
    const juego = juegoParaDesafiar();
    if (!juego) { toast("ABRE PRIMERO EL JUEGO AL QUE QUIERES JUGAR.", 3600); return; }
    dialogo({
      texto: `Desafiar con «${juego}». Elige el tipo. Quien se acerque a ti y pulse A, acepta. Caduca en 45 segundos.`,
      opciones: Object.entries(c.tipos),
      botones: [{ texto: "CANCELAR" }, { texto: "LANZAR DESAFÍO", principal: true, accion: (tipo) => c.lanza(tipo, juego, context.source === "remote") }]
    });
  }

  /* Aceptar: los dos necesitan el juego. Desde aquí también se puede decir que
     no, silenciar a quien desafía o denunciarle. */
  function aceptaDesafio({ desafio, playerId }) {
    const c = combates();
    const tipo = c.tipos[desafio.tipo] || desafio.tipo;
    dialogo({
      texto: `${desafio.nombre} desafía: ${tipo}${desafio.juego ? " · «" + desafio.juego + "»" : ""}. Jugaréis conectados entre los dos, con conexión cifrada.`,
      botones: [
        { texto: "ACEPTAR", principal: true, accion: () => {
          const clave = gameKey(desafio.juego);
          if (clave && !hasGame(context, clave)) {
            const deBiblioteca = desafio.biblioteca || esDeBiblioteca(clave);
            if (deBiblioteca && context.acceso) pideAcceso(desafio.juego);
            else toast(deBiblioteca ? "ESTE JUEGO ES SOLO PARA TESTERS." : `NO TIENES «${desafio.juego.toUpperCase()}».`, 4200);
            return;
          }
          c.acepta(desafio.id);
        } },
        { texto: "RECHAZAR", accion: () => c.rechaza(desafio.id) },
        { texto: "🔇 SILENCIAR", accion: () => { c.silencia(playerId); toast(`${desafio.nombre.toUpperCase()} SILENCIADO`, 2600); } },
        { texto: "DENUNCIAR", accion: () => byId("selectButton")?.click() },
        { texto: "CANCELAR" }
      ]
    });
  }

  function terminaCombate() {
    const c = combates();
    const duelo = c?.estado().duelo;
    if (!duelo) return;
    if (duelo.mio) { toast("ESPERANDO A QUE EL RIVAL DIGA SU RESULTADO…", 3200); return; }
    dialogo({
      texto: `Combate contra ${duelo.rival}. ¿Cómo ha acabado? Solo cuenta si los dos decís lo mismo.`,
      botones: [
        { texto: "GANÉ", accion: () => c.termina("gane") },
        { texto: "PERDÍ", accion: () => c.termina("perdi") },
        { texto: "EMPATE", accion: () => c.termina("empate") },
        { texto: "ABANDONAR", accion: () => c.termina("abandono") },
        { texto: duelo.estado === "jugando" ? "SEGUIR JUGANDO" : "CANCELAR" }
      ]
    });
  }
  /* El rival ha terminado: se me pregunta a mí, una vez. */
  let preguntado = "";
  function preguntaResultado() {
    const duelo = combates()?.estado().duelo;
    if (!duelo || duelo.estado !== "terminando" || duelo.mio || preguntado === duelo.id || openModalEl()) return;
    preguntado = duelo.id;
    terminaCombate();
  }

  /* ---------- tabla de resultados y estado del combate ---------- */

  const RESULTADO = { empate: "empate", disputado: "disputado", abandonada: "abandonada", cancelado: "cancelado antes de empezar", sin_conexion: "no se pudo conectar" };
  const resultadoDe = (u) => u.resultado === "gana_a" ? "ganó " + u.nombreA : u.resultado === "gana_b" ? "ganó " + u.nombreB : RESULTADO[u.resultado] || u.resultado;
  function textoTabla() {
    const estado = combates()?.estado();
    if (!estado) return "";
    const lineas = [];
    const c = estado.combate;
    if (c) {
      const seg = c.inicio ? Math.max(0, Math.floor((Date.now() - c.inicio) / 1000)) : 0;
      lineas.push(`EN CURSO: ${c.nombreA} vs ${c.nombreB}`, `${combates().tipos[c.tipo] || c.tipo}${c.juego ? " · " + c.juego : ""}`, c.estado === "conectando" ? "conectando…" : `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, "0")}`, "");
    }
    if (estado.ultimo && !c) lineas.push(`ÚLTIMO: ${estado.ultimo.nombreA} vs ${estado.ultimo.nombreB} · ${resultadoDe(estado.ultimo)}`, "");
    lineas.push("TABLA DE LA SALA");
    if (!estado.tabla.length) lineas.push("Todavía no hay resultados.");
    estado.tabla.forEach((f, i) => lineas.push(`${i + 1}. ${f.nombre.padEnd(12)}  G ${f.ganados} · P ${f.perdidos} · E ${f.empates}`));
    for (const d of estado.desafios) lineas.push("", `DESAFÍA: ${d.nombre} · ${combates().tipos[d.tipo] || d.tipo}${d.juego ? " · " + d.juego : ""}`);
    return lineas.join("\n");
  }
  function abreTabla() {
    dialogo({ texto: "Pantalla de la sala", detalle: textoTabla(), botones: [{ texto: "CERRAR", principal: true }] });
    byId("embedDialog")?.classList.add("embed-dialog-grande");   /* casi toda la pantalla: en un móvil la de la sala es diminuta */
  }

  /* ---------- gestos ---------- */

  const GESTOS = [["salto", "⤴ SALTAR"], ["saludo", "👋 SALUDAR"], ["aplauso", "👏 APLAUDIR"], ["risa", "😄 REÍR"], ["corazon", "❤️ CORAZÓN"]];

  /* Botón A en la sala: elegir un gesto. Con cruceta, A otra vez lo manda. */
  function abreGestos() {
    const gestos = window.ML3DLobbyGestos;
    if (!gestos) return;
    dialogo({
      texto: "Gesto",
      botones: [
        ...GESTOS.filter(([id]) => gestos.lista.includes(id)).map(([id, texto]) => ({
          texto,
          accion: () => { if (!gestos.envia(id)) toast("Espera un momento.", 1200); }
        })),
        { texto: "CANCELAR" }
      ]
    });
  }

  /* ---------- "listo" ---------- */

  /* Un jugador está listo cuando tiene su juego cargado y comprobado:
     - sala normal: tiene el juego de la sala y la huella de su copia es la
       misma que la del anfitrión;
     - juegos distintos: ha elegido su juego.
     Es automático; nadie lo marca a mano. El aviso de compartir la partida
     se pide después, al iniciar la conexión: aquí todavía no existe. */
  function pintaListos() {
    const jugadores = [...document.querySelectorAll("#playersLayer .player")];
    if (!jugadores.length) return;
    const porNombre = new Map((games()?.peers() || []).map((peer) => [cleanName(peer.name), peer]));
    const mixto = esMixto();
    const wanted = gameKey(roomGame());
    const yo = { ...context, hash: context.romLoaded ? context.romHash : "", sala: miSala };
    const datos = (el) => (el.classList.contains("local") ? yo : porNombre.get(cleanName(el.querySelector(".player-name-text")?.textContent)));
    const anfitrion = jugadores.find((el) => el.querySelector(".player-name-text")?.textContent?.includes("★"));
    /* La huella que cuenta es la de la copia que tiene abierta ahora mismo,
       si es el juego de la sala; si no la tiene abierta, la de la copia que
       dijo que usará. */
    const huella = (quien) => (quien.hash && gameKey(quien.game) === wanted ? quien.hash : huellaPara(quien, wanted));
    const huellaAnfitrion = anfitrion && datos(anfitrion) ? huella(datos(anfitrion)) : "";
    for (const el of jugadores) {
      const quien = datos(el);
      let listo = false;
      if (quien && mixto) listo = Boolean(el.classList.contains("local") ? miJuego : quien.mio?.name);
      else if (quien && wanted) {
        const suya = huella(quien);
        listo = hasGame(quien, wanted) && Boolean(suya) && Boolean(huellaAnfitrion) && suya === huellaAnfitrion;
      }
      const valor = listo ? "1" : "0";
      if (el.dataset.listo !== valor) el.dataset.listo = valor;
    }
  }

  /* ---------- denunciar a un jugador ---------- */

  const MOTIVOS_DENUNCIA = [
    ["chat_insultos", "Insultos en el chat"],
    ["chat_acoso", "Acoso en el chat"],
    ["chat_sexual", "Contenido sexual en el chat"],
    ["chat_spam", "Spam en el chat"],
    ["nombre_ofensivo", "Nombre ofensivo"],
    ["molestar", "Molesta o no deja jugar"],
    ["otro", "Otro motivo"]
  ];
  const RESPUESTA_DENUNCIA = {
    ya_denunciado: "Ya habías denunciado a este jugador en esta sala.",
    demasiadas_denuncias: "Has llegado al límite de denuncias de hoy.",
    tope_del_dia: "Hoy no se pueden enviar más denuncias.",
    sin_identificar: "No se pudo enviar la denuncia desde este navegador.",
    no_disponible: "Las denuncias no están disponibles ahora.",
    sin_red: "No se pudo enviar la denuncia. Revisa la conexión."
  };

  /* Dos pasos. Primero el motivo. Después, lo que se va a enviar: si el
     motivo es del chat, el administrador lo tiene activado y hay mensajes de
     ese jugador, se enseñan tal cual con una casilla sin marcar. Sin marcar
     la casilla, la denuncia sale sin mensajes. */
  function denuncia({ nombre, id, mensajes, envia }) {
    dialogo({
      texto: `Denunciar a ${nombre}. Elige el motivo.`,
      opciones: MOTIVOS_DENUNCIA,
      botones: [
        { texto: "CANCELAR" },
        { texto: "CONTINUAR", principal: true, accion: (motivo) => confirmaDenuncia({ nombre, id, mensajes, envia, motivo }) }
      ]
    });
  }

  async function confirmaDenuncia({ nombre, id, mensajes, envia, motivo }) {
    let adjuntar = false;
    if (motivo.startsWith("chat_") && mensajes.length) {
      try { adjuntar = (await window.parent?.ML3DContenido?.ajustes?.())?.denunciaMensajes === true; } catch { adjuntar = false; }
    }
    const etiqueta = MOTIVOS_DENUNCIA.find(([clave]) => clave === motivo)?.[1] || motivo;
    const manda = async (conMensajes) => {
      const r = await envia({ target: id, reason: motivo, messages: conMensajes ? mensajes : undefined });
      if (r.ok && r.status !== "ya_denunciado") toast(r.messagesStored ? `Denuncia enviada, con ${r.messagesStored} mensajes.` : "Denuncia enviada.", 4000);
      else toast(RESPUESTA_DENUNCIA[r.status] || RESPUESTA_DENUNCIA[r.reason] || "No se pudo enviar la denuncia.", 4500);
    };
    dialogo({
      texto: `Se enviará una denuncia contra ${nombre} por: ${etiqueta}. Solo la verá el administrador. Lleva tu nombre y el suyo, la sala y la fecha.`
        + (adjuntar ? ` Puedes adjuntar sus últimos ${mensajes.length} mensajes. Se enviaría exactamente esto:` : ""),
      detalle: adjuntar ? mensajes.map((m) => "· " + m).join("\n") : "",
      casilla: adjuntar ? "Acepto enviar estos mensajes con la denuncia" : "",
      botones: [
        { texto: "CANCELAR" },
        { texto: "ENVIAR DENUNCIA", principal: true, accion: (_, marcada) => manda(adjuntar && marcada) }
      ]
    });
  }

  window.ML3DLobbyUI = {
    denuncia,
    confirma(texto, si = "SÍ", no = "NO") {
      const turno = colaPreguntas.then(() => new Promise((resolve) => {
        /* Si el anfitrión tiene el lobby quitado (está en su juego), se le
           pone delante: una pregunta que no se ve no sirve. */
        post({ type: "attention" });
        dialogo({
          texto,
          botones: [
            { texto: no, principal: true, accion: () => resolve(false) },
            { texto: si, accion: () => resolve(true) }
          ],
          alCancelar: () => resolve(false)
        });
      }));
      colaPreguntas = turno.catch(() => {});
      return turno;
    },
    avisa(texto, ms = 5000) {
      toast(texto, ms);
    }
  };

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

  /* El juego de la sala es de la biblioteca de testers si algún jugador lo
     tiene en la suya o lo lleva abierto desde ella. */
  function esDeBiblioteca(wanted) {
    return (games()?.peers() || []).some((peer) =>
      (peer.library || []).some((name) => gameKey(name) === wanted) ||
      (peer.origen === "remote" && gameKey(peer.game) === wanted));
  }

  function respuestaPeticion(resultado) {
    const textos = {
      pending: "PETICIÓN ENVIADA · TE AVISAREMOS CUANDO SE RESUELVA",
      ya_lo_tiene: "YA TIENES ESE JUEGO · RECARGA EL EMULADOR",
      no_es_de_la_biblioteca: "ESE JUEGO NO ESTÁ EN LA BIBLIOTECA",
      demasiadas_peticiones: "TIENES DEMASIADAS PETICIONES PENDIENTES",
      sin_conexion: "SIN CONEXIÓN · NO SE PUDO ENVIAR LA PETICIÓN"
    };
    toast(textos[resultado?.status] || textos[resultado?.reason] || "NO SE PUDO ENVIAR LA PETICIÓN", 5000);
  }

  function revisaMiJuego(forzar) {
    if (!inRoom()) { avisadoDe = ""; return; }
    if (esMixto()) { avisadoDe = ""; return; }
    /* En una sala de 3 o 4 no hay "juego de la sala": cada combate lleva el
       suyo, y si falta se dice al aceptar el desafío. */
    if (combates()?.disponible) { avisadoDe = ""; return; }
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
    /* Juego de la biblioteca de testers: no se envía. Un tester puede pedir
       que se lo añadan; quien no lo es no puede pedirlo desde aquí. */
    const deBiblioteca = !origen && esDeBiblioteca(wanted);
    if (deBiblioteca && context.acceso) {
      botones.push({
        texto: "SOLICITAR ACCESO A ESTE JUEGO",
        accion: () => {
          toast("ENVIANDO LA PETICIÓN…", 6000);
          post({ type: "game-access-request", game: nombre });
        }
      });
    }
    botones.push({ texto: "CANCELAR" });
    if (origen) aviso = " COMPARTE SOLO JUEGOS SOBRE LOS QUE TENGAS DERECHOS.";
    else if (deBiblioteca && !context.acceso) aviso = " ESTE JUEGO ES SOLO PARA TESTERS.";
    else if (deBiblioteca) aviso = " ES UN JUEGO DE LA BIBLIOTECA Y TU ACCESO NO LO INCLUYE.";

    let texto = `LA SALA JUEGA A «${nombre.toUpperCase()}» Y NO LO ENCUENTRO CON ESE NOMBRE EN TU DISPOSITIVO.`;
    if (mios.length) texto += " SI LO TIENES CON OTRO NOMBRE, ELÍGELO.";
    if (origen) texto += ` SI NO LO TIENES, ${origen.name.toUpperCase()} PUEDE ENVIÁRTELO.`;
    else if (!mios.length && !esDeBiblioteca(wanted)) texto += " CÁRGALO EN TU EMULADOR PARA JUGAR.";

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
      sala: miSala,
      mixto: isHost() && mixtoHost,
      mio: miJuego ? { name: miJuego, origen: origenDe(miJuego) } : null,
      envio: context.envioRoms === true
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
    /* Mientras se entra en una sala, los botones son de la pantalla de conexión. */
    if (window.ML3DConexion?.activa()) {
      if (down) window.ML3DConexion.tecla(key);
      return;
    }
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
      else if (key === "A") accion();
      else if (key === "G") abreGestos();
      else if (key === "SELECT") byId("selectButton")?.click();
      else if (key === "B") goBack();
      return;
    }

    if (!down) return;
    if (editorDePersonaje()?.tecla(key)) return;
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
      acceso: data.acceso === true,
      libraryGba: Array.isArray(data.libraryGba) ? data.libraryGba.map(String) : [],
      salaLocal: data.salaLocal === true,
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
    pintaLocal();
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== PARENT) return;

    if (data.type === "input") handleInput(String(data.key || ""), Boolean(data.down));
    else if (data.type === "context") applyContext(data);
    else if (data.type === "rom-bytes") entregaRom(data);
    else if (data.type === "hash-result") llegaHuella(data);
    else if (data.type === "game-access-result") respuestaPeticion(data.result);
    else if (data.type === "local-status") toast(String(data.texto || ""), data.error ? 6000 : 20000);
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
    byId("embedGameSelect").addEventListener("change", (event) => {
      if (esMixto()) eligeMiJuego(event.target.value);
      else applyGameChoice(event.target.value);
    });
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
    montaLocal();
    refreshView();
    resetCursor();
    post({ type: "ready" });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
