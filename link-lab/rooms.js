(() => {
  "use strict";

  /* El worker solo admite el origen del sitio publicado, así que desde
     cualquier otro se pasa por su proxy /api: mismo origen, sin CORS.
     No vale mirar si el host es "localhost": con un túnel (para probar desde
     el móvil) el host es el del túnel y el worker rechazaría la petición. */
  const SITIO_PUBLICADO = "https://makinglayers3d-a11y.github.io";
  const DEFAULT_API_BASE = location.origin === SITIO_PUBLICADO
    ? "https://ml3d-link-lab.makinglayers3d.workers.dev"
    : `${location.origin}/api`;
  /* Ninguna conexión es directa: todas pasan por un relevo, para que ningún
     jugador vea la IP de otro. Sin relevo no se conecta; nunca se cae a una
     conexión directa. */
  const SIN_RELEVO = "No se puede conectar: el servicio de conexión no responde.";
  /* Las credenciales duran 6 horas y el relevo corta la conexión poco después
     de que caduquen. Se renuevan pasados 5/6 de su vida: a las 5 horas. */
  const RELEVO_RENUEVA = 5 / 6;
  const RELEVO_REINTENTA_MS = 30000;
  /* Tope de jugadores en una sala online.
     El cable admite 4 y en local se usan 4, pero por red solo se ha probado
     con 2: con 3 o 4 el anfitrion hace de centralita y cada tecla da un salto
     de mas, y eso no esta medido. Subir a 3 o 4 cuando se pruebe. */
  /* La sala admite hasta 4 personas por red. El cable no: en una sala de 3 o 4
     une solo a los dos que aceptan un desafío (ver "combates"). */
  const MAX_JUGADORES_ONLINE = 4;
  const PROFILE_KEY = "ml3d-link-profile-v1";
  const API_KEY = "ml3d-link-api";
  const MOVE_INTERVAL_MS = 55;
  const QUALITY_INTERVAL_MS = 2000;
  const CHAT_LIFETIME_MS = 5200;
  const PALETTE = {
    orange: "#f28c43",
    blue: "#4d9be6",
    mint: "#55c99a",
    pink: "#e76fa0",
    yellow: "#e1b94f",
    purple: "#9575d6"
  };
  const BODIES = ["round", "square", "bean"];
  const FACES = ["happy", "flat", "wow"];
  const ACCESSORIES = ["none", "cap", "antenna", "bow"];
  const $ = (s) => document.querySelector(s);

  const statusText = $("#statusText");
  const errorBox = $("#errorBox");
  const logEl = $("#log");
  const sendButton = $("#send");
  const pingButton = $("#ping");
  const lobbyShell = $("#lobbyShell");
  const playersLayer = $("#playersLayer");
  const diagnosticsCard = $("#diagnosticsCard");

  let selectedRoom = null;
  let hostSession = null;
  let duelo = null;   /* el combate de este jugador, si está en uno (ver "combates") */
  let joinSession = null;
  let profile = loadProfile();
  let localPlayerId = null;
  let players = new Map();
  let moveTimer = null;
  let lastMoveSentAt = 0;
  const heldMoves = new Set();
  const chatTimers = new Map();
  const GBA_LINK_LOCAL_CHANNEL = "ml3d-gba-link-v1";
  const GBA_LINK_STORAGE_KEY = "ml3d-gba-link-session-v1";
  const gbaLinkBus = typeof BroadcastChannel === "function"
    ? new BroadcastChannel(GBA_LINK_LOCAL_CHANNEL)
    : null;
  let gbaLinkPending = null;
  let gbaLinkSequence = 0;
  let localGbaReady = false;

  function log(message) {
    const t = new Date().toLocaleTimeString();
    logEl.textContent += `[${t}] ${message}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setState(state, text) {
    document.body.dataset.state = state;
    statusText.textContent = text;
    if (state !== "error") {
      errorBox.hidden = true;
      errorBox.textContent = "";
    }
  }

  function fail(error, title = "Error") {
    const message = error?.message || String(error);
    setState("error", title);
    errorBox.hidden = false;
    errorBox.textContent = message;
    log(`ERROR: ${message}`);
  }

  function apiBase() {
    return $("#apiBase").value.trim().replace(/\/+$/, "");
  }

  async function api(path, { method = "GET", body, token } = {}) {
    const base = apiBase();
    if (!base) throw new Error("Configura primero la URL de la API ML3D Link.");
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    let res;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store"
      });
    } catch (error) {
      /* "Failed to fetch" a secas no dice nada: casi siempre es el servidor
         caído o un origen que la API no admite. */
      throw new Error(`No se pudo contactar con ${base} (${error.message}).`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  /* ---------------------------------------------------------------- salas

     Tipos de sala, pausa, vuelta al mismo hueco, inactividad, bloqueos y
     confirmación de jugadores. Todo esto vale en el lobby. Con una partida de
     cable en marcha no se toca nada: ahí manda la sesión. */

  const DEVICE_KEY = "ml3d-link-device-v1";
  const BLOCK_KEY = "ml3d-link-bloqueados-v1";
  const RESERVA_KEY = "ml3d-link-reserva-v1";
  const RESERVA_MS = 20000;
  let cuentaAtras = false;

  /* Con el cable ya jugando, el lobby no pausa, no reserva y no expulsa. */
  function cableEnMarcha() {
    if (cuentaAtras) return true;
    try { return Boolean(window.parent?.ML3DLocalLinkSession?.active); } catch { return false; }
  }

  function aleatorio(bytes = 18) {
    const data = crypto.getRandomValues(new Uint8Array(bytes));
    let binary = "";
    for (const byte of data) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  /* Identificador de este navegador, para que un anfitrión pueda bloquearlo
     aunque cambie de nombre. Es aleatorio y no dice nada de quién es. Se
     pierde al borrar los datos del sitio o en una ventana de incógnito. */
  function deviceId() {
    let id = "";
    try { id = localStorage.getItem(DEVICE_KEY) || ""; } catch {}
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      id = aleatorio(18);
      try { localStorage.setItem(DEVICE_KEY, id); } catch {}
    }
    return id;
  }

  /* Un tester presenta además su pase: el servidor lo reconoce por él y el
     bloqueo ya no depende del navegador. */
  function testerPass() {
    try { return String(window.parent?.ML3DContenido?.paseParaSalas?.() || ""); } catch { return ""; }
  }

  function bloqueados() {
    try {
      const lista = JSON.parse(localStorage.getItem(BLOCK_KEY) || "[]");
      return Array.isArray(lista) ? lista.filter((item) => item && item.device) : [];
    } catch {
      return [];
    }
  }

  function guardaBloqueados(lista) {
    try { localStorage.setItem(BLOCK_KEY, JSON.stringify(lista.slice(-200))); } catch {}
    renderBlocked();
  }

  function leeReserva() {
    try { return JSON.parse(localStorage.getItem(RESERVA_KEY) || "null"); } catch { return null; }
  }

  function guardaReserva() {
    if (!joinSession?.reserva) return;
    try {
      localStorage.setItem(RESERVA_KEY, JSON.stringify({
        roomId: joinSession.room.id,
        roomName: nombreSala(joinSession.room),
        game: joinSession.room.game || "",
        token: joinSession.reserva,
        name: profile.name,
        visto: Date.now()
      }));
    } catch {}
  }

  function borraReserva() {
    try { localStorage.removeItem(RESERVA_KEY); } catch {}
  }

  /* Preguntas y avisos: dentro del emulador los pinta embed.js con su propio
     diálogo, manejable con la cruceta; fuera, lo de siempre. */
  function pregunta(texto, si = "SÍ", no = "NO") {
    const ui = window.ML3DLobbyUI;
    if (ui?.confirma) return ui.confirma(texto, si, no);
    return Promise.resolve(window.confirm(texto));
  }

  function aviso(texto) {
    const ui = window.ML3DLobbyUI;
    if (ui?.avisa) ui.avisa(texto);
    else showSessionBanner(texto, 3200);
  }

  const MOTIVOS = {
    rejected: "NO HAS SIDO ADMITIDO EN LA SALA",
    blocked: "NO PUEDES ENTRAR EN ESTA SALA",
    inactive: "EXPULSADO POR INACTIVIDAD",
    full: "LA SALA ESTÁ COMPLETA",
    outdated: "RECARGA LA PÁGINA PARA PODER ENTRAR",
    kicked: "EXPULSADO DE LA SALA"
  };

  /* Pausa: al salir del navegador sin cerrarlo o bloquear el móvil, los demás
     ven el personaje holográfico con "PAUSADO". Al volver, todo sigue. */
  function publicaPausa(forzado) {
    if (cableEnMarcha()) return;
    const paused = typeof forzado === "boolean" ? forzado : document.hidden;
    /* Se envía aunque la foto de la sala no haya llegado todavía: quien
       bloquea el móvil nada más entrar también está en pausa. */
    const yo = players.get(localPlayerId);
    if (yo) {
      yo.paused = paused;
      renderPlayers();
    }
    if (hostSession) sendAll({ type: "lobby:pause", playerId: "host", paused, time: Date.now() });
    else if (joinSession?.channel) safeSend(joinSession.channel, { type: "lobby:pause", paused, time: Date.now() });
  }
  document.addEventListener("visibilitychange", () => publicaPausa());
  /* Un móvil no siempre da tiempo: se avisa en cuanto hay cualquier señal de
     que la página se va a quedar parada, no solo en la más habitual. */
  document.addEventListener("freeze", () => publicaPausa(true));
  document.addEventListener("resume", () => publicaPausa());
  window.addEventListener("pagehide", () => publicaPausa(true));
  window.addEventListener("pageshow", () => publicaPausa());
  /* La página del emulador también lo dice: a un iframe el aviso le puede
     llegar tarde. */
  window.ML3DLobbyPausa = (oculto) => publicaPausa(Boolean(oculto));

  function getLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("Este navegador no ofrece ubicación."));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        (err) => reject(new Error(`No se pudo obtener la ubicación: ${err.message}`)),
        { enableHighAccuracy: false, timeout: 12000, maximumAge: 30000 }
      );
    });
  }

  /* Sin GPS ni wifi, el navegador calcula la ubicación por la dirección de
     red y puede fallar por cientos de kilómetros. Una sala creada así cae
     lejos de donde está de verdad y nadie la encuentra buscando cerca, y una
     búsqueda hecha así mira en otro sitio. Se dice, para que se use el código
     o el QR. */
  const UBICACION_IMPRECISA_M = 1500;
  function avisaUbicacionImprecisa(loc, accion) {
    const metros = Number(loc?.accuracy);
    if (!(metros > UBICACION_IMPRECISA_M)) return;
    const km = metros >= 10000 ? Math.round(metros / 1000) : (metros / 1000).toFixed(1);
    log(`Ubicación imprecisa: ~${km} km.`);
    window.dispatchEvent(new CustomEvent("ml3d-lobby-aviso", {
      detail: { tipo: "ubicacion-imprecisa", accion, km: String(km) }
    }));
  }

  function waitIce(peer) {
    if (peer.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        peer.removeEventListener("icegatheringstatechange", onChange);
        resolve();
      };
      const onChange = () => {
        if (peer.iceGatheringState === "complete") finish();
      };
      peer.addEventListener("icegatheringstatechange", onChange);
      setTimeout(finish, 10000);
    });
  }

  function serialize(desc) {
    return JSON.stringify({ type: desc.type, sdp: desc.sdp });
  }

  /* ---- relevo ---- */

  const candidatosDe = (sdp) => String(sdp || "").split(/\r?\n/).filter((linea) => linea.startsWith("a=candidate:"));
  /* Solo direcciones del relevo, y ninguna otra al lado (raddr). */
  function soloRelevo(sdp) {
    const candidatos = candidatosDe(sdp);
    return candidatos.length > 0 && candidatos.every((linea) => {
      if (!/ typ relay( |$)/.test(linea)) return false;
      const alLado = linea.match(/ raddr (\S+)/);
      return !alLado || alLado[1] === "0.0.0.0" || alLado[1] === "::";
    });
  }
  /* Lo que sale de este dispositivo. Se revisa aquí, antes de enviarlo: si
     el navegador hubiera puesto una dirección propia, no sale. */
  function serializaRelevo(desc) {
    const sdp = String(desc?.sdp || "").replace(/ raddr \S+ rport \d+/g, " raddr 0.0.0.0 rport 0");
    if (!soloRelevo(sdp)) throw new Error(SIN_RELEVO);
    return JSON.stringify({ type: desc.type, sdp });
  }
  /* Lo que llega de otro: si trae una dirección que no es del relevo, no se usa. */
  function descripcionRelevo(value, expected) {
    const parsed = parseDescription(value, expected);
    if (!soloRelevo(parsed.sdp)) throw new Error("Conexión no válida: el otro jugador tiene que recargar la página.");
    return parsed;
  }

  let relevoListo = null;   /* { clave, cfg, renueva } */
  let relevoFallo = null;   /* { clave, hasta } */
  /* Configuración de conexión con credenciales temporales. Las da el
     servidor de salas a quien está en una sala; duran 6 horas y se piden de
     nuevo a las 5. */
  async function configRelevo() {
    const s = hostSession
      ? { clave: `h:${hostSession.room.id}`, ruta: `/v1/rooms/${encodeURIComponent(hostSession.room.id)}/relevo`, token: hostSession.token }
      : joinSession
        ? { clave: `j:${joinSession.join.id}`, ruta: `/v1/rooms/${encodeURIComponent(joinSession.room.id)}/joins/${encodeURIComponent(joinSession.join.id)}/relevo`, token: joinSession.token }
        : null;
    if (!s) throw new Error(SIN_RELEVO);
    if (relevoListo && relevoListo.clave === s.clave && Date.now() < relevoListo.renueva) return relevoListo.cfg;
    /* Si acaba de fallar no se insiste en cada intento: el servidor tiene un tope. */
    if (relevoFallo && relevoFallo.clave === s.clave && Date.now() < relevoFallo.hasta) throw new Error(SIN_RELEVO);
    try {
      /* Para probar la renovación sin esperar 5 horas: con
         localStorage "ml3d-relevo-ttl" = segundos, se piden credenciales más
         cortas. El servidor solo admite acortarlas, nunca alargarlas. */
      let corta = 0;
      try { corta = Number(localStorage.getItem("ml3d-relevo-ttl")) || 0; } catch {}
      const data = await api(s.ruta, { method: "POST", token: s.token, body: corta >= 60 ? { ttl: corta } : {} });
      const servidores = (Array.isArray(data.iceServers) ? data.iceServers : [])
        .map((x) => ({ urls: [].concat(x?.urls || []).filter((u) => /^turns?:/.test(u)), username: x?.username, credential: x?.credential }))
        .filter((x) => x.urls.length && x.username && x.credential);
      if (!servidores.length) throw new Error("sin servidores de relevo");
      const vida = Number(data.expiresAt) - Date.now();
      if (!(vida > 0)) throw new Error("credenciales sin caducidad");
      relevoListo = { clave: s.clave, cfg: { iceServers: servidores, iceTransportPolicy: "relay" }, renueva: Date.now() + vida * RELEVO_RENUEVA, caduca: Number(data.expiresAt), desde: Date.now() };
      log(`Relevo: credenciales nuevas, válidas ${Math.round(vida / 60000)} min.`);
      relevoFallo = null;
      return relevoListo.cfg;
    } catch (error) {
      log(`Relevo: ${error.message}`);
      relevoFallo = { clave: s.clave, hasta: Date.now() + RELEVO_REINTENTA_MS };
      if (!renovando) aviso(SIN_RELEVO.toUpperCase());
      throw new Error(SIN_RELEVO);
    }
  }
  /* ---- renovar una conexión viva ----
     Cada lado usa sus propias credenciales en el relevo, y el relevo corta la
     conexión poco después de que caduquen. Antes de eso se piden unas nuevas
     y la conexión se renegocia por su propio canal (reinicio ICE): los dos
     lados vuelven a reservar sitio en el relevo y la sala o la partida siguen
     sin cortarse. Empieza siempre quien hizo la oferta original (el
     anfitrión en la sala, quien desafía en el combate); el otro lado, cuando
     le toca, se lo pide.

     Cada conexión recuerda con qué credenciales está abierta (pc.__cfg). Si
     no son las actuales, se insiste hasta que lo sean; si no se consigue, se
     avisa: quedan minutos antes del corte. */
  let renovando = false;
  const renovacion = { hechas: 0, fallos: 0, ultima: 0, ultimoFallo: "", avisado: 0 };
  function falloRenovacion(motivo) {
    renovacion.fallos += 1; renovacion.ultimoFallo = motivo;
    log(`Relevo: FALLO al renovar (${motivo}).`);
    if (Date.now() - renovacion.avisado < 120000) return;
    renovacion.avisado = Date.now();
    const quedan = relevoListo?.caduca ? Math.max(0, Math.round((relevoListo.caduca - Date.now()) / 60000)) : 0;
    aviso(`NO SE HA PODIDO RENOVAR LA CONEXIÓN. PUEDE CORTARSE EN ${quedan > 1 ? `UNOS ${quedan} MINUTOS` : "POCO TIEMPO"}.`);
  }
  function renovada(pc, cfg) {
    pc.__cfg = cfg; pc.__renovando = false; pc.__pendiente = 0;
    renovacion.hechas += 1; renovacion.ultima = Date.now();
    log(`Relevo: conexión renovada (${renovacion.hechas}).`);
  }
  async function reunidos(pc) {
    for (let i = 0; i < 100; i++) {
      if (pc.iceGatheringState === "complete" && candidatosDe(pc.localDescription?.sdp).length) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  async function renuevaConexion(pc, canal) {
    if (!pc || pc.__renovando || canal?.readyState !== "open") return;
    pc.__renovando = true;
    try {
      const cfg = await configRelevo();
      pc.setConfiguration(cfg);
      pc.__cfgNueva = cfg;
      await pc.setLocalDescription(await pc.createOffer({ iceRestart: true }));
      await reunidos(pc);
      safeSend(canal, { type: "relevo:oferta", data: serializaRelevo(pc.localDescription), time: Date.now() });
      /* Si la respuesta no llega, se intenta otra vez. */
      setTimeout(() => { if (pc.__renovando && pc.__cfgNueva === cfg) { pc.__renovando = false; falloRenovacion("el otro lado no contesta"); } }, 30000);
    } catch (error) { pc.__renovando = false; falloRenovacion(error.message); }
  }
  async function alRenovar(pc, canal, packet, hiceLaOferta) {
    if (!pc) return;
    try {
      if (packet.type === "relevo:pide" && hiceLaOferta) {
        /* Nadie puede pedirlo sin parar. */
        if (Date.now() - (pc.__pedida || 0) < 15000) return;
        pc.__pedida = Date.now();
        await renuevaConexion(pc, canal);
      } else if (packet.type === "relevo:oferta" && !hiceLaOferta) {
        const oferta = descripcionRelevo(packet.data, "offer");
        const cfg = await configRelevo();
        pc.setConfiguration(cfg);
        await pc.setRemoteDescription(oferta);
        await pc.setLocalDescription(await pc.createAnswer());
        await reunidos(pc);
        safeSend(canal, { type: "relevo:respuesta", data: serializaRelevo(pc.localDescription), time: Date.now() });
        renovada(pc, cfg);
      } else if (packet.type === "relevo:respuesta" && hiceLaOferta && pc.__renovando) {
        await pc.setRemoteDescription(descripcionRelevo(packet.data, "answer"));
        renovada(pc, pc.__cfgNueva);
      }
    } catch (error) { pc.__renovando = false; falloRenovacion(error.message); }
  }
  setInterval(async () => {
    if (!relevoListo || (!hostSession && !joinSession)) return;
    if (Date.now() >= relevoListo.renueva) {
      renovando = true;
      try { await configRelevo(); } catch { falloRenovacion("el servicio de conexión no da credenciales nuevas"); return; } finally { renovando = false; }
    }
    const cfg = relevoListo.cfg;
    const mira = (pc, canal, hiceLaOferta) => {
      if (!pc || pc.__cfg === cfg || pc.connectionState !== "connected" || canal?.readyState !== "open") return;
      pc.__pendiente = pc.__pendiente || Date.now();
      if (Date.now() - pc.__pendiente > 60000) { pc.__pendiente = Date.now(); falloRenovacion("la conexión sigue con las credenciales antiguas"); }
      if (hiceLaOferta) renuevaConexion(pc, canal);
      else safeSend(canal, { type: "relevo:pide", time: Date.now() });
    };
    if (hostSession) for (const peer of hostSession.peers.values()) mira(peer.pc, peer.channel, true);
    else if (joinSession) mira(joinSession.pc, joinSession.channel, false);
    if (duelo?.pc && duelo.canal) mira(duelo.pc, duelo.canal, duelo.asiento === 0);
  }, 10000);

  function parseDescription(value, expected) {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || parsed.type !== expected || typeof parsed.sdp !== "string") {
      throw new Error(`Descripción ${expected} no válida.`);
    }
    return parsed;
  }

  /* Conexiones vivas, para poder preguntarle a WebRTC la latencia real.
     Sin esto no hay forma de separar "el movil va justo de CPU" de "la wifi
     va lenta": las dos cosas se ven igual desde fuera. */
  const conexionesVivas = new Set();

  window.ML3DLinkNet = {
    async medida() {
      let rtt = null;
      let camino = "";
      let perdidos = null;
      for (const pc of conexionesVivas) {
        if (pc.connectionState !== "connected") continue;
        const stats = await pc.getStats();
        stats.forEach((s) => {
          if (s.type === "candidate-pair" && s.state === "succeeded" && s.nominated !== false) {
            if (typeof s.currentRoundTripTime === "number") rtt = s.currentRoundTripTime * 1000;
          }
          if (s.type === "local-candidate" && s.candidateType) camino = camino || s.candidateType;
          if (s.type === "data-channel" && typeof s.messagesSent === "number") {
            perdidos = { enviados: s.messagesSent, recibidos: s.messagesReceived };
          }
        });
      }
      return { rttMs: rtt === null ? null : Math.round(rtt * 10) / 10, camino, perdidos,
               conexiones: conexionesVivas.size,
               /* Renovación de credenciales del relevo: cuántas, cuándo y si ha fallado. */
               relevo: relevoListo ? { renovadas: renovacion.hechas, fallos: renovacion.fallos, ultimoFallo: renovacion.ultimoFallo,
                 ultimaHaceS: renovacion.ultima ? Math.round((Date.now() - renovacion.ultima) / 1000) : null,
                 proximaEnS: Math.round((relevoListo.renueva - Date.now()) / 1000), caducanEnS: Math.round((relevoListo.caduca - Date.now()) / 1000) } : null };
    }
  };

  /* La sesion Link corre en la pagina y el lobby dentro de un iframe, asi que
     alli window.ML3DLinkNet no existe. Se publica tambien en el padre cuando
     el origen coincide; sin esto la latencia salia siempre vacia. */
  try {
    if (window.parent && window.parent !== window) window.parent.ML3DLinkNet = window.ML3DLinkNet;
  } catch (_) { /* otro origen: se queda solo aqui */ }

  /* Deja en los desplegables solo los tamanos permitidos, y explica el resto
     en vez de ofrecerlos y rechazarlos luego. */
  function acotaSelectoresDeJugadores() {
    for (const id of ["maxPlayers", "hostMaxPlayers"]) {
      const sel = document.getElementById(id);
      if (!sel) continue;
      for (const opt of [...sel.options]) {
        if (Number(opt.value) > MAX_JUGADORES_ONLINE) {
          opt.disabled = true;
          opt.textContent = opt.value + " (aun no por red)";
        }
      }
      if (Number(sel.value) > MAX_JUGADORES_ONLINE) sel.value = String(MAX_JUGADORES_ONLINE);
    }
  }

  function makePeer(label, onChannel, cfg) {
    if (cfg?.iceTransportPolicy !== "relay") throw new Error(SIN_RELEVO);
    const pc = new RTCPeerConnection(cfg);
    pc.__cfg = cfg;
    conexionesVivas.add(pc);
    pc.addEventListener("connectionstatechange", () => {
      log(`${label}: peer ${pc.connectionState}`);
      if (pc.connectionState === "connected") olvidaCaida();
      if (pc.connectionState === "closed" || pc.connectionState === "failed") {
        conexionesVivas.delete(pc);
        avisaCaidaAlEmulador("la conexion con el otro jugador se ha perdido");
      }
    });
    pc.addEventListener("iceconnectionstatechange", () => log(`${label}: ICE ${pc.iceConnectionState}`));
    pc.addEventListener("datachannel", (event) => onChannel(event.channel));
    return pc;
  }

  function safeSend(channel, packet) {
    if (!channel || channel.readyState !== "open") return false;
    try {
      channel.send(JSON.stringify(packet));
      return true;
    } catch (error) {
      log(`Canal: ${error.message}`);
      return false;
    }
  }

  function sendAll(packet, exceptJoinId = null) {
    if (!hostSession) return 0;
    let count = 0;
    for (const [joinId, peer] of hostSession.peers) {
      if (joinId === exceptJoinId) continue;
      if (safeSend(peer.channel, packet)) count += 1;
    }
    return count;
  }

  function openChannels() {
    if (hostSession) {
      return [...hostSession.peers.values()].map((p) => p.channel).filter((c) => c?.readyState === "open");
    }
    return joinSession?.channel?.readyState === "open" ? [joinSession.channel] : [];
  }

  /* El nombre de la sesión de cable de este jugador: la de su combate si
     está en uno; la sala entera si es una sala de dos; ninguna si mira. */
  function currentLinkRoomId() {
    if (duelo && duelo.estado !== "conectando") return duelo.sala;
    if (!salaDeCable()) return "";
    return String(hostSession?.room?.id || joinSession?.room?.id || "");
  }

  /* Jugadores de la sala, 2 a 4: define cuántas consolas emula cada navegador. */
  function roomSeatCount() {
    /* Al invitado que entra por código le llega una sala de relleno, así que
       manda lo que dijo el host al configurar el cable. */
    const fromHost = Number(joinSession?.linkPlayers) | 0;
    if (fromHost >= 2) return Math.min(4, fromHost);
    const room = hostSession?.room || joinSession?.room;
    return Math.max(2, Math.min(MAX_JUGADORES_ONLINE, Number(room?.maxPlayers) | 0 || 2));
  }

  function rememberLocalLinkSession(roomId, playerNumber, role, players, game) {
    /* En una sala de 3 o 4 no hay cable hasta que hay combate. */
    if (!duelo && !salaDeCable()) return null;
    const next = {
      roomId: String(roomId || ""),
      playerNumber: Math.max(0, Math.min(3, Number(playerNumber) | 0)),
      role: role === "host" ? "host" : "guest",
      /* Manda lo que diga el host: su copia de la sala es la buena. */
      players: Math.max(2, Math.min(4, Number(players) | 0 || roomSeatCount())),
      updatedAt: Date.now()
    };
    try {
      localStorage.setItem(GBA_LINK_STORAGE_KEY, JSON.stringify(next));
    } catch {}
    if (gbaLinkBus) {
      gbaLinkBus.postMessage({
        type: "gba:link:configure",
        source: "lobby",
        /* El emulador abre este juego si no lo tiene ya puesto. */
        game: String(game || hostSession?.room?.game || joinSession?.room?.game || ""),
        ...next
      });
    }
    return next;
  }

  function clearLocalLinkSession(roomId = "") {
    let stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(GBA_LINK_STORAGE_KEY) || "null");
    } catch {}
    if (!roomId || stored?.roomId === roomId) {
      try { localStorage.removeItem(GBA_LINK_STORAGE_KEY); } catch {}
      if (gbaLinkBus) {
        gbaLinkBus.postMessage({
          type: "gba:link:disconnect",
          source: "lobby",
          roomId: roomId || stored?.roomId || "",
          time: Date.now()
        });
      }
    }
  }

  /* Aviso al emulador de que el cable se ha caido.
     El lobby se enteraba (lo escribia en su registro) pero no se lo decia a
     nadie: la partida se quedaba congelada esperando datos que ya no iban a
     llegar, sin explicacion para el jugador. */
  let caidaAvisada = false;

  function avisaCaidaAlEmulador(motivo, delDuelo = false) {
    /* Con un combate en marcha, el cable es el canal directo con el rival:
       que se caiga la sala o el anfitrión no es una caída del cable. */
    if (duelo && !delDuelo) return;
    if (caidaAvisada || !gbaLinkBus) return;
    const roomId = currentLinkRoomId();
    if (!roomId) return;
    caidaAvisada = true;
    gbaLinkBus.postMessage({
      type: "gba:link:peer-lost",
      source: "lobby",
      roomId,
      motivo: String(motivo || ""),
      time: Date.now()
    });
  }

  /* Al volver a conectar se rearma, para que la siguiente caida vuelva a
     avisar. */
  function olvidaCaida() {
    caidaAvisada = false;
  }

  function postLocalLink(packet) {
    if (!gbaLinkBus) return false;
    gbaLinkBus.postMessage({
      ...packet,
      source: "lobby",
      roomId: packet.roomId || currentLinkRoomId(),
      time: Date.now()
    });
    return true;
  }

  function completeHostLinkTransfer(error = false) {
    const pending = gbaLinkPending;
    if (!pending || !hostSession) return;
    clearTimeout(pending.retryTimer);
    clearTimeout(pending.timer);
    gbaLinkPending = null;

    const words = pending.words.map((word) => Number(word) & 0xFFFF);
    postLocalLink({
      type: "gba:link:complete",
      roomId: hostSession.room.id,
      seq: pending.seq,
      words,
      playerNumber: 0,
      connectedCount: Math.max(0, Math.min(3, Number(pending.connectedCount) | 0)),
      error: Boolean(error)
    });

    for (const peer of hostSession.peers.values()) {
      if (peer.channel?.readyState !== "open") continue;
      safeSend(peer.channel, {
        type: "gba:link:complete",
        roomId: hostSession.room.id,
        seq: pending.seq,
        words,
        playerNumber: Math.max(1, Math.min(3, Number(peer.linkSlot) | 0)),
        connectedCount: Math.max(0, Math.min(3, Number(pending.connectedCount) | 0)),
        error: Boolean(error),
        time: Date.now()
      });
    }
  }

  function retryHostLinkTransfer() {
    const pending = gbaLinkPending;
    if (!pending || !hostSession || !pending.waiting.size) return;

    pending.retryCount = (pending.retryCount | 0) + 1;
    for (const joinId of pending.waiting) {
      const peer = hostSession.peers.get(joinId);
      if (!peer || peer.channel?.readyState !== "open") continue;
      const slot = Math.max(1, Math.min(3, Number(peer.linkSlot) | 0));
      safeSend(peer.channel, {
        type: "gba:link:poll",
        roomId: hostSession.room.id,
        seq: pending.seq,
        playerNumber: slot,
        baud: pending.baud,
        hostWord: pending.hostWord,
        retry: pending.retryCount,
        time: Date.now()
      });
    }
    log(`GBA Link: reintento ${pending.retryCount} para ${pending.seq}.`);

    if (pending.retryCount < 2 && gbaLinkPending === pending) {
      pending.retryTimer = setTimeout(retryHostLinkTransfer, pending.retryMs);
    }
  }

  function startHostLinkTransfer(packet) {
    if (!hostSession) return;
    if (gbaLinkPending) {
      log(`GBA Link: transferencia solapada ignorada (${String(packet.seq || "sin-seq")}).`);
      return;
    }

    const seq = String(packet.seq || `host-${Date.now()}-${++gbaLinkSequence}`);
    const words = [Number(packet.word) & 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF];
    const waiting = new Set();

    for (const [joinId, peer] of hostSession.peers) {
      if (peer.channel?.readyState !== "open") continue;
      const slot = Math.max(1, Math.min(3, Number(peer.linkSlot) | 0));
      waiting.add(joinId);
      safeSend(peer.channel, {
        type: "gba:link:poll",
        roomId: hostSession.room.id,
        seq,
        playerNumber: slot,
        baud: Number(packet.baud) & 0x3,
        hostWord: words[0],
        time: Date.now()
      });
    }

    const measuredRtts = [...hostSession.peers.values()]
      .map((peer) => Number(peer.metrics?.rtt))
      .filter(Number.isFinite);
    const worstRtt = measuredRtts.length ? Math.max(...measuredRtts) : null;
    const retryMs = worstRtt === null
      ? 350
      : Math.max(180, Math.min(700, Math.ceil(worstRtt * 2.5 + 100)));
    const timeoutMs = worstRtt === null
      ? 2200
      : Math.max(1500, Math.min(5000, Math.ceil(worstRtt * 10 + 1000)));

    gbaLinkPending = {
      seq,
      words,
      waiting,
      connectedCount: Math.max(0, Math.min(3, waiting.size | 0)),
      baud: Number(packet.baud) & 0x3,
      hostWord: words[0],
      retryCount: 0,
      retryMs,
      timeoutMs,
      // Mobile browsers can occasionally delay a DataChannel callback for
      // hundreds of milliseconds. Retry the same transfer sequence first and
      // only raise COMMERROR after a much wider hard watchdog.
      retryTimer: setTimeout(retryHostLinkTransfer, retryMs),
      timer: setTimeout(() => completeHostLinkTransfer(true), timeoutMs)
    };

    if (!waiting.size) {
      completeHostLinkTransfer(true);
    }
  }

  function savePacket(packet, roomId, playerNumber) {
    return {
      type: "gba:lockstep:save",
      roomId,
      playerNumber,
      /* "rom-*": el cartucho de un jugador, en salas de juegos distintos. */
      kind: ["chunk", "meta", "rom-meta", "rom-chunk"].includes(packet.kind) ? packet.kind : "meta",
      hash: String(packet.hash || ""),
      size: Number(packet.size) | 0,
      total: Number(packet.total) | 0,
      index: Number(packet.index) | 0,
      data: typeof packet.data === "string" ? packet.data : "",
      time: Date.now()
    };
  }

  function handleLocalGbaLinkMessage(event) {
    const packet = event.data;
    if (!packet || packet.source !== "emulator") return;
    const roomId = currentLinkRoomId();
    if (!roomId || packet.roomId !== roomId) return;

    /* En un combate, el cable va por el canal directo: solo al rival. */
    if (duelo && roomId === duelo.sala) {
      const tipo = String(packet.type || "");
      if (!/^gba:lockstep:(ready|start|save|input|sync)$/.test(tipo)) return;
      if (tipo === "gba:lockstep:start" && duelo.asiento !== 0) return;
      const saliente = tipo === "gba:lockstep:save"
        ? savePacket(packet, roomId, duelo.asiento)
        : { ...packet, source: undefined, roomId, playerNumber: duelo.asiento, time: Date.now() };
      safeSend(duelo.canal, saliente);
      return;
    }

    if (packet.type === "gba:lockstep:ready") {
      const outgoing = {
        type: "gba:lockstep:ready",
        roomId,
        playerNumber: Number(packet.playerNumber) | 0,
        role: String(packet.role || ""),
        romHash: String(packet.romHash || ""),
        protocol: String(packet.protocol || ""),
        /* Partidas: quien acepta compartir la suya y cuales tiene ya. */
        consent: packet.consent === true,
        declined: packet.declined === true,
        go: packet.go === true,
        have: String(packet.have || ""),
        /* Juegos distintos: qué cartucho lleva cada uno y cuál ajeno tiene ya. */
        pre: packet.pre === true,
        rom: packet.rom && typeof packet.rom === "object" ? {
          hash: String(packet.rom.hash || ""), nombre: String(packet.rom.nombre || "").slice(0, 120),
          size: Number(packet.rom.size) | 0, origen: String(packet.rom.origen || ""), envio: packet.rom.envio === true
        } : null,
        preHave: String(packet.preHave || ""),
        motivo: String(packet.motivo || "").slice(0, 24),
        time: Date.now()
      };
      if (hostSession) {
        for (const peer of hostSession.peers.values()) {
          if (peer.channel?.readyState === "open") safeSend(peer.channel, outgoing);
        }
      } else if (joinSession?.channel?.readyState === "open") {
        safeSend(joinSession.channel, outgoing);
      }
      return;
    }

    if (packet.type === "gba:lockstep:start" && hostSession) {
      const outgoing = {
        type: "gba:lockstep:start",
        roomId,
        sessionId: String(packet.sessionId || ""),
        delay: Number(packet.delay) | 0,
        romHash: String(packet.romHash || ""),
        clock: Number(packet.clock) || 0,
        time: Date.now()
      };
      for (const peer of hostSession.peers.values()) {
        if (peer.channel?.readyState === "open") safeSend(peer.channel, outgoing);
      }
      return;
    }

    /* La partida de un jugador, a trozos, para las copias de su consola en
       los demas dispositivos. Mismo camino que las teclas: directo entre
       jugadores, nunca por el servidor de salas. */
    if (packet.type === "gba:lockstep:save") {
      const outgoing = savePacket(packet, roomId, Number(packet.playerNumber) | 0);
      if (hostSession) {
        for (const peer of hostSession.peers.values()) {
          if (peer.channel?.readyState === "open") safeSend(peer.channel, outgoing);
        }
      } else if (joinSession?.channel?.readyState === "open") {
        safeSend(joinSession.channel, outgoing);
      }
      return;
    }

    if (packet.type === "gba:lockstep:input") {
      const outgoing = {
        type: "gba:lockstep:input",
        roomId,
        sessionId: String(packet.sessionId || ""),
        playerNumber: Number(packet.playerNumber) | 0,
        frame: Number(packet.frame),
        mask: Number(packet.mask) & 0x3ff,
        time: Date.now()
      };
      if (hostSession) {
        for (const peer of hostSession.peers.values()) {
          if (peer.channel?.readyState === "open") safeSend(peer.channel, outgoing);
        }
      } else if (joinSession?.channel?.readyState === "open") {
        safeSend(joinSession.channel, outgoing);
      }
      return;
    }

    /* Huella del estado, para detectar que las copias han divergido. Viaja por
       el mismo camino que las teclas y con las mismas reglas. */
    if (packet.type === "gba:lockstep:sync") {
      const outgoing = {
        type: "gba:lockstep:sync",
        roomId,
        sessionId: String(packet.sessionId || ""),
        playerNumber: Number(packet.playerNumber) | 0,
        frame: Number(packet.frame),
        hash: Number(packet.hash) >>> 0,
        /* Las cifras del emisor viajan pegadas a la huella; sin
           reenviarlas, el otro lado no ve como le va a su compañero. */
        stats: packet.stats || null,
        time: Date.now()
      };
      if (hostSession) {
        for (const peer of hostSession.peers.values()) {
          if (peer.channel?.readyState === "open") safeSend(peer.channel, outgoing);
        }
      } else if (joinSession?.channel?.readyState === "open") {
        safeSend(joinSession.channel, outgoing);
      }
      return;
    }

    if (packet.type === "gba:link:ready") {
      localGbaReady = Boolean(packet.ready);
      if (hostSession) {
        for (const peer of hostSession.peers.values()) {
          if (peer.channel?.readyState !== "open") continue;
          safeSend(peer.channel, {
            type: "gba:link:ready",
            roomId,
            ready: localGbaReady,
            time: Date.now()
          });
        }
      } else if (joinSession) {
        safeSend(joinSession.channel, {
          type: "gba:link:ready",
          roomId,
          ready: localGbaReady,
          time: Date.now()
        });
      }
      log(`GBA local: ${localGbaReady ? "MULTIPLAYER LISTO" : "fuera de multiplayer"}.`);
      return;
    }

    if (packet.type === "gba:link:prepared-transfer" && hostSession) {
      for (const peer of hostSession.peers.values()) {
        if (peer.channel?.readyState !== "open") continue;
        safeSend(peer.channel, {
          type: "gba:link:prepared-transfer",
          roomId,
          seq: String(packet.seq || ""),
          words: Array.isArray(packet.words) ? packet.words : [],
          playerNumber: Math.max(1, Math.min(3, Number(peer.linkSlot) | 0)),
          connectedCount: Math.max(0, Math.min(3, Number(packet.connectedCount) | 0)),
          baud: Number(packet.baud) & 0x3,
          hostReady: Boolean(localGbaReady),
          time: Date.now()
        });
      }
      return;
    }

    if (packet.type === "gba:link:request" && hostSession) {
      startHostLinkTransfer(packet);
      return;
    }

    if (packet.type === "gba:link:reply" && joinSession) {
      safeSend(joinSession.channel, {
        type: "gba:link:reply",
        roomId,
        seq: String(packet.seq || ""),
        word: Number(packet.word) & 0xFFFF,
        baud: Number(packet.baud) & 0x3,
        time: Date.now()
      });
      return;
    }

    if (packet.type === "gba:link:hw-complete" && joinSession) {
      safeSend(joinSession.channel, {
        type: "gba:link:hw-complete",
        roomId,
        seq: String(packet.seq || ""),
        playerNumber: Math.max(1, Math.min(3, Number(packet.playerNumber) | 0)),
        error: Boolean(packet.error),
        time: Date.now()
      });
      return;
    }

    if (packet.type === "gba:link:prepared-word" && joinSession) {
      safeSend(joinSession.channel, {
        type: "gba:link:prepared-word",
        roomId,
        playerNumber: Math.max(1, Math.min(3, Number(packet.playerNumber) | 0)),
        word: Number(packet.word) & 0xFFFF,
        reason: String(packet.reason || ""),
        time: Date.now()
      });
      return;
    }

    if (packet.type === "gba:link:next-word-ready" && joinSession) {
      safeSend(joinSession.channel, {
        type: "gba:link:next-word-ready",
        roomId,
        seq: String(packet.seq || ""),
        playerNumber: Math.max(1, Math.min(3, Number(packet.playerNumber) | 0)),
        word: Number(packet.word) & 0xFFFF,
        reason: String(packet.reason || ""),
        time: Date.now()
      });
    }
  }

  if (gbaLinkBus) {
    gbaLinkBus.addEventListener("message", handleLocalGbaLinkMessage);
  }


  function updateChannelButtons() {
    const ready = openChannels().length > 0;
    sendButton.disabled = !ready;
    pingButton.disabled = !ready;
  }

  function loadProfile() {
    const fallback = { name: "Jugador", color: "orange", body: "round", face: "happy", accessory: "none" };
    try {
      return normalizeProfile({ ...fallback, ...JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}") });
    } catch {
      return fallback;
    }
  }

  /* Aspecto del personaje (kit de ./personajes/): un JSON pequeño con
     identificadores y colores. Es lo único del avatar que viaja por la red;
     imágenes, nunca.

     Lo que llega de otro jugador se valida contra el manifest del kit: solo
     identificadores conocidos, colores "#rrggbb" y tamaño máximo. Si algo no
     vale, null: ese jugador se ve con el personaje por defecto. Mientras el
     kit no ha terminado de cargar solo se puede acotar el tamaño; quien pinta
     (personajes.js) vuelve a validar siempre antes de dibujar. */
  function limpiaAspecto(value) {
    /* El tope va aquí dentro y no en una constante de fuera: el perfil
       guardado se lee al arrancar, antes de que esa constante existiera, y
       la lectura fallaba entera (se perdían el nombre y el personaje). */
    const ASPECTO_MAX = 1024;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    let texto;
    try { texto = JSON.stringify(value); } catch { return null; }
    if (typeof texto !== "string" || texto.length > ASPECTO_MAX) return null;
    const kit = window.ML3DPersonajes;
    if (kit?.porDefecto) return kit.valida(value);
    try { return JSON.parse(texto); } catch { return null; }
  }

  function normalizeProfile(value = {}) {
    return {
      name: cleanName(value.name || "Jugador"),
      color: Object.hasOwn(PALETTE, value.color) ? value.color : "orange",
      body: BODIES.includes(value.body) ? value.body : "round",
      face: FACES.includes(value.face) ? value.face : "happy",
      accessory: ACCESSORIES.includes(value.accessory) ? value.accessory : "none",
      aspecto: limpiaAspecto(value.aspecto)
    };
  }

  /* Ni en el nombre de un jugador ni en el de una sala se enseña una dirección web. */
  /* Declarada con function: cleanName se usa ya al arrancar, antes de llegar aquí. */
  function sinEnlaces(text) { return window.ML3DFiltroChat?.sinEnlaces ? window.ML3DFiltroChat.sinEnlaces(text) : String(text ?? ""); }
  function cleanName(value) {
    return sinEnlaces(String(value || "Jugador").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 32)) || "Jugador";
  }
  function nombreSala(room) { return sinEnlaces(room?.name || "") || "Sala"; }

  function cleanChat(value) {
    return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 90);
  }

  function saveProfileLocal(next) {
    profile = normalizeProfile(next);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    $("#playerName").value = profile.name;
  }

  function spawnPoint(index) {
    const spots = [
      { x: 50, y: 70 },
      { x: 30, y: 58 },
      { x: 70, y: 58 },
      { x: 50, y: 44 }
    ];
    return spots[Math.max(0, Math.min(spots.length - 1, index))];
  }

  function qualityClass(value) {
    return ["good", "ok", "bad"].includes(value) ? value : "unknown";
  }

  function qualityLabel(value) {
    return value === "good" ? "Buena" : value === "ok" ? "Aceptable" : value === "bad" ? "Mala" : "Sin medir";
  }

  function computeQuality(rtt, jitter, missed = 0) {
    if (missed >= 2) return "bad";
    if (!Number.isFinite(rtt)) return "unknown";
    if (rtt <= 80 && (jitter ?? 0) <= 35) return "good";
    if (rtt <= 180 && (jitter ?? 0) <= 80) return "ok";
    return "bad";
  }

  function playerSnapshot(player) {
    return {
      id: player.id,
      name: player.name,
      avatar: player.avatar,
      x: player.x,
      y: player.y,
      quality: player.quality || "unknown",
      rtt: player.rtt ?? null,
      jitter: player.jitter ?? null,
      host: Boolean(player.host),
      paused: Boolean(player.paused),
      aspecto: player.aspecto || null
    };
  }

  function setLobbyVisible(visible) {
    lobbyShell.hidden = !visible;
    diagnosticsCard.hidden = !visible;
    $("#setupArea").hidden = visible;
    if (visible) {
      window.setTimeout(() => $("#lobbyStage").focus({ preventScroll: true }), 100);
      ensureMoveTimer();
    } else {
      stopMoveTimer();
    }
  }

  function ensureLocalPlayer(id, isHost, pos = spawnPoint(isHost ? 0 : 1)) {
    localPlayerId = id;
    let player = players.get(id);
    if (!player) {
      player = {
        id,
        name: profile.name,
        avatar: { color: profile.color, body: profile.body, face: profile.face, accessory: profile.accessory },
        aspecto: profile.aspecto,
        x: pos.x,
        y: pos.y,
        quality: isHost ? "good" : "unknown",
        rtt: isHost ? 0 : null,
        jitter: isHost ? 0 : null,
        host: isHost
      };
      players.set(id, player);
    }
    renderPlayers();
    return player;
  }

  function renderPlayers() {
    const existing = new Map([...playersLayer.querySelectorAll(".player")].map((el) => [el.dataset.playerId, el]));
    for (const player of players.values()) {
      let el = existing.get(player.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "player";
        el.dataset.playerId = player.id;
        const name = document.createElement("div");
        name.className = "player-name";
        const q = document.createElement("span");
        q.className = "quality-dot";
        const nameText = document.createElement("span");
        nameText.className = "player-name-text";
        name.append(q, nameText);
        const wrap = document.createElement("div");
        wrap.className = "avatar-wrap";
        const pausa = document.createElement("div");
        pausa.className = "player-paused-tag";
        pausa.textContent = "PAUSADO";
        el.append(name, wrap, pausa);
        playersLayer.append(el);
      }
      existing.delete(player.id);
      el.classList.toggle("local", player.id === localPlayerId);
      el.classList.toggle("paused", Boolean(player.paused));
      el.classList.toggle("silenciado", silenciados.has(player.id));
      el.dataset.nombre = player.name;
      /* personajes.js pinta a partir de esto y lo valida antes de dibujar. */
      const aspecto = player.aspecto ? JSON.stringify(player.aspecto) : "";
      if (el.dataset.aspecto !== aspecto) el.dataset.aspecto = aspecto;
      /* Dónde pisa, en % de la sala. Cómo se ve (posición suavizada, quién
         va delante, escala) lo decide sala.js. */
      el.dataset.x = String(player.x);
      el.dataset.y = String(player.y);
      const nameText = el.querySelector(".player-name-text");
      nameText.textContent = player.host ? `${player.name} ★` : player.name;
      const q = el.querySelector(".quality-dot");
      q.className = `quality-dot ${qualityClass(player.quality)}`;
      q.title = `${qualityLabel(player.quality)}${Number.isFinite(player.rtt) ? ` · ${Math.round(player.rtt)} ms` : ""}`;
      renderAvatarInto(el.querySelector(".avatar-wrap"), player.avatar);
    }
    for (const el of existing.values()) el.remove();
    pintaCombates();
    updateDiagnostics();
  }

  function renderAvatarInto(container, avatarValue) {
    const avatar = normalizeProfile({ name: "x", ...avatarValue });
    container.textContent = "";
    container.className = `avatar-wrap body-${avatar.body}`;
    container.style.setProperty("--avatar-color", PALETTE[avatar.color]);
    const head = document.createElement("div");
    head.className = `avatar-head face-${avatar.face}`;
    const leftEye = document.createElement("span");
    leftEye.className = "avatar-eye left";
    const rightEye = document.createElement("span");
    rightEye.className = "avatar-eye right";
    const mouth = document.createElement("span");
    mouth.className = "avatar-mouth";
    head.append(leftEye, rightEye, mouth);
    const body = document.createElement("div");
    body.className = "avatar-body";
    container.append(head, body);
    if (avatar.accessory !== "none") {
      const accessory = document.createElement("span");
      accessory.className = `avatar-accessory accessory-${avatar.accessory}`;
      container.append(accessory);
    }
  }

  /* ---------------------------------------------------------------- denuncias

     Los últimos mensajes de chat de cada jugador de la sala, SOLO en memoria:
     no se escriben en disco y se borran al salir de la sala. Sirven para que
     quien denuncia a alguien por el chat pueda, si quiere y si el
     administrador lo permite, adjuntar lo que esa persona dijo. */
  const MAX_MENSAJES_DENUNCIA = 20;
  const ultimosMensajes = new Map();   /* id de jugador -> textos */
  function apuntaMensaje(playerId, text) {
    if (!text || playerId === localPlayerId) return;
    const lista = ultimosMensajes.get(playerId) || [];
    lista.push(text);
    while (lista.length > MAX_MENSAJES_DENUNCIA) lista.shift();
    ultimosMensajes.set(playerId, lista);
  }

  /* La denuncia va al servidor de salas con la llave de este jugador. A quién
     se denuncia se dice por su sitio en la sala: quién es de verdad lo pone
     el servidor. */
  async function enviaDenuncia({ target, reason, messages }) {
    const sesion = hostSession || joinSession;
    if (!sesion) return { ok: false, reason: "sin_sala" };
    try {
      const res = await fetch(`${apiBase()}/v1/rooms/${encodeURIComponent(sesion.room.id)}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sesion.token}` },
        body: JSON.stringify({ from: hostSession ? "host" : sesion.join.id, target, reason, ...(messages ? { messages } : {}) }),
        cache: "no-store"
      });
      const datos = await res.json().catch(() => ({}));
      return { ok: res.ok && datos.ok !== false, status: datos.status || "", reason: datos.reason || (res.ok ? "" : "error"), messagesStored: datos.messagesStored || 0 };
    } catch { return { ok: false, reason: "sin_red" }; }
  }

  /* Los demás jugadores de la sala, cada uno con DENUNCIAR. Lo ven todos, no
     solo el anfitrión. La ventana de la denuncia la pone embed.js. */
  function renderListaJugadores() {
    const box = $("#listaJugadores");
    if (!box) return;
    box.textContent = "";
    const otros = [...players.values()].filter((p) => p.id !== localPlayerId);
    $("#jugadoresSala").hidden = !otros.length;
    for (const player of otros) {
      const row = document.createElement("div");
      row.className = "manage-player";
      const label = document.createElement("span");
      label.textContent = player.host ? `${player.name} ★` : player.name;
      row.append(label);
      const silencio = document.createElement("button");
      silencio.type = "button";
      silencio.className = "silenciar";
      const callado = silenciados.has(player.id);
      silencio.textContent = callado ? "🔇 QUITAR SILENCIO" : "🔇 SILENCIAR";
      silencio.setAttribute("aria-pressed", String(callado));
      silencio.addEventListener("click", () => { cambiaSilencio(player.id); renderListaJugadores(); });
      row.append(silencio);
      const ui = window.ML3DLobbyUI;
      if (ui?.denuncia) {
        const boton = document.createElement("button");
        boton.type = "button";
        boton.className = "danger";
        boton.textContent = "DENUNCIAR";
        boton.addEventListener("click", () => {
          closeModal("selectModal");
          ui.denuncia({ id: player.id, nombre: player.name, mensajes: [...(ultimosMensajes.get(player.id) || [])], envia: enviaDenuncia });
        });
        row.append(boton);
      }
      box.append(row);
    }
  }

  /* ---------------------------------------------------------------- combates

     En una sala de 3 o 4 el cable no une a toda la sala: une a dos jugadores,
     cuando uno lanza un desafío y otro lo acepta. Los demás miran.

     - ARBITRA EL ANFITRIÓN. No hay servidor: si dos aceptan a la vez, gana
       el que llega antes al navegador del anfitrión y el otro recibe "ya
       aceptado".
     - CANAL DIRECTO. Al aceptar, los dos combatientes abren una conexión solo
       entre ellos (también cuando uno de los dos es el anfitrión). Por ahí,
       y solo por ahí, van las teclas, las partidas y los datos del juego. El
       anfitrión reenvía los mensajes para abrirla y nada más. Sin relevo: si
       no se puede abrir, el combate no empieza.
     - LO PÚBLICO. Toda la sala sabe quién desafía, quién juega, a qué, cuánto
       lleva y cómo acabó. Nada más.
     - RESULTADOS. Cada uno dice si ganó, perdió o empató; cuenta si
       coinciden, si no queda "disputado". La tabla vive en la memoria del
       anfitrión y se borra con la sala.

     En una sala de 2 sigue valiendo INICIAR CONEXIÓN, como siempre. */

  const TIPOS_DESAFIO = {
    combate: { nombre: "Combate", cuenta: true },
    carrera: { nombre: "Carrera", cuenta: true },
    intercambio: { nombre: "Intercambio", cuenta: false },
    libre: { nombre: "Libre", cuenta: false }
  };
  /* Un desafío se acepta yendo hasta quien lo lanza. CERCA_PX es la distancia
     a la que aparece el botón (en píxeles de la sala de referencia, 720x480).
     El anfitrión lo comprueba con sus propias posiciones y algo de margen:
     la posición de los demás le llega con un pequeño retraso. */
  const CERCA_PX = 78;
  const ACEPTA_PX = 120;
  const distanciaSala = (a, b) => Math.hypot((a.x - b.x) * 7.2, (a.y - b.y) * 4.8);
  const DESAFIO_CADUCA_MS = 45000;
  const DESAFIO_CADA_MS = 20000;
  const DIRECTO_ESPERA_MS = 15000;
  const RESULTADO_ESPERA_MS = 60000;
  const NOMBRE_TABLA_MAX = 12;

  /* Sala de dos: el cable une a toda la sala, como siempre. */
  function salaDeCable() {
    const room = hostSession?.room || joinSession?.room;
    return (Number(room?.maxPlayers) | 0 || 2) <= 2;
  }
  const nombrePublico = (id) => filtra(String(players.get(id)?.name || "Jugador")).slice(0, NOMBRE_TABLA_MAX);

  /* Lo que sabe toda la sala. Lo escribe el anfitrión; los demás lo reciben. */
  let combates = { habilitados: true, desafios: [], combate: null, tabla: [], ultimo: null };
  const escuchasCombate = new Set();
  const rechazados = new Set();   /* desafíos que este jugador ha dicho que no quiere */

  /* ---- anfitrión: árbitro ---- */
  const arbitro = { ultimo: new Map(), vetados: new Map(), resultados: new Map(), tabla: new Map(), siguiente: 1, plazo: null, habilitados: true, desafios: [], combate: null, ultimoFin: null };

  function publicaCombates() {
    if (!hostSession) return;
    combates = {
      habilitados: arbitro.habilitados,
      desafios: arbitro.desafios.map((d) => ({ id: d.id, de: d.de, nombre: nombrePublico(d.de), tipo: d.tipo, juego: d.juego, biblioteca: d.biblioteca, caduca: d.caduca })),
      combate: arbitro.combate ? { ...arbitro.combate } : null,
      tabla: [...arbitro.tabla.values()].sort((a, b) => b.ganados - a.ganados || a.perdidos - b.perdidos).slice(0, 8),
      ultimo: arbitro.ultimoFin
    };
    sendAll({ type: "combate:estado", ...combates, time: Date.now() });
    avisaCombates();
  }

  function respondeA(quien, motivo) {
    const packet = { type: "desafio:respuesta", motivo, time: Date.now() };
    if (quien === "host") alRecibirRespuesta(packet);
    else safeSend(hostSession?.peers.get(quien)?.channel, packet);
  }

  function arbitraLanza(quien, packet) {
    const tipo = String(packet.tipo || "");
    if (!hostSession || salaDeCable() || !arbitro.habilitados) return respondeA(quien, "desactivados");
    if (!TIPOS_DESAFIO[tipo] || !players.has(quien)) return;
    if (arbitro.combate) return respondeA(quien, "hay_combate");
    if (arbitro.desafios.some((d) => d.de === quien)) return respondeA(quien, "ya_tienes_uno");
    const ahora = Date.now();
    if (ahora - (arbitro.ultimo.get(quien) || 0) < DESAFIO_CADA_MS) return respondeA(quien, "espera");
    arbitro.ultimo.set(quien, ahora);
    const id = "d" + arbitro.siguiente++;
    arbitro.desafios.push({ id, de: quien, tipo, juego: cleanName(packet.juego || "").slice(0, 80), biblioteca: packet.biblioteca === true, caduca: ahora + DESAFIO_CADUCA_MS });
    /* A quién ha silenciado quien desafía: no podrán aceptarle. No se publica. */
    arbitro.vetados.set(id, new Set((Array.isArray(packet.vetados) ? packet.vetados : []).slice(0, 8).map(String)));
    publicaCombates();
  }

  function arbitraRetira(quien) {
    const antes = arbitro.desafios.length;
    arbitro.desafios = arbitro.desafios.filter((d) => d.de !== quien);
    if (arbitro.desafios.length !== antes) publicaCombates();
  }

  /* El primero que llega aquí se lo queda. */
  function arbitraAcepta(quien, id) {
    const desafio = arbitro.desafios.find((d) => d.id === id);
    if (!desafio) return respondeA(quien, arbitro.combate ? "ya_aceptado" : "caducado");
    if (arbitro.combate) return respondeA(quien, "ya_aceptado");
    if (desafio.de === quien || !players.has(quien) || !players.has(desafio.de)) return;
    if (arbitro.vetados.get(id)?.has(quien)) return respondeA(quien, "no_puedes");
    if (!(distanciaSala(players.get(quien), players.get(desafio.de)) <= ACEPTA_PX)) return respondeA(quien, "lejos");
    arbitro.combate = { id, a: desafio.de, b: quien, nombreA: nombrePublico(desafio.de), nombreB: nombrePublico(quien), tipo: desafio.tipo, juego: desafio.juego, estado: "conectando", inicio: 0, listos: [] };
    arbitro.desafios = arbitro.desafios.filter((d) => d.de !== desafio.de && d.de !== quien);
    arbitro.resultados.clear();
    publicaCombates();
  }

  function arbitraListo(quien) {
    const c = arbitro.combate;
    if (!c || c.estado !== "conectando" || (quien !== c.a && quien !== c.b)) return;
    if (!c.listos.includes(quien)) c.listos.push(quien);
    if (c.listos.length === 2) { c.estado = "jugando"; c.inicio = Date.now(); publicaCombates(); }
  }

  function terminaCombate(resultado) {
    const c = arbitro.combate;
    if (!c) return;
    clearTimeout(arbitro.plazo);
    if (TIPOS_DESAFIO[c.tipo]?.cuenta && ["gana_a", "gana_b", "empate"].includes(resultado)) {
      for (const [id, nombre, gano, perdio] of [[c.a, c.nombreA, resultado === "gana_a", resultado === "gana_b"], [c.b, c.nombreB, resultado === "gana_b", resultado === "gana_a"]]) {
        const fila = arbitro.tabla.get(id) || { nombre, ganados: 0, perdidos: 0, empates: 0 };
        fila.nombre = nombre;
        if (gano) fila.ganados++; else if (perdio) fila.perdidos++; else fila.empates++;
        arbitro.tabla.set(id, fila);
      }
    }
    arbitro.ultimoFin = { id: c.id, nombreA: c.nombreA, nombreB: c.nombreB, tipo: c.tipo, juego: c.juego, resultado };
    arbitro.combate = null;
    publicaCombates();
  }

  /* Cada combatiente dice cómo le ha ido. Solo cuenta si los dos coinciden. */
  function arbitraResultado(quien, r) {
    const c = arbitro.combate;
    if (!c || (quien !== c.a && quien !== c.b)) return;
    if (c.estado === "conectando") { if (r === "fallo") terminaCombate("sin_conexion"); return; }
    if (!["gane", "perdi", "empate", "abandono"].includes(r)) return;
    if (r === "abandono") return terminaCombate("abandonada");
    arbitro.resultados.set(quien, r);
    const ra = arbitro.resultados.get(c.a), rb = arbitro.resultados.get(c.b);
    if (ra && rb) {
      if (ra === "gane" && rb === "perdi") terminaCombate("gana_a");
      else if (ra === "perdi" && rb === "gane") terminaCombate("gana_b");
      else if (ra === "empate" && rb === "empate") terminaCombate("empate");
      else terminaCombate("disputado");
      return;
    }
    if (c.estado !== "terminando") {
      c.estado = "terminando";
      arbitro.plazo = setTimeout(() => terminaCombate("disputado"), RESULTADO_ESPERA_MS);
      publicaCombates();
    }
  }

  /* Una vez por segundo: caducan los desafíos y se va quien ya no está. */
  function arbitraVigila() {
    if (!hostSession) return;
    const ahora = Date.now();
    const antes = arbitro.desafios.length;
    arbitro.desafios = arbitro.desafios.filter((d) => d.caduca > ahora && players.has(d.de));
    const c = arbitro.combate;
    if (c && (!players.has(c.a) || !players.has(c.b))) return terminaCombate(c.estado === "conectando" ? "sin_conexion" : "abandonada");
    if (arbitro.desafios.length !== antes) publicaCombates();
  }
  setInterval(arbitraVigila, 1000);

  function arbitraPaquete(quien, packet) {
    if (packet.type === "desafio:lanza") arbitraLanza(quien, packet);
    else if (packet.type === "desafio:retira") arbitraRetira(quien);
    else if (packet.type === "desafio:acepta") arbitraAcepta(quien, String(packet.id || ""));
    else if (packet.type === "combate:listo") arbitraListo(quien);
    else if (packet.type === "combate:resultado") arbitraResultado(quien, String(packet.r || ""));
    else return false;
    return true;
  }

  /* ---- canal directo entre dos jugadores ---- */

  /* Los mensajes para abrirlo pasan por el anfitrión, que los entrega a su
     destinatario y a nadie más. Son descripciones de conexión, no datos del
     juego. */
  function senalDirecta(para, data) {
    const packet = { type: "directo:senal", para, de: localPlayerId, data, time: Date.now() };
    if (hostSession) safeSend(hostSession.peers.get(para)?.channel, packet);
    else safeSend(joinSession?.channel, packet);
  }
  function reenviaSenal(joinId, packet) {
    const para = String(packet.para || "");
    /* Solo entre los dos del combate que se está abriendo, y solo el
       mensaje de apertura: nada más pasa por aquí. */
    const c = arbitro.combate;
    if (!c || c.estado !== "conectando" || !((c.a === joinId && c.b === para) || (c.b === joinId && c.a === para))) return;
    if (JSON.stringify(packet.data ?? null).length > 20000) return;
    const senal = packet.data?.oferta || packet.data?.respuesta;
    try { if (!soloRelevo(JSON.parse(senal).sdp)) return; } catch { return; }
    const limpio = { type: "directo:senal", para, de: joinId, data: packet.data, time: Date.now() };
    if (para === "host") alRecibirSenal(limpio);
    else if (para !== joinId) safeSend(hostSession?.peers.get(para)?.channel, limpio);
  }


  /* El canal propio de los dos combatientes. Va también por el relevo:
     ninguno de los dos ve la IP del otro. */
  function conexionDirecta(cfg) {
    if (cfg?.iceTransportPolicy !== "relay") throw new Error(SIN_RELEVO);
    const pc = new RTCPeerConnection(cfg);
    pc.__cfg = cfg;
    pc.addEventListener("connectionstatechange", () => {
      log(`Duelo: conexión ${pc.connectionState}`);
      if ((pc.connectionState === "failed" || pc.connectionState === "closed") && duelo?.pc === pc && duelo.estado === "jugando") caeDuelo("se ha perdido la conexión con el otro jugador");
    });
    return pc;
  }
  function conectaCanal(canal) {
    if (!duelo) return;
    duelo.canal = canal;
    canal.addEventListener("open", () => { if (duelo?.canal === canal) { clearTimeout(duelo.plazo); avisaArbitro({ type: "combate:listo" }); } });
    canal.addEventListener("message", (event) => {
      let packet;
      try { packet = JSON.parse(event.data); } catch { return; }
      if (duelo?.canal === canal) alRecibirDelRival(packet);
    });
    canal.addEventListener("close", () => { if (duelo?.canal === canal && duelo.estado === "jugando") caeDuelo("se ha perdido la conexión con el otro jugador"); });
  }
  async function ofreceDirecto() {
    const mio = duelo;
    try {
      const cfg = await configRelevo();
      if (duelo !== mio || mio.pc) return;
      mio.pc = conexionDirecta(cfg);
      conectaCanal(mio.pc.createDataChannel("ml3d-duelo", { ordered: true }));
      await mio.pc.setLocalDescription(await mio.pc.createOffer());
      await waitIce(mio.pc);
      if (duelo !== mio) return;
      senalDirecta(mio.otro, { duelo: mio.id, oferta: serializaRelevo(mio.pc.localDescription) });
    } catch (error) { log(`Duelo: ${error.message}`); fallaDirecto(); }
  }
  async function alRecibirSenal(packet) {
    const data = packet.data || {};
    if (!duelo || data.duelo !== duelo.id || String(packet.de) !== duelo.otro) return;
    try {
      if (data.oferta && duelo.asiento === 1 && !duelo.pc) {
        const mio = duelo;
        const oferta = descripcionRelevo(data.oferta, "offer");
        const cfg = await configRelevo();
        if (duelo !== mio || mio.pc) return;
        mio.pc = conexionDirecta(cfg);
        mio.pc.addEventListener("datachannel", (event) => conectaCanal(event.channel));
        await mio.pc.setRemoteDescription(oferta);
        await mio.pc.setLocalDescription(await mio.pc.createAnswer());
        await waitIce(mio.pc);
        if (duelo !== mio) return;
        senalDirecta(mio.otro, { duelo: mio.id, respuesta: serializaRelevo(mio.pc.localDescription) });
      } else if (data.respuesta && duelo.asiento === 0 && duelo.pc && !duelo.pc.currentRemoteDescription) {
        await duelo.pc.setRemoteDescription(descripcionRelevo(data.respuesta, "answer"));
      }
    } catch (error) { log(`Duelo: ${error.message}`); fallaDirecto(); }
  }
  /* No se ha podido abrir, tampoco por el relevo: el combate no empieza. */
  function fallaDirecto() {
    if (!duelo || duelo.estado !== "conectando") return;
    const rival = duelo.nombreOtro;
    avisaArbitro({ type: "combate:resultado", r: "fallo" });
    sueltaDuelo();
    avisa(`No se ha podido abrir la conexión con ${rival}. El combate no empieza.`);
  }

  function avisaArbitro(packet) {
    packet.time = Date.now();
    if (hostSession) arbitraPaquete("host", packet);
    else safeSend(joinSession?.channel, packet);
  }

  /* ---- el combate de este jugador ---- */

  function sueltaDuelo() {
    if (!duelo) return;
    const viejo = duelo;
    duelo = null;
    clearTimeout(viejo.plazo);
    clearLocalLinkSession(viejo.sala);
    try { viejo.canal?.close(); } catch {}
    try { viejo.pc?.close(); } catch {}
    avisaCombates();
  }
  function caeDuelo(motivo) {
    if (!duelo) return;
    avisaCaidaAlEmulador(motivo, true);
    avisaArbitro({ type: "combate:resultado", r: "abandono" });
    duelo.estado = "caido";
    avisaCombates();
  }

  /* El cable de dos: este jugador es la consola 1 o la 2 de una sesión que
     solo existe entre los dos, con nombre propio para no mezclarse con la sala. */
  function empiezaDuelo() {
    if (!duelo || duelo.estado !== "conectando") return;
    duelo.estado = "jugando";
    olvidaCaida();
    rememberLocalLinkSession(duelo.sala, duelo.asiento, duelo.asiento === 0 ? "host" : "guest", 2, duelo.juego);
    showSessionBanner("3", 550);
    setTimeout(() => showSessionBanner("2", 550), 600);
    setTimeout(() => showSessionBanner("1", 550), 1200);
    setTimeout(() => showSessionBanner("ML3D LINK\nPREPARADO", 1800), 1800);
    const mio = duelo;
    setTimeout(() => {
      if (duelo !== mio) return;
      closeModal("selectModal");
      if (new URLSearchParams(location.search).get("embed") === "1") {
        window.parent?.postMessage({ source: "ml3d-lobby", type: "link-start", roomId: mio.sala, playerNumber: mio.asiento, role: mio.asiento === 0 ? "host" : "guest" }, location.origin);
      }
    }, 2400);
    avisaCombates();
  }

  /* Lo que llega del rival por el canal directo: el cable y el resultado. */
  function alRecibirDelRival(packet) {
    if (String(packet.type || "").startsWith("relevo:")) { alRenovar(duelo.pc, duelo.canal, packet, duelo.asiento === 0); return; }
    const rival = duelo.asiento === 0 ? 1 : 0;
    const base = { roomId: duelo.sala, sessionId: String(packet.sessionId || ""), playerNumber: rival };
    if (packet.type === "gba:lockstep:ready") {
      postLocalLink({
        type: "gba:lockstep:remote-ready", roomId: duelo.sala, ready: true, playerNumber: rival,
        romHash: String(packet.romHash || ""), protocol: String(packet.protocol || ""),
        consent: packet.consent === true, declined: packet.declined === true, go: packet.go === true, have: String(packet.have || ""),
        pre: packet.pre === true,
        rom: packet.rom && typeof packet.rom === "object" ? {
          hash: String(packet.rom.hash || ""), nombre: String(packet.rom.nombre || "").slice(0, 120),
          size: Number(packet.rom.size) | 0, origen: String(packet.rom.origen || ""), envio: packet.rom.envio === true
        } : null,
        preHave: String(packet.preHave || ""), motivo: String(packet.motivo || "").slice(0, 24)
      });
    } else if (packet.type === "gba:lockstep:save") {
      postLocalLink({ ...savePacket(packet, duelo.sala, rival), type: "gba:lockstep:remote-save" });
    } else if (packet.type === "gba:lockstep:start" && rival === 0) {
      postLocalLink({ type: "gba:lockstep:start", roomId: duelo.sala, sessionId: base.sessionId, delay: Number(packet.delay) | 0, romHash: String(packet.romHash || ""), clock: Number(packet.clock) || 0 });
    } else if (packet.type === "gba:lockstep:input") {
      postLocalLink({ type: "gba:lockstep:remote-input", ...base, frame: Number(packet.frame), mask: Number(packet.mask) & 0x3ff });
    } else if (packet.type === "gba:lockstep:sync") {
      postLocalLink({ type: "gba:lockstep:remote-sync", ...base, frame: Number(packet.frame), hash: Number(packet.hash) >>> 0, stats: packet.stats || null });
    } else if (packet.type === "duelo:resultado") {
      /* El rival ha terminado: se suelta el cable y se pregunta el resultado. */
      duelo.suyo = String(packet.r || "");
      if (duelo.estado === "jugando") { duelo.estado = "terminando"; clearLocalLinkSession(duelo.sala); window.parent?.postMessage({ source: "ml3d-lobby", type: "attention" }, location.origin); }
      resuelveSinSala();
      avisaCombates();
    }
  }

  /* El jugador dice cómo ha acabado: gane, perdi, empate o abandono. */
  function terminaMiDuelo(r) {
    if (!duelo || !["gane", "perdi", "empate", "abandono"].includes(r)) return;
    duelo.mio = r;
    safeSend(duelo.canal, { type: "duelo:resultado", r, time: Date.now() });
    if (duelo.estado === "jugando") { duelo.estado = "terminando"; clearLocalLinkSession(duelo.sala); }
    avisaArbitro({ type: "combate:resultado", r });
    resuelveSinSala();
    avisaCombates();
  }
  /* Sin sala (el anfitrión se fue): el resultado lo cierran los dos entre ellos. */
  function resuelveSinSala() {
    if (!duelo || hostSession || joinSession) return;
    const mio = duelo.mio, suyo = duelo.suyo;
    if (mio !== "abandono" && suyo !== "abandono" && !(mio && suyo)) return;
    const texto = mio === "abandono" || suyo === "abandono" ? "Partida abandonada."
      : mio === "gane" && suyo === "perdi" ? `Has ganado a ${duelo.nombreOtro}.`
      : mio === "perdi" && suyo === "gane" ? `${duelo.nombreOtro} te ha ganado.`
      : mio === "empate" && suyo === "empate" ? "Empate." : "Resultado disputado: no coincidís.";
    sueltaDuelo();
    avisa(texto);
  }

  /* Cada vez que cambia lo público, este jugador mira si le toca algo. */
  function reaccionaCombate() {
    const c = combates.combate;
    const soyDe = (x) => x && (x.a === localPlayerId || x.b === localPlayerId);
    if (soyDe(c) && !duelo) {
      const soyA = c.a === localPlayerId;
      duelo = { id: c.id, otro: soyA ? c.b : c.a, nombreOtro: soyA ? c.nombreB : c.nombreA, asiento: soyA ? 0 : 1, tipo: c.tipo, juego: c.juego, estado: "conectando",
        sala: `${currentRoomId()}:${c.id}`, pc: null, canal: null, mio: "", suyo: "" };
      duelo.plazo = setTimeout(fallaDirecto, DIRECTO_ESPERA_MS + (soyA ? 0 : 3000));
      if (soyA) ofreceDirecto();
    }
    if (duelo && c && c.id === duelo.id && c.estado === "jugando" && duelo.estado === "conectando") empiezaDuelo();
    if (duelo && c && c.id === duelo.id && c.estado === "terminando" && duelo.estado === "jugando") {
      duelo.estado = "terminando";
      clearLocalLinkSession(duelo.sala);
      window.parent?.postMessage({ source: "ml3d-lobby", type: "attention" }, location.origin);
    }
    /* El árbitro lo ha cerrado. */
    if (duelo && (!c || c.id !== duelo.id) && (hostSession || joinSession)) {
      const fin = combates.ultimo && combates.ultimo.id === duelo.id ? combates.ultimo.resultado : "";
      const eraA = duelo.asiento === 0;
      const texto = fin === "sin_conexion" ? "" : fin === "abandonada" ? "Partida abandonada."
        : fin === "disputado" ? "Resultado disputado: no coincidís."
        : fin === "empate" ? "Empate."
        : fin === "gana_a" || fin === "gana_b" ? ((fin === "gana_a") === eraA ? `Has ganado a ${duelo.nombreOtro}.` : `${duelo.nombreOtro} te ha ganado.`) : "";
      sueltaDuelo();
      if (texto) avisa(texto);
    }
  }

  function alRecibirRespuesta(packet) {
    const TEXTO = { ya_aceptado: "Ya aceptado: otro jugador llegó antes.", caducado: "Ese desafío ya no está.", no_puedes: "No puedes aceptar este desafío.", lejos: "Estás demasiado lejos. Acércate a quien desafía.",
      desactivados: "Los desafíos están desactivados en esta sala.", hay_combate: "Ya hay un combate en la sala. Espera a que termine.",
      ya_tienes_uno: "Ya tienes un desafío lanzado.", espera: "Espera un poco antes de lanzar otro desafío." };
    avisa(TEXTO[packet.motivo] || "No se ha podido.");
  }

  /* Marcas en cada jugador para que se vea quién desafía y quién juega. */
  function pintaCombates() {
    for (const el of playersLayer.querySelectorAll(".player")) {
      const id = el.dataset.playerId;
      const d = combates.desafios.find((x) => x.de === id);
      const c = combates.combate;
      const marca = c && (c.a === id || c.b === id) ? "combate" : d ? "desafio:" + d.tipo : "";
      if ((el.dataset.duelo || "") !== marca) { if (marca) el.dataset.duelo = marca; else delete el.dataset.duelo; }
      if (d) el.dataset.desafio = d.id; else delete el.dataset.desafio;
    }
    document.body.classList.toggle("sala-de-cable", salaDeCable());
    const casilla = $("#hostDesafios");
    if (casilla) casilla.checked = combates.habilitados;
  }
  function avisaCombates() {
    reaccionaCombate();
    pintaCombates();
    for (const escucha of escuchasCombate) { try { escucha(); } catch (error) { console.error(error); } }
  }
  function currentRoomId() { return String(hostSession?.room?.id || joinSession?.room?.id || ""); }

  /* Al cambiar de sala no queda nada de la anterior. */
  function olvidaCombates() {
    arbitro.ultimo.clear(); arbitro.vetados.clear(); arbitro.resultados.clear(); arbitro.tabla.clear();
    arbitro.desafios = []; arbitro.combate = null; arbitro.ultimoFin = null; arbitro.habilitados = true;
    clearTimeout(arbitro.plazo);
    rechazados.clear();
    combates = { habilitados: true, desafios: [], combate: null, tabla: [], ultimo: null };
  }

  window.ML3DCombates = {
    cerca: CERCA_PX,
    tipos: Object.fromEntries(Object.entries(TIPOS_DESAFIO).map(([id, t]) => [id, t.nombre])),
    get disponible() { return Boolean(hostSession || joinSession) && !salaDeCable(); },
    estado() {
      return { ...combates, yo: localPlayerId, esAnfitrion: Boolean(hostSession),
        duelo: duelo ? { id: duelo.id, estado: duelo.estado, rival: duelo.nombreOtro, juego: duelo.juego, tipo: duelo.tipo, mio: duelo.mio, suyo: duelo.suyo } : null };
    },
    /* "biblioteca": quien desafía dice si su juego es de la biblioteca de
       testers, para que a quien le falte se le ofrezca pedir acceso. Es solo
       una pista para el aviso: el acceso lo decide el servidor. */
    lanza(tipo, juego, biblioteca = false) { avisaArbitro({ type: "desafio:lanza", tipo, juego, biblioteca: biblioteca === true, vetados: [...silenciados] }); },
    retira() { avisaArbitro({ type: "desafio:retira" }); },
    acepta(id) { avisaArbitro({ type: "desafio:acepta", id }); },
    rechaza(id) { rechazados.add(id); avisaCombates(); },
    rechazado: (id) => rechazados.has(id),
    silenciado: (playerId) => silenciados.has(playerId),
    silencia(playerId) { if (!silenciados.has(playerId)) cambiaSilencio(playerId); },
    termina: terminaMiDuelo,
    /* Anfitrión: activar o desactivar los desafíos de la sala. */
    activa(valor) { if (!hostSession) return; arbitro.habilitados = Boolean(valor); if (!valor) arbitro.desafios = []; publicaCombates(); },
    onCambio(escucha) { escuchasCombate.add(escucha); }
  };

  /* ---------------------------------------------------------------- chat y gestos

     El chat va directo entre navegadores y no se guarda en ningún servidor.
     - Filtro de palabras (filtro-chat.js): al enviar, al repartir y al mostrar.
     - Silenciar: quien silencia a un jugador deja de ver lo que dice y sus
       gestos. Es cosa suya: el otro no se entera y los demás le siguen viendo.
     - El anfitrión puede desactivar el chat de la sala. Entonces no reparte
       ningún mensaje, aunque un navegador modificado los mande. */
  const filtra = (text) => (window.ML3DFiltroChat ? window.ML3DFiltroChat.limpia(text) : text);
  const silenciados = new Set();   /* ids de jugador, mientras dure la sala */
  /* Va en la sesión y no en los datos de la sala: esos los refresca el
     servidor de salas, que no sabe nada del chat, y lo borraba. */
  function chatPermitido() {
    return (hostSession || joinSession)?.chat !== false;
  }
  function avisa(texto) {
    if (window.ML3DLobbyUI?.avisa) window.ML3DLobbyUI.avisa(texto, 3500);
  }
  /* El anfitrión cambia si hay chat; se lo cuenta a todos con la foto de la sala. */
  function ponChat(activo) {
    if (!hostSession) return;
    hostSession.chat = Boolean(activo);
    if (!activo) closeChat();
    sendAll(lobbySnapshot());
    pintaChat();
  }
  function pintaChat() {
    const activo = chatPermitido();
    document.body.classList.toggle("chat-desactivado", !activo);
    const casilla = $("#hostChat");
    if (casilla) casilla.checked = activo;
    if (!activo && !$("#chatComposer").hidden) closeChat();
  }
  function cambiaSilencio(playerId) {
    if (silenciados.has(playerId)) silenciados.delete(playerId);
    else {
      silenciados.add(playerId);
      ultimosMensajes.delete(playerId);
      playersLayer.querySelector(`.player[data-player-id="${CSS.escape(playerId)}"] .chat-bubble`)?.remove();
    }
    renderPlayers();
  }

  /* Gestos rápidos, sin escribir. Lista cerrada: por la red va solo el
     nombre del gesto, y lo que no esté en la lista se ignora. */
  const GESTOS = ["salto", "saludo", "aplauso", "risa", "corazon"];
  const GESTO_CADA_MS = 1200;
  const gestoTimers = new Map();
  let ultimoGestoPropio = 0;
  function muestraGesto(playerId, gesto) {
    if (!GESTOS.includes(gesto) || silenciados.has(playerId)) return;
    const el = playersLayer.querySelector(`.player[data-player-id="${CSS.escape(playerId)}"]`);
    if (!el) return;
    if (gesto === "salto") {
      el.classList.remove("saltando");
      void el.offsetWidth;   /* para que la animación vuelva a empezar */
      el.classList.add("saltando");
      setTimeout(() => el.classList.remove("saltando"), 520);
      return;
    }
    el.dataset.gesto = gesto;
    clearTimeout(gestoTimers.get(playerId));
    gestoTimers.set(playerId, setTimeout(() => { delete el.dataset.gesto; gestoTimers.delete(playerId); }, 1900));
  }
  function sendGesto(gesto) {
    if (!GESTOS.includes(gesto) || !localPlayerId) return false;
    const ahora = Date.now();
    if (ahora - ultimoGestoPropio < GESTO_CADA_MS) return false;
    ultimoGestoPropio = ahora;
    muestraGesto(localPlayerId, gesto);
    if (hostSession) sendAll({ type: "lobby:gesto", playerId: "host", gesto, time: ahora });
    else if (joinSession) safeSend(joinSession.channel, { type: "lobby:gesto", gesto, time: ahora });
    return true;
  }
  window.ML3DLobbyGestos = { lista: [...GESTOS], envia: sendGesto };

  function showChatBubble(playerId, text) {
    if (silenciados.has(playerId)) return;
    text = filtra(text);
    apuntaMensaje(playerId, text);
    const el = playersLayer.querySelector(`.player[data-player-id="${CSS.escape(playerId)}"]`);
    if (!el) return;
    let bubble = el.querySelector(".chat-bubble");
    if (!bubble) {
      bubble = document.createElement("div");
      bubble.className = "chat-bubble";
      el.append(bubble);
    }
    bubble.textContent = text;
    if (chatTimers.has(playerId)) clearTimeout(chatTimers.get(playerId));
    chatTimers.set(playerId, setTimeout(() => {
      bubble.remove();
      chatTimers.delete(playerId);
    }, CHAT_LIFETIME_MS));
  }

  function updateToolbar(room) {
    if (!room) return;
    $("#lobbyRoomName").textContent = nombreSala(room);
    $("#lobbyGameName").textContent = room.game || "Sin juego seleccionado";
    $("#lobbyRoomCode").textContent = room.id ? `Código ${room.id}` : "";
    $("#hostGameInput").value = room.game || "";
    $("#hostRoomNameInput").value = sinEnlaces(room.name || "");
    $("#hostMaxPlayers").value = String(room.maxPlayers || 2);
    $("#guestRoomInfo").textContent = `${nombreSala(room)}${room.game ? ` · ${room.game}` : ""}`;
  }

  function updateDiagnostics() {
    let rtt = null;
    let jitter = null;
    let quality = "unknown";
    if (hostSession) {
      const metrics = [...hostSession.peers.values()].filter((p) => Number.isFinite(p.metrics?.rtt)).map((p) => p.metrics);
      if (metrics.length) {
        const worst = metrics.sort((a, b) => (b.rtt || 0) - (a.rtt || 0))[0];
        rtt = worst.rtt;
        jitter = worst.jitter;
        quality = worst.quality;
      } else if (hostSession.peers.size === 0) {
        quality = "good";
        rtt = 0;
        jitter = 0;
      }
    } else if (joinSession && localPlayerId && players.has(localPlayerId)) {
      const me = players.get(localPlayerId);
      rtt = me.rtt;
      jitter = me.jitter;
      quality = me.quality;
    }
    $("#metricPing").textContent = Number.isFinite(rtt) ? `${Math.round(rtt)} ms` : "—";
    $("#metricJitter").textContent = Number.isFinite(jitter) ? `${Math.round(jitter)} ms` : "—";
    $("#metricQuality").textContent = qualityLabel(quality);
  }

  function lobbySnapshot() {
    return {
      type: "lobby:snapshot",
      room: hostSession?.room || null,
      chat: hostSession?.chat !== false,
      players: [...players.values()].map(playerSnapshot),
      time: Date.now()
    };
  }

  function broadcastPlayer(player, exceptJoinId = null) {
    sendAll({ type: "lobby:player", player: playerSnapshot(player), time: Date.now() }, exceptJoinId);
  }

  function handleHostPacket(joinId, packet) {
    if (!hostSession) return;
    const peer = hostSession.peers.get(joinId);
    const player = players.get(joinId);
    if (!peer) return;

    if (packet.type === "directo:senal") { reenviaSenal(joinId, packet); return; }
    if (packet.type === "relevo:pide" || packet.type === "relevo:respuesta") { alRenovar(peer.pc, peer.channel, packet, true); return; }
    if (arbitraPaquete(joinId, packet)) return;
    /* En una sala de 3 o 4 el cable de los combates no pasa por aquí. Si
       llegara algo, no se mira ni se reparte. */
    if (!salaDeCable() && String(packet.type || "").startsWith("gba:lockstep:")) return;

    if (packet.type === "gba:lockstep:ready") {
      postLocalLink({
        type: "gba:lockstep:remote-ready",
        roomId: hostSession.room.id,
        ready: true,
        playerNumber: Math.max(1, Math.min(3, Number(peer.linkSlot) | 0)),
        romHash: String(packet.romHash || ""),
        protocol: String(packet.protocol || ""),
        consent: packet.consent === true,
        declined: packet.declined === true,
        have: String(packet.have || ""),
        /* Juegos distintos: qué cartucho lleva cada uno y cuál ajeno tiene ya. */
        pre: packet.pre === true,
        rom: packet.rom && typeof packet.rom === "object" ? {
          hash: String(packet.rom.hash || ""), nombre: String(packet.rom.nombre || "").slice(0, 120),
          size: Number(packet.rom.size) | 0, origen: String(packet.rom.origen || ""), envio: packet.rom.envio === true
        } : null,
        preHave: String(packet.preHave || ""),
        motivo: String(packet.motivo || "").slice(0, 24),
      });
      return;
    }

    if (packet.type === "gba:lockstep:save") {
      /* El asiento lo pone el host: un invitado no puede hacerse pasar por otro. */
      const slot = Math.max(1, Math.min(3, Number(peer.linkSlot) | 0));
      const relayed = savePacket(packet, hostSession.room.id, slot);
      postLocalLink({ ...relayed, type: "gba:lockstep:remote-save" });
      sendAll(relayed, joinId);
      return;
    }

    if (packet.type === "gba:lockstep:input") {
      const slot = Math.max(1, Math.min(3, Number(peer.linkSlot) | 0));
      postLocalLink({
        type: "gba:lockstep:remote-input",
        roomId: hostSession.room.id,
        sessionId: String(packet.sessionId || ""),
        playerNumber: slot,
        frame: Number(packet.frame),
        mask: Number(packet.mask) & 0x3ff
      });
      /* Con tres o cuatro jugadores, los demás invitados también necesitan
         estas teclas: el host es el único que habla con todos. */
      sendAll({
        type: "gba:lockstep:input",
        roomId: hostSession.room.id,
        sessionId: String(packet.sessionId || ""),
        playerNumber: slot,
        frame: Number(packet.frame),
        mask: Number(packet.mask) & 0x3ff,
        time: Date.now()
      }, joinId);
      return;
    }

    if (packet.type === "gba:lockstep:sync") {
      const slot = Math.max(1, Math.min(3, Number(peer.linkSlot) | 0));
      postLocalLink({
        type: "gba:lockstep:remote-sync",
        roomId: hostSession.room.id,
        sessionId: String(packet.sessionId || ""),
        playerNumber: slot,
        frame: Number(packet.frame),
        hash: Number(packet.hash) >>> 0,
        stats: packet.stats || null
      });
      sendAll({
        type: "gba:lockstep:sync",
        roomId: hostSession.room.id,
        sessionId: String(packet.sessionId || ""),
        playerNumber: slot,
        frame: Number(packet.frame),
        hash: Number(packet.hash) >>> 0,
        /* Las cifras del emisor viajan pegadas a la huella; sin
           reenviarlas, el otro lado no ve como le va a su compañero. */
        stats: packet.stats || null,
        time: Date.now()
      }, joinId);
      return;
    }

    if (packet.type === "gba:link:ready") {
      peer.linkReady = Boolean(packet.ready);
      const activePeers = [...hostSession.peers.values()].filter((item) => item.channel?.readyState === "open");
      const remoteReady = activePeers.length > 0 && activePeers.every((item) => Boolean(item.linkReady));
      postLocalLink({
        type: "gba:link:remote-ready",
        roomId: hostSession.room.id,
        ready: remoteReady
      });
      log(`${peer.join.displayName}: GBA ${peer.linkReady ? "MULTIPLAYER LISTA" : "no lista"}.`);
      return;
    }

    if (packet.type === "gba:link:reply") {
      if (!gbaLinkPending || String(packet.seq || "") !== gbaLinkPending.seq) return;
      const slot = Math.max(1, Math.min(3, Number(peer.linkSlot) | 0));
      gbaLinkPending.words[slot] = Number(packet.word) & 0xFFFF;
      gbaLinkPending.waiting.delete(joinId);
      if (!gbaLinkPending.waiting.size) completeHostLinkTransfer(false);
      return;
    }

    if (packet.type === "gba:link:hw-complete") {
      postLocalLink({
        type: "gba:link:remote-hw-complete",
        roomId: hostSession.room.id,
        seq: String(packet.seq || ""),
        playerNumber: Math.max(1, Math.min(3, Number(peer.linkSlot) | 0)),
        error: Boolean(packet.error)
      });
      return;
    }

    if (packet.type === "gba:link:prepared-word") {
      postLocalLink({
        type: "gba:link:remote-prepared-word",
        roomId: hostSession.room.id,
        playerNumber: Math.max(1, Math.min(3, Number(peer.linkSlot) | 0)),
        word: Number(packet.word) & 0xFFFF,
        reason: String(packet.reason || "")
      });
      return;
    }

    if (packet.type === "gba:link:next-word-ready") {
      postLocalLink({
        type: "gba:link:remote-next-word-ready",
        roomId: hostSession.room.id,
        seq: String(packet.seq || ""),
        playerNumber: Math.max(1, Math.min(3, Number(peer.linkSlot) | 0)),
        word: Number(packet.word) & 0xFFFF,
        reason: String(packet.reason || "")
      });
      return;
    }

    if (packet.type === "lobby:pause") {
      if (!player) return;
      peer.notifiedPause = packet.paused === true;
      peer.pausedSince = peer.notifiedPause ? Date.now() : 0;
      if (!peer.notifiedPause) {
        peer.silentPaused = false;
        hostSession.reservas.delete(peer.reserva);
      }
      ponPausado(hostSession, joinId, peer, peer.notifiedPause);
      return;
    }

    /* Se despide: sale por su voluntad y no hay hueco que guardarle. */
    if (packet.type === "lobby:bye") {
      peer.adios = true;
      return;
    }

    if (packet.type === "lobby:profile") {
      const incoming = normalizeProfile(packet.profile || {});
      if (player) {
        player.name = incoming.name;
        player.avatar = { color: incoming.color, body: incoming.body, face: incoming.face, accessory: incoming.accessory };
        player.aspecto = incoming.aspecto;
        renderPlayers();
        broadcastPlayer(player);
      }
      return;
    }

    if (packet.type === "lobby:move" && player) {
      player.x = clamp(packet.x, 7, 93, player.x);
      player.y = clamp(packet.y, 28, 88, player.y);
      renderPlayers();
      sendAll({ type: "lobby:move", playerId: joinId, x: player.x, y: player.y, time: Date.now() }, joinId);
      return;
    }

    if (packet.type === "lobby:gesto" && player) {
      /* Lista cerrada y, como mucho, uno por segundo y jugador. */
      const ahora = Date.now();
      if (!GESTOS.includes(packet.gesto) || ahora - (peer.ultimoGesto || 0) < 1000) return;
      peer.ultimoGesto = ahora;
      muestraGesto(joinId, packet.gesto);
      sendAll({ type: "lobby:gesto", playerId: joinId, gesto: packet.gesto, time: ahora }, joinId);
      return;
    }

    if (packet.type === "lobby:chat" && player) {
      /* Con el chat desactivado no se reparte nada, lo mande quien lo mande. */
      if (!chatPermitido()) return;
      const text = filtra(cleanChat(packet.text));
      if (!text) return;
      showChatBubble(joinId, text);
      sendAll({ type: "lobby:chat", playerId: joinId, text, time: Date.now() });
      return;
    }

    if (packet.type === "net:pong") {
      handleHostPong(peer, packet);
      return;
    }

    if (packet.type === "debug:message") {
      log(`${player?.name || "Jugador"}: ${cleanChat(packet.text)}`);
    }
  }

  function handleGuestPacket(packet) {
    if (packet.type === "relevo:oferta") { alRenovar(joinSession?.pc, joinSession?.channel, packet, false); return; }
    if (packet.type === "combate:estado") {
      const texto = (v, n) => String(v || "").slice(0, n);
      const c = packet.combate && typeof packet.combate === "object" ? packet.combate : null;
      combates = {
        habilitados: packet.habilitados !== false,
        desafios: (Array.isArray(packet.desafios) ? packet.desafios : []).slice(0, 4).filter((d) => TIPOS_DESAFIO[d?.tipo]).map((d) => ({ id: texto(d.id, 12), de: texto(d.de, 64), nombre: filtra(texto(d.nombre, NOMBRE_TABLA_MAX)), tipo: d.tipo, juego: texto(d.juego, 80), biblioteca: d.biblioteca === true, caduca: Number(d.caduca) || 0 })),
        combate: c && TIPOS_DESAFIO[c.tipo] ? { id: texto(c.id, 12), a: texto(c.a, 64), b: texto(c.b, 64), nombreA: filtra(texto(c.nombreA, NOMBRE_TABLA_MAX)), nombreB: filtra(texto(c.nombreB, NOMBRE_TABLA_MAX)), tipo: c.tipo, juego: texto(c.juego, 80), estado: texto(c.estado, 12), inicio: Number(c.inicio) || 0 } : null,
        tabla: (Array.isArray(packet.tabla) ? packet.tabla : []).slice(0, 8).map((f) => ({ nombre: filtra(texto(f?.nombre, NOMBRE_TABLA_MAX)), ganados: Number(f?.ganados) | 0, perdidos: Number(f?.perdidos) | 0, empates: Number(f?.empates) | 0 })),
        ultimo: packet.ultimo && typeof packet.ultimo === "object" ? { id: texto(packet.ultimo.id, 12), nombreA: filtra(texto(packet.ultimo.nombreA, NOMBRE_TABLA_MAX)), nombreB: filtra(texto(packet.ultimo.nombreB, NOMBRE_TABLA_MAX)), tipo: texto(packet.ultimo.tipo, 12), juego: texto(packet.ultimo.juego, 80), resultado: texto(packet.ultimo.resultado, 14) } : null
      };
      avisaCombates();
      return;
    }
    if (packet.type === "desafio:respuesta") { alRecibirRespuesta(packet); return; }
    if (packet.type === "directo:senal") { alRecibirSenal(packet); return; }
    if (!salaDeCable() && String(packet.type || "").startsWith("gba:lockstep:")) return;

    if (packet.type === "gba:lockstep:ready") {
      postLocalLink({
        type: "gba:lockstep:remote-ready",
        roomId: packet.roomId || joinSession?.room?.id || "",
        ready: true,
        playerNumber: 0,
        romHash: String(packet.romHash || ""),
        protocol: String(packet.protocol || ""),
        consent: packet.consent === true,
        declined: packet.declined === true,
        go: packet.go === true,
        have: String(packet.have || ""),
        /* Juegos distintos: qué cartucho lleva cada uno y cuál ajeno tiene ya. */
        pre: packet.pre === true,
        rom: packet.rom && typeof packet.rom === "object" ? {
          hash: String(packet.rom.hash || ""), nombre: String(packet.rom.nombre || "").slice(0, 120),
          size: Number(packet.rom.size) | 0, origen: String(packet.rom.origen || ""), envio: packet.rom.envio === true
        } : null,
        preHave: String(packet.preHave || ""),
        motivo: String(packet.motivo || "").slice(0, 24),
      });
      return;
    }

    if (packet.type === "gba:lockstep:save") {
      const relayed = savePacket(packet, packet.roomId || joinSession?.room?.id || "",
        Math.max(0, Math.min(3, Number(packet.playerNumber) | 0)));
      postLocalLink({ ...relayed, type: "gba:lockstep:remote-save" });
      return;
    }

    if (packet.type === "gba:lockstep:start") {
      postLocalLink({
        type: "gba:lockstep:start",
        roomId: packet.roomId || joinSession?.room?.id || "",
        sessionId: String(packet.sessionId || ""),
        delay: Number(packet.delay) | 0,
        romHash: String(packet.romHash || ""),
        clock: Number(packet.clock) || 0
      });
      return;
    }

    if (packet.type === "gba:lockstep:input") {
      postLocalLink({
        type: "gba:lockstep:remote-input",
        roomId: packet.roomId || joinSession?.room?.id || "",
        sessionId: String(packet.sessionId || ""),
        /* Puede venir del host (0) o de otro invitado reenviado por él. */
        playerNumber: Math.max(0, Math.min(3, Number(packet.playerNumber) | 0)),
        frame: Number(packet.frame),
        mask: Number(packet.mask) & 0x3ff
      });
      return;
    }

    if (packet.type === "gba:lockstep:sync") {
      postLocalLink({
        type: "gba:lockstep:remote-sync",
        roomId: packet.roomId || joinSession?.room?.id || "",
        sessionId: String(packet.sessionId || ""),
        playerNumber: Math.max(0, Math.min(3, Number(packet.playerNumber) | 0)),
        frame: Number(packet.frame),
        hash: Number(packet.hash) >>> 0,
        stats: packet.stats || null
      });
      return;
    }

    if (packet.type === "gba:link:ready") {
      postLocalLink({
        type: "gba:link:remote-ready",
        roomId: packet.roomId || joinSession?.room?.id || "",
        ready: Boolean(packet.ready)
      });
      log(`Host: GBA ${packet.ready ? "MULTIPLAYER LISTA" : "no lista"}.`);
      return;
    }

    if (packet.type === "gba:link:configure") {
      const slot = Math.max(1, Math.min(3, Number(packet.playerNumber) | 0));
      if (joinSession) {
        joinSession.linkSlot = slot;
        joinSession.linkPlayers = Math.max(2, Math.min(4, Number(packet.players) | 0 || 2));
      }
      rememberLocalLinkSession(packet.roomId || joinSession?.room?.id || "", slot, "guest", packet.players);
      return;
    }

    if (packet.type === "gba:link:prepared-transfer") {
      if (packet.hostReady !== undefined) {
        postLocalLink({
          type: "gba:link:remote-ready",
          roomId: packet.roomId || joinSession?.room?.id || "",
          ready: Boolean(packet.hostReady)
        });
      }
      postLocalLink({
        type: "gba:link:prepared-transfer",
        roomId: packet.roomId || joinSession?.room?.id || "",
        seq: String(packet.seq || ""),
        words: Array.isArray(packet.words) ? packet.words : [],
        playerNumber: Math.max(1, Math.min(3, Number(packet.playerNumber) | 0)),
        connectedCount: Math.max(0, Math.min(3, Number(packet.connectedCount) | 0)),
        baud: Number(packet.baud) & 0x3
      });
      return;
    }

    if (packet.type === "gba:link:poll") {
      postLocalLink({
        type: "gba:link:poll",
        roomId: packet.roomId || joinSession?.room?.id || "",
        seq: String(packet.seq || ""),
        playerNumber: Math.max(1, Math.min(3, Number(packet.playerNumber) | 0)),
        baud: Number(packet.baud) & 0x3,
        hostWord: Number(packet.hostWord) & 0xFFFF
      });
      return;
    }

    if (packet.type === "gba:link:complete") {
      postLocalLink({
        type: "gba:link:complete",
        roomId: packet.roomId || joinSession?.room?.id || "",
        seq: String(packet.seq || ""),
        words: Array.isArray(packet.words) ? packet.words : [],
        playerNumber: Math.max(1, Math.min(3, Number(packet.playerNumber) | 0)),
        connectedCount: Math.max(0, Math.min(3, Number(packet.connectedCount) | 0)),
        error: Boolean(packet.error)
      });
      return;
    }

    if (packet.type === "lobby:snapshot") {
      const next = new Map();
      for (const raw of Array.isArray(packet.players) ? packet.players : []) {
        const p = normalizeIncomingPlayer(raw);
        next.set(p.id, p);
      }
      players = next;
      if (packet.room) {
        joinSession.room = { ...joinSession.room, ...packet.room };
        updateToolbar(joinSession.room);
      }
      /* ¿Hay chat en la sala? Lo dice el anfitrión en cada foto. */
      const habia = chatPermitido();
      const primera = joinSession.chat === undefined;
      joinSession.chat = packet.chat !== false;
      pintaChat();
      if (!primera && habia !== chatPermitido()) avisa(chatPermitido() ? "El anfitrión ha activado el chat." : "El anfitrión ha desactivado el chat.");
      renderPlayers();
      /* La foto no sabe si este jugador está ahora mismo en pausa. */
      if (document.hidden) publicaPausa();
      return;
    }

    if (packet.type === "lobby:player") {
      const p = normalizeIncomingPlayer(packet.player);
      const existing = players.get(p.id) || {};
      players.set(p.id, { ...existing, ...p });
      renderPlayers();
      return;
    }

    if (packet.type === "lobby:move") {
      const p = players.get(packet.playerId);
      if (p && packet.playerId !== localPlayerId) {
        p.x = clamp(packet.x, 7, 93, p.x);
        p.y = clamp(packet.y, 28, 88, p.y);
        renderPlayers();
      }
      return;
    }

    if (packet.type === "lobby:chat") {
      if (chatPermitido()) showChatBubble(String(packet.playerId || ""), cleanChat(packet.text));
      return;
    }

    if (packet.type === "lobby:gesto") {
      const quien = String(packet.playerId || "");
      if (quien !== localPlayerId) muestraGesto(quien, String(packet.gesto || ""));
      return;
    }

    if (packet.type === "lobby:quality") {
      const p = players.get(packet.playerId);
      if (p) {
        p.quality = qualityClass(packet.quality);
        p.rtt = Number.isFinite(packet.rtt) ? packet.rtt : null;
        p.jitter = Number.isFinite(packet.jitter) ? packet.jitter : null;
        renderPlayers();
      }
      return;
    }

    if (packet.type === "lobby:room") {
      joinSession.room = { ...joinSession.room, ...packet.room };
      updateToolbar(joinSession.room);
      return;
    }

    if (packet.type === "lobby:player-left") {
      players.delete(String(packet.playerId));
      renderPlayers();
      return;
    }

    if (packet.type === "net:ping") {
      /* Cada respuesta dice si este jugador está ahora en pausa. Así el
         anfitrión se pone al día aunque se pierda un aviso suelto: una
         página congelada no contesta, y al descongelarse dice que ha vuelto. */
      safeSend(joinSession.channel, { type: "net:pong", id: packet.id, sentAt: packet.sentAt, paused: document.hidden, time: Date.now() });
      return;
    }

    if (packet.type === "session:start") {
      const launchDelay = Math.max(1800, Number(packet.launchDelay) || 2400);
      cuentaAtras = true;
      setTimeout(() => { cuentaAtras = false; }, launchDelay + 4000);
      showSessionBanner("3", 550);
      setTimeout(() => showSessionBanner("2", 550), 600);
      setTimeout(() => showSessionBanner("1", 550), 1200);
      setTimeout(() => showSessionBanner("ML3D LINK\nPREPARADO", 1800), 1800);
      setTimeout(() => openLinkEmulator(), launchDelay);
      return;
    }

    if (packet.type === "lobby:pause") {
      const quien = players.get(String(packet.playerId));
      if (quien) {
        quien.paused = packet.paused === true;
        renderPlayers();
      }
      return;
    }

    if (packet.type === "lobby:reserva") {
      joinSession.reserva = String(packet.token || "");
      guardaReserva();
      clearInterval(joinSession.reservaTimer);
      /* "visto" se refresca mientras se está en la sala: al cerrar el
         navegador, lo último escrito dice cuánto hace que se fue. */
      joinSession.reservaTimer = setInterval(guardaReserva, 2000);
      return;
    }

    if (packet.type === "lobby:kicked") {
      joinSession.expulsado = true;
      borraReserva();
      const texto = MOTIVOS[String(packet.code || "")] || "EXPULSADO DE LA SALA";
      showSessionBanner(texto, 2600);
      aviso(texto);
      setTimeout(() => leaveRoom(false), 1800);
      return;
    }

    if (packet.type === "debug:message") log(`Host: ${cleanChat(packet.text)}`);
  }

  function normalizeIncomingPlayer(raw = {}) {
    const avatar = normalizeProfile({ name: "x", ...(raw.avatar || {}) });
    return {
      id: String(raw.id || "unknown"),
      name: cleanName(raw.name),
      avatar: { color: avatar.color, body: avatar.body, face: avatar.face, accessory: avatar.accessory },
      x: clamp(raw.x, 7, 93, 50),
      y: clamp(raw.y, 28, 88, 60),
      quality: qualityClass(raw.quality),
      rtt: Number.isFinite(raw.rtt) ? raw.rtt : null,
      jitter: Number.isFinite(raw.jitter) ? raw.jitter : null,
      host: Boolean(raw.host),
      paused: raw.paused === true,
      aspecto: limpiaAspecto(raw.aspecto)
    };
  }

  function clamp(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }

  async function checkApi() {
    try {
      $("#apiStatus").textContent = "Comprobando…";
      const data = await api("/v1/health");
      $("#apiStatus").textContent = `${data.service} · API v${data.apiVersion} · OK`;
      log("API de salas disponible.");
    } catch (e) {
      $("#apiStatus").textContent = `No disponible: ${e.message}`;
      fail(e, "API no disponible");
    }
  }

  function stopHostTimers() {
    if (!hostSession) return;
    clearInterval(hostSession.pollTimer);
    clearInterval(hostSession.heartbeatTimer);
    clearInterval(hostSession.qualityTimer);
    clearInterval(hostSession.idleTimer);
  }

  function stopJoinTimers() {
    if (!joinSession) return;
    clearInterval(joinSession.pollTimer);
    clearInterval(joinSession.heartbeatTimer);
    clearInterval(joinSession.reservaTimer);
  }

  async function createRoom() {
    try {
      /* Una sala privada no usa ubicación: ni se pide. */
      /* La sala local no es una sala en red: no se crea nada en el servidor. */
      if ($("#roomKind")?.value === "local") return;
      const kind = $("#roomKind")?.value === "nearby" ? "nearby" : "private";
      let loc = null;
      if (kind === "nearby") {
        setState("working", "Obteniendo ubicación…");
        loc = await getLocation();
      }
      setState("working", "Creando sala…");
      const data = await api("/v1/rooms", {
        method: "POST",
        body: {
          name: $("#roomName").value,
          game: $("#gameName").value,
          password: $("#roomPassword").value,
          maxPlayers: Math.min(Number($("#maxPlayers").value) || 2, MAX_JUGADORES_ONLINE),
          kind,
          /* Quién crea la sala: para los bloqueos del administrador y para
             que un invitado pueda denunciar al anfitrión. */
          displayName: profile.name,
          deviceId: deviceId(),
          ...(testerPass() ? { pass: testerPass() } : {}),
          ...(loc ? { lat: loc.lat, lon: loc.lon } : {})
        }
      });
      players = new Map();
    ultimosMensajes.clear();   /* lo dicho en la sala anterior no se conserva */
    silenciados.clear();
    olvidaCombates();
      hostSession = {
        room: data.room, token: data.hostToken, peers: new Map(), pollBusy: false, joins: [],
        kind,
        confirm: Boolean($("#confirmPlayers")?.checked),
        idleMinutes: Number($("#hostIdleMinutes")?.value) || 0,
        reservas: new Map(),     /* resguardo -> { joinId, slot, until } */
        tramitando: new Set(),   /* solicitudes que se están decidiendo */
        decididos: new Set()     /* solicitudes ya rechazadas */
      };
      hostSession.chat = Boolean($("#roomChat")?.checked);
      silenciados.clear();
    olvidaCombates();
      pintaChat();
      rememberLocalLinkSession(data.room.id, 0, "host");
      ensureLocalPlayer("host", true, spawnPoint(0));
      updateToolbar(data.room);
      setLobbyVisible(true);
      setState("working", kind === "nearby" ? "Sala publicada · esperando jugadores" : "Sala privada · pasa el código o el QR");
      log(`Sala ${data.room.id} creada (${kind === "nearby" ? "proximidad" : "privada"}).`);
      if (loc) avisaUbicacionImprecisa(loc, "crear");
      hostSession.idleTimer = setInterval(vigilaJugadores, 1000);
      renderBlocked();
      hostSession.pollTimer = setInterval(pollHostJoins, 1200);
      hostSession.heartbeatTimer = setInterval(() => {
        api(`/v1/rooms/${encodeURIComponent(data.room.id)}/heartbeat`, { method: "POST", token: data.hostToken })
          .catch((e) => log(`Heartbeat host: ${e.message}`));
      }, 20000);
      hostSession.qualityTimer = setInterval(runQualityProbe, QUALITY_INTERVAL_MS);
      await pollHostJoins();
    } catch (e) {
      fail(e, "No se pudo crear la sala");
    }
  }

  async function pollHostJoins() {
    if (!hostSession || hostSession.pollBusy) return;
    hostSession.pollBusy = true;
    try {
      const { room, token, peers } = hostSession;
      const data = await api(`/v1/rooms/${encodeURIComponent(room.id)}/joins`, { token });
      hostSession.joins = data.joins;
      renderManagePlayers();
      const liveIds = new Set(data.joins.map((j) => j.id));
      for (const join of data.joins) {
        if (join.status === "requested" && !peers.has(join.id) &&
            !hostSession.tramitando.has(join.id) && !hostSession.decididos.has(join.id)) {
          /* No se espera aquí: una pregunta al anfitrión no puede parar el
             resto del sondeo (respuestas de otros jugadores, latidos). */
          const sesion = hostSession;
          sesion.tramitando.add(join.id);
          admiteSolicitud(sesion, join)
            .catch((e) => log(`Solicitud de ${join.displayName}: ${e.message}`))
            .finally(() => sesion.tramitando.delete(join.id));
        }
        const peer = peers.get(join.id);
        if (join.status === "answer_ready" && peer && !peer.answerApplied && join.answer) {
          await peer.pc.setRemoteDescription(descripcionRelevo(join.answer, "answer"));
          peer.answerApplied = true;
          log(`Host: respuesta aplicada para ${join.displayName}.`);
        }
      }
      for (const [joinId, peer] of peers) {
        /* Un hueco reservado se suelta por su propio plazo, no por aquí. */
        if (peer.reservado) continue;
        if (!liveIds.has(joinId) && peer.channel?.readyState !== "open") {
          try { peer.pc.close(); } catch {}
          peers.delete(joinId);
          players.delete(joinId);
          renderPlayers();
        }
      }
    } catch (e) {
      log(`Polling host: ${e.message}`);
    } finally {
      if (hostSession) hostSession.pollBusy = false;
    }
  }

  /* Vigilancia de jugadores (solo el anfitrión, solo en el lobby).

     Un móvil que bloquea la pantalla o cierra el navegador no siempre avisa:
     a veces se queda mudo sin más, y el canal no se cierra hasta mucho
     después, o nunca. Por eso no se espera a ningún aviso: se mira cuánto hace
     que cada jugador no da señal. Contesta a un ping cada 2 segundos, así que
     6 segundos callado ya es que no está.

     - Callado sin haber avisado de pausa: se ve PAUSADO y se le guarda el
       sitio. Si vuelve a dar señal, sigue como si nada. A los 20 segundos
       sale de la sala.
     - Avisó de pausa (bloqueó el móvil y dio tiempo a decirlo): PAUSADO sin
       plazo de 20 s; manda el límite de inactividad del anfitrión.
     - Conexión rota del todo: 20 segundos desde ese momento y sale.

     Los plazos se miden con el reloj, no con temporizadores largos: una
     pestaña en segundo plano los retrasa, pero al siguiente tic se cumple lo
     que tocaba. */
  const SILENCIO_MS = 6000;
  let ultimoTic = 0;

  function ponPausado(sesion, joinId, peer, paused) {
    const player = players.get(joinId);
    if (!player || player.paused === paused) return;
    player.paused = paused;
    renderPlayers();
    sendAll({ type: "lobby:pause", playerId: joinId, paused, time: Date.now() }, joinId);
  }

  /* El jugador ya no está: se le reserva el hueco desde `desde`. */
  function marcaIdo(sesion, joinId, peer, desde = peer.lastSeen || Date.now()) {
    if (peer.goneAt) return;
    /* Los 20 segundos cuentan desde la última señal: una conexión rota se
       nota varios segundos después de que el jugador se fuera. */
    peer.goneAt = desde;
    peer.reservado = true;
    sesion.reservas.set(peer.reserva, { joinId, slot: peer.linkSlot, until: desde + RESERVA_MS });
    ponPausado(sesion, joinId, peer, true);
  }

  function sueltaJugador(sesion, joinId, peer) {
    sesion.reservas.delete(peer.reserva);
    if (sesion.peers.get(joinId) !== peer) return;
    peer.adios = true;
    try { peer.pc.close(); } catch {}
    sesion.peers.delete(joinId);
    players.delete(joinId);
    sendAll({ type: "lobby:player-left", playerId: joinId });
    api(`/v1/rooms/${encodeURIComponent(sesion.room.id)}/joins/${encodeURIComponent(joinId)}/kick`, {
      method: "POST", token: sesion.token
    }).catch(() => {});
    log(`Host: ${peer.join.displayName} sale de la sala (sin señal).`);
    renderPlayers();
    renderManagePlayers();
    updateChannelButtons();
    if (!openChannels().length) setState("working", "Sala abierta · esperando jugadores");
  }

  function vigilaJugadores() {
    const sesion = hostSession;
    if (!sesion) return;
    const ahora = Date.now();
    /* Si quien ha estado dormido es el anfitrión (su móvil bloqueado, su
       pestaña congelada), el silencio no es de los demás: se empieza a
       contar otra vez en vez de echar a todos al despertar. */
    const dormido = ultimoTic && ahora - ultimoTic > 4000;
    ultimoTic = ahora;
    if (cableEnMarcha()) return;

    for (const [joinId, peer] of [...sesion.peers]) {
      if (peer.adios) continue;
      if (peer.goneAt) {
        if (ahora - peer.goneAt >= RESERVA_MS) sueltaJugador(sesion, joinId, peer);
        continue;
      }
      if (!peer.lastSeen) continue;             /* todavía conectando */
      if (dormido) { peer.lastSeen = ahora; continue; }

      const callado = ahora - peer.lastSeen;
      if (peer.notifiedPause) continue;         /* en pausa avisada: no se le pide señal */

      if (callado > SILENCIO_MS && !peer.silentPaused) {
        peer.silentPaused = true;
        sesion.reservas.set(peer.reserva, { joinId, slot: peer.linkSlot, until: peer.lastSeen + RESERVA_MS });
        ponPausado(sesion, joinId, peer, true);
      } else if (callado <= SILENCIO_MS && peer.silentPaused) {
        peer.silentPaused = false;
        sesion.reservas.delete(peer.reserva);
        ponPausado(sesion, joinId, peer, false);
      }
      if (callado >= RESERVA_MS) sueltaJugador(sesion, joinId, peer);
    }
    revisaInactivos();
  }
  /* Al volver a tener la pestaña delante se revisa en el acto. */
  document.addEventListener("visibilitychange", () => { if (!document.hidden) vigilaJugadores(); });

  /* Primer asiento libre: 1..3, saltando los ocupados y los reservados. */
  function freeSlot() {
    const usados = new Set([...hostSession.peers.values()].map((peer) => Number(peer.linkSlot) | 0));
    for (let slot = 1; slot <= 3; slot++) if (!usados.has(slot)) return slot;
    return 3;
  }

  async function rechaza(sesion, join, reason) {
    sesion.decididos.add(join.id);
    try {
      await api(`/v1/rooms/${encodeURIComponent(sesion.room.id)}/joins/${encodeURIComponent(join.id)}/kick`, {
        method: "POST", token: sesion.token, body: { reason }
      });
    } catch (e) {
      log(`Rechazo de ${join.displayName}: ${e.message}`);
    }
    log(`Host: ${join.displayName} no entra (${reason}).`);
  }

  /* Quién entra lo decide el anfitrión, en este orden: quien vuelve a su
     hueco, los bloqueados, el aforo y, si está activado, la confirmación. */
  async function admiteSolicitud(sesion, join) {
    /* 1. Vuelve a su hueco con el resguardo que se le dio. */
    const reserva = join.resume ? sesion.reservas.get(join.resume) : null;
    if (reserva && reserva.until >= Date.now()) {
      sesion.reservas.delete(join.resume);
      const viejo = sesion.peers.get(reserva.joinId);
      const previo = players.get(reserva.joinId) || null;
      if (viejo) viejo.adios = true;
      try { viejo?.pc.close(); } catch {}
      sesion.peers.delete(reserva.joinId);
      players.delete(reserva.joinId);
      sendAll({ type: "lobby:player-left", playerId: reserva.joinId });
      api(`/v1/rooms/${encodeURIComponent(sesion.room.id)}/joins/${encodeURIComponent(reserva.joinId)}/kick`, {
        method: "POST", token: sesion.token
      }).catch(() => {});
      log(`Host: ${join.displayName} vuelve a su hueco.`);
      if (hostSession === sesion) await prepareHostOffer(join, reserva.slot, previo);
      return;
    }

    /* 2. Sin identificador no se puede bloquear a nadie: no entra. Una web
       sin actualizar es el caso normal; basta con recargar. */
    /* Un servidor de salas anterior no manda este dato: ahí no hay bloqueos
       que aplicar y se entra como siempre. */
    const conEtiquetas = typeof join.device === "string";
    if (conEtiquetas && !join.device) return rechaza(sesion, join, "outdated");
    if (conEtiquetas && bloqueados().some((item) => item.device === join.device)) return rechaza(sesion, join, "blocked");

    /* 3. Aforo. El servidor ya lo mira, salvo a quien dice que vuelve. */
    if (1 + sesion.peers.size >= Number(sesion.room.maxPlayers || 2)) return rechaza(sesion, join, "full");

    /* 4. Confirmar jugadores. */
    if (sesion.confirm) {
      const admite = await pregunta(`${cleanName(join.displayName).toUpperCase()} QUIERE ENTRAR EN LA SALA. ¿LO ADMITES?`, "SÍ", "NO");
      if (hostSession !== sesion) return;
      if (!admite) return rechaza(sesion, join, "rejected");
      if (1 + sesion.peers.size >= Number(sesion.room.maxPlayers || 2)) return rechaza(sesion, join, "full");
    }
    if (hostSession === sesion) await prepareHostOffer(join);
  }

  async function prepareHostOffer(join, slot = 0, previo = null) {
    const { room, token, peers } = hostSession;
    const cfg = await configRelevo();
    if (!hostSession || hostSession.room.id !== room.id) return;
    const index = slot || freeSlot();
    const pos = previo ? { x: previo.x, y: previo.y } : spawnPoint(index);
    const placeholder = {
      id: join.id,
      name: previo?.name || cleanName(join.displayName),
      avatar: previo?.avatar || { color: "blue", body: "round", face: "happy", accessory: "none" },
      x: pos.x,
      y: pos.y,
      quality: "unknown",
      rtt: null,
      jitter: null,
      host: false
    };
    players.set(join.id, placeholder);
    renderPlayers();

    const peerInfo = {
      join,
      pc: null,
      channel: null,
      answerApplied: false,
      linkSlot: index,
      /* Etiqueta de quien entra (para bloquearlo) y su resguardo de hueco. */
      device: String(join.device || ""),
      reserva: aleatorio(18),
      pausedSince: 0,
      linkReady: false,
      metrics: { pending: new Map(), rtt: null, jitter: null, lastRtt: null, missed: 0, quality: "unknown" }
    };
    const pc = makePeer(`Host↔${join.displayName}`, () => {}, cfg);
    peerInfo.pc = pc;
    const channel = pc.createDataChannel("ml3d-link", { ordered: true });
    peerInfo.channel = channel;
    attachHostChannel(join.id, channel, peerInfo);
    peers.set(join.id, peerInfo);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIce(pc);
    await api(`/v1/rooms/${encodeURIComponent(room.id)}/joins/${encodeURIComponent(join.id)}/offer`, {
      method: "POST",
      token,
      body: { offer: serializaRelevo(pc.localDescription) }
    });
    log(`Host: oferta preparada para ${join.displayName}.`);
  }

  function attachHostChannel(joinId, channel, peerInfo) {
    channel.binaryType = "arraybuffer";
    channel.addEventListener("open", async () => {
      log(`${peerInfo.join.displayName}: canal abierto.`);
      setState("connected", "LINK CONECTADO");
      updateChannelButtons();
      try {
        await api(`/v1/rooms/${encodeURIComponent(hostSession.room.id)}/joins/${encodeURIComponent(joinId)}/connected`, {
          method: "POST",
          token: hostSession.token
        });
      } catch (e) {
        log(`Confirmación connected: ${e.message}`);
      }
      safeSend(channel, lobbySnapshot());
      safeSend(channel, { type: "combate:estado", ...combates, time: Date.now() });
      if (salaDeCable()) safeSend(channel, {
        type: "gba:link:configure",
        roomId: hostSession.room.id,
        playerNumber: peerInfo.linkSlot,
        role: "guest",
        time: Date.now()
      });
      safeSend(channel, {
        type: "gba:link:ready",
        roomId: hostSession.room.id,
        ready: localGbaReady,
        time: Date.now()
      });
      safeSend(channel, { type: "lobby:request-profile" });
      safeSend(channel, { type: "lobby:quality", playerId: "host", quality: "good", rtt: 0, jitter: 0 });
      /* Resguardo para volver a este mismo hueco si cierra el navegador. */
      safeSend(channel, { type: "lobby:reserva", token: peerInfo.reserva, ms: RESERVA_MS });
      peerInfo.lastSeen = Date.now();
      renderManagePlayers();
    });
    channel.addEventListener("close", () => {
      log(`${peerInfo.join.displayName}: canal cerrado.`);
      /* Se ha ido sin despedirse y sin que lo echen: puede ser un cierre por
         error. Se le guarda el sitio 20 segundos; de soltarlo se encarga la
         vigilancia. Con el cable jugando no: ahí vale el aviso de caída. */
      const sesion = hostSession;
      if (sesion && !peerInfo.adios && !cableEnMarcha() && sesion.peers.get(joinId) === peerInfo) {
        marcaIdo(sesion, joinId, peerInfo);
        updateChannelButtons();
        renderManagePlayers();
        return;
      }
      avisaCaidaAlEmulador(`${peerInfo.join.displayName} se ha desconectado`);
      if (players.has(joinId)) {
        players.delete(joinId);
        sendAll({ type: "lobby:player-left", playerId: joinId }, joinId);
        renderPlayers();
      }
      updateChannelButtons();
      renderManagePlayers();
      if (!openChannels().length) setState("working", "Sala abierta · esperando jugadores");
    });
    channel.addEventListener("message", (event) => {
      let packet;
      try { packet = JSON.parse(event.data); } catch { return; }
      peerInfo.lastSeen = Date.now();
      handleHostPacket(joinId, packet);
    });
    /* La conexión se rompe sin que el canal llegue a cerrarse (móvil que
       mata el navegador): cuenta igual que un cierre. */
    peerInfo.pc.addEventListener("connectionstatechange", () => {
      const estado = peerInfo.pc.connectionState;
      const sesion = hostSession;
      if ((estado === "failed" || estado === "closed") && sesion && !peerInfo.adios &&
          !cableEnMarcha() && sesion.peers.get(joinId) === peerInfo) {
        marcaIdo(sesion, joinId, peerInfo);
      }
    });
  }

  function runQualityProbe() {
    if (!hostSession) return;
    const now = performance.now();
    for (const [joinId, peer] of hostSession.peers) {
      if (peer.channel?.readyState !== "open") continue;
      let missedNow = 0;
      for (const [id, started] of peer.metrics.pending) {
        if (now - started > 5000) {
          peer.metrics.pending.delete(id);
          missedNow += 1;
        }
      }
      if (missedNow) peer.metrics.missed += missedNow;
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      peer.metrics.pending.set(id, now);
      safeSend(peer.channel, { type: "net:ping", id, sentAt: Date.now() });
      if (peer.metrics.missed >= 2) updatePeerQuality(joinId, peer, peer.metrics.rtt, peer.metrics.jitter);
    }
  }

  function handleHostPong(peer, packet) {
    if (typeof packet.paused === "boolean" && hostSession && !cableEnMarcha()) {
      const joinId = [...hostSession.peers].find(([, p]) => p === peer)?.[0];
      /* Contesta, luego no está congelado: lo que diga ahora es lo que vale. */
      if (joinId && peer.notifiedPause !== packet.paused) {
        peer.notifiedPause = packet.paused;
        peer.pausedSince = packet.paused ? Date.now() : 0;
        ponPausado(hostSession, joinId, peer, packet.paused);
      }
    }
    const started = peer.metrics.pending.get(packet.id);
    if (started === undefined) return;
    peer.metrics.pending.delete(packet.id);
    const rtt = performance.now() - started;
    const jitter = peer.metrics.lastRtt === null ? 0 : Math.abs(rtt - peer.metrics.lastRtt);
    peer.metrics.lastRtt = rtt;
    peer.metrics.rtt = peer.metrics.rtt === null ? rtt : peer.metrics.rtt * 0.72 + rtt * 0.28;
    peer.metrics.jitter = peer.metrics.jitter === null ? jitter : peer.metrics.jitter * 0.72 + jitter * 0.28;
    peer.metrics.missed = 0;
    const joinId = [...hostSession.peers].find(([, p]) => p === peer)?.[0];
    if (joinId) updatePeerQuality(joinId, peer, peer.metrics.rtt, peer.metrics.jitter);
  }

  function updatePeerQuality(joinId, peer, rtt, jitter) {
    const quality = computeQuality(rtt, jitter, peer.metrics.missed);
    peer.metrics.quality = quality;
    const player = players.get(joinId);
    if (player) {
      player.rtt = Number.isFinite(rtt) ? rtt : null;
      player.jitter = Number.isFinite(jitter) ? jitter : null;
      player.quality = quality;
      renderPlayers();
    }
    sendAll({ type: "lobby:quality", playerId: joinId, rtt, jitter, quality, time: Date.now() });
  }

  async function closeRoom() {
    if (!hostSession) return;
    const { room, token, peers } = hostSession;
    sendAll({ type: "lobby:kicked", reason: "Sala cerrada por el host" });
    try {
      await api(`/v1/rooms/${encodeURIComponent(room.id)}/close`, { method: "POST", token });
    } catch (e) {
      log(`Cerrar sala: ${e.message}`);
    }
    stopHostTimers();
    for (const peer of peers.values()) {
      try { peer.pc.close(); } catch {}
    }
    clearLocalLinkSession(room.id);
    hostSession = null;
    players = new Map();
    ultimosMensajes.clear();   /* lo dicho en la sala anterior no se conserva */
    silenciados.clear();
    olvidaCombates();
    localPlayerId = null;
    setLobbyVisible(false);
    updateChannelButtons();
    closeModal("selectModal");
    setState("idle", "Sala cerrada");
  }

  const ROOM_CODE_RE = /^[A-Z0-9_-]{4,16}$/;

  function normalizeRoomCode(value) {
    return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
  }

  function selectRoomByCode() {
    const code = normalizeRoomCode($("#roomCode").value);
    if (!ROOM_CODE_RE.test(code)) {
      fail(new Error("El código son 4-16 caracteres (letras, números, - o _)."), "Código de sala no válido");
      return;
    }
    $("#roomCode").value = code;
    selectRoom({ id: code, name: `Sala ${code}`, game: "", locked: false, maxPlayers: 2, players: 1, byCode: true });
    setState("idle", `Código ${code} listo`);
  }

  async function searchRooms() {
    try {
      setState("working", "Buscando cerca…");
      const loc = await getLocation();
      const radiusKm = Number($("#radius").value);
      const data = await api(`/v1/rooms/nearby?lat=${encodeURIComponent(loc.lat)}&lon=${encodeURIComponent(loc.lon)}&radiusKm=${encodeURIComponent(radiusKm)}`);
      const compatibleRooms = (data.rooms || []).filter((room) => {
        const seats = Number(room.maxPlayers) | 0;
        return seats >= 2 && seats <= MAX_JUGADORES_ONLINE;
      });
      renderRooms(compatibleRooms);
      avisaUbicacionImprecisa(loc, "buscar");
      setState("idle", compatibleRooms.length ? `${compatibleRooms.length} sala(s) Link encontrada(s)` : "No hay salas Link cercanas");
    } catch (e) {
      fail(e, "No se pudieron buscar salas");
    }
  }

  function renderRooms(rooms) {
    const box = $("#roomsList");
    if (!rooms.length) {
      box.innerHTML = '<p class="hint">No hay salas disponibles dentro de ese radio.</p>';
      return;
    }
    box.innerHTML = rooms.map((room) => {
      /* El servidor ya no da metros: solo si la sala está muy cerca, cerca o
         en la zona. Nadie ve dónde está otro jugador. */
      const distance = { muy_cerca: "muy cerca", cerca: "cerca", en_tu_zona: "en tu zona" }[room.distanceBand] || "cerca";
      const full = room.players >= room.maxPlayers;
      return `<div class="room"><div class="room-head"><div><div class="room-title">${escapeHtml(nombreSala(room))}</div><div class="hint">${escapeHtml(room.game || "Juego no indicado")}</div></div><div>${room.locked ? "🔒" : ""}</div></div><div class="badges"><span class="badge">${distance}</span><span class="badge">${room.players}/${room.maxPlayers}</span><span class="badge">${escapeHtml(room.id)}</span></div><button data-room-id="${escapeHtml(room.id)}" ${full ? "disabled" : ""}>${full ? "SALA COMPLETA" : "UNIRME"}</button></div>`;
    }).join("");
    box.querySelectorAll("button[data-room-id]").forEach((button) => {
      button.addEventListener("click", () => selectRoom(rooms.find((r) => r.id === button.dataset.roomId)));
    });
  }

  function selectRoom(room) {
    selectedRoom = room;
    $("#joinCard").hidden = false;
    $("#joinRoomInfo").textContent = room.byCode
      ? `Código ${room.id} · la sala se comprueba al pulsar ENTRAR AL LOBBY`
      : `${nombreSala(room)}${room.game ? ` · ${room.game}` : ""} · ${room.players}/${room.maxPlayers}`;
    $("#joinPasswordWrap").hidden = !room.locked;
    $("#joinPassword").value = "";
    $("#playerName").value = profile.name;
    $("#joinCard").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function joinSelectedRoom() {
    if (!selectedRoom) return;
    try {
      const typedName = cleanName($("#playerName").value);
      saveProfileLocal({ ...profile, name: typedName });
      setState("working", "Solicitando entrada…");
      const data = await api(`/v1/rooms/${encodeURIComponent(selectedRoom.id)}/join`, {
        method: "POST",
        body: {
          password: $("#joinPassword").value,
          displayName: profile.name,
          deviceId: deviceId(),
          ...(testerPass() ? { pass: testerPass() } : {}),
          ...(selectedRoom.resume ? { resume: selectedRoom.resume } : {})
        }
      });
      players = new Map();
    ultimosMensajes.clear();   /* lo dicho en la sala anterior no se conserva */
    silenciados.clear();
    olvidaCombates();
      joinSession = {
        room: selectedRoom,
        join: data.join,
        token: data.joinToken,
        pc: null,
        channel: null,
        answerSent: false,
        pollBusy: false
      };
      localPlayerId = data.join.id;
      setState("working", "Esperando a que el anfitrión te admita…");
      log(`Solicitud enviada a ${selectedRoom.name}.`);
      joinSession.pollTimer = setInterval(pollJoinState, 1000);
      joinSession.heartbeatTimer = setInterval(() => {
        api(`/v1/rooms/${encodeURIComponent(selectedRoom.id)}/joins/${encodeURIComponent(data.join.id)}/heartbeat`, {
          method: "POST",
          token: data.joinToken
        }).catch((e) => log(`Heartbeat jugador: ${e.message}`));
      }, 20000);
      await pollJoinState();
    } catch (e) {
      if (selectedRoom && /contrase/i.test(e.message || "")) {
        selectedRoom.locked = true;
        $("#joinPasswordWrap").hidden = false;
        $("#joinPassword").value = "";
        $("#joinPassword").focus();
      }
      fail(e, "No se pudo entrar en la sala");
    }
  }

  async function pollJoinState() {
    if (!joinSession || joinSession.pollBusy) return;
    joinSession.pollBusy = true;
    try {
      const { room, join, token } = joinSession;
      const data = await api(`/v1/rooms/${encodeURIComponent(room.id)}/joins/${encodeURIComponent(join.id)}`, { token });
      const state = data.join;
      /* El anfitrión no admite la entrada, o ha expulsado: se dice por qué. */
      if (state.status === "kicked") {
        joinSession.expulsado = true;
        const texto = MOTIVOS[state.reason] || MOTIVOS.kicked;
        borraReserva();
        joinSession.pollBusy = false;
        await leaveRoom(false);
        setState("idle", texto.charAt(0) + texto.slice(1).toLowerCase());
        aviso(texto);
        return;
      }
      if (state.status === "offer_ready" && state.offer && !joinSession.answerSent) {
        await answerHostOffer(state.offer);
      } else if (state.status === "connected" && joinSession.channel?.readyState === "open") {
        setState("connected", "LINK CONECTADO");
      }
    } catch (e) {
      log(`Polling jugador: ${e.message}`);
    } finally {
      if (joinSession) joinSession.pollBusy = false;
    }
  }

  async function answerHostOffer(offerText) {
    const { room, join, token } = joinSession;
    const oferta = descripcionRelevo(offerText, "offer");
    const cfg = await configRelevo();
    if (!joinSession || joinSession.join.id !== join.id || joinSession.pc) return;
    const pc = makePeer(`Jugador↔${room.name}`, (channel) => {
      joinSession.channel = channel;
      attachGuestChannel(channel);
    }, cfg);
    joinSession.pc = pc;
    await pc.setRemoteDescription(oferta);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitIce(pc);
    await api(`/v1/rooms/${encodeURIComponent(room.id)}/joins/${encodeURIComponent(join.id)}/answer`, {
      method: "POST",
      token,
      body: { answer: serializaRelevo(pc.localDescription) }
    });
    joinSession.answerSent = true;
    setState("working", "Respuesta enviada · conectando…");
    log("Jugador: respuesta WebRTC enviada al host.");
  }

  function attachGuestChannel(channel) {
    channel.binaryType = "arraybuffer";
    channel.addEventListener("open", async () => {
      log("Jugador: canal de lobby abierto.");
      setState("connected", "LINK CONECTADO");
      setLobbyVisible(true);
      updateToolbar(joinSession.room);
      updateChannelButtons();
      try {
        await api(`/v1/rooms/${encodeURIComponent(joinSession.room.id)}/joins/${encodeURIComponent(joinSession.join.id)}/connected`, {
          method: "POST",
          token: joinSession.token
        });
      } catch (e) {
        log(`Confirmación connected: ${e.message}`);
      }
      safeSend(channel, { type: "lobby:profile", profile, time: Date.now() });
      safeSend(channel, {
        type: "gba:link:ready",
        roomId: joinSession.room.id,
        ready: localGbaReady,
        time: Date.now()
      });
    });
    channel.addEventListener("close", () => {
      log("Jugador: canal cerrado.");
      avisaCaidaAlEmulador("se ha perdido la conexion con el anfitrion");
      updateChannelButtons();
      if (joinSession) setState("idle", "Conexión cerrada");
      intentaVolver();
    });
    channel.addEventListener("message", (event) => {
      let packet;
      try { packet = JSON.parse(event.data); } catch { return; }
      if (packet.type === "lobby:request-profile") {
        safeSend(channel, { type: "lobby:profile", profile, time: Date.now() });
      } else {
        handleGuestPacket(packet);
      }
    });
  }

  /* El móvil estuvo dormido y, al despertar, el anfitrión ya había soltado el
     hueco. Se pide entrar otra vez, una sola vez: si el resguardo aún vale se
     vuelve al mismo sitio, y si no, el anfitrión decide como con cualquiera. */
  let ultimoIntento = 0;
  async function intentaVolver() {
    const sesion = joinSession;
    if (!sesion || sesion.expulsado || cableEnMarcha()) return;
    if (Date.now() - ultimoIntento < 30000) return;
    ultimoIntento = Date.now();
    const sala = { ...sesion.room, byCode: true, locked: false, resume: sesion.reserva || "" };
    const nombre = profile.name;
    await leaveRoom(false);
    if (hostSession || joinSession) return;
    selectedRoom = sala;
    $("#playerName").value = nombre;
    $("#joinPassword").value = "";
    setState("working", "Volviendo a la sala…");
    joinSelectedRoom();
  }

  async function leaveRoom(callApi = true) {
    if (!joinSession) return;
    const session = joinSession;
    stopJoinTimers();
    if (callApi) {
      session.expulsado = true;   /* sale por su voluntad: no hay que volver */
      borraReserva();
      safeSend(session.channel, { type: "lobby:bye", time: Date.now() });
      try {
        await api(`/v1/rooms/${encodeURIComponent(session.room.id)}/joins/${encodeURIComponent(session.join.id)}/leave`, {
          method: "POST",
          token: session.token
        });
      } catch (e) {
        log(`Salir: ${e.message}`);
      }
    }
    try { session.pc?.close(); } catch {}
    clearLocalLinkSession(session.room?.id || "");
    joinSession = null;
    players = new Map();
    ultimosMensajes.clear();   /* lo dicho en la sala anterior no se conserva */
    silenciados.clear();
    olvidaCombates();
    localPlayerId = null;
    setLobbyVisible(false);
    closeModal("selectModal");
    setState("idle", "Fuera de la sala");
  }

  function ensureMoveTimer() {
    if (moveTimer) return;
    moveTimer = setInterval(stepMovement, MOVE_INTERVAL_MS);
  }

  function stopMoveTimer() {
    clearInterval(moveTimer);
    moveTimer = null;
    heldMoves.clear();
  }

  function stepMovement() {
    if (!localPlayerId || heldMoves.size === 0) return;
    const player = players.get(localPlayerId);
    if (!player) return;
    let dx = 0;
    let dy = 0;
    if (heldMoves.has("left")) dx -= 1;
    if (heldMoves.has("right")) dx += 1;
    if (heldMoves.has("up")) dy -= 1;
    if (heldMoves.has("down")) dy += 1;
    if (!dx && !dy) return;
    const diagonal = dx && dy ? 0.72 : 1;
    player.x = clamp(player.x + dx * 1.55 * diagonal, 7, 93, player.x);
    player.y = clamp(player.y + dy * 1.55 * diagonal, 28, 88, player.y);
    renderPlayers();
    const now = performance.now();
    if (now - lastMoveSentAt < 70) return;
    lastMoveSentAt = now;
    if (hostSession) {
      sendAll({ type: "lobby:move", playerId: "host", x: player.x, y: player.y, time: Date.now() });
    } else if (joinSession) {
      safeSend(joinSession.channel, { type: "lobby:move", x: player.x, y: player.y, time: Date.now() });
    }
  }

  function setMove(direction, active) {
    if (active) heldMoves.add(direction);
    else heldMoves.delete(direction);
  }

  function openChat() {
    if (!localPlayerId) return;
    if (!chatPermitido()) { avisa("El chat está desactivado en esta sala."); return; }
    $("#chatComposer").hidden = false;
    const input = $("#chatInput");
    input.value = "";
    input.focus({ preventScroll: false });
  }

  function closeChat() {
    $("#chatComposer").hidden = true;
    $("#lobbyStage").focus({ preventScroll: true });
  }

  function sendChat(text) {
    const cleaned = filtra(cleanChat(text));
    if (!cleaned || !localPlayerId || !chatPermitido()) return;
    showChatBubble(localPlayerId, cleaned);
    if (hostSession) {
      sendAll({ type: "lobby:chat", playerId: "host", text: cleaned, time: Date.now() });
    } else if (joinSession) {
      safeSend(joinSession.channel, { type: "lobby:chat", text: cleaned, time: Date.now() });
    }
  }

  function buildEditorChoices() {
    const makeChoices = (containerId, values, getLabel, field) => {
      const container = $(containerId);
      container.textContent = "";
      values.forEach((value) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.value = value;
        button.textContent = getLabel(value);
        button.addEventListener("click", () => {
          container.querySelectorAll("button").forEach((b) => b.classList.toggle("selected", b === button));
          profile = normalizeProfile({ ...profile, [field]: value, name: $("#profileName").value });
          renderEditorPreview();
        });
        container.append(button);
      });
    };
    makeChoices("#colorChoices", Object.keys(PALETTE), (v) => ({ orange: "Naranja", blue: "Azul", mint: "Menta", pink: "Rosa", yellow: "Amarillo", purple: "Morado" }[v]), "color");
    makeChoices("#bodyChoices", BODIES, (v) => ({ round: "Redondo", square: "Cuadrado", bean: "Judía" }[v]), "body");
    makeChoices("#faceChoices", FACES, (v) => ({ happy: "Feliz", flat: "Serio", wow: "Oh!" }[v]), "face");
    makeChoices("#accessoryChoices", ACCESSORIES, (v) => ({ none: "Nada", cap: "Gorra", antenna: "Antena", bow: "Lazo" }[v]), "accessory");
  }

  function openAvatarEditor() {
    /* También fuera de una sala: se edita desde el menú del lobby. */
    $("#profileName").value = profile.name;
    syncEditorButtons();
    renderEditorPreview();
    openModal("avatarModal");
  }

  function syncEditorButtons() {
    const mapping = [
      ["#colorChoices", profile.color],
      ["#bodyChoices", profile.body],
      ["#faceChoices", profile.face],
      ["#accessoryChoices", profile.accessory]
    ];
    for (const [selector, value] of mapping) {
      $(selector).querySelectorAll("button").forEach((b) => b.classList.toggle("selected", b.dataset.value === value));
    }
  }

  function renderEditorPreview() {
    const preview = $("#avatarPreview");
    preview.textContent = "";
    const wrap = document.createElement("div");
    renderAvatarInto(wrap, profile);
    preview.append(wrap);
  }

  function applyProfile() {
    const borrador = window.ML3DPersonajes?.borrador?.();
    const next = normalizeProfile({ ...profile, name: $("#profileName").value, aspecto: borrador || profile.aspecto });
    saveProfileLocal(next);
    const me = players.get(localPlayerId);
    if (me) {
      me.name = profile.name;
      me.avatar = { color: profile.color, body: profile.body, face: profile.face, accessory: profile.accessory };
      me.aspecto = profile.aspecto;
      renderPlayers();
      if (hostSession) broadcastPlayer(me);
      else if (joinSession) safeSend(joinSession.channel, { type: "lobby:profile", profile, time: Date.now() });
    }
    closeModal("avatarModal");
  }

  function openSelectMenu() {
    if (!hostSession && !joinSession) return;
    $("#hostMenu").hidden = !hostSession;
    $("#guestMenu").hidden = !joinSession;
    renderListaJugadores();
    pintaChat();
    if (hostSession) {
      updateToolbar(hostSession.room);
      renderManagePlayers();
    } else if (joinSession) {
      updateToolbar(joinSession.room);
    }
    openModal("selectModal");
  }

  function renderManagePlayers() {
    const box = $("#managePlayers");
    if (!hostSession) {
      box.textContent = "";
      return;
    }
    box.textContent = "";
    const hostRow = document.createElement("div");
    hostRow.className = "manage-player";
    hostRow.innerHTML = `<span><span class="quality-dot good"></span> ${escapeHtml(profile.name)} ★</span><span class="hint">HOST</span>`;
    box.append(hostRow);
    for (const [joinId, peer] of hostSession.peers) {
      const player = players.get(joinId);
      if (!player) continue;
      const row = document.createElement("div");
      row.className = "manage-player";
      const label = document.createElement("span");
      const dot = document.createElement("span");
      dot.className = `quality-dot ${qualityClass(player.quality)}`;
      const text = document.createTextNode(` ${player.name}`);
      label.append(dot, text);
      const kick = document.createElement("button");
      kick.type = "button";
      kick.textContent = "EXPULSAR";
      kick.addEventListener("click", () => kickPlayer(joinId));
      /* Bloquear: no vuelve a entrar en las salas de este anfitrión aunque
         cambie de nombre. Hace falta su etiqueta de dispositivo. */
      const block = document.createElement("button");
      block.type = "button";
      block.className = "danger";
      block.textContent = "BLOQUEAR";
      block.disabled = !peer.device;
      block.addEventListener("click", () => blockPlayer(joinId));
      row.append(label, kick, block);
      box.append(row);
    }
  }

  async function blockPlayer(joinId) {
    if (!hostSession) return;
    const peer = hostSession.peers.get(joinId);
    const player = players.get(joinId);
    if (!peer?.device) return;
    const seguro = await pregunta(`¿BLOQUEAR A ${(player?.name || "JUGADOR").toUpperCase()}? NO PODRÁ VOLVER A ENTRAR EN TUS SALAS.`, "BLOQUEAR", "NO");
    if (!seguro || !hostSession) return;
    const lista = bloqueados().filter((item) => item.device !== peer.device);
    lista.push({ device: peer.device, name: player?.name || "Jugador", at: new Date().toISOString() });
    guardaBloqueados(lista);
    await kickPlayer(joinId, "blocked");
  }

  /* Lista de bloqueados del anfitrión: vive en su dispositivo y vale para
     todas sus salas. Aquí se ve y se quita. */
  function renderBlocked() {
    const box = $("#blockedList");
    if (!box) return;
    box.textContent = "";
    const lista = bloqueados();
    if (!lista.length) {
      const vacio = document.createElement("p");
      vacio.className = "hint";
      vacio.textContent = "No has bloqueado a nadie.";
      box.append(vacio);
      return;
    }
    for (const item of lista) {
      const row = document.createElement("div");
      row.className = "manage-player";
      const label = document.createElement("span");
      const fecha = item.at ? new Date(item.at).toLocaleDateString("es-ES") : "";
      label.textContent = `${item.name || "Jugador"}${item.device.startsWith("v:") ? " · tester" : ""}${fecha ? " · " + fecha : ""}`;
      const quitar = document.createElement("button");
      quitar.type = "button";
      quitar.textContent = "QUITAR";
      quitar.addEventListener("click", () => guardaBloqueados(bloqueados().filter((otro) => otro.device !== item.device)));
      row.append(label, quitar);
      box.append(row);
    }
  }

  /* Inactividad: quien lleva en pausa más de lo que el anfitrión permite sale
     de la sala. Solo en el lobby. */
  function revisaInactivos() {
    const sesion = hostSession;
    if (!sesion || !sesion.idleMinutes || cableEnMarcha()) return;
    const limite = sesion.idleMinutes * 60000;
    for (const [joinId, peer] of sesion.peers) {
      if (peer.goneAt || peer.adios || !peer.pausedSince) continue;
      if (Date.now() - peer.pausedSince < limite) continue;
      peer.pausedSince = 0;
      log(`Host: ${peer.join.displayName} sale por inactividad.`);
      kickPlayer(joinId, "inactive");
    }
  }

  async function kickPlayer(joinId, code = "kicked") {
    if (!hostSession) return;
    const peer = hostSession.peers.get(joinId);
    if (peer) peer.adios = true;
    try {
      await api(`/v1/rooms/${encodeURIComponent(hostSession.room.id)}/joins/${encodeURIComponent(joinId)}/kick`, {
        method: "POST",
        token: hostSession.token,
        body: { reason: code }
      });
      safeSend(peer?.channel, { type: "lobby:kicked", code, reason: MOTIVOS[code] || "Expulsado por el host" });
      setTimeout(() => {
        try { peer?.pc.close(); } catch {}
      }, 150);
      hostSession.peers.delete(joinId);
      players.delete(joinId);
      sendAll({ type: "lobby:player-left", playerId: joinId });
      renderPlayers();
      renderManagePlayers();
    } catch (e) {
      fail(e, "No se pudo expulsar al jugador");
    }
  }

  async function applyGameSetting() {
    if (!hostSession) return;
    await updateRoomSettings({ game: $("#hostGameInput").value });
  }

  async function applyRoomSettings(removePassword = false) {
    if (!hostSession) return;
    const body = {
      name: $("#hostRoomNameInput").value,
      maxPlayers: Math.min(Number($("#hostMaxPlayers").value) || 2, MAX_JUGADORES_ONLINE)
    };
    if (removePassword) body.clearPassword = true;
    else if ($("#hostPasswordInput").value) body.password = $("#hostPasswordInput").value;
    await updateRoomSettings(body);
    $("#hostPasswordInput").value = "";
  }

  async function updateRoomSettings(body) {
    try {
      const data = await api(`/v1/rooms/${encodeURIComponent(hostSession.room.id)}/settings`, {
        method: "POST",
        token: hostSession.token,
        body
      });
      hostSession.room = { ...hostSession.room, ...data.room };
      updateToolbar(hostSession.room);
      sendAll({ type: "lobby:room", room: hostSession.room, time: Date.now() });
      log("Ajustes de sala actualizados.");
    } catch (e) {
      fail(e, "No se pudieron guardar los ajustes de sala");
    }
  }

  function openLinkEmulator() {
    const room = hostSession?.room || joinSession?.room;
    if (!room) return;

    const role = hostSession ? "host" : "guest";
    const playerNumber = hostSession ? 0 : Number(joinSession?.linkSlot);
    if (!hostSession && !Number.isFinite(playerNumber)) {
      showSessionBanner("ESPERANDO ASIGNACIÓN LINK", 1800);
      return;
    }
    if (!hostSession && (playerNumber < 1 || playerNumber > 3)) {
      showSessionBanner("ASIENTO LINK NO VÁLIDO", 2200);
      return;
    }

    rememberLocalLinkSession(room.id, playerNumber, role);

    /* Integrado en el emulador: el emulador es la página y el lobby vive en su
       pantalla, así que aquí solo hay que devolver el mando al juego. La
       configuración del cable ya ha viajado por BroadcastChannel. */
    if (new URLSearchParams(location.search).get("embed") === "1") {
      closeModal("selectModal");
      window.parent?.postMessage(
        { source: "ml3d-lobby", type: "link-start", roomId: room.id, playerNumber, role },
        location.origin
      );
      return;
    }

    const url = new URL("../", location.href);
    url.searchParams.set("menu", "1");
    url.searchParams.set("linkRoom", room.id);
    url.searchParams.set("linkPlayer", String(playerNumber));
    url.searchParams.set("linkRole", role);
    url.searchParams.set("linkDebug", "1");
    url.searchParams.set("linkTransport", "dual");
    // Unique launch value avoids reusing an older cached emulator document.
    url.searchParams.set("linkLaunch", String(Date.now()));

    const shell = $("#linkEmulatorShell");
    const frame = $("#linkEmulatorFrame");
    const status = $("#linkEmulatorStatus");
    if (!shell || !frame) {
      fail(new Error("No está disponible la vista integrada del emulador."), "Error Link");
      return;
    }

    closeModal("selectModal");
    if (status) {
      status.textContent = `${nombreSala(room)} · jugador ${playerNumber} · ${role === "host" ? "HOST" : "INVITADO"}`;
    }
    document.body.classList.add("link-emulator-open");
    shell.hidden = false;
    stopMoveTimer();
    frame.src = url.toString();
  }

  function closeLinkEmulator() {
    const shell = $("#linkEmulatorShell");
    const frame = $("#linkEmulatorFrame");
    if (frame) frame.src = "about:blank";
    if (shell) shell.hidden = true;
    document.body.classList.remove("link-emulator-open");
    if (!lobbyShell.hidden) ensureMoveTimer();
    window.setTimeout(() => $("#lobbyStage")?.focus({ preventScroll: true }), 50);
  }

  function startSessionCountdown() {
    if (!hostSession) return;
    /* INICIAR CONEXIÓN es para salas de dos. Con 3 o 4, el cable empieza
       cuando alguien acepta un desafío. */
    if (!salaDeCable()) {
      showSessionBanner("EN ESTA SALA EL CABLE EMPIEZA\nAL ACEPTAR UN DESAFÍO", 2800);
      return;
    }
    const connectedPeers = [...hostSession.peers.values()]
      .filter((peer) => peer.channel?.readyState === "open");
    /* El cable admite de 2 a 4 consolas y cada una necesita su asiento: 0 para
       el host y 1..3 seguidos para los invitados. */
    const seats = roomSeatCount();
    const slots = new Set(connectedPeers.map((peer) => Number(peer.linkSlot) | 0));
    const expected = [];
    for (let slot = 1; slot < seats; slot++) expected.push(slot);
    if (connectedPeers.length !== seats - 1 || !expected.every((slot) => slots.has(slot))) {
      showSessionBanner(`SE NECESITAN ${seats} JUGADORES`, 2400);
      return;
    }
    rememberLocalLinkSession(hostSession.room.id, 0, "host");
    for (const peer of hostSession.peers.values()) {
      if (peer.channel?.readyState !== "open") continue;
      safeSend(peer.channel, {
        type: "gba:link:configure",
        roomId: hostSession.room.id,
        playerNumber: peer.linkSlot,
        role: "guest",
        players: seats,
        time: Date.now()
      });
    }
    const launchDelay = 2400;
    cuentaAtras = true;
    setTimeout(() => { cuentaAtras = false; }, launchDelay + 4000);
    sendAll({
      type: "session:start",
      game: hostSession.room.game || "",
      launchDelay,
      time: Date.now()
    });
    showSessionBanner("3", 550);
    setTimeout(() => showSessionBanner("2", 550), 600);
    setTimeout(() => showSessionBanner("1", 550), 1200);
    setTimeout(() => showSessionBanner("ML3D LINK\nPREPARADO", 1800), 1800);
    setTimeout(() => openLinkEmulator(), launchDelay);
    closeModal("selectModal");
  }

  function showSessionBanner(text, duration) {
    const banner = $("#sessionBanner");
    banner.textContent = text;
    banner.hidden = false;
    clearTimeout(showSessionBanner.timer);
    showSessionBanner.timer = setTimeout(() => { banner.hidden = true; }, duration);
  }

  /* Todas las llamadas pasan el id pelado ("avatarModal"), igual que
     data-close-modal, así que aquí no vale querySelector. */
  function openModal(id) {
    $("#chatComposer").hidden = true;
    const modal = document.getElementById(id);
    if (modal) modal.hidden = false;
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.hidden = true;
    if (!lobbyShell.hidden) $("#lobbyStage").focus({ preventScroll: true });
  }

  function isTypingTarget(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
  }

  function bindControls() {
    document.querySelectorAll("[data-move]").forEach((button) => {
      const dir = button.dataset.move;
      const down = (event) => { event.preventDefault(); button.setPointerCapture?.(event.pointerId); setMove(dir, true); };
      const up = (event) => { event.preventDefault(); setMove(dir, false); };
      button.addEventListener("pointerdown", down);
      button.addEventListener("pointerup", up);
      button.addEventListener("pointercancel", up);
      button.addEventListener("pointerleave", (e) => { if (e.buttons === 0) setMove(dir, false); });
    });

    window.addEventListener("keydown", (event) => {
      if (isTypingTarget(event.target) || !localPlayerId) return;
      const key = event.key.toLowerCase();
      const map = { arrowup: "up", w: "up", arrowdown: "down", s: "down", arrowleft: "left", a: "left", arrowright: "right", d: "right" };
      if (map[key]) {
        event.preventDefault();
        setMove(map[key], true);
      } else if (key === "l") {
        event.preventDefault();
        openAvatarEditor();
      } else if (key === "r") {
        event.preventDefault();
        openChat();
      }
    });

    window.addEventListener("keyup", (event) => {
      const key = event.key.toLowerCase();
      const map = { arrowup: "up", w: "up", arrowdown: "down", s: "down", arrowleft: "left", a: "left", arrowright: "right", d: "right" };
      if (map[key]) setMove(map[key], false);
    });
  }

  function escapeHtml(text) {
    return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  }

  if (window.ML3DPersonajes) window.ML3DPersonajes.actual = () => profile.aspecto;
  /* El kit termina de cargar después: lo guardado se valida entonces, y a
     quien ya esté en una sala se le aplica. */
  window.addEventListener("ml3d-personajes-listos", () => {
    profile = normalizeProfile(profile);
    /* Lo que llegó de otros jugadores antes de tener el kit solo estaba
       acotado en tamaño: ahora se valida de verdad, antes de reenviarlo. */
    for (const player of players.values()) player.aspecto = limpiaAspecto(player.aspecto);
    const me = players.get(localPlayerId);
    if (me) me.aspecto = profile.aspecto;
    renderPlayers();
  });
  /* El sistema de avatares anterior guardaba aquí un identificador único y
     permanente del navegador, que se enviaba a los demás jugadores. Ya no
     existe; se borra lo que quedara. */
  try { localStorage.removeItem("ml3d-link-avatar-final-v1"); } catch {}

  $("#saveApi").addEventListener("click", () => {
    localStorage.setItem(API_KEY, apiBase());
    $("#apiStatus").textContent = "API guardada en este navegador.";
  });
  $("#checkApi").addEventListener("click", checkApi);
  $("#createRoom").addEventListener("click", createRoom);
  $("#searchRooms").addEventListener("click", searchRooms);
  $("#joinByCode").addEventListener("click", selectRoomByCode);
  $("#roomCode").addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); selectRoomByCode(); }
  });
  $("#lobbyRoomCode").addEventListener("click", () => {
    const code = normalizeRoomCode($("#lobbyRoomCode").textContent.replace(/^Código\s*/i, ""));
    if (!code) return;
    navigator.clipboard?.writeText(code).then(
      () => log(`Código ${code} copiado.`),
      () => log(`Código de sala: ${code}`)
    );
  });
  $("#joinRoom").addEventListener("click", joinSelectedRoom);
  $("#avatarButton").addEventListener("click", openAvatarEditor);
  $("#chatButton").addEventListener("click", openChat);
  $("#selectButton").addEventListener("click", openSelectMenu);
  $("#saveProfile").addEventListener("click", applyProfile);
  $("#applyGame").addEventListener("click", applyGameSetting);
  $("#applyRoomSettings").addEventListener("click", () => applyRoomSettings(false));
  $("#removePassword").addEventListener("click", () => applyRoomSettings(true));
  $("#closeRoom").addEventListener("click", closeRoom);
  $("#leaveRoom").addEventListener("click", () => leaveRoom(true));
  $("#startSession").addEventListener("click", startSessionCountdown);
  $("#hostIdleMinutes")?.addEventListener("change", (event) => {
    if (hostSession) hostSession.idleMinutes = Number(event.target.value) || 0;
  });
  $("#hostDesafios")?.addEventListener("change", (event) => {
    window.ML3DCombates.activa(event.target.checked);
    avisa(event.target.checked ? "Desafíos activados en la sala." : "Desafíos desactivados en la sala.");
  });
  $("#hostChat")?.addEventListener("change", (event) => {
    ponChat(event.target.checked);
    avisa(event.target.checked ? "Chat activado para la sala." : "Chat desactivado para la sala.");
  });
  $("#hostConfirmPlayers")?.addEventListener("change", (event) => {
    if (hostSession) hostSession.confirm = Boolean(event.target.checked);
  });
  /* El botón de crear dice lo que va a hacer según el tipo elegido. */
  const pintaTipo = () => {
    const cerca = $("#roomKind")?.value === "nearby";
    const local = $("#roomKind")?.value === "local";
    $("#createRoom").textContent = cerca ? "CREAR SALA DE PROXIMIDAD" : "CREAR SALA PRIVADA";
    /* Entre desconocidos, el chat empieza apagado; el anfitrión puede cambiarlo. */
    if ($("#roomChat")) $("#roomChat").checked = !cerca;
    const nota = $("#roomKindNote");
    if (nota) {
      nota.textContent = local
        ? "Dos consolas en este dispositivo, unidas por el cable. No es una sala en red."
        : cerca
        ? "Aparece en «buscar cerca» para quien esté cerca. Usa tu ubicación aproximada; nadie la ve."
        : "Solo se entra con el código o el QR. No usa tu ubicación.";
    }
  };
  $("#roomKind")?.addEventListener("change", pintaTipo);
  pintaTipo();
  renderBlocked();

  /* Si este navegador se cerró hace menos de 20 segundos estando en una sala,
     se vuelve a ella y al mismo hueco, sin preguntar. */
  setTimeout(() => {
    const reserva = leeReserva();
    if (!reserva || !reserva.token || Date.now() - Number(reserva.visto || 0) > RESERVA_MS) {
      borraReserva();
      return;
    }
    if (hostSession || joinSession) return;
    selectedRoom = {
      id: String(reserva.roomId || ""), name: String(reserva.roomName || "Sala"), game: String(reserva.game || ""),
      byCode: true, locked: false, resume: String(reserva.token)
    };
    $("#playerName").value = reserva.name || profile.name;
    $("#joinPassword").value = "";
    setState("working", "Volviendo a tu sala…");
    joinSelectedRoom();
  }, 300);
  document.querySelectorAll("[data-open-link-emulator]").forEach((button) => {
    button.addEventListener("click", openLinkEmulator);
  });
  $("#closeLinkEmulator")?.addEventListener("click", closeLinkEmulator);
  $("#chatForm").addEventListener("submit", (event) => {
    event.preventDefault();
    sendChat($("#chatInput").value);
    closeChat();
  });
  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.dataset.closeModal));
  });

  sendButton.addEventListener("click", () => {
    const text = cleanChat($("#message").value);
    if (!text) return;
    if (hostSession) {
      const count = sendAll({ type: "debug:message", text, time: Date.now() });
      log(`Prueba enviada a ${count} enlace(s).`);
    } else if (joinSession) {
      safeSend(joinSession.channel, { type: "debug:message", text, time: Date.now() });
      log("Prueba enviada al host.");
    }
  });

  pingButton.addEventListener("click", () => {
    if (hostSession) runQualityProbe();
    else if (joinSession) safeSend(joinSession.channel, { type: "debug:message", text: "Ping solicitado", time: Date.now() });
  });

  window.addEventListener("pagehide", () => {
    stopHostTimers();
    stopJoinTimers();
    stopMoveTimer();
    if (gbaLinkPending) {
      clearTimeout(gbaLinkPending.timer);
      gbaLinkPending = null;
    }
  });

  /* Fuera del sitio publicado, una API guardada que apunte a otro sitio no
     puede funcionar (CORS), así que no se hereda: manda el proxy propio. Vale
     igual para localhost y para un túnel, que es como entra el móvil. */
  const storedApi = localStorage.getItem(API_KEY) || "";
  const usableApi = location.origin === SITIO_PUBLICADO
    ? (storedApi || DEFAULT_API_BASE)
    : (storedApi.startsWith(location.origin) ? storedApi : DEFAULT_API_BASE);
  $("#apiBase").value = usableApi;
  $("#playerName").value = profile.name;
  buildEditorChoices();
  bindControls();
  acotaSelectoresDeJugadores();
  log("ML3D Link Lobby v4 · bus GBA Cable Link listo.");
})();
