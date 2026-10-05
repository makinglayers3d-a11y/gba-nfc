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
  let hashedFor = "";

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
    romHash = [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
    hashedFor = filename;
    return romHash;
  }

  function context() {
    const runtime = window.ML3DLinkRuntime;
    const title = document.getElementById("game-title")?.textContent || "";
    const filename = runtime?.romFilename || "";
    return {
      type: "context",
      game: title.trim(),
      romFilename: filename,
      romLoaded: Boolean(filename),
      romHash: hashedFor === filename ? romHash : "",
      system: /\.(gbc|gb)$/i.test(filename) ? filename.toLowerCase().endsWith(".gbc") ? "gbc" : "gb" : "gba",
      library: library || [],
      /* De dónde viene el juego cargado y qué juegos de sala ha dicho este
         jugador que tiene con otro nombre. */
      romSource: runtime?.romSource || "",
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
  /* Apagado hasta que el envío de juegos esté completo: ni se entrega el
     juego cargado ni se abre uno recibido. */
  const ENVIO_ROMS = false;

  function sendLocalRom() {
    const runtime = window.ML3DLinkRuntime;
    const bytes = ENVIO_ROMS && runtime?.romSource === "local" ? runtime.romBytes : null;
    const filename = runtime?.romFilename || "";
    if (!bytes?.byteLength || !filename) {
      post({ type: "rom-bytes", denied: true });
      return;
    }
    post({
      type: "rom-bytes",
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
    if (data.type === "rom-request") {
      sendLocalRom();
      return;
    }
    if (data.type === "close" || data.type === "link-start") close();
  });

  window.addEventListener("keydown", (event) => {
    if (isOpen && event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }, true);

  /* Juego recibido de otro jugador en el lobby: se carga como una ROM local. */
  async function loadSharedRom(data) {
    if (!ENVIO_ROMS) return;
    const bytes = data.bytes instanceof Uint8Array ? data.bytes : new Uint8Array(data.bytes || 0);
    const filename = String(data.filename || "juego.gba");
    if (!bytes.byteLength || typeof window.gbaStartLocalRom !== "function") return;

    const system = /\.gbc$/i.test(filename) ? "gbc" : /\.gb$/i.test(filename) ? "gb" : "gba";
    close();
    try {
      await window.gbaStartLocalRom({
        bytes,
        filename,
        system,
        saveId: "compartido-" + filename.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        displayName: filename.replace(/\.(gba|gbc|gb)$/i, "")
      });
    } catch (error) {
      console.error("ML3D Link: no se pudo cargar el juego compartido.", error);
    }
  }

  /* Cambiar de juego cambia lo que el lobby debe mostrar y comprobar. */
  window.addEventListener("ml3d-rom-started", () => {
    romHash = "";
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
