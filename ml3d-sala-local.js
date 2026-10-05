(() => {
  "use strict";

  /* Sala local: dos consolas en este mismo dispositivo, unidas por el cable.

     Pensada para intercambiar entre dos partidas propias (Rubí y Esmeralda, o
     dos partidas del mismo juego). No usa internet, servidor ni ubicación, y
     nadie más la ve.

     - Las dos consolas corren a la vez. Se ve, se oye y se maneja una; la
       otra sigue funcionando. Se cambia con la tecla Tab o con el botón
       CAMBIAR PANTALLA. No se usa ningún botón de la GBA para eso: le
       llegaría al juego.
     - Cada consola carga su partida y la guarda cuando cambia. Antes de
       empezar se saca una copia de las dos, por si algo falla a mitad de un
       intercambio; se restauran desde "Datos de guardado".
     - "Partida 2" es una segunda partida del mismo juego, aparte de la de
       siempre, para poder intercambiar entre dos partidas sin que se pisen.
     - No se comprueba que los dos cartuchos sean el mismo: aquí se permiten
       juegos distintos. */

  const MGBA_DIR = "link-mgba/dist/multi/";
  const SAVE_MS = 3000;
  const ANCHO_DOBLE = "(min-width: 900px) and (orientation: landscape)";

  let rt = null;
  let consolas = [];        /* [{ nombre, namespace, ultima }] */
  let visible = 0;
  let saveTimer = null;
  let doble = false;
  let ui = null;
  let parando = false;

  const activa = () => Boolean(rt);

  function sumaRapida(bytes) {
    let h = 2166136261;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) + ":" + bytes.length;
  }

  /* Nombre con el que se guarda la partida. La Partida 1 es la de siempre:
     mismo nombre, mismo archivo. La 2 lleva su marca y vive aparte. */
  function nombrePartida(displayName, slot) {
    const base = String(displayName || "partida").replace(/\.(gba|gbc|gb)$/i, "");
    return slot === 2 ? base + " (Partida 2)" : base;
  }

  /* ---------- interfaz mínima sobre la pantalla ---------- */

  function montaUi() {
    quitaUi();
    const screen = document.querySelector(".screen-frame");
    if (!screen) return;
    ui = document.createElement("div");
    ui.id = "ml3d-sala-local-ui";
    ui.style.cssText = "position:absolute;inset:0;z-index:6;pointer-events:none;font:800 11px/1.2 system-ui,sans-serif;color:#fff";

    const etiqueta = document.createElement("div");
    etiqueta.id = "ml3d-sala-local-etiqueta";
    etiqueta.style.cssText = "position:absolute;left:4px;top:4px;padding:3px 7px;border-radius:6px;background:rgba(0,0,0,.72);text-shadow:0 1px 2px #000";

    const fila = document.createElement("div");
    fila.style.cssText = "position:absolute;right:4px;top:4px;display:flex;gap:4px;pointer-events:auto";
    const boton = (texto, titulo, accion) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = texto;
      b.title = titulo;
      b.setAttribute("aria-label", titulo);
      b.style.cssText = "padding:5px 9px;border:1px solid rgba(255,255,255,.45);border-radius:6px;background:rgba(20,40,70,.86);color:#fff;font:inherit;cursor:pointer";
      /* Que el toque no llegue a los controles de la consola. */
      for (const tipo of ["pointerdown", "pointerup", "touchstart", "touchend", "mousedown", "mouseup"]) {
        b.addEventListener(tipo, (event) => event.stopPropagation());
      }
      b.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); accion(); });
      return b;
    };
    fila.append(boton("⇄ CAMBIAR PANTALLA", "Cambiar de consola (tecla Tab)", cambia));
    if (window.matchMedia(ANCHO_DOBLE).matches) fila.append(boton("▯▯", "Pantalla doble", () => ponDoble(!doble)));
    fila.append(boton("✕", "Salir de la sala local", () => stop()));

    ui.append(etiqueta, fila);
    screen.append(ui);
    pintaEtiqueta();
  }

  function pintaEtiqueta() {
    const etiqueta = document.getElementById("ml3d-sala-local-etiqueta");
    if (etiqueta && consolas[visible]) etiqueta.textContent = `CONSOLA ${visible + 1} · ${consolas[visible].nombre}`;
    const otra = document.getElementById("ml3d-sala-local-otra-nombre");
    if (otra && consolas[1 - visible]) otra.textContent = `CONSOLA ${2 - visible} · ${consolas[1 - visible].nombre}`;
  }

  function quitaUi() {
    ui?.remove();
    ui = null;
    document.getElementById("ml3d-sala-local-doble")?.remove();
  }

  /* Pantalla doble: la otra consola, al lado. Solo en pantallas anchas. */
  function ponDoble(encender) {
    doble = Boolean(encender) && window.matchMedia(ANCHO_DOBLE).matches;
    document.getElementById("ml3d-sala-local-doble")?.remove();
    if (!doble || !rt) {
      rt?.setSecondCanvas?.(null);
      return;
    }
    const caja = document.createElement("div");
    caja.id = "ml3d-sala-local-doble";
    caja.style.cssText = "position:fixed;right:12px;top:50%;transform:translateY(-50%);z-index:2147482000;padding:8px;border-radius:12px;background:rgba(12,16,24,.94);border:1px solid rgba(255,255,255,.2);box-shadow:0 12px 40px rgba(0,0,0,.6);font:800 11px/1.2 system-ui,sans-serif;color:#fff";
    const nombre = document.createElement("div");
    nombre.id = "ml3d-sala-local-otra-nombre";
    nombre.style.cssText = "margin-bottom:6px;opacity:.85";
    const lienzo = document.createElement("canvas");
    lienzo.width = 240;
    lienzo.height = 160;
    lienzo.style.cssText = "display:block;width:min(38vw,480px);aspect-ratio:3/2;image-rendering:pixelated;background:#000;border-radius:6px;cursor:pointer";
    lienzo.title = "Pasar a esta consola";
    lienzo.addEventListener("click", cambia);
    caja.append(nombre, lienzo);
    document.body.append(caja);
    rt.setSecondCanvas(lienzo);
    pintaEtiqueta();
  }

  /* ---------- partidas ---------- */

  function guardaPartidas() {
    if (!rt) return;
    consolas.forEach((consola, seat) => {
      const bytes = rt.sram(seat);
      if (!bytes || !bytes.length) return;
      const suma = sumaRapida(bytes);
      if (suma === consola.ultima) return;
      consola.ultima = suma;
      Promise.resolve(window.ML3DLocalSave?.cableWriteSave?.(consola.namespace, consola.nombre, bytes))
        .catch((error) => console.error("ML3D sala local (guardar):", error));
    });
  }

  /* ---------- arranque y parada ---------- */

  /**
   * @param lista dos entradas { bytes, filename, displayName, saveId, slot }
   */
  async function start(lista) {
    if (!Array.isArray(lista) || lista.length !== 2) throw new Error("La sala local necesita dos juegos.");
    if (typeof window.ML3DMgbaLink !== "function") throw new Error("Falta el núcleo del cable.");
    for (const juego of lista) {
      if (!/\.gba$/i.test(String(juego.filename || ""))) throw new Error("La sala local solo admite juegos de GBA.");
      if (!juego.bytes?.byteLength) throw new Error("No se pudo leer " + (juego.displayName || "el juego") + ".");
    }
    if (rt) await stop({ volver: false });

    /* El emulador normal suelta la pantalla y deja su partida escrita. */
    const compat = window.ML3DMgbaCompat;
    try { await compat?.flushSave?.(); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
    window.ML3DLinkRuntime?.stopTimers?.();
    try { await compat?.stop?.(); } catch {}

    /* Partida de cada consola, con copia de seguridad antes de tocar nada. */
    const guardado = window.ML3DLocalSave;
    const nuevas = [];
    for (const juego of lista) {
      const slot = juego.slot === 2 ? 2 : 1;
      const nombre = nombrePartida(juego.displayName || juego.filename, slot);
      /* La Partida 1 es la que usa el juego normal; la 2 no tiene carpeta en
         el núcleo normal y vive solo en su .sav. */
      const namespace = slot === 1 ? (compat?.namespaceFor?.(juego.filename, juego.saveId) || "") : "";
      let bytes = null;
      try { bytes = await guardado?.cableReadSave?.(namespace, nombre); } catch {}
      if (bytes?.length) {
        try { await guardado?.cableBackup?.(nombre, bytes); } catch (error) { console.error("ML3D sala local (copia):", error); }
      }
      nuevas.push({ nombre, namespace, partida: bytes?.length ? bytes : null, ultima: bytes?.length ? sumaRapida(bytes) : "" });
    }
    if (nuevas[0].nombre === nuevas[1].nombre) {
      throw new Error("Las dos consolas usarían la misma partida. Elige Partida 2 en una de ellas.");
    }

    const runtime = await window.ML3DMgbaLink.create({
      wasmDir: MGBA_DIR,
      roms: lista.map((juego) => juego.bytes instanceof Uint8Array ? juego.bytes : new Uint8Array(juego.bytes)),
      seats: 2,
      canvas: document.getElementById("screen")
    });
    nuevas.forEach((consola, seat) => {
      if (consola.partida) runtime.loadSram(seat, consola.partida);
      delete consola.partida;
    });

    rt = runtime;
    consolas = nuevas;
    visible = 0;
    rt.setVisible(0);
    await rt.startAudio();
    rt.start();
    saveTimer = setInterval(guardaPartidas, SAVE_MS);
    montaUi();
    document.body.classList.add("ml3d-sala-local");
    window.dispatchEvent(new CustomEvent("ml3d-sala-local", { detail: { activa: true } }));
    return true;
  }

  async function stop({ volver = true } = {}) {
    if (!rt || parando) return;
    parando = true;
    try {
      clearInterval(saveTimer);
      saveTimer = null;
      /* Lo último jugado, antes de cerrar las consolas. */
      try { guardaPartidas(); } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
      const runtime = rt;
      rt = null;
      try { runtime.setSecondCanvas?.(null); } catch {}
      try { runtime.stop(); } catch {}
      try { runtime.detachAll(); } catch {}
      try { runtime.destroy(); } catch {}
      consolas = [];
      doble = false;
      quitaUi();
      document.body.classList.remove("ml3d-sala-local");
      window.dispatchEvent(new CustomEvent("ml3d-sala-local", { detail: { activa: false } }));
      if (volver) {
        /* De vuelta al emulador normal: el juego que hubiera, o la biblioteca. */
        const ok = await Promise.resolve(window.ML3DLinkRuntime?.resumeNormal?.()).catch(() => false);
        if (!ok) document.getElementById("select-game-button")?.click();
      }
    } finally {
      parando = false;
    }
  }

  /* ---------- pantalla y mando ---------- */

  function cambia() {
    if (!rt) return;
    /* Soltar los botones de la consola que se deja: si no, se quedarían
       pulsados sin nadie que los suelte. */
    rt.setKeys(visible, 0);
    visible = 1 - visible;
    rt.setVisible(visible);
    pintaEtiqueta();
  }

  /* app.js pregunta aquí antes de mandar una tecla al emulador normal. */
  function handleKey(keyName, down) {
    if (!rt) return false;
    rt.press(visible, keyName, Boolean(down));
    return true;
  }

  window.addEventListener("keydown", (event) => {
    if (!rt || event.key !== "Tab" || event.repeat) return;
    if (window.ML3DLobbyOverlay?.isOpen) return;
    const destino = event.target;
    if (destino && (destino.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(destino.tagName || ""))) return;
    event.preventDefault();
    event.stopPropagation();
    cambia();
  }, true);

  /* Si se abre otro juego por el camino normal, la sala local se cierra. */
  window.addEventListener("ml3d-rom-started", () => {
    if (rt && !parando) stop({ volver: false });
  });
  window.addEventListener("pagehide", () => { try { guardaPartidas(); } catch {} });

  window.ML3DSalaLocal = {
    start,
    stop,
    cambia,
    handleKey,
    ponDoble,
    get activa() { return activa(); },
    get estado() {
      return rt ? {
        visible,
        doble,
        consolas: consolas.map((consola) => consola.nombre),
        fps: Math.round(rt.fps || 0),
        frames: rt.seats.map((_, seat) => rt.coreState(seat)?.frames || 0),
        cable: rt.attachedCount()
      } : null;
    },
    /* Solo para pruebas: el runtime de las dos consolas. */
    get _rt() { return rt; }
  };
})();
