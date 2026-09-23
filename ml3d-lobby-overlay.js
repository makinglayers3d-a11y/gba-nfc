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
    frame.allow = "autoplay; clipboard-write";
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

  function context() {
    const runtime = window.ML3DLinkRuntime;
    const title = document.getElementById("game-title")?.textContent || "";
    return {
      type: "context",
      game: title.trim(),
      romFilename: runtime?.romFilename || "",
      romLoaded: Boolean(runtime?.romFilename)
    };
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
    post(context());
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
      post(context());
      post({ type: "visible", visible: isOpen });
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
