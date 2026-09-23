(() => {
  "use strict";

  /* Juegos de la sala: qué juego tiene cargado cada jugador, qué hay en su
     biblioteca y envío de una ROM de un jugador a otro.

     Viaja por los mismos RTCDataChannel del lobby, con paquetes propios
     (ml3d:game:*), igual que hace avatar-final.js con el avatar: rooms.js
     ignora lo que no entiende, así que no hay que tocarlo. */

  if (new URLSearchParams(location.search).get("embed") !== "1") return;

  const CHUNK = 12 * 1024;          // bytes por paquete, antes de base64
  const BUFFER_LIMIT = 512 * 1024;  // freno cuando el canal se llena
  const STATUS_INTERVAL_MS = 4000;

  const channels = new Set();
  const peers = new Map();
  const listeners = new Set();
  const incoming = new Map();

  let local = { name: "", game: "", hash: "", system: "", library: [], sharing: null };
  let sharedRom = null; // { bytes, name, system, hash }
  let onTransfer = null;

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
      library: local.library,
      sharing: local.sharing
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
          sharing: packet.sharing || null,
          at: Date.now()
        });
        notify();
        break;
      }
      case "ml3d:game:request": {
        if (clean(packet.to) !== local.name || !sharedRom) return;
        sendRom(channel).catch((error) => console.error("ML3D compartir:", error));
        break;
      }
      case "ml3d:game:meta": {
        if (clean(packet.to) !== local.name) return;
        incoming.set(from, {
          name: String(packet.name || "juego.gba"),
          system: String(packet.system || "gba"),
          size: Number(packet.size) | 0,
          chunks: Number(packet.chunks) | 0,
          parts: [],
          received: 0
        });
        onTransfer?.({ state: "start", from, name: String(packet.name || ""), progress: 0 });
        break;
      }
      case "ml3d:game:chunk": {
        if (clean(packet.to) !== local.name) return;
        const entry = incoming.get(from);
        if (!entry) return;
        const binary = atob(String(packet.data || ""));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        entry.parts[Number(packet.index) | 0] = bytes;
        entry.received += bytes.length;
        onTransfer?.({
          state: "progress",
          from,
          name: entry.name,
          progress: entry.size ? Math.min(1, entry.received / entry.size) : 0
        });
        break;
      }
      case "ml3d:game:done": {
        if (clean(packet.to) !== local.name) return;
        const entry = incoming.get(from);
        incoming.delete(from);
        if (!entry) return;
        const total = entry.parts.reduce((sum, part) => sum + (part?.length || 0), 0);
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const part of entry.parts) {
          if (!part) continue;
          bytes.set(part, offset);
          offset += part.length;
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

  async function sendRom(channel) {
    const rom = sharedRom;
    if (!rom || channel.readyState !== "open") return;
    const chunks = Math.ceil(rom.bytes.length / CHUNK);
    const target = peerNameFor(channel);

    const push = (packet) => {
      try {
        channel.__ml3dGamesSend(JSON.stringify({ ...packet, from: local.name, to: target, time: Date.now() }));
      } catch {}
    };

    push({ type: "ml3d:game:meta", name: rom.name, system: rom.system, size: rom.bytes.length, chunks, hash: rom.hash });

    for (let index = 0; index < chunks; index++) {
      await waitForDrain(channel);
      if (channel.readyState !== "open") return;
      const slice = rom.bytes.subarray(index * CHUNK, (index + 1) * CHUNK);
      let binary = "";
      for (let i = 0; i < slice.length; i++) binary += String.fromCharCode(slice[i]);
      push({ type: "ml3d:game:chunk", index, data: btoa(binary) });
      onTransfer?.({ state: "sending", to: target, name: rom.name, progress: (index + 1) / chunks });
    }
    push({ type: "ml3d:game:done" });
    onTransfer?.({ state: "sent", to: target, name: rom.name, progress: 1 });
  }

  /* Con dos jugadores por sala basta con el único par del canal; si algún día
     hay más, el nombre sale del último estado recibido por ese canal. */
  function peerNameFor(channel) {
    return channel.__ml3dGamesPeer || [...peers.keys()][0] || "";
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
    onTransfer(handler) {
      onTransfer = handler;
    },
    async share(file) {
      const buffer = await file.arrayBuffer();
      const extension = (file.name.match(/\.(gba|gbc|gb)$/i) || [])[1] || "gba";
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      const hash = [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
      sharedRom = {
        bytes: new Uint8Array(buffer),
        name: file.name,
        system: extension.toLowerCase(),
        hash
      };
      local.sharing = { name: file.name.replace(/\.(gba|gbc|gb)$/i, ""), size: sharedRom.bytes.length, hash };
      broadcastStatus();
      notify();
      return local.sharing;
    },
    get shared() {
      return sharedRom ? { ...local.sharing } : null;
    },
    request(name) {
      return send({ type: "ml3d:game:request", to: clean(name) }) > 0;
    },
    /* Para probar el bocadillo y el botón A sin un segundo dispositivo. */
    debugPeer(peer = {}) {
      const name = clean(peer.name) || "Invitado";
      peers.set(name, { name, game: "", hash: "", system: "gba", library: [], sharing: null, at: Date.now(), ...peer });
      notify();
    },
    stopSharing() {
      sharedRom = null;
      local.sharing = null;
      broadcastStatus();
      notify();
    }
  };

  hookTransport();
  setInterval(() => {
    if (channels.size) broadcastStatus();
  }, STATUS_INTERVAL_MS);
})();
