(() => {
  "use strict";

  /* Juegos de la sala: qué juego tiene cargado cada jugador, qué hay en su
     biblioteca y envío de una ROM de un jugador a otro.

     Viaja por los mismos RTCDataChannel del lobby, con paquetes propios
     (ml3d:game:*), igual que hace avatar-final.js con el avatar: rooms.js
     ignora lo que no entiende, así que no hay que tocarlo. */

  if (new URLSearchParams(location.search).get("embed") !== "1") return;

  const STATUS_INTERVAL_MS = 4000;

  const channels = new Set();
  const peers = new Map();
  const listeners = new Set();

  let local = { name: "", game: "", hash: "", system: "", library: [] };

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

  /* ---------- estado de juegos ---------- */

  function broadcastStatus() {
    local.name = localName();
    send({
      type: "ml3d:game:status",
      game: local.game,
      hash: local.hash,
      system: local.system,
      library: local.library
    });
  }

  function handlePacket(packet, channel) {
    const from = clean(packet.from);
    if (!from) return;
    channel.__ml3dGamesPeer = from;

    switch (packet.type) {
      case "ml3d:game:status": {
        peers.set(from, {
          name: from,
          game: String(packet.game || ""),
          hash: String(packet.hash || ""),
          system: String(packet.system || ""),
          library: Array.isArray(packet.library) ? packet.library.map(String) : [],
          at: Date.now()
        });
        notify();
        break;
      }
      /* Reparto de ROMs retirado: si un cliente antiguo manda estos paquetes,
         se ignoran en lugar de aceptar el juego. */
      case "ml3d:game:request":
      case "ml3d:game:meta":
      case "ml3d:game:chunk":
      case "ml3d:game:done":
      default:
        break;
    }
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
    /* Para probar el bocadillo y el botón A sin un segundo dispositivo. */
    debugPeer(peer = {}) {
      const name = clean(peer.name) || "Invitado";
      peers.set(name, { name, game: "", hash: "", system: "gba", library: [], at: Date.now(), ...peer });
      notify();
    }
  };

  hookTransport();
  setInterval(() => {
    if (channels.size) broadcastStatus();
  }, STATUS_INTERVAL_MS);
})();
