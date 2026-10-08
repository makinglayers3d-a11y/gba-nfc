(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  /* El lobby integrado configura la sesión en caliente (gba:link:configure),
     así que estos tres valores ya no son fijos: la URL solo da el arranque
     directo que sigue usando el lobby en ventana aparte. */
  let roomId = String(params.get("linkRoom") || "");
  let mySeat = Math.max(0, Math.min(3, Number(params.get("linkPlayer")) | 0));
  let role = params.get("linkRole") === "host" ? "host" : "guest";
  /* Jugadores de la sala: 2 a 4, como el cable Link real. Cada navegador
     emula su consola y una copia oculta de cada compañero. */
  let seatCount = Math.max(2, Math.min(4, Number(params.get("linkPlayers")) | 0 || 2));
  const selfTest = params.get("linkSelfTest") === "1";
  const requestedTransferCycles = Math.max(0, Number(params.get("linkTransferCycles")) | 0);
  const progressiveTransfer = params.get("linkProgressive") === "1";
  let enabled = Boolean(roomId) || selfTest;
  const BUS_NAME = "ml3d-gba-link-v1";
  const FRAME_CYCLES = 280896;
  const INPUT_DELAY = 4;
  const RING = 256;
  const LINK_SLICE = 16384;   /* rodaja por vuelta del planificador con cable */
  const AUDIO_TARGET_MS = 120; /* cola de audio a la que se acompasa la sesion */
  const SYNC_EVERY = 60;       /* cada cuantos frames se comparan las copias */
  const UNKNOWN = -1;

  let localMask = 0;
  /* Volver al juego normal recarga la ROM, y eso emite ml3d-rom-started. Sin
     esta bandera el oyente volveria a armar la sesion que se acaba de cerrar. */
  let returningToNormal = false;
  const selfTestMasks = [0, 0, 0, 0];
  let controller = null;
  let pendingStart = null;

  /* Aviso de divergencia.

     El cable en red no manda imagen: cada navegador emula las mismas consolas
     con las mismas teclas y confia en llegar al mismo sitio. Si dejan de
     coincidir, cada jugador ve una partida distinta y nada lo delata. Por eso
     el aviso es un cartel que tapa la pantalla, no una linea en la barra de
     depuracion: el jugador tiene que enterarse. */
  function mostrarDesync(detalle) {
    let el = document.getElementById("ml3d-link-desync");
    if (!el) {
      el = document.createElement("div");
      el.id = "ml3d-link-desync";
      el.style.cssText =
        "position:fixed;inset:0;z-index:2147483646;display:flex;" +
        "flex-direction:column;align-items:center;justify-content:center;gap:10px;" +
        "background:rgba(120,0,0,.88);color:#fff;text-align:center;padding:24px;" +
        "font:bold 18px/1.4 system-ui,sans-serif;text-shadow:0 1px 2px #000";
      document.documentElement.appendChild(el);
    }
    el.textContent = "";
    const titulo = document.createElement("div");
    titulo.style.cssText = "font-size:26px;letter-spacing:.04em";
    titulo.textContent = "PARTIDAS DESINCRONIZADAS";
    const cuerpo = document.createElement("div");
    cuerpo.style.cssText = "font-weight:normal;max-width:34ch";
    cuerpo.textContent =
      "Las consolas han dejado de ir a la vez: cada jugador esta viendo una " +
      "partida distinta. Volved a conectar para empezar de nuevo.";
    const pie = document.createElement("div");
    pie.style.cssText = "font:11px/1.3 monospace;opacity:.75";
    pie.textContent = detalle;
    el.append(titulo, cuerpo, pie);
  }

  function quitarDesync() {
    document.getElementById("ml3d-link-desync")?.remove();
  }

  /* Partidas guardadas y cable.

     Cada navegador emula su consola y una copia de la de cada compañero. Para
     que las copias hagan lo mismo, todos necesitan la partida de todos: se
     intercambian al empezar, directas entre los dispositivos.

     - Nadie envia nada hasta que todos han aceptado este aviso.
     - La partida ajena vive solo en memoria mientras dura la sesion. No se
       escribe en disco y no hay forma de verla ni exportarla.
     - Cada jugador guarda solo la de su propia consola. */
  const ESPERA_AVISO_MS = 500;
  function pideConsentimiento(tienePartida, comparteJuego = false) {
    return new Promise((resolve) => {
      document.getElementById("ml3d-link-consent")?.remove();
      const el = document.createElement("div");
      el.id = "ml3d-link-consent";
      el.style.cssText =
        "position:fixed;inset:0;z-index:2147483646;display:flex;" +
        "flex-direction:column;align-items:center;justify-content:center;gap:12px;" +
        "background:rgba(20,20,28,.94);color:#fff;text-align:center;padding:24px;" +
        "font:bold 18px/1.4 system-ui,sans-serif;text-shadow:0 1px 2px #000";
      const titulo = document.createElement("div");
      titulo.style.cssText = "font-size:20px;max-width:30ch";
      titulo.textContent = comparteJuego
        ? "Tu partida y tu juego se compartirán con el otro jugador durante esta sesión"
        : "Tu partida se compartirá con el otro jugador durante esta sesión";
      const cuerpo = document.createElement("div");
      cuerpo.style.cssText = "font-weight:normal;font-size:15px;max-width:38ch";
      cuerpo.textContent =
        (tienePartida
          ? "Va directa a su dispositivo y solo se usa mientras dura la sesión: no se guarda allí ni en ningún servidor. Antes se ha hecho una copia de tu partida. "
          : "No tienes partida guardada de este juego. ") +
        "Tú recibirás la suya igual: solo durante la sesión." +
        (comparteJuego
          ? " El juego también va directo, solo en memoria, y se borra al terminar. Al aceptar declaras que tienes derecho a compartirlo."
          : "");
      const fila = document.createElement("div");
      fila.style.cssText = "display:flex;gap:12px;margin-top:6px";
      const boton = (texto, fondo, valor) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = texto;
        b.style.cssText =
          "padding:10px 22px;font:bold 15px system-ui,sans-serif;color:#fff;border:0;" +
          "border-radius:8px;cursor:pointer;background:" + fondo;
        b.addEventListener("click", () => { if (b.disabled) return; el.remove(); resolve(valor); });
        return b;
      };
      const cancelar = boton("CANCELAR", "#555b66", false);
      const aceptar = boton("ACEPTAR", "#3b6fd4", true);
      fila.append(cancelar, aceptar);
      el.append(titulo, cuerpo, fila);
      document.documentElement.appendChild(el);
      /* Es un consentimiento: no puede darse por un toque que ya venía de
         camino. El aviso tapa toda la pantalla, también los botones de la
         consola, así que los suyos no responden hasta pasada la espera, y el
         que queda enfocado es CANCELAR: una tecla suelta nunca acepta. */
      for (const b of [cancelar, aceptar]) { b.disabled = true; b.style.opacity = ".45"; }
      setTimeout(() => {
        for (const b of [cancelar, aceptar]) { b.disabled = false; b.style.opacity = ""; }
        if (el.isConnected) cancelar.focus({ preventScroll: true });
      }, ESPERA_AVISO_MS);
    });
  }

  function avisaSinSesion(texto, accion = null) {
    document.getElementById("ml3d-link-consent")?.remove();
    let el = document.getElementById("ml3d-link-sin-sesion");
    if (el) return;
    el = document.createElement("div");
    el.id = "ml3d-link-sin-sesion";
    el.style.cssText =
      "position:fixed;inset:0;z-index:2147483646;display:flex;" +
      "flex-direction:column;align-items:center;justify-content:center;gap:12px;" +
      "background:rgba(20,20,28,.92);color:#fff;text-align:center;padding:24px;" +
      "font:bold 18px/1.4 system-ui,sans-serif;text-shadow:0 1px 2px #000";
    const titulo = document.createElement("div");
    titulo.style.cssText = "font-size:22px;letter-spacing:.03em";
    titulo.textContent = "LA SESIÓN NO EMPIEZA";
    const cuerpo = document.createElement("div");
    cuerpo.style.cssText = "font-weight:normal;max-width:34ch";
    cuerpo.textContent = texto + " No se ha compartido ninguna partida.";
    const boton = document.createElement("button");
    boton.type = "button";
    boton.textContent = "ENTENDIDO";
    boton.style.cssText =
      "margin-top:6px;padding:10px 22px;font:bold 15px system-ui,sans-serif;" +
      "background:#3b6fd4;color:#fff;border:0;border-radius:8px;cursor:pointer";
    boton.addEventListener("click", () => el.remove());
    el.append(titulo, cuerpo);
    if (accion) {
      const extra = document.createElement("button");
      extra.type = "button";
      extra.textContent = accion.texto;
      extra.style.cssText = boton.style.cssText + ";background:#2e8b57";
      extra.addEventListener("click", async () => {
        extra.disabled = true;
        cuerpo.textContent = await accion.hacer();
      });
      el.append(extra);
    }
    el.append(boton);
    document.documentElement.appendChild(el);
    setTimeout(() => el.remove(), accion ? 60000 : 15000);
  }

  const SAVE_CHUNK = 12 * 1024;
  const SAVE_MAX_BYTES = 1024 * 1024;
  const SAVE_WRITE_MS = 3000;
  const PROTOCOLO = "dual-core-v2";

  /* Suma rapida para saber si la partida ha cambiado desde la ultima vez. */
  function sumaRapida(bytes) {
    let h = 2166136261;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) + ":" + bytes.length;
  }

  /* Aviso de cable caido.
     Se parece al de divergencia pero dice otra cosa: alli las dos copias
     seguian corriendo y habian dejado de coincidir; aqui no hay nadie al otro
     lado. El jugador tiene que enterarse de por que se ha quedado solo, y la
     partida tiene que soltarse en vez de esperar para siempre. */
  function mostrarCaida(motivo) {
    let el = document.getElementById("ml3d-link-caida");
    if (el) return;
    el = document.createElement("div");
    el.id = "ml3d-link-caida";
    el.style.cssText =
      "position:fixed;inset:0;z-index:2147483646;display:flex;" +
      "flex-direction:column;align-items:center;justify-content:center;gap:12px;" +
      "background:rgba(20,20,28,.92);color:#fff;text-align:center;padding:24px;" +
      "font:bold 18px/1.4 system-ui,sans-serif;text-shadow:0 1px 2px #000";
    const titulo = document.createElement("div");
    titulo.style.cssText = "font-size:24px;letter-spacing:.03em";
    titulo.textContent = "SE PERDIO LA CONEXION";
    const cuerpo = document.createElement("div");
    cuerpo.style.cssText = "font-weight:normal;max-width:34ch";
    cuerpo.textContent =
      (motivo ? motivo.charAt(0).toUpperCase() + motivo.slice(1) + ". " : "") +
      "Vuelves al juego de un jugador. Para seguir jugando juntos, entrad otra " +
      "vez en la sala y empezad una partida nueva.";
    const boton = document.createElement("button");
    boton.type = "button";
    boton.textContent = "ENTENDIDO";
    boton.style.cssText =
      "margin-top:6px;padding:10px 22px;font:bold 15px system-ui,sans-serif;" +
      "background:#3b6fd4;color:#fff;border:0;border-radius:8px;cursor:pointer";
    boton.addEventListener("click", () => el.remove());
    el.append(titulo, cuerpo, boton);
    document.documentElement.appendChild(el);
    /* Que no se quede para siempre si nadie lo toca. */
    setTimeout(() => el.remove(), 15000);
  }

  /* Que no se apague la pantalla durante la partida.
     En el movil, apagarse congela el navegador y con el se para esta consola:
     la otra se queda esperando input que ya no llega. El navegador suelta el
     bloqueo solo al cambiar de pestaña, asi que hay que volver a pedirlo. */
  let pantallaDespierta = null;

  async function mantenPantallaEncendida() {
    if (!navigator.wakeLock || pantallaDespierta) return;
    try {
      pantallaDespierta = await navigator.wakeLock.request("screen");
      pantallaDespierta.addEventListener("release", () => { pantallaDespierta = null; });
    } catch { pantallaDespierta = null; }
  }

  function dejaApagarPantalla() {
    try { pantallaDespierta?.release(); } catch {}
    pantallaDespierta = null;
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && controller?.started) mantenPantallaEncendida();
  });

  function handleLocalKey(key, down) {
    key = Number(key) | 0;
    if (key < 0 || key > 9) return false;
    const bit = 1 << key;
    if (down) localMask |= bit;
    else localMask &= ~bit;
    localMask &= 0x3ff;
    return Boolean(controller?.started);
  }

  window.ML3DLocalLinkSession = {
    handleLocalKey,
    get active() {
      return Boolean(controller?.started);
    },
    get status() {
      return controller?.status?.() || { enabled, roomId, mySeat, role, selfTest };
    },
    /* Medicion de la partida: resumen() separa CPU de red, muestras() da el
       segundo a segundo. Es lo que se mira al terminar una prueba larga. */
    get medicion() {
      if (!controller) return null;
      return { resumen: controller.resumen(), muestras: controller.muestras || [] };
    },
    test: selfTest ? {
      setSeatMask(seat, mask) {
        seat = Number(seat) | 0;
        if (seat < 0 || seat > 3) return false;
        selfTestMasks[seat] = Number(mask) & 0x3ff;
        return true;
      },
      press(seat, key) {
        seat = Number(seat) | 0;
        key = Number(key) | 0;
        if (seat < 0 || seat > 3 || key < 0 || key > 9) return false;
        selfTestMasks[seat] |= (1 << key);
        return true;
      },
      release(seat, key) {
        seat = Number(seat) | 0;
        key = Number(key) | 0;
        if (seat < 0 || seat > 3 || key < 0 || key > 9) return false;
        selfTestMasks[seat] &= ~(1 << key);
        return true;
      },
      releaseAll() {
        selfTestMasks.fill(0);
      },
      get masks() {
        return selfTestMasks.slice();
      },
      get controller() {
        return controller || null;
      }
    } : null
  };

  /* El bus queda siempre escuchando: sin sala configurada nada casa con el
     filtro de roomId, y asi el lobby integrado puede configurarla despues. */
  if (typeof BroadcastChannel !== "function") return;

  const bus = new BroadcastChannel(BUS_NAME);

  function sendLocal(packet) {
    bus.postMessage({
      ...packet,
      source: "emulator",
      roomId,
      time: Date.now()
    });
  }

  async function fingerprint(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
    );
    return [...new Uint8Array(digest).slice(0, 8)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /* Juegos distintos en cada consola.

     Cada navegador emula su consola y una copia de la del otro, así que con
     juegos distintos necesita los dos cartuchos. Antes de montar las consolas
     cada jugador consigue el del otro:

     - Juego de la biblioteca: lo baja con SU propio acceso. Nunca se le pide
       al otro jugador ni se le envía. Si no tiene acceso, la sesión no
       empieza.
     - Juego que el otro cargó de un archivo suyo: se lo envía el otro, solo
       para esta sesión. Vive en memoria, no se escribe en disco y se borra al
       terminar. Solo con el interruptor de envío encendido en los dos lados y
       después de que los dos acepten el aviso, que es el mismo de la partida.
     - Juego que el otro recibió de un tercero: no se comparte.

     Solo con dos jugadores. */
  const ROM_MAX_BYTES = 64 * 1024 * 1024;
  const ROM_LOTE = 16;          /* trozos por tanda */
  const ROM_LOTE_MS = 40;
  const plan = () => window.ML3DLinkPlan || { mixed: false, mine: "" };
  const envioEncendido = () => window.ML3D_ENVIO_ROMS === true;

  class Preludio {
    /**
     * @param mia     { bytes, hash, nombre, origen } el juego de este jugador
     * @param partida si este jugador tiene partida (para el texto del aviso)
     * @param alListo recibe los cartuchos por asiento cuando están los dos
     */
    constructor(mia, partida, alListo) {
      this.mia = mia;
      this.tienePartida = Boolean(partida?.bytes);
      this.alListo = alListo;
      this.otra = null;          /* { hash, nombre, size, origen, envio } */
      this.otraBytes = null;
      this.remoto = { consent: false, tiene: "" };
      this.consent = false;
      this.declined = false;
      this.motivo = "";
      this.necesitaEnvio = false;
      this.enviada = false;
      this.entrante = null;
      this.fin = false;
      this.preguntado = false;
      this.timer = setInterval(() => this.tic(), 400);
      this.tic();
    }

    publica() {
      sendLocal({
        type: "gba:lockstep:ready",
        playerNumber: mySeat,
        role,
        romHash: this.mia.hash,
        protocol: PROTOCOLO,
        pre: true,
        rom: { hash: this.mia.hash, nombre: this.mia.nombre, size: this.mia.bytes.length, origen: this.mia.origen, envio: envioEncendido() },
        consent: this.consent,
        declined: this.declined,
        motivo: this.motivo,
        preHave: this.otraBytes ? this.otra.hash : ""
      });
    }

    tic() {
      if (this.fin) return;
      /* Un juego que no se puede conseguir se sabe pronto, con el lobby aún
         delante. El aviso espera a que se intente empezar: taparle el lobby
         a quien todavía está eligiendo no ayuda a nadie. */
      if (this.fallo && window.ML3DLobbyOverlay?.isOpen !== true) {
        const fallo = this.fallo;
        this.fallo = null;
        this.rechaza(fallo.motivo, fallo.texto, fallo.accion);
        return;
      }
      this.publica();
      /* El aviso espera a que el lobby se quite, como el de la partida, y a
         saber qué juego lleva el otro: el texto depende de si hay que enviar. */
      if (!this.preguntado && this.otra && !this.declined && !this.fallo && window.ML3DLobbyOverlay?.isOpen !== true) {
        this.preguntado = true;
        const comparteJuego = this.mia.origen === "local" && this.otra.hash !== this.mia.hash;
        pideConsentimiento(this.tienePartida, comparteJuego).then((acepta) => {
          if (this.fin) return;
          if (acepta) { this.consent = true; this.revisa(); this.publica(); return; }
          this.rechaza("", "");
        });
      }
      this.revisa();
    }

    /* Este lado no sigue: se le dice al otro y se vuelve al juego normal. */
    rechaza(motivo, texto, accion = null) {
      if (this.fin) return;
      this.declined = true;
      this.motivo = motivo;
      this.publica();
      if (texto) avisaSinSesion(texto, accion);
      setTimeout(() => { this.publica(); cancelaSesion(); }, 300);
    }

    acceptReady(packet) {
      if (this.fin) return;
      const seat = Number(packet.playerNumber) | 0;
      if (seat === mySeat) return;
      if (String(packet.protocol || "") !== PROTOCOLO) {
        avisaSinSesion("Las dos páginas no llevan la misma versión. Recargad los dos.");
        cancelaSesion();
        return;
      }
      if (packet.declined) {
        const textos = {
          acceso: "El otro jugador no tiene acceso a tu juego. Es de la biblioteca y no se comparte.",
          apagado: "El envío de juegos está desactivado: no se puede compartir un juego cargado de archivo.",
          recibida: "Uno de los juegos lo recibió su dueño de otro jugador y no se puede compartir.",
          distintos: "El juego del otro jugador no es la misma copia que la tuya con ese nombre."
        };
        avisaSinSesion(textos[packet.motivo] || "El otro jugador no ha aceptado compartir su partida.");
        cancelaSesion();
        return;
      }
      /* Si el otro lado ya montó sus consolas, sus paquetes no traen `pre`
         pero siguen diciendo qué juego mío tiene. */
      this.remoto = { consent: packet.consent === true, tiene: String(packet.preHave || "") };
      if (!this.otra && packet.pre && packet.rom && packet.rom.hash) {
        this.otra = {
          hash: String(packet.rom.hash), nombre: String(packet.rom.nombre || ""), size: Number(packet.rom.size) | 0,
          origen: String(packet.rom.origen || ""), envio: packet.rom.envio === true
        };
        this.resuelve().catch((error) => {
          console.error("ML3D Local Link (juego del otro):", error);
          this.fallara("acceso", "No se pudo conseguir el juego del otro jugador.");
        });
      }
      this.revisa();
    }

    /* De dónde sale el juego del otro. */
    /* Deja apuntado por qué no se puede seguir; se dice al intentar empezar. */
    fallara(motivo, texto, accion = null) {
      this.fallo = { motivo, texto, accion };
    }

    async resuelve() {
      const otra = this.otra;
      if (otra.hash === this.mia.hash) {            /* resulta que es el mismo cartucho */
        this.otraBytes = this.mia.bytes.slice();
        return;
      }
      if (otra.origen === "remote") {
        const bytes = await window.ML3DLinkRuntime?.romFor?.(otra.nombre);
        const limpio = otra.nombre.replace(/\.(gba|gbc|gb)$/i, "");
        if (!bytes) {
          const puedePedir = Boolean(window.ML3DContenido?.hayAcceso);
          this.fallara("acceso",
            `No tienes acceso a «${limpio}». Es un juego de la biblioteca: cada jugador necesita su propio acceso y no se comparte.` +
              (puedePedir ? "" : " Este juego es solo para testers."),
            puedePedir ? {
              texto: "SOLICITAR ACCESO A ESTE JUEGO",
              hacer: async () => {
                const r = await window.ML3DContenido.pideJuego(limpio);
                return r?.status === "pending" ? "Petición enviada. Te avisaremos cuando se resuelva."
                  : r?.status === "ya_lo_tiene" ? "Ya tienes ese juego: recarga el emulador."
                  : "No se pudo enviar la petición.";
              }
            } : null);
          return;
        }
        if (await fingerprint(bytes) !== otra.hash) {
          this.fallara("distintos", `Tu copia de «${limpio}» no es la misma que la del otro jugador. Los dos necesitáis la misma.`);
          return;
        }
        this.otraBytes = bytes;
        return;
      }
      if (otra.origen === "local") {
        if (!otra.envio || !envioEncendido()) {
          this.fallara("apagado", "El envío de juegos está desactivado: el otro jugador no puede compartir un juego cargado de archivo.");
          return;
        }
        if (otra.size <= 0 || otra.size > ROM_MAX_BYTES) {
          this.fallara("acceso", "El juego del otro jugador no tiene un tamaño válido.");
          return;
        }
        this.necesitaEnvio = true;   /* llegará cuando los dos acepten */
        return;
      }
      this.fallara("recibida", "El otro jugador lleva un juego que recibió de otro jugador: no se puede compartir.");
    }

    revisa() {
      if (this.fin || this.declined) return;
      /* Enviar el juego propio: solo si es de archivo, si el otro lo necesita,
         con el interruptor encendido y con los dos de acuerdo. */
      if (!this.enviada && this.consent && this.remoto.consent && this.otra &&
          this.mia.origen === "local" && this.otra.hash !== this.mia.hash &&
          this.remoto.tiene !== this.mia.hash && envioEncendido()) {
        this.enviada = true;
        this.envia();
      }
      if (this.otraBytes && this.consent && this.remoto.consent && this.remoto.tiene === this.mia.hash) {
        this.fin = true;
        clearInterval(this.timer);
        const roms = [];
        roms[mySeat] = this.mia.bytes;
        roms[1 - mySeat] = this.otraBytes;
        const combinado = mySeat === 0 ? this.mia.hash + this.otra.hash : this.otra.hash + this.mia.hash;
        const tengo = this.otra.hash;
        this.otraBytes = null;
        this.alListo(roms, combinado, tengo);
      }
    }

    envia() {
      const bytes = this.mia.bytes;
      const total = Math.ceil(bytes.length / SAVE_CHUNK);
      sendLocal({ type: "gba:lockstep:save", playerNumber: mySeat, kind: "rom-meta", hash: this.mia.hash, size: bytes.length, total });
      let index = 0;
      const tanda = () => {
        if (this.declined || this.destruido) return;
        for (let n = 0; n < ROM_LOTE && index < total; n++, index++) {
          const slice = bytes.subarray(index * SAVE_CHUNK, (index + 1) * SAVE_CHUNK);
          let binary = "";
          for (let i = 0; i < slice.length; i++) binary += String.fromCharCode(slice[i]);
          sendLocal({ type: "gba:lockstep:save", playerNumber: mySeat, kind: "rom-chunk", index, data: btoa(binary) });
        }
        if (index < total) setTimeout(tanda, ROM_LOTE_MS);
      };
      tanda();
    }

    /* Llega el juego del otro. Solo si aquí se aceptó, si se esperaba y con el
       tamaño y la huella que anunció. */
    acceptRom(packet) {
      if (this.fin || !this.consent || !this.necesitaEnvio || this.otraBytes) return;
      const seat = Number(packet.playerNumber) | 0;
      if (seat === mySeat) return;
      if (packet.kind === "rom-meta") {
        const size = Number(packet.size) | 0;
        if (size !== this.otra.size || String(packet.hash || "") !== this.otra.hash) return;
        this.entrante = { partes: [], recibido: 0, size };
        return;
      }
      if (packet.kind !== "rom-chunk" || !this.entrante) return;
      const binary = atob(String(packet.data || ""));
      if (this.entrante.recibido + binary.length > this.entrante.size) { this.entrante = null; return; }
      const trozo = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) trozo[i] = binary.charCodeAt(i);
      this.entrante.partes[Number(packet.index) | 0] = trozo;
      this.entrante.recibido += trozo.length;
      if (this.entrante.recibido < this.entrante.size) return;

      const entrada = this.entrante;
      this.entrante = null;
      const todo = new Uint8Array(entrada.size);
      let offset = 0;
      for (const parte of entrada.partes) {
        if (!parte) continue;
        todo.set(parte, offset);
        offset += parte.length;
      }
      fingerprint(todo).then((hash) => {
        if (this.fin || this.destruido) return;
        if (offset !== entrada.size || hash !== this.otra.hash) {
          this.rechaza("distintos", "El juego del otro jugador ha llegado dañado.");
          return;
        }
        this.otraBytes = todo;
        this.revisa();
        this.publica();
      });
    }

    destroy() {
      this.destruido = true;
      this.fin = true;
      clearInterval(this.timer);
      document.getElementById("ml3d-link-consent")?.remove();
      /* El juego ajeno no sobrevive a la sesión. */
      if (this.otraBytes) this.otraBytes.fill(0);
      this.otraBytes = null;
      this.entrante = null;
    }
  }

  let prelude = null;

  class LocalDualLink {
    /**
     * @param rt   adaptador del runtime mGBA multi-instancia (ver mgbaRuntime)
     * @param hash huella de la ROM, para que los dos lados comparen cartucho
     */
    constructor(rt, hash, partida = null, opciones = {}) {
      this.rt = rt;
      /* Juegos distintos: el aviso (partida y juego) ya se aceptó antes de
         montar las consolas, y se sigue diciendo qué juego ajeno se tiene. */
      this.preHave = String(opciones.preHave || "");
      this.romHash = hash;
      this.seats = seatCount;

      /* Partidas. `saves[asiento]`: undefined = aun no se sabe, null = ese
         jugador no tiene, bytes = su partida. La propia sale del disco; las
         demas llegan por el cable y solo viven aqui, en memoria. */
      this.partida = partida;                 /* { bytes, hash, namespace, nombre } o null */
      this.saves = new Array(4).fill(undefined);
      this.saves[mySeat] = partida?.bytes || null;
      this.myHash = partida?.hash || "-";
      this.consent = false;
      this.declined = false;
      this.go = false;                        /* todos han aceptado */
      this.sentSave = false;
      this.remotos = new Map();               /* asiento -> { consent, have } */
      this.entrantes = new Map();             /* asiento -> partida a medio llegar */
      this.saveTimer = null;
      this.ultimaEscrita = partida?.bytes ? sumaRapida(partida.bytes) : "";

      /* Mapa explícito asiento → core. El id que devuelve instance_open no
         tiene por qué coincidir con el asiento, y el asiento definitivo lo
         confirma el coordinador aparte, en confirmedSeat. */
      this.seatToCore = Array.from({ length: this.seats }, (_, i) => i);
      this.confirmedSeat = new Array(this.seats).fill(-1);
      /* La consola visible y audible es siempre la de mySeat. */
      this.visible = this.coreOf(Math.min(mySeat, this.seats - 1));
      rt.setVisible(this.visible);

      this.ran = new Array(this.seats).fill(0);
      this.target = 0;
      this.frame = 0;
      this.sessionId = "";
      this.started = false;
      this.readySeats = new Set();
      this.remoteHash = "";
      /* El recuento de transferencias lo lleva ahora el coordinador nativo: se
         cuenta por flancos de transferencia activa, no por el cable a mano. */
      this.transferCount = 0;
      this.prevTransferActive = 0;
      this.lastLinkError = "";
      this.wedged = false;
      this.inputTimer = null;
      this.readyTimer = null;
      this.tickTimer = null;
      this.lastApplied = new Array(this.seats).fill(0);
      this.inputs = new Int16Array(RING * this.seats).fill(UNKNOWN);
      this.sentFrames = new Set();
      this.lastTickAt = performance.now();
      this.stallCount = 0;
      this.debug = null;

      for (let frame = 0; frame < INPUT_DELAY; frame++) {
        for (let seat = 0; seat < this.seats; seat++) this.setInput(frame, seat, 0);
      }

      this.cableOk = this.attachCable();
      this.buildDebug();
      if (!this.cableOk) return;
      if (selfTest) {
        for (let seat = 1; seat < this.seats; seat++) this.readySeats.add(seat);
        this.remoteHash = this.romHash;
        setTimeout(() => this.start("ci-selftest", INPUT_DELAY), 0);
      } else {
        this.publishReady();
        this.readyTimer = setInterval(() => {
          if (!this.started) this.publishReady();
        }, 500);
        /* La sesion se monta al entrar en la sala, con el lobby delante. El
           aviso espera a que el lobby se quite (al iniciar la conexion o al
           volver al juego): es entonces cuando la partida esta por empezar. */
        const lobbyDelante = () => window.ML3DLobbyOverlay?.isOpen === true;
        const pregunta = () => pideConsentimiento(Boolean(partida?.bytes)).then((acepta) => {
          if (this.destroyed) return;
          if (acepta) {
            this.consent = true;
            this.revisaPartidas();
            this.publishReady();
            return;
          }
          /* Sin aceptar no sale nada de aqui. Se avisa al otro y se vuelve al
             juego normal. */
          this.declined = true;
          this.publishReady();
          setTimeout(() => { this.publishReady(); cancelaSesion(); }, 300);
        });
        if (opciones.consentido) {
          this.consent = true;
          this.revisaPartidas();
          this.publishReady();
        } else if (!lobbyDelante()) pregunta();
        else {
          this.consentTimer = setInterval(() => {
            if (lobbyDelante()) return;
            clearInterval(this.consentTimer);
            this.consentTimer = null;
            if (!this.destroyed && !this.started) pregunta();
          }, 300);
        }
      }
    }

    /* ------------------------------------------------------------ partidas */

    /** Huella conjunta de las partidas que tiene este dispositivo, o "". */
    haveDigest() {
      const trozos = [];
      for (let seat = 0; seat < this.seats; seat++) {
        const save = this.saves[seat];
        if (save === undefined) return "";
        trozos.push(seat === mySeat ? this.myHash : (this.hashes?.[seat] || "-"));
      }
      return trozos.join("|");
    }

    todosAceptan() {
      if (!this.consent) return false;
      for (let seat = 1; seat < this.seats; seat++) {
        if (!this.remotos.get(seat)?.consent) return false;
      }
      return true;
    }

    /* El host decide cuando han aceptado todos; los demas se enteran por su
       paquete de listo. Solo entonces sale la partida propia. */
    revisaPartidas() {
      if (role === "host") this.go = this.todosAceptan();
      if (!this.go || !this.consent || this.sentSave) return;
      this.sentSave = true;
      const bytes = this.partida?.bytes || null;
      const total = bytes ? Math.ceil(bytes.length / SAVE_CHUNK) : 0;
      sendLocal({
        type: "gba:lockstep:save", playerNumber: mySeat, kind: "meta",
        hash: this.myHash, size: bytes ? bytes.length : 0, total
      });
      for (let index = 0; index < total; index++) {
        const slice = bytes.subarray(index * SAVE_CHUNK, (index + 1) * SAVE_CHUNK);
        let binary = "";
        for (let i = 0; i < slice.length; i++) binary += String.fromCharCode(slice[i]);
        sendLocal({ type: "gba:lockstep:save", playerNumber: mySeat, kind: "chunk", index, data: btoa(binary) });
      }
    }

    /* Llega la partida de otro jugador. Solo se acepta si aqui tambien se ha
       aceptado compartir, y se comprueba contra la huella anunciada. */
    acceptRemoteSave(packet) {
      if (this.started || !this.consent) return;
      const seat = Number(packet.playerNumber) | 0;
      if (seat === mySeat || seat < 0 || seat >= this.seats) return;

      if (packet.kind === "meta") {
        const size = Number(packet.size) | 0;
        if (size < 0 || size > SAVE_MAX_BYTES) return;
        this.hashes = this.hashes || {};
        this.hashes[seat] = String(packet.hash || "-");
        if (size === 0) {
          this.saves[seat] = null;
          this.entrantes.delete(seat);
          this.despuesDePartida();
          return;
        }
        this.entrantes.set(seat, { size, total: Number(packet.total) | 0, partes: [], recibido: 0, hash: this.hashes[seat] });
        return;
      }

      if (packet.kind === "chunk") {
        const entrada = this.entrantes.get(seat);
        if (!entrada) return;
        const binary = atob(String(packet.data || ""));
        if (entrada.recibido + binary.length > entrada.size) { this.entrantes.delete(seat); return; }
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        entrada.partes[Number(packet.index) | 0] = bytes;
        entrada.recibido += bytes.length;
        if (entrada.recibido < entrada.size) return;

        this.entrantes.delete(seat);
        const todo = new Uint8Array(entrada.size);
        let offset = 0;
        for (const parte of entrada.partes) {
          if (!parte) continue;
          todo.set(parte, offset);
          offset += parte.length;
        }
        fingerprint(todo).then((hash) => {
          if (this.destroyed || this.started) return;
          if (offset !== entrada.size || hash !== entrada.hash) {
            this.setDebugError("PARTIDA DEL ASIENTO " + seat + " DAÑADA");
            return;
          }
          this.saves[seat] = todo;
          this.despuesDePartida();
        });
      }
    }

    despuesDePartida() {
      this.publishReady();
      this.renderDebug();
      this.maybeHostStart();
    }

    /* Cada consola arranca con la partida de su jugador y con el mismo reloj
       en todos los dispositivos. Va antes del primer frame. */
    cargaPartidas(clock) {
      for (let seat = 0; seat < this.seats; seat++) {
        const core = this.coreOf(seat);
        const save = this.saves[seat];
        if (save && save.length) this.rt.loadSram?.(core, save);
        /* Sin reloj comun las copias divergen con una partida cargada: mejor
           no empezar que empezar mal. */
        if (clock > 0 && this.rt.setClock?.(core, clock) !== true) {
          this.setDebugError("NÚCLEO ANTIGUO: RECARGA LA PÁGINA");
          return false;
        }
      }
    }

    /* Solo se escribe la partida de la consola propia, y solo si ha cambiado. */
    guardaMiPartida() {
      if (!this.partidaDestino) return;
      const bytes = this.rt.sram?.(this.coreOf(mySeat));
      if (!bytes || !bytes.length) return;
      const suma = sumaRapida(bytes);
      if (suma === this.ultimaEscrita) return;
      this.ultimaEscrita = suma;
      const { namespace, nombre } = this.partidaDestino;
      Promise.resolve(window.ML3DLocalSave?.cableWriteSave?.(namespace, nombre, bytes))
        .catch((error) => console.error("ML3D Local Link (guardar partida):", error));
    }

    /** Suelta las partidas ajenas: no deben sobrevivir a la sesion. */
    olvidaPartidas() {
      for (let seat = 0; seat < this.saves.length; seat++) {
        const save = this.saves[seat];
        if (seat !== mySeat && save instanceof Uint8Array) save.fill(0);
        this.saves[seat] = undefined;
      }
      this.entrantes.clear();
    }

    slot(frame, seat) {
      return (frame % RING) * this.seats + seat;
    }

    setInput(frame, seat, mask) {
      if (!Number.isSafeInteger(frame) || frame < 0) return false;
      if (frame < this.frame || frame >= this.frame + RING) return false;
      this.inputs[this.slot(frame, seat)] = Number(mask) & 0x3ff;
      return true;
    }

    getInput(frame, seat) {
      return this.inputs[this.slot(frame, seat)];
    }

    publishReady() {
      sendLocal({
        type: "gba:lockstep:ready",
        playerNumber: mySeat,
        role,
        romHash: this.romHash,
        protocol: PROTOCOLO,
        consent: this.consent,
        declined: this.declined,
        go: role === "host" ? this.go : false,
        have: this.haveDigest(),
        preHave: this.preHave
      });
    }

    maybeHostStart() {
      /* El host arranca cuando todos los compañeros están listos. */
      if (role !== "host" || this.started) return;
      if (this.readySeats.size < this.seats - 1) return;
      if (!this.remoteHash || this.remoteHash !== this.romHash) {
        this.setDebugError("ROM DISTINTA");
        return;
      }
      /* Nadie empieza hasta que todos han aceptado y cada dispositivo tiene
         las mismas partidas que el host. */
      if (!selfTest) {
        if (!this.go) return;
        const mias = this.haveDigest();
        if (!mias) return;
        for (let seat = 1; seat < this.seats; seat++) {
          if (this.remotos.get(seat)?.have !== mias) return;
        }
      }
      const sessionId =
        (crypto.randomUUID?.() || (Date.now().toString(36) + "-" + Math.random().toString(36).slice(2)));
      /* Hora de partida del reloj del juego, la misma para todos. */
      const clock = Date.now();
      sendLocal({
        type: "gba:lockstep:start",
        sessionId,
        delay: INPUT_DELAY,
        romHash: this.romHash,
        clock
      });
      this.start(sessionId, INPUT_DELAY, clock);
    }

    acceptRemoteReady(packet) {
      if (packet.pre === true) return;   /* el otro aún está consiguiendo los juegos */
      const seat = Math.max(0, Math.min(3, Number(packet.playerNumber) | 0));
      if (packet.ready === false) this.readySeats.delete(seat);
      else if (seat !== mySeat) this.readySeats.add(seat);
      this.remoteHash = String(packet.romHash || "");

      if (!this.started && seat !== mySeat) {
        if (String(packet.protocol || "") !== PROTOCOLO) {
          this.setDebugError("VERSIÓN DISTINTA: RECARGAD LOS DOS LA PÁGINA");
          return;
        }
        if (packet.declined) {
          avisaSinSesion("El otro jugador no ha aceptado compartir su partida.");
          cancelaSesion();
          return;
        }
        this.remotos.set(seat, { consent: packet.consent === true, have: String(packet.have || "") });
        if (role !== "host" && seat === 0 && packet.go === true) this.go = true;
        this.revisaPartidas();
      }

      this.renderDebug();
      this.maybeHostStart();
    }

    start(sessionId, delay, clock = 0) {
      if (this.started) return;
      if (Number(delay) !== INPUT_DELAY) {
        this.setDebugError("DELAY INCOMPATIBLE");
        return;
      }
      this.sessionId = String(sessionId || "");
      if (!this.sessionId) return;
      this.started = true;
      clearInterval(this.readyTimer);
      this.readyTimer = null;
      document.getElementById("ml3d-link-consent")?.remove();
      if (this.cargaPartidas(Number(clock) || 0) === false) {
        this.started = false;
        return;
      }
      /* A partir de aqui la partida propia se guarda sola. Sin sitio donde
         guardarla (nucleo sin partidas), la sesion sigue sin guardar. */
      if (this.partida?.namespace) {
        this.partidaDestino = { namespace: this.partida.namespace, nombre: this.partida.nombre };
        this.saveTimer = setInterval(() => this.guardaMiPartida(), SAVE_WRITE_MS);
      }
      this.frame = 0;
      this.miHuella = new Map();    /* frame -> huella propia */
      this.suHuella = new Map();    /* frame -> { asiento: huella } */
      this.statsRemotas = {};       /* asiento -> cifras que manda el otro */
      this.desync = null;
      quitarDesync();
      mantenPantallaEncendida();
      this.arrancaRegistro();
      this.lastTickAt = performance.now();
      this.tickTimer = setInterval(() => this.tick(), 1000 / 60);
      this.renderDebug();
    }

    /* El cable ya no se monta a mano: lo lleva GBASIOLockstepCoordinator dentro
       del propio WASM. Aqui solo se pide asiento y se comprueba que el
       coordinador lo confirma. No se asume que el id del core sea el asiento:
       el coordinador reparte por preferencia y puede no coincidir. */
    attachCable() {
      try {
        window.ML3DLinkCable?.detachEmulator?.(this.visible);
      } catch {}
      document.getElementById("ml3d-link-debug")?.remove();

      for (let seat = 0; seat < this.seats; seat++) {
        const core = this.coreOf(seat);
        if (!this.rt.attachSeat(core, seat)) {
          this.setDebugError("NO SE PUDO ENGANCHAR EL ASIENTO " + seat);
          return false;
        }
      }
      if (this.rt.attachedCount() !== this.seats) {
        this.setDebugError(`CABLE ${this.rt.attachedCount()}/${this.seats}`);
        return false;
      }
      /* El asiento definitivo lo dice el coordinador, no nosotros. */
      for (let seat = 0; seat < this.seats; seat++) {
        this.confirmedSeat[seat] = this.rt.seatOf(this.coreOf(seat));
      }
      return true;
    }

    /** Core que atiende un asiento. Mapa explicito, nunca por indice implicito. */
    coreOf(seat) {
      return this.seatToCore[seat];
    }

    /**
     * Cambia quien se ve y se oye sin tocar la sesion.
     * Ningun core se reinicia ni se para: solo se mueve la ventana.
     */
    setVisibleSeat(seat) {
      if (seat < 0 || seat >= this.seats) return false;
      this.visible = this.coreOf(seat);
      this.rt.setVisible(this.visible);
      return true;
    }

    /**
     * Ajusta la sala a otro numero de jugadores creando o cerrando solo los
     * asientos que cambian. Devuelve false si no se puede hacer en caliente y
     * hay que reconstruir.
     *
     * Quitar asientos en una sesion ya arrancada cambiaria el reparto de input
     * a mitad de partida, asi que eso si obliga a reconstruir.
     */
    resize(nextSeats, nextMySeat) {
      if (nextSeats === this.seats) return this.setVisibleSeat(nextMySeat);
      if (this.started) return false;
      if (nextSeats < this.seats) return false;
      if (nextSeats > this.rt.maxSeats()) return false;

      for (let seat = this.seats; seat < nextSeats; seat++) {
        const core = this.rt.openSeat();
        if (core < 0) return false;
        this.seatToCore[seat] = core;
        if (!this.rt.attachSeat(core, seat)) return false;
      }

      this.seats = nextSeats;
      this.confirmedSeat = Array.from({ length: nextSeats },
        (_, seat) => this.rt.seatOf(this.coreOf(seat)));
      this.ran = Array.from({ length: nextSeats }, (_, seat) => this.ran[seat] || 0);
      this.lastApplied = Array.from({ length: nextSeats }, (_, seat) => this.lastApplied[seat] || 0);
      /* El anillo de input se indexa por numero de asientos, asi que hay que
         rehacerlo con el tamaño nuevo y volver a sembrar el retardo. */
      this.inputs = new Int16Array(RING * nextSeats).fill(UNKNOWN);
      for (let frame = this.frame; frame < this.frame + INPUT_DELAY; frame++) {
        for (let seat = 0; seat < nextSeats; seat++) this.setInput(frame, seat, 0);
      }
      this.sentFrames.clear();
      return this.setVisibleSeat(nextMySeat);
    }

    applyMask(seat, mask) {
      /* Una sola llamada por asiento: el shim toma la mascara entera, asi que
         ya no hace falta traducirla a keyDown/keyUp tecla por tecla. */
      mask &= 0x3ff;
      if (this.lastApplied[seat] === mask) return;
      this.lastApplied[seat] = mask;
      this.rt.setKeys(this.coreOf(seat), mask);
    }

    publishLocalInput() {
      const target = this.frame + INPUT_DELAY;
      if (this.sentFrames.has(target)) return;
      this.sentFrames.add(target);

      if (selfTest) {
        /* En autoprueba no hay nadie al otro lado que mande entrada, asi que el
           teclado fisico mueve TODAS las consolas a la vez. Es lo que permite
           llevarlas juntas al menu Link del juego desde una sola ventana; sin
           esto solo respondian a test.setSeatMask, que es para automatizar.
           El mando por asiento sigue funcionando y se suma. */
        for (let seat = 0; seat < this.seats; seat++) {
          this.setInput(target, seat, (selfTestMasks[seat] | localMask) & 0x3ff);
        }
      } else {
        this.setInput(target, mySeat, localMask);
        sendLocal({
          type: "gba:lockstep:input",
          sessionId: this.sessionId,
          playerNumber: mySeat,
          frame: target,
          mask: localMask
        });
      }

      const oldest = this.frame - 8;
      for (const frame of this.sentFrames) {
        if (frame < oldest) this.sentFrames.delete(frame);
      }
    }

    acceptRemoteInput(packet) {
      if (!this.started || String(packet.sessionId || "") !== this.sessionId) return;
      const seat = Number(packet.playerNumber) | 0;
      if (seat === mySeat || seat < 0 || seat >= this.seats) return;
      this.setInput(Number(packet.frame), seat, Number(packet.mask));
    }

    frameReady() {
      for (let seat = 0; seat < this.seats; seat++) {
        if (this.getInput(this.frame, seat) === UNKNOWN) return false;
      }
      return true;
    }

    /**
     * Un frame para todos los asientos, con el coordinador nativo repartiendo.
     *
     * Se le da tiempo al despierto que menos ha corrido EN ESTA vuelta, sin
     * atarlo al objetivo del frame: una consola que ya cumplio su frame todavia
     * tiene que poder correr para que el lockstep despierte a la que espera por
     * ella. Atarla bloquea a las dos.
     *
     * Se ordena por los ciclos que devuelve link_run y no por el reloj emulado,
     * porque mTiming es un int32 que mGBA reajusta y comparar valores absolutos
     * entre nucleos no es fiable.
     */
    runFrame() {
      for (let seat = 0; seat < this.seats; seat++) {
        this.applyMask(seat, this.getInput(this.frame, seat));
      }

      /* El objetivo es acumulativo, no relativo a esta llamada. Rehacer la
         base cada frame hacia que el sobrepaso de la ultima rodaja se sumara
         en vez de compensarse: el juego corria a 69 fps en vez de 59,7. */
      this.target += FRAME_CYCLES;
      let rounds = 0;
      const MAX_ROUNDS = 8192;

      while (rounds++ < MAX_ROUNDS) {
        if (this.ran.every((cycles) => cycles >= this.target)) break;

        let pick = -1;
        let least = Infinity;
        for (let seat = 0; seat < this.seats; seat++) {
          if (this.rt.isAsleep(this.coreOf(seat))) continue;
          if (this.ran[seat] < least) { least = this.ran[seat]; pick = seat; }
        }
        if (pick < 0) {
          /* Nadie despierto: el coordinador garantiza que no pasa, asi que si
             ocurre es un bloqueo real y hay que verlo, no taparlo. */
          this.wedged = true;
          this.setDebugError("TODAS LAS CONSOLAS DORMIDAS");
          return false;
        }
        /* Se pide solo lo que falta, para no sobrepasar mas de lo justo; si
           ya llego al objetivo se le da rodaja entera, porque puede tener que
           correr para despertar a otra. */
        const falta = this.target - this.ran[pick];
        const rodaja = falta > 0 ? Math.min(LINK_SLICE, falta) : LINK_SLICE;
        this.ran[pick] += this.rt.runCycles(this.coreOf(pick), rodaja);
      }

      if (rounds >= MAX_ROUNDS) {
        this.wedged = true;
        this.setDebugError("PLANIFICADOR SIN AVANCE");
        return false;
      }

      /* Transferencias: flanco de subida de la transferencia activa del
         coordinador. Antes lo contaba el cable a mano. */
      const coord = this.rt.coordinatorState();
      if (coord.transferActive && !this.prevTransferActive) this.transferCount += 1;
      this.prevTransferActive = coord.transferActive;

      /* Solo la consola de mySeat se pinta y suena; a las demas se les descarta
         el audio para que su cola no sature. */
      this.rt.present();

      this.frame += 1;

      /* El anillo reutiliza el hueco de hace RING frames. Sin vaciarlo, un
         input que todavia no ha llegado se lee como el de la vuelta anterior y
         frameReady() da por completo un frame que no lo esta: pasados RING
         frames el lockstep deja de esperar a nadie y las dos copias divergen
         en silencio. Se libera el hueco que se acaba de consumir. */
      const libre = this.frame + RING - 1;
      for (let seat = 0; seat < this.seats; seat++) {
        this.inputs[this.slot(libre, seat)] = UNKNOWN;
      }

      this.compruebaSincronia();
      return true;
    }

    /* ------------------------------------------------------- medicion */

    /**
     * Una muestra por segundo durante toda la partida.
     *
     * Va por reloj real y no por frame, para que una parada quede registrada
     * como tal en vez de desaparecer. Guarda por separado lo que es CPU (fps
     * de cada lado, cola de audio) y lo que es red (latencia, desfase de
     * frames, esperas por falta de input): confundirlos es lo que hace que
     * una prueba de dos dispositivos no sirva para nada.
     */
    arrancaRegistro() {
      clearInterval(this.registroTimer);
      this.muestras = [];
      this.registroDesde = Date.now();
      this.ultimaRed = null;
      this.frameAnterior = 0;
      this.stallsAnteriores = 0;
      this.holdsAnteriores = 0;

      this.ultimaMuestraAt = performance.now();

      this.registroTimer = setInterval(() => {
        /* La latencia se pide sin esperar: llega para la muestra siguiente. */
        Promise.resolve(window.ML3DLinkNet?.medida?.())
          .then((red) => { if (red) this.ultimaRed = red; })
          .catch(() => {});

        const otro = Object.values(this.statsRemotas)[0] || null;
        const fresco = otro && (Date.now() - otro.at) < 4000;
        /* El intervalo no dispara exactamente cada segundo, y con el navegador
           ocupado se va bastante. Dividir por el tiempo real evita que los fps
           del panel mientan justo cuando mas importa. */
        const ahora = performance.now();
        const seg = Math.max(0.2, (ahora - this.ultimaMuestraAt) / 1000);
        this.ultimaMuestraAt = ahora;
        this.fpsMedidos = Math.round(((this.frame - this.frameAnterior) / seg) * 10) / 10;
        this.muestras.push({
          s: Math.round((Date.now() - this.registroDesde) / 1000),
          frame: this.frame,
          fps: Math.round(((this.frame - this.frameAnterior) / seg) * 10) / 10,
          stalls: this.stallCount - this.stallsAnteriores,
          holds: (this.audioHolds || 0) - this.holdsAnteriores,
          audioMs: Math.round(this.rt.audioBacklogMs()),
          rttMs: this.ultimaRed?.rttMs ?? null,
          otroFps: fresco ? otro.fps : null,
          otroAudioMs: fresco ? otro.audioMs : null,
          otroFrame: fresco ? otro.frame : null,
          desfase: fresco ? this.frame - otro.frame : null,
          desync: Boolean(this.desync)
        });
        this.frameAnterior = this.frame;
        this.stallsAnteriores = this.stallCount;
        this.holdsAnteriores = this.audioHolds || 0;

        /* Dos horas de muestras bastan de sobra; mas seria fuga de memoria. */
        if (this.muestras.length > 7200) this.muestras.shift();
      }, 1000);
    }

    /** Resumen de lo registrado, con CPU y red separadas. */
    resumen() {
      const m = this.muestras || [];
      if (!m.length) return null;
      const num = (lista) => lista.filter((v) => typeof v === "number" && Number.isFinite(v));
      const stat = (lista) => {
        const v = num(lista).sort((a, b) => a - b);
        if (!v.length) return null;
        return {
          min: v[0],
          p50: v[Math.floor(v.length * 0.5)],
          p95: v[Math.floor(v.length * 0.95)],
          max: v[v.length - 1],
          media: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10
        };
      };
      /* El primer par de muestras coge el arranque y no dice nada del regimen. */
      const util = m.slice(2);
      return {
        duracionSegundos: m.length,
        cpu: {
          fpsAqui: stat(util.map((x) => x.fps)),
          fpsAlli: stat(util.map((x) => x.otroFps)),
          audioMsAqui: stat(util.map((x) => x.audioMs)),
          audioMsAlli: stat(util.map((x) => x.otroAudioMs)),
          frenosAudio: util.reduce((a, x) => a + x.holds, 0)
        },
        red: {
          rttMs: stat(util.map((x) => x.rttMs)),
          desfaseFrames: stat(util.map((x) => x.desfase)),
          esperasPorInput: util.reduce((a, x) => a + x.stalls, 0),
          segundosSinNoticias: util.filter((x) => x.otroFps === null).length
        },
        divergencia: {
          hubo: util.some((x) => x.desync),
          primerSegundo: util.findIndex((x) => x.desync)
        },
        peoresSegundos: util.slice().sort((a, b) => a.fps - b.fps).slice(0, 5)
      };
    }

    /* ------------------------------------------------- desincronizacion */

    /**
     * Cada SYNC_EVERY frames se publica la huella del estado de todas las
     * consolas y se compara con la de los demas navegadores.
     *
     * Vale con comparar de vez en cuando: una divergencia no se arregla sola,
     * asi que si esta ahi seguira estando en la siguiente ronda. Hacerlo cada
     * frame costaria un savestate por consola y por frame para no enterarse
     * antes de nada util.
     */
    compruebaSincronia() {
      /* En autoprueba no hay nadie al otro lado con quien comparar. */
      if (selfTest || this.desync) return;
      if (this.frame % SYNC_EVERY !== 0) return;

      const huella = this.rt.allStateHash();
      this.miHuella.set(this.frame, huella);
      sendLocal({
        type: "gba:lockstep:sync",
        sessionId: this.sessionId,
        playerNumber: mySeat,
        frame: this.frame,
        hash: huella,
        /* Las cifras del que envia viajan con la huella, que ya va cada
           segundo. Es la unica forma de ver desde el PC como le va al movil
           sin tener que mirarle la pantalla. */
        stats: {
          /* Los fotogramas que avanza esta partida por segundo real. El contador
             del núcleo (rt.status().fps) no cuenta con el cable: daba siempre 0. */
          fps: this.fpsMedidos ?? 0,
          stalls: this.stallCount,
          holds: this.audioHolds || 0,
          audioMs: Math.round(this.rt.audioBacklogMs())
        }
      });
      this.comparaHuellas(this.frame);

      /* Las huellas viejas ya no sirven: el que iba retrasado o las mando o
         no las va a mandar. */
      const viejo = this.frame - SYNC_EVERY * 8;
      for (const frame of this.miHuella.keys()) if (frame < viejo) this.miHuella.delete(frame);
      for (const frame of this.suHuella.keys()) if (frame < viejo) this.suHuella.delete(frame);
    }

    acceptRemoteSync(packet) {
      if (!this.started || String(packet.sessionId || "") !== this.sessionId) return;
      const asiento = Number(packet.playerNumber) | 0;
      if (asiento === mySeat || asiento < 0 || asiento > 3) return;
      const frame = Number(packet.frame);
      if (!Number.isSafeInteger(frame) || frame < 0) return;
      if (!this.suHuella.has(frame)) this.suHuella.set(frame, {});
      this.suHuella.get(frame)[asiento] = Number(packet.hash) >>> 0;
      if (packet.stats) {
        this.statsRemotas[asiento] = { ...packet.stats, frame, at: Date.now() };
      }
      this.comparaHuellas(frame);
    }

    /* Solo compara lo que ya tiene de los dos lados: al que aun no ha llegado
       a ese frame no se le da por divergente. */
    comparaHuellas(frame) {
      if (this.desync) return;
      const mia = this.miHuella.get(frame);
      const suyas = this.suHuella.get(frame);
      if (mia === undefined || !suyas) return;
      for (const asiento of Object.keys(suyas)) {
        if (suyas[asiento] === mia) continue;
        const hx = (v) => (v >>> 0).toString(16).padStart(8, "0");
        this.desync = {
          frame,
          seat: Number(asiento),
          mine: mia >>> 0,
          theirs: suyas[asiento] >>> 0
        };
        mostrarDesync(
          "frame " + frame + " · P" + mySeat + " " + hx(mia) +
          " ≠ P" + asiento + " " + hx(suyas[asiento])
        );
        this.renderDebug();
        return;
      }
    }

    tick() {
      if (!this.started || this.wedged) {
        this.renderDebug();
        return;
      }

      this.publishLocalInput();

      /* El temporizador dispara a ~62,5 Hz y el GBA va a 59,7275, asi que sin
         frenar se corre un 4,6% y el audio se descarta sin parar. Cuando hay
         audio sonando, manda su cola: si va sobrada, esta vuelta no avanza.
         No cuenta como stall, que es otra cosa: ahi no se pudo avanzar. */
      const backlog = this.rt.audioBacklogMs();
      if (backlog > AUDIO_TARGET_MS) {
        this.audioHolds = (this.audioHolds || 0) + 1;
        this.renderDebug();
        return;
      }

      let ran = 0;
      if (this.frameReady()) {
        if (this.runFrame()) {
          ran = 1;
          this.publishLocalInput();
        }
      }

      if (!ran) this.stallCount += 1;
      this.renderDebug();
    }

    buildDebug() {
      const old = document.getElementById("ml3d-local-link-debug");
      if (old) old.remove();
      const el = document.createElement("div");
      el.id = "ml3d-local-link-debug";
      el.style.cssText =
        "position:fixed;right:6px;bottom:6px;z-index:2147483647;" +
        "padding:6px 8px;background:rgba(0,0,0,.86);color:#fff;" +
        "font:10px/1.3 monospace;border:1px solid rgba(255,255,255,.3);" +
        "border-radius:6px;pointer-events:none;white-space:pre";
      document.documentElement.appendChild(el);
      this.debug = el;
      this.renderDebug();
    }

    setDebugError(message) {
      if (!this.debug) this.buildDebug();
      this.debug.textContent = "LOCAL LINK ERROR\n" + message;
    }

    renderDebug() {
      if (!this.debug) return;
      /* Mismo formato de siempre; los registros vienen ahora del shim en vez
         de leerse de los objetos serial de IodineGBA. */
      const a = this.rt.coreState(this.coreOf(0));
      const b = this.seats > 1 ? this.rt.coreState(this.coreOf(1)) : null;
      const coord = this.rt.coordinatorState();
      const current0 = this.getInput(this.frame, 0);
      const current1 = this.getInput(this.frame, 1);
      const hx = (value) => (Number(value) & 0xff).toString(16).padStart(2, "0");
      const busy = (s) => (s && (s.siocnt & 0x80)) ? 1 : 0;
      const delta = Math.round((this.ran[0] || 0) - (this.ran[1] || 0));
      const ink = (v) => v === UNKNOWN ? "-" : v.toString(16);
      const lines = [
        `LOCAL LINK ${role === "host" ? "H" : "G"} P${mySeat} ${this.started ? "RUN" : "SYNC"}`,
      ];
      if (!this.started) {
        const rom = this.remoteHash ? (this.remoteHash === this.romHash ? "OK" : "DIFF") : "...";
        lines.push(`ESPERANDO PEERS:${this.readySeats.size}/${this.seats - 1} ROM:${rom}`);
      }
      lines.push(`F:${this.frame} IN:${ink(current0)}/${ink(current1)} D:${INPUT_DELAY}`);

      /* Linea para leer a simple vista durante una prueba, sin consola y sin
         cronometro: fps de aqui, fps del otro y latencia real de la red. */
      const otro = Object.values(this.statsRemotas || {})[0];
      const otroVivo = otro && (Date.now() - otro.at) < 4000;
      const rtt = this.ultimaRed?.rttMs;
      /* audioBacklogMs da -1 cuando todavia no suena nada: mostrar "-1ms"
         parece una medida rara en vez de lo que es, que no hay audio. */
      const aud = Math.round(this.rt.audioBacklogMs());
      const estadoAudio = this.rt.audioState?.() || "?";
      lines.push(
        `FPS:${this.fpsMedidos ?? "-"}` +
        ` OTRO:${otroVivo ? otro.fps : "-"}` +
        ` RED:${rtt === null || rtt === undefined ? "-" : rtt + "ms"}` +
        ` AUD:${aud >= 0 ? aud + "ms" : estadoAudio}`
      );
      lines.push(`M:${a?.mode ?? "-"}/${b?.mode ?? "-"} BUSY:${busy(a)}/${busy(b)}` +
        ` S:${hx(a?.siocnt)}/${hx(b?.siocnt)} R:${hx(a?.rcnt)}/${hx(b?.rcnt)}`);
      lines.push(`XFER:${this.transferCount} SEATS:${this.confirmedSeat.join("/")}` +
        ` ACT:${coord.transferActive} D:${delta}` +
        ` T:${Math.round(FRAME_CYCLES - ((this.ran[0] || 0) % FRAME_CYCLES))} STALL:${this.stallCount}`);
      if (this.lastLinkError) {
        lines.push("ADAPTER ERROR: " + this.lastLinkError.split("\n")[0]);
      }
      if (this.wedged) lines.push("WEDGED");
      this.debug.textContent = lines.join("\n");
    }

    status() {
      /* Se conserva la forma del contrato y todo lo que el lobby y la linea
         base miran. Lo que desaparece son los volcados internos de IodineGBA
         —registros de CPU, trazas de SIOCNT/RCNT— que solo existian porque el
         cable estaba hecho a mano; mGBA no los expone y ya no hacen falta.
         Los campos se mantienen a null en vez de quitarse, para no romper a
         quien los lea. */
      const coord = this.rt.coordinatorState();
      return {
        roomId,
        mySeat,
        role,
        started: this.started,
        sessionId: this.sessionId,
        frame: this.frame,
        transfers: this.transferCount,
        seats: this.seats,
        readySeats: [...this.readySeats],
        remoteReady: this.readySeats.size >= this.seats - 1,
        romHash: this.romHash,
        remoteHash: this.remoteHash,
        wedged: this.wedged,
        stalls: this.stallCount,
        /* Partidas: solo estado, nunca contenido. */
        partidas: {
          acepto: this.consent,
          todosAceptan: this.go,
          enviada: this.sentSave,
          tengo: this.haveDigest(),
          desync: this.desync ? true : false
        },
        /* Diagnostico del ritmo: un tick que no avanza o es un stall (falta
           input de alguien) o es un freno de audio (la cola va sobrada).
           Distinguirlos es lo unico que dice quien manda cuando el juego se
           arrastra. */
        audioHolds: this.audioHolds || 0,
        audioBacklogMs: Math.round(this.rt.audioBacklogMs()),
        faltaInput: Array.from({ length: this.seats },
          (_, seat) => this.getInput(this.frame, seat) === UNKNOWN),
        transferCycles: requestedTransferCycles || null,
        progressiveTransfer,
        cable: {
          attached: coord.attached,
          transferActive: Boolean(coord.transferActive),
          transferMode: coord.transferMode,
          multiData: coord.multiData.slice(),
          waiting: coord.waiting,
          confirmedSeats: this.confirmedSeat.slice()
        },
        coreExecution: Array.from({ length: this.seats }, (_, seat) => {
          const core = this.coreOf(seat);
          const st = this.rt.coreState(core);
          return {
            seat,
            core,
            visible: core === this.visible,
            frames: st?.frames ?? null,
            cycles: this.ran[seat] | 0,
            asleep: st?.asleep ?? null,
            confirmedSeat: this.confirmedSeat[seat],
            sioMode: st?.mode ?? null,
            siocnt: st?.siocnt ?? null,
            rcnt: st?.rcnt ?? null,
            siomulti: st?.multi ?? null,
            siomltSend: st?.send ?? null,
            /* Solo IodineGBA los exponia; se dejan declarados para no romper
               a quien los lea, pero ya no hay de donde sacarlos. */
            pc: null, sp: null, lr: null, modeFlags: null, thumb: null,
            systemStatus: null, halted: null, stopped: null, irq: null
          };
        })
      };
    }

    destroy() {
      this.destroyed = true;
      clearInterval(this.readyTimer);
      clearInterval(this.tickTimer);
      clearInterval(this.registroTimer);
      clearInterval(this.saveTimer);
      clearInterval(this.consentTimer);
      this.saveTimer = null;
      this.consentTimer = null;
      document.getElementById("ml3d-link-consent")?.remove();
      /* Lo ultimo jugado, antes de cerrar las consolas. */
      if (this.started) {
        try { this.guardaMiPartida(); } catch {}
      }
      this.olvidaPartidas();
      this.readyTimer = null;
      this.tickTimer = null;
      this.registroTimer = null;
      /* Soltar el cable y cerrar los cores; el runtime normal queda usable. */
      try { this.rt.detachAll(); } catch {}
      try { this.rt.destroy(); } catch {}
      this.debug?.remove();
      quitarDesync();
      dejaApagarPantalla();
      this.started = false;
    }
  }

  /* Ruta del WASM multi-instancia. Es el fork propio, no el paquete publicado:
     el cable exige que las cuatro consolas vivan en el mismo modulo. */
  const MGBA_DIR = "link-mgba/dist/multi/";

  /* iPhone y iPad quedan fuera de momento.
     app.js ya deja el juego normal en el nucleo antiguo en iOS, porque mGBA se
     atasca al poco de arrancar bajo WebKit. El Cable Link usa nuestro propio
     mGBA, que esta compilado de otra forma y quiza no sufra lo mismo, pero eso
     no se ha probado en un iPhone. Mejor decirlo que dejar a alguien con la
     partida colgada. Quitar esta guarda en cuanto se pruebe. */
  function esIOS() {
    const ua = navigator.userAgent || "";
    const macTactil = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    return /iPad|iPhone|iPod/i.test(ua) || macTactil;
  }

  function avisaLinkNoDisponible() {
    if (document.getElementById("ml3d-link-sin-ios")) return;
    const el = document.createElement("div");
    el.id = "ml3d-link-sin-ios";
    el.style.cssText =
      "position:fixed;inset:0;z-index:2147483646;display:flex;" +
      "flex-direction:column;align-items:center;justify-content:center;gap:12px;" +
      "background:rgba(20,20,28,.92);color:#fff;text-align:center;padding:24px;" +
      "font:bold 18px/1.4 system-ui,sans-serif;text-shadow:0 1px 2px #000";
    const t = document.createElement("div");
    t.style.cssText = "font-size:22px;letter-spacing:.03em";
    t.textContent = "CABLE LINK NO DISPONIBLE AQUI";
    const c = document.createElement("div");
    c.style.cssText = "font-weight:normal;max-width:34ch";
    c.textContent =
      "El Cable Link todavia no funciona en iPhone ni iPad. El resto del " +
      "emulador si: puedes jugar de un jugador con normalidad.";
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "ENTENDIDO";
    b.style.cssText =
      "margin-top:6px;padding:10px 22px;font:bold 15px system-ui,sans-serif;" +
      "background:#3b6fd4;color:#fff;border:0;border-radius:8px;cursor:pointer";
    b.addEventListener("click", () => el.remove());
    el.append(t, c, b);
    document.documentElement.appendChild(el);
    setTimeout(() => el.remove(), 15000);
  }

  async function bootLocalDual() {
    if (returningToNormal) return;
    if (!roomId && !selfTest) return;
    if (esIOS()) {
      console.warn("ML3D Local Link: desactivado en iOS hasta poder probarlo.");
      avisaLinkNoDisponible();
      roomId = "";
      enabled = false;
      return;
    }
    const runtime = window.ML3DLinkRuntime;
    const rom = runtime?.romBytes;
    if (!rom || !rom.byteLength) return;
    if (typeof window.ML3DMgbaLink !== "function") {
      console.error("ML3D Local Link: falta el runtime mGBA multi-instancia.");
      return;
    }

    /* La partida de este jugador, antes de soltar el nucleo normal: se lee de
       donde el juego la guarda y se saca una copia por si la sesion sale mal. */
    let partida = null;
    if (!selfTest) {
      try {
        const compat = window.ML3DMgbaCompat;
        const namespace = compat?.isActive?.() ? compat.getNamespace() : "";
        const nombre = namespace ? compat.getDisplayName() : "";
        if (namespace && window.ML3DLocalSave?.cableReadSave) {
          await compat.flushSave?.();
          await new Promise((resolve) => setTimeout(resolve, 120));
          const bytes = await window.ML3DLocalSave.cableReadSave(namespace, nombre);
          if (bytes?.length) await window.ML3DLocalSave.cableBackup?.(nombre, bytes);
          partida = {
            namespace,
            nombre,
            bytes: bytes?.length ? bytes : null,
            hash: bytes?.length ? await fingerprint(bytes) : "-"
          };
        }
      } catch (error) {
        console.error("ML3D Local Link (leer partida):", error);
      }
    }

    /* El camino normal suelta la pantalla: durante la partida Link la conduce
       el runtime multi-instancia, que es quien tiene las cuatro consolas. */
    runtime.stopTimers?.();
    try { await window.ML3DMgbaCompat?.stop?.(); } catch {}
    try { window.ML3DLinkCable?.detachEmulator?.(runtime.emulator); } catch {}

    const hash = await fingerprint(rom);
    controller?.destroy?.();
    controller = null;
    prelude?.destroy();
    prelude = null;

    if (!selfTest && plan().mixed && seatCount === 2) {
      /* De dónde viene el juego de este jugador decide si se puede compartir. */
      let origen = runtime.romSource === "local" ? "local" : "remote";
      try {
        const completa = await window.ML3DRecibidas?.huella(rom);
        if (origen === "local" && completa && window.ML3DRecibidas.esRecibida(completa)) origen = "recibida";
      } catch {}
      const mia = { bytes: rom, hash, nombre: String(runtime.romFilename || "").split("/").pop(), origen };
      const sala = roomId;
      prelude = new Preludio(mia, partida, async (roms, combinado, tengo) => {
        if (roomId !== sala) return;
        prelude = null;
        const rtMixto = await window.ML3DMgbaLink.create({
          wasmDir: MGBA_DIR,
          roms,
          seats: 2,
          canvas: document.getElementById("screen"),
          link: false
        });
        /* El cartucho ajeno ya está copiado dentro del núcleo: aquí se borra. */
        roms[1 - mySeat].fill(0);
        await rtMixto.startAudio();
        if (roomId !== sala) { try { rtMixto.destroy(); } catch {} return; }
        controller = new LocalDualLink(rtMixto, combinado, partida, { consentido: true, preHave: tengo });
      });
      pendingStart = null;
      return;
    }

    const rt = await window.ML3DMgbaLink.create({
      wasmDir: MGBA_DIR,
      rom,
      seats: seatCount,
      canvas: document.getElementById("screen"),
      link: false                      /* el enganche lo hace attachCable, por asiento */
    });
    await rt.startAudio();

    controller = new LocalDualLink(rt, hash, partida);

    /* Un arranque que llego antes de montar la sesion se descarta: ahora nadie
       empieza sin el intercambio de partidas, y el host lo repite al estar
       todos listos. */
    pendingStart = null;
  }

  /* Configuración en caliente desde el lobby integrado. La sesión Link exige
     que los dos núcleos de cada jugador arranquen desde la ROM limpia, así que
     al entrar en una sala se reinicia la ROM actual sin partida guardada; el
     evento ml3d-rom-started encadena después con bootLocalDual(). */
  let configuring = false;
  let configuredKey = roomId ? `${roomId}:${mySeat}:${role}` : "";

  let configuredGame = "";
  let lastConfigure = null;

  /* El jugador cambia de juego o la sala cambia de modo antes de empezar: la
     sesión se rehace con lo nuevo. Con la partida en marcha no se toca. */
  window.addEventListener("ml3d-link-plan", () => {
    if (!lastConfigure || !roomId || controller?.started) return;
    if (String(lastConfigure.roomId || "") !== roomId) return;
    configuredKey = "";
    configureSession(lastConfigure);
  });

  function configureSession(packet) {
    const nextRoom = String(packet.roomId || "");
    if (!nextRoom || configuring) return;
    const nextSeat = Math.max(0, Math.min(3, Number(packet.playerNumber) | 0));
    const nextRole = packet.role === "host" ? "host" : "guest";
    const nextSeats = Math.max(2, Math.min(4, Number(packet.players) | 0 || 2));
    lastConfigure = packet;
    /* Con juegos distintos, cada jugador abre el que ha elegido él, no el de
       la sala. */
    const mixto = plan().mixed && nextSeats === 2 && Boolean(plan().mine);
    const nextGame = mixto ? String(plan().mine) : String(packet.game || "");
    const key = `${nextRoom}:${nextSeat}:${nextRole}:${nextSeats}:${nextGame}:${mixto ? "mixto" : ""}`;
    if (key === configuredKey) return;

    /* Qué ha cambiado decide cuánto se rehace. Reconstruir la sesión entera por
       un cambio de asiento tiraría una partida en marcha sin necesidad. */
    const sameRoom = roomId === nextRoom && Boolean(controller);
    const gameChanged = nextGame !== configuredGame;
    const seatsChanged = nextSeats !== seatCount;
    const mySeatChanged = nextSeat !== mySeat;

    configuredKey = key;
    configuredGame = nextGame;
    roomId = nextRoom;
    role = nextRole;
    enabled = true;

    /* Caso 1: solo cambia quién soy. La sesión sigue viva y solo se mueve la
       consola que se ve y se oye. */
    if (sameRoom && !gameChanged && !seatsChanged && mySeatChanged) {
      mySeat = nextSeat;
      controller.setVisibleSeat(mySeat);
      controller.renderDebug();
      return;
    }

    /* Caso 2: cambia el número de jugadores sin cambiar de juego. Se ajustan
       solo los asientos que sobran o faltan. */
    if (sameRoom && !gameChanged && seatsChanged) {
      mySeat = nextSeat;
      seatCount = nextSeats;
      if (controller.resize(nextSeats, mySeat)) {
        controller.renderDebug();
        return;
      }
      /* Si no se pudo ajustar, se cae al camino completo de abajo. */
    }

    /* Caso 3: juego distinto, sala distinta o ajuste imposible. Se reconstruye
       limpiamente con la ROM que pida la sala. */
    mySeat = nextSeat;
    seatCount = nextSeats;
    controller?.destroy?.();
    controller = null;
    prelude?.destroy();
    prelude = null;
    pendingStart = null;

    const runtime = window.ML3DLinkRuntime;
    configuring = true;
    const prepare = runtime?.prepareForLink
      ? runtime.prepareForLink(nextGame)
      : runtime?.restartForLink?.();
    Promise.resolve(prepare)
      .catch((error) => console.error("ML3D Local Link (reinicio):", error))
      .finally(() => { configuring = false; });
  }

  /* La sesion no llega a empezar (alguien no acepta): se suelta y se vuelve al
     juego normal, igual que al desconectar. */
  function cancelaSesion() {
    if (!controller && !prelude) return;
    /* El lobby tiene que enterarse: si esto era un combate, sin este aviso la
       sala lo seguía dando por «en combate» hasta que alguien lo cerraba a mano. */
    sendLocal({ type: "gba:link:cancelled" });
    disconnectSession({});
    configuredKey = "";
  }

  function disconnectSession(packet) {
    if (packet.roomId && packet.roomId !== roomId) return;
    controller?.destroy?.();
    controller = null;
    prelude?.destroy();
    prelude = null;
    pendingStart = null;
    roomId = "";
    configuredKey = "";
    enabled = selfTest;
    /* destroy() ya soltó el cable, cerró los cores y paró el planificador. Falta
       devolver la pantalla al núcleo normal, que el runtime multi-instancia se
       había quedado durante la partida. */
    try { window.ML3DLinkRuntime?.startTimers?.(); } catch {}
    returningToNormal = true;
    Promise.resolve(window.ML3DLinkRuntime?.resumeNormal?.())
      .catch((error) => console.error("ML3D Local Link (volver al juego):", error))
      .finally(() => { returningToNormal = false; });
  }

  bus.addEventListener("message", (event) => {
    const packet = event.data;
    if (!packet || packet.source !== "lobby") return;

    if (packet.type === "gba:link:configure") {
      configureSession(packet);
      return;
    }
    if (packet.type === "gba:link:disconnect") {
      disconnectSession(packet);
      return;
    }

    /* El cable se ha caido: avisar y soltar la partida. Sin esto la sesion se
       quedaba viva esperando input que ya no iba a llegar, con la pantalla
       congelada y sin decir nada. */
    if (packet.type === "gba:link:peer-lost") {
      if (packet.roomId && packet.roomId !== roomId) return;
      if (!controller && !prelude) return;
      mostrarCaida(String(packet.motivo || ""));
      disconnectSession(packet);
      return;
    }
    if (packet.roomId !== roomId) return;

    if (packet.type === "gba:lockstep:remote-ready") {
      if (prelude) prelude.acceptReady(packet);
      else controller?.acceptRemoteReady(packet);
      return;
    }

    if (packet.type === "gba:lockstep:start") {
      if (String(packet.romHash || "") && controller && packet.romHash !== controller.romHash) {
        controller.setDebugError("ROM DISTINTA");
        return;
      }
      if (!controller) pendingStart = packet;
      else controller.start(String(packet.sessionId || ""), Number(packet.delay), Number(packet.clock) || 0);
      return;
    }

    if (packet.type === "gba:lockstep:remote-save") {
      if (/^rom-/.test(String(packet.kind || ""))) prelude?.acceptRom(packet);
      else controller?.acceptRemoteSave(packet);
      return;
    }

    if (packet.type === "gba:lockstep:remote-input") {
      controller?.acceptRemoteInput(packet);
      return;
    }

    if (packet.type === "gba:lockstep:remote-sync") {
      controller?.acceptRemoteSync(packet);
      return;
    }

    if (packet.type === "gba:lockstep:stop") {
      controller?.destroy?.();
      controller = null;
    }
  });

  window.addEventListener("ml3d-rom-started", (event) => {
    if (event.detail?.system !== "gba") return;
    bootLocalDual().catch((error) => {
      console.error("ML3D Local Link:", error);
      controller?.setDebugError?.(String(error?.message || error));
    });
  });

  window.addEventListener("pagehide", () => {
    controller?.destroy?.();
    try { bus.close(); } catch {}
  });
})();
