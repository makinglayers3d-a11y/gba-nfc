(() => {
  "use strict";

  /* Juegos de la sala: qué juego tiene cargado cada jugador, qué hay en su
     biblioteca y, cuando hace falta, envío de una ROM de un jugador a otro.

     Viaja por los mismos RTCDataChannel del lobby, con paquetes propios
     (ml3d:game:*), igual que hace avatar-final.js con el avatar: rooms.js
     ignora lo que no entiende, así que no hay que tocarlo.

     Sobre el envío de ROMs: solo se envía un juego que su dueño ha cargado
     desde un archivo suyo. Los juegos de la biblioteca de testers no salen de
     aquí nunca: quien manda es la página del emulador, que no entrega los
     bytes de un juego de la biblioteca, y este fichero no tiene otra forma de
     conseguirlos. */

  if (new URLSearchParams(location.search).get("embed") !== "1") return;

  const CHUNK = 12 * 1024;          /* bytes por paquete, antes de base64 */
  const BUFFER_LIMIT = 512 * 1024;  /* freno cuando el canal se llena */
  const MAX_ROM_BYTES = 64 * 1024 * 1024;
  const STATUS_INTERVAL_MS = 4000;

  const channels = new Set();
  const peers = new Map();
  const listeners = new Set();
  const incoming = new Map();
  let onTransfer = null;
  let onRequest = null;
  let onCheck = null;

  /* `tiene`: claves de juegos de la sala que este jugador ha dicho que tiene
     aunque en su dispositivo se llamen de otra forma.
     `origen`: "local" si el juego cargado viene de un archivo suyo. */
  let local = { name: "", game: "", hash: "", system: "", library: [], tiene: [], origen: "" };

  const clean = (value) => String(value || "").replace(/\s*★$/, "").trim().slice(0, 32);

  function localName() {
    const fromStage = document.querySelector(".player.local .player-name-text")?.textContent;
    return clean(fromStage) || clean(document.getElementById("profileName")?.value) || "Jugador";
  }

  function notify() {
    for (const listener of listeners) {
      try { listener(); } catch (error) { console.error(error); }
    }
  }

  /* ---------- canales ---------- */

  function send(packet) {
    const text = JSON.stringify({ ...packet, from: local.name, time: Date.now() });
    let sent = 0;
    for (const channel of channels) {
      if (channel.readyState !== "open") continue;
      try { channel.__ml3dGamesSend(text); sent++; } catch {}
    }
    return sent;
  }

  function wireChannel(channel, nativeSend) {
    if (channel.__ml3dGames) return;
    channel.__ml3dGames = true;
    channel.__ml3dGamesSend = (text) => nativeSend.call(channel, text);
    channels.add(channel);
    channel.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let packet = null;
      try { packet = JSON.parse(event.data); } catch { return; }
      if (packet?.type?.startsWith?.("ml3d:game:")) handlePacket(packet, channel);
    });
    channel.addEventListener("close", () => channels.delete(channel));
    channel.addEventListener("open", () => setTimeout(broadcastStatus, 400));
  }

  function hookTransport() {
    const nativeSend = RTCDataChannel.prototype.send;

    const nativeCreate = RTCPeerConnection.prototype.createDataChannel;
    RTCPeerConnection.prototype.createDataChannel = function (...args) {
      const channel = nativeCreate.apply(this, args);
      wireChannel(channel, nativeSend);
      return channel;
    };

    /* Red de seguridad: cualquier canal al que el lobby enganche un listener
       queda registrado aquí también, venga de donde venga. */
    const nativeChannelAdd = RTCDataChannel.prototype.addEventListener;
    RTCDataChannel.prototype.addEventListener = function (type, listener, options) {
      wireChannel(this, nativeSend);
      return nativeChannelAdd.call(this, type, listener, options);
    };

    const nativeAdd = RTCPeerConnection.prototype.addEventListener;
    RTCPeerConnection.prototype.addEventListener = function (type, listener, options) {
      if (type !== "datachannel") return nativeAdd.call(this, type, listener, options);
      return nativeAdd.call(this, type, (event) => {
        wireChannel(event.channel, nativeSend);
        listener.call(this, event);
      }, options);
    };
  }

  function channelOf(name) {
    const wanted = clean(name);
    for (const channel of channels) {
      if (channel.readyState === "open" && channel.__ml3dGamesPeer === wanted) return channel;
    }
    /* Con dos jugadores solo hay un canal: sirve aunque aún no tenga nombre. */
    const open = [...channels].filter((channel) => channel.readyState === "open");
    return open.length === 1 ? open[0] : null;
  }

  /* ---------- estado de juegos ---------- */

  function broadcastStatus() {
    local.name = localName();
    send({
      type: "ml3d:game:status",
      game: local.game,
      hash: local.hash,
      system: local.system,
      library: local.library,
      tiene: local.tiene,
      origen: local.origen
    });
  }

  function handlePacket(packet, channel) {
    const from = clean(packet.from);
    if (!from) return;
    channel.__ml3dGamesPeer = from;
    const paraMi = clean(packet.to) === local.name;

    switch (packet.type) {
      case "ml3d:game:status": {
        peers.set(from, {
          name: from,
          game: String(packet.game || ""),
          hash: String(packet.hash || ""),
          system: String(packet.system || ""),
          library: Array.isArray(packet.library) ? packet.library.map(String) : [],
          tiene: Array.isArray(packet.tiene) ? packet.tiene.map(String) : [],
          origen: String(packet.origen || ""),
          at: Date.now()
        });
        notify();
        break;
      }
      /* El anfitrión ha intentado empezar: cada uno revisa si tiene el juego. */
      case "ml3d:game:check": {
        onCheck?.({ from, game: String(packet.game || "") });
        break;
      }
      /* Alguien pide el juego. Decide quien lo tiene, y los bytes los pone la
         página del emulador, que solo entrega un juego cargado de un archivo. */
      case "ml3d:game:request": {
        if (!paraMi) return;
        onRequest?.({ from, game: String(packet.game || "") });
        break;
      }
      case "ml3d:game:denied": {
        if (!paraMi) return;
        incoming.delete(from);
        onTransfer?.({ state: "denied", from, reason: String(packet.reason || "") });
        break;
      }
      case "ml3d:game:meta": {
        if (!paraMi) return;
        const size = Number(packet.size) | 0;
        if (size <= 0 || size > MAX_ROM_BYTES) return;
        incoming.set(from, {
          name: String(packet.name || "juego.gba").replace(/[\\/]/g, "_").slice(0, 120),
          system: String(packet.system || "gba"),
          size,
          parts: [],
          received: 0
        });
        onTransfer?.({ state: "start", from, name: String(packet.name || ""), progress: 0 });
        break;
      }
      case "ml3d:game:chunk": {
        if (!paraMi) return;
        const entry = incoming.get(from);
        if (!entry) return;
        const binary = atob(String(packet.data || ""));
        if (entry.received + binary.length > entry.size) { incoming.delete(from); return; }
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        entry.parts[Number(packet.index) | 0] = bytes;
        entry.received += bytes.length;
        onTransfer?.({ state: "progress", from, name: entry.name, progress: Math.min(1, entry.received / entry.size) });
        break;
      }
      case "ml3d:game:done": {
        if (!paraMi) return;
        const entry = incoming.get(from);
        incoming.delete(from);
        if (!entry) return;
        const bytes = new Uint8Array(entry.received);
        let offset = 0;
        for (const part of entry.parts) {
          if (!part) continue;
          bytes.set(part, offset);
          offset += part.length;
        }
        /* Un envío a medias no se da por bueno. */
        if (offset !== entry.size) {
          onTransfer?.({ state: "denied", from, reason: "El juego ha llegado incompleto." });
          return;
        }
        onTransfer?.({ state: "done", from, name: entry.name, system: entry.system, bytes, progress: 1 });
        break;
      }
      default:
        break;
    }
  }

  /* ---------- envío de la ROM ---------- */

  function waitForDrain(channel) {
    if (channel.bufferedAmount < BUFFER_LIMIT) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (channel.readyState !== "open" || channel.bufferedAmount < BUFFER_LIMIT) resolve();
        else setTimeout(check, 60);
      };
      setTimeout(check, 60);
    });
  }

  async function sendRom(target, rom) {
    const channel = channelOf(target);
    if (!channel || !rom?.bytes?.length) return false;
    const to = clean(target);
    const total = Math.ceil(rom.bytes.length / CHUNK);

    const push = (packet) => {
      try {
        channel.__ml3dGamesSend(JSON.stringify({ ...packet, from: local.name, to, time: Date.now() }));
      } catch {}
    };

    push({ type: "ml3d:game:meta", name: rom.name, system: rom.system, size: rom.bytes.length });

    for (let index = 0; index < total; index++) {
      await waitForDrain(channel);
      if (channel.readyState !== "open") return false;
      const slice = rom.bytes.subarray(index * CHUNK, (index + 1) * CHUNK);
      let binary = "";
      for (let i = 0; i < slice.length; i++) binary += String.fromCharCode(slice[i]);
      push({ type: "ml3d:game:chunk", index, data: btoa(binary) });
      onTransfer?.({ state: "sending", to, name: rom.name, progress: (index + 1) / total });
    }
    push({ type: "ml3d:game:done" });
    onTransfer?.({ state: "sent", to, name: rom.name, progress: 1 });
    return true;
  }

  /* ---------- API ---------- */

  window.ML3DRoomGames = {
    hook: hookTransport,
    setLocal(patch = {}) {
      local = { ...local, ...patch, name: localName() };
      broadcastStatus();
      notify();
    },
    get local() {
      return { ...local };
    },
    peers() {
      return [...peers.values()];
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onTransfer(handler) { onTransfer = handler; },
    onRequest(handler) { onRequest = handler; },
    onCheck(handler) { onCheck = handler; },
    /** El anfitrión avisa de que quiere empezar con este juego. */
    check(game) {
      return send({ type: "ml3d:game:check", game: String(game || "") }) > 0;
    },
    /** Pide el juego de la sala a otro jugador. */
    request(name, game) {
      return send({ type: "ml3d:game:request", to: clean(name), game: String(game || "") }) > 0;
    },
    /** Respuesta de quien no puede o no quiere enviarlo. */
    deny(name, reason) {
      return send({ type: "ml3d:game:denied", to: clean(name), reason: String(reason || "") }) > 0;
    },
    sendRom,
    /* Para probar los avisos sin un segundo dispositivo. */
    debugPeer(peer = {}) {
      const name = clean(peer.name) || "Invitado";
      peers.set(name, { name, game: "", hash: "", system: "gba", library: [], tiene: [], origen: "", at: Date.now(), ...peer });
      notify();
    },
    debugPacket(packet) {
      handlePacket({ from: "Invitado", to: localName(), ...packet }, { __ml3dGamesPeer: "Invitado" });
    }
  };

  hookTransport();
  setInterval(() => {
    if (channels.size) broadcastStatus();
  }, STATUS_INTERVAL_MS);
})();
