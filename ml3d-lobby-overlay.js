(() => {
  "use strict";

  /* ML3D Link en la pantalla del emulador.
     - El lobby se carga una sola vez en un iframe sobre .screen-frame y se
       oculta al volver al juego: así la sala WebRTC sobrevive a la partida.
     - Los botones del emulador (D-pad, A, B, L, R, START, SELECT) se reenvían
       al lobby mientras está abierto; el emulador no los recibe.
     - La configuración del cable Link sigue viajando por BroadcastChannel
       (gba:link:configure), que funciona igual entre iframe y página. */

  const LOBBY_URL = "link-lab/rooms.html?embed=1";
  const CHILD = "ml3d-lobby";
  const PARENT = "ml3d-emulator";

  let host = null;
  let frame = null;
  let isOpen = false;
  const held = new Set();

  function screenFrame() {
    return document.querySelector(".screen-frame");
  }

  function build() {
    if (host) return host;
    const screen = screenFrame();
    if (!screen) return null;

    host = document.createElement("div");
    host.className = "lobby-overlay";
    host.hidden = true;

    frame = document.createElement("iframe");
    frame.className = "lobby-overlay-frame";
    frame.title = "ML3D Link";
    /* Cámara para leer el QR de una sala; ubicación para buscar salas cerca. */
    frame.allow = "autoplay; clipboard-write; camera; geolocation";
    frame.src = LOBBY_URL;

    host.append(frame);
    screen.append(host);
    return host;
  }

  function post(message) {
    if (!frame?.contentWindow) return;
    try {
      frame.contentWindow.postMessage({ source: PARENT, ...message }, location.origin);
    } catch {}
  }

  let library = null;
  let romHash = "";
  let romHashFull = "";
  let hashedFor = "";

  /* Envío de juegos entre jugadores. Apagado salvo que se encienda desde
     fuera: lo encenderá el interruptor de la app de gestión, a través del
     worker. Sin respuesta, apagado. */
  const envioRoms = () => window.ML3D_ENVIO_ROMS === true;
  const recibidas = () => window.ML3DRecibidas;

  /* La biblioteca para el desplegable de juego de la sala. La da el worker a
     quien tiene acceso; sin acceso no hay juegos que ofrecer. No se guarda
     vacia: el acceso puede llegar despues de abrir el lobby. */
  async function loadLibrary() {
    if (library) return library;
    const contenido = window.ML3DContenido;
    if (!contenido?.hayAcceso) return [];
    library = contenido.estado.juegos
      .filter((name) => /[.](gba|gbc|gb)$/i.test(name))
      .map((name) => name.replace(/[.](gba|gbc|gb)$/i, ""));
    return library;
  }

  /* Misma huella que usa LocalLinkSession para comparar ROMs. */
  async function currentRomHash() {
    const runtime = window.ML3DLinkRuntime;
    const filename = runtime?.romFilename || "";
    if (!filename) return "";
    if (hashedFor === filename && romHash) return romHash;
    const bytes = runtime?.romBytes;
    if (!bytes?.byteLength) return "";
    const digest = await crypto.subtle.digest("SHA-256", bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0"));
    romHash = hex.slice(0, 8).join("");
    romHashFull = hex.join("");
    hashedFor = filename;
    return romHash;
  }

  function context() {
    const runtime = window.ML3DLinkRuntime;
    const title = document.getElementById("game-title")?.textContent || "";
    const filename = runtime?.romFilename || "";
    const guardadas = recibidas()?.lista() || [];
    /* Un juego recibido cuenta como "recibida" se abra desde donde se abra:
       manda su huella, no el sitio del que salió el archivo. */
    const esRecibida = hashedFor === filename && recibidas()?.esRecibida(romHashFull);
    return {
      type: "context",
      game: title.trim(),
      romFilename: filename,
      romLoaded: Boolean(filename),
      romHash: hashedFor === filename ? romHash : "",
      system: /\.(gbc|gb)$/i.test(filename) ? filename.toLowerCase().endsWith(".gbc") ? "gbc" : "gb" : "gba",
      library: [...(library || []), ...guardadas.map((item) => item.nombre.replace(/[.](gba|gbc|gb)$/i, ""))],
      envioRoms: envioRoms(),
      /* Tester con biblioteca: puede pedir un juego que su acceso no incluye. */
      acceso: Boolean(window.ML3DContenido?.hayAcceso),
      recibidas: guardadas.map((item) => ({ nombre: item.nombre, size: item.size, de: item.de })),
      /* De dónde viene el juego cargado y qué juegos de sala ha dicho este
         jugador que tiene con otro nombre. */
      romSource: esRecibida ? "recibida" : runtime?.romSource || "",
      aliases: readAliases()
    };
  }

  const ALIAS_PREFIX = "ml3d-link-alias:";

  function readAliases() {
    const out = {};
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key && key.startsWith(ALIAS_PREFIX)) out[key.slice(ALIAS_PREFIX.length)] = localStorage.getItem(key) || "";
      }
    } catch {}
    return out;
  }

  /* El lobby pide el juego cargado para enviárselo a otro jugador. Solo se
     entrega un juego que este jugador cargó desde un archivo suyo: uno de la
     biblioteca no sale de aquí. */
  async function sendLocalRom() {
    const runtime = window.ML3DLinkRuntime;
    const bytes = envioRoms() && runtime?.romSource === "local" ? runtime.romBytes : null;
    const filename = runtime?.romFilename || "";
    if (!bytes?.byteLength || !filename) {
      post({ type: "rom-bytes", denied: true });
      return;
    }
    /* Un juego recibido de otro jugador no se reenvía. Si no se puede
       comprobar, tampoco. */
    const hash = await recibidas()?.huella(bytes).catch(() => "");
    if (!hash || recibidas().esRecibida(hash)) {
      post({ type: "rom-bytes", denied: true, reason: "recibida" });
      return;
    }
    post({
      type: "rom-bytes",
      hash,
      bytes: bytes.buffer,
      filename: filename.split("/").pop(),
      system: /\.gbc$/i.test(filename) ? "gbc" : /\.gb$/i.test(filename) ? "gb" : "gba"
    });
  }

  /* El hash y la biblioteca llegan tarde: se reenvía el contexto al tenerlos. */
  function sendContext() {
    post(context());
    Promise.all([loadLibrary(), currentRomHash()])
      .then(() => post(context()))
      .catch(() => {});
  }

  function releaseHeld() {
    for (const key of held) post({ type: "input", key, down: false });
    held.clear();
  }

  /* El juego se congela mientras el lobby ocupa la pantalla, como un menú
     del propio emulador. Durante una partida Link no: ahí el tiempo emulado
     lo lleva el coordinador y pararlo rompería el lockstep. */
  function linkRunning() {
    /* Con sala configurada el coordinador ya manda, esté o no sincronizado. */
    return Boolean(window.ML3DLocalLinkSession?.status?.roomId);
  }

  function open() {
    if (!build()) return;
    document.getElementById("menu")?.close?.();
    isOpen = true;
    host.hidden = false;
    document.body.classList.add("ml3d-lobby-open");
    if (!linkRunning()) window.ML3DLinkRuntime?.stopTimers?.();
    sendContext();
    /* El interruptor del envío de juegos se vuelve a leer cada vez que se
       abre el lobby: apagarlo en la app tiene que notarse sin recargar. */
    Promise.resolve(window.ML3DContenido?.ajustes?.()).then(() => post(context())).catch(() => {});
    post({ type: "visible", visible: true });
  }

  function close() {
    if (!host) return;
    releaseHeld();
    post({ type: "visible", visible: false });
    isOpen = false;
    host.hidden = true;
    document.body.classList.remove("ml3d-lobby-open");
    if (!linkRunning()) window.ML3DLinkRuntime?.startTimers?.();
  }

  /* El jugador sale del lobby. Sin juego abierto no hay partida a la que
     volver: se vuelve a la biblioteca, que es de donde se entró. */
  function closeByUser() {
    close();
    if (!window.ML3DLinkRuntime?.romFilename && !linkRunning()) {
      document.getElementById("select-game-button")?.click();
    }
  }

  /* app.js llama aquí antes de tocar el emulador: true = tecla consumida. */
  function handleKey(keyName, down) {
    if (!isOpen) return false;
    if (down) held.add(keyName);
    else held.delete(keyName);
    post({ type: "input", key: keyName, down: Boolean(down) });
    return true;
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== CHILD) return;

    if (data.type === "ready") {
      sendContext();
      post({ type: "visible", visible: isOpen });
      return;
    }
    if (data.type === "load-rom") {
      loadSharedRom(data);
      return;
    }
    if (data.type === "set-alias") {
      const key = String(data.key || "").slice(0, 120);
      const name = String(data.name || "").slice(0, 160);
      try {
        if (key && name) localStorage.setItem(ALIAS_PREFIX + key, name);
        else if (key) localStorage.removeItem(ALIAS_PREFIX + key);
      } catch {}
      sendContext();
      return;
    }
    if (data.type === "hash-request") {
      const id = data.id;
      Promise.resolve(window.ML3DLinkRuntime?.gameHash?.(String(data.name || "")))
        .catch(() => "")
        .then((hash) => post({ type: "hash-result", id, hash: String(hash || "") }));
      return;
    }
    if (data.type === "game-access-request") {
      Promise.resolve(window.ML3DContenido?.pideJuego?.(String(data.game || "")))
        .catch(() => null)
        .then((resultado) => post({ type: "game-access-result", result: resultado || { ok: false, reason: "error" } }));
      return;
    }
    if (data.type === "play-received") {
      playReceived(String(data.name || ""));
      return;
    }
    if (data.type === "delete-received") {
      Promise.resolve(recibidas()?.borra(String(data.name || ""))).finally(sendContext);
      return;
    }
    if (data.type === "rom-request") {
      sendLocalRom();
      return;
    }
    if (data.type === "link-start") close();
    else if (data.type === "close") closeByUser();
  });

  window.addEventListener("keydown", (event) => {
    if (isOpen && event.key === "Escape") {
      event.preventDefault();
      closeByUser();
    }
  }, true);

  /* Juego recibido de otro jugador en el lobby: se guarda en este dispositivo
     y queda apuntado como recibido. No se abre aquí: lo abre la sala al
     iniciar la conexión, o el jugador desde "JUEGOS RECIBIDOS". */
  async function loadSharedRom(data) {
    if (!envioRoms()) return;
    const bytes = new Uint8Array(data.bytes || 0);
    if (bytes.byteLength < 1024) return;
    try {
      /* La huella se vuelve a mirar aquí, con lo que de verdad ha llegado. */
      if (data.hash && await recibidas().huella(bytes) !== data.hash) throw new Error("huella distinta");
      await recibidas().guarda({ bytes, filename: String(data.filename || "juego.gba"), de: data.de });
      post({ type: "rom-saved", ok: true, filename: String(data.filename || "") });
    } catch (error) {
      console.error("ML3D Link: no se pudo guardar el juego recibido.", error);
      post({ type: "rom-saved", ok: false });
    }
    sendContext();
  }

  async function playReceived(nombre) {
    const juego = await recibidas()?.lee(nombre);
    if (!juego || typeof window.gbaStartLocalRom !== "function") return;
    const titulo = juego.filename.replace(/[.](gba|gbc|gb)$/i, "");
    close();
    try {
      await window.gbaStartLocalRom({
        bytes: juego.bytes,
        filename: juego.filename,
        system: /[.]gbc$/i.test(juego.filename) ? "gbc" : /[.]gb$/i.test(juego.filename) ? "gb" : "gba",
        saveId: "recibido-" + titulo.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        displayName: titulo
      });
    } catch (error) {
      console.error("ML3D Link: no se pudo abrir el juego recibido.", error);
    }
  }

  /* Cambiar de juego cambia lo que el lobby debe mostrar y comprobar. */
  window.addEventListener("ml3d-rom-started", () => {
    romHash = "";
    romHashFull = "";
    hashedFor = "";
    if (frame) sendContext();
  });

  function wireLauncher() {
    const button = document.getElementById("open-lobby-button");
    if (!button || button.dataset.lobbyWired) return;
    button.dataset.lobbyWired = "1";
    button.addEventListener("click", open);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireLauncher, { once: true });
  } else {
    wireLauncher();
  }

  window.ML3DLobbyOverlay = {
    open,
    close,
    handleKey,
    get isOpen() {
      return isOpen;
    }
  };
})();
