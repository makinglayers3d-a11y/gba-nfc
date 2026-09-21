(() => {
  "use strict";

  const DEFAULT_API_BASE = "https://ml3d-link-lab.makinglayers3d.workers.dev";
  const ICE_SERVERS = [{ urls: ["stun:stun.cloudflare.com:3478"] }];
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
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store"
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

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

  function parseDescription(value, expected) {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || parsed.type !== expected || typeof parsed.sdp !== "string") {
      throw new Error(`Descripción ${expected} no válida.`);
    }
    return parsed;
  }

  function makePeer(label, onChannel) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.addEventListener("connectionstatechange", () => log(`${label}: peer ${pc.connectionState}`));
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

  function currentLinkRoomId() {
    return String(hostSession?.room?.id || joinSession?.room?.id || "");
  }

  function rememberLocalLinkSession(roomId, playerNumber, role) {
    const next = {
      roomId: String(roomId || ""),
      playerNumber: Math.max(0, Math.min(3, Number(playerNumber) | 0)),
      role: role === "host" ? "host" : "guest",
      updatedAt: Date.now()
    };
    try {
      localStorage.setItem(GBA_LINK_STORAGE_KEY, JSON.stringify(next));
    } catch {}
    if (gbaLinkBus) {
      gbaLinkBus.postMessage({
        type: "gba:link:configure",
        source: "lobby",
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

  function handleLocalGbaLinkMessage(event) {
    const packet = event.data;
    if (!packet || packet.source !== "emulator") return;
    const roomId = currentLinkRoomId();
    if (!roomId || packet.roomId !== roomId) return;

    if (packet.type === "gba:lockstep:ready") {
      const outgoing = {
        type: "gba:lockstep:ready",
        roomId,
        playerNumber: Number(packet.playerNumber) | 0,
        role: String(packet.role || ""),
        romHash: String(packet.romHash || ""),
        protocol: String(packet.protocol || ""),
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
        time: Date.now()
      };
      for (const peer of hostSession.peers.values()) {
        if (peer.channel?.readyState === "open") safeSend(peer.channel, outgoing);
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

  function normalizeProfile(value = {}) {
    return {
      name: cleanName(value.name || "Jugador"),
      color: Object.hasOwn(PALETTE, value.color) ? value.color : "orange",
      body: BODIES.includes(value.body) ? value.body : "round",
      face: FACES.includes(value.face) ? value.face : "happy",
      accessory: ACCESSORIES.includes(value.accessory) ? value.accessory : "none"
    };
  }

  function cleanName(value) {
    return String(value || "Jugador").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 32) || "Jugador";
  }

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
      host: Boolean(player.host)
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
        el.append(name, wrap);
        playersLayer.append(el);
      }
      existing.delete(player.id);
      el.classList.toggle("local", player.id === localPlayerId);
      el.style.left = `${player.x}%`;
      el.style.top = `${player.y}%`;
      const nameText = el.querySelector(".player-name-text");
      nameText.textContent = player.host ? `${player.name} ★` : player.name;
      const q = el.querySelector(".quality-dot");
      q.className = `quality-dot ${qualityClass(player.quality)}`;
      q.title = `${qualityLabel(player.quality)}${Number.isFinite(player.rtt) ? ` · ${Math.round(player.rtt)} ms` : ""}`;
      renderAvatarInto(el.querySelector(".avatar-wrap"), player.avatar);
    }
    for (const el of existing.values()) el.remove();
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

  function showChatBubble(playerId, text) {
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
    $("#lobbyRoomName").textContent = room.name || "Sala";
    $("#lobbyGameName").textContent = room.game || "Sin juego seleccionado";
    $("#lobbyRoomCode").textContent = room.id ? `Código ${room.id}` : "";
    $("#hostGameInput").value = room.game || "";
    $("#hostRoomNameInput").value = room.name || "";
    $("#hostMaxPlayers").value = String(room.maxPlayers || 2);
    $("#guestRoomInfo").textContent = `${room.name || "Sala"}${room.game ? ` · ${room.game}` : ""}`;
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

    if (packet.type === "gba:lockstep:ready") {
      postLocalLink({
        type: "gba:lockstep:remote-ready",
        roomId: hostSession.room.id,
        ready: true,
        playerNumber: Math.max(1, Math.min(3, Number(peer.linkSlot) | 0)),
        romHash: String(packet.romHash || ""),
        protocol: String(packet.protocol || "")
      });
      return;
    }

    if (packet.type === "gba:lockstep:input") {
      postLocalLink({
        type: "gba:lockstep:remote-input",
        roomId: hostSession.room.id,
        sessionId: String(packet.sessionId || ""),
        playerNumber: Math.max(1, Math.min(3, Number(peer.linkSlot) | 0)),
        frame: Number(packet.frame),
        mask: Number(packet.mask) & 0x3ff
      });
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

    if (packet.type === "lobby:profile") {
      const incoming = normalizeProfile(packet.profile || {});
      if (player) {
        player.name = incoming.name;
        player.avatar = { color: incoming.color, body: incoming.body, face: incoming.face, accessory: incoming.accessory };
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

    if (packet.type === "lobby:chat" && player) {
      const text = cleanChat(packet.text);
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
    if (packet.type === "gba:lockstep:ready") {
      postLocalLink({
        type: "gba:lockstep:remote-ready",
        roomId: packet.roomId || joinSession?.room?.id || "",
        ready: true,
        playerNumber: 0,
        romHash: String(packet.romHash || ""),
        protocol: String(packet.protocol || "")
      });
      return;
    }

    if (packet.type === "gba:lockstep:start") {
      postLocalLink({
        type: "gba:lockstep:start",
        roomId: packet.roomId || joinSession?.room?.id || "",
        sessionId: String(packet.sessionId || ""),
        delay: Number(packet.delay) | 0,
        romHash: String(packet.romHash || "")
      });
      return;
    }

    if (packet.type === "gba:lockstep:input") {
      postLocalLink({
        type: "gba:lockstep:remote-input",
        roomId: packet.roomId || joinSession?.room?.id || "",
        sessionId: String(packet.sessionId || ""),
        playerNumber: 0,
        frame: Number(packet.frame),
        mask: Number(packet.mask) & 0x3ff
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
      if (joinSession) joinSession.linkSlot = slot;
      rememberLocalLinkSession(packet.roomId || joinSession?.room?.id || "", slot, "guest");
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
      renderPlayers();
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
      showChatBubble(String(packet.playerId || ""), cleanChat(packet.text));
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
      safeSend(joinSession.channel, { type: "net:pong", id: packet.id, sentAt: packet.sentAt, time: Date.now() });
      return;
    }

    if (packet.type === "session:start") {
      const launchDelay = Math.max(1800, Number(packet.launchDelay) || 2400);
      showSessionBanner("3", 550);
      setTimeout(() => showSessionBanner("2", 550), 600);
      setTimeout(() => showSessionBanner("1", 550), 1200);
      setTimeout(() => showSessionBanner("ML3D LINK\nPREPARADO", 1800), 1800);
      setTimeout(() => openLinkEmulator(), launchDelay);
      return;
    }

    if (packet.type === "lobby:kicked") {
      showSessionBanner("EXPULSADO DE LA SALA", 2200);
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
      host: Boolean(raw.host)
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
  }

  function stopJoinTimers() {
    if (!joinSession) return;
    clearInterval(joinSession.pollTimer);
    clearInterval(joinSession.heartbeatTimer);
  }

  async function createRoom() {
    try {
      setState("working", "Obteniendo ubicación…");
      const loc = await getLocation();
      setState("working", "Creando sala…");
      const data = await api("/v1/rooms", {
        method: "POST",
        body: {
          name: $("#roomName").value,
          game: $("#gameName").value,
          password: $("#roomPassword").value,
          maxPlayers: 2,
          lat: loc.lat,
          lon: loc.lon
        }
      });
      players = new Map();
      hostSession = { room: data.room, token: data.hostToken, peers: new Map(), pollBusy: false, joins: [] };
      rememberLocalLinkSession(data.room.id, 0, "host");
      ensureLocalPlayer("host", true, spawnPoint(0));
      updateToolbar(data.room);
      setLobbyVisible(true);
      setState("working", "Sala publicada · esperando jugadores");
      log(`Sala ${data.room.id} creada. Precisión del navegador: ~${Math.round(loc.accuracy)} m.`);
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
        if (join.status === "requested" && !peers.has(join.id)) await prepareHostOffer(join);
        const peer = peers.get(join.id);
        if (join.status === "answer_ready" && peer && !peer.answerApplied && join.answer) {
          await peer.pc.setRemoteDescription(parseDescription(join.answer, "answer"));
          peer.answerApplied = true;
          log(`Host: respuesta aplicada para ${join.displayName}.`);
        }
      }
      for (const [joinId, peer] of peers) {
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

  async function prepareHostOffer(join) {
    const { room, token, peers } = hostSession;
    const index = Math.min(3, peers.size + 1);
    const pos = spawnPoint(index);
    const placeholder = {
      id: join.id,
      name: cleanName(join.displayName),
      avatar: { color: "blue", body: "round", face: "happy", accessory: "none" },
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
      linkReady: false,
      metrics: { pending: new Map(), rtt: null, jitter: null, lastRtt: null, missed: 0, quality: "unknown" }
    };
    const pc = makePeer(`Host↔${join.displayName}`, () => {});
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
      body: { offer: serialize(pc.localDescription) }
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
      safeSend(channel, {
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
      renderManagePlayers();
    });
    channel.addEventListener("close", () => {
      log(`${peerInfo.join.displayName}: canal cerrado.`);
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
      handleHostPacket(joinId, packet);
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
      const compatibleRooms = (data.rooms || []).filter((room) => Number(room.maxPlayers) === 2);
      renderRooms(compatibleRooms);
      setState("idle", compatibleRooms.length ? `${compatibleRooms.length} sala(s) Link P1/P2 encontrada(s)` : "No hay salas Link P1/P2 cercanas");
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
      const distance = room.distanceMeters < 1000 ? `${room.distanceMeters} m` : `${(room.distanceMeters / 1000).toFixed(1)} km`;
      const full = room.players >= room.maxPlayers;
      return `<div class="room"><div class="room-head"><div><div class="room-title">${escapeHtml(room.name)}</div><div class="hint">${escapeHtml(room.game || "Juego no indicado")}</div></div><div>${room.locked ? "🔒" : ""}</div></div><div class="badges"><span class="badge">${distance}</span><span class="badge">${room.players}/${room.maxPlayers}</span><span class="badge">${escapeHtml(room.id)}</span></div><button data-room-id="${escapeHtml(room.id)}" ${full ? "disabled" : ""}>${full ? "SALA COMPLETA" : "UNIRME"}</button></div>`;
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
      : `${room.name}${room.game ? ` · ${room.game}` : ""} · ${room.players}/${room.maxPlayers}`;
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
        body: { password: $("#joinPassword").value, displayName: profile.name }
      });
      players = new Map();
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
      setState("working", "Esperando al host…");
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
    const pc = makePeer(`Jugador↔${room.name}`, (channel) => {
      joinSession.channel = channel;
      attachGuestChannel(channel);
    });
    joinSession.pc = pc;
    await pc.setRemoteDescription(parseDescription(offerText, "offer"));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitIce(pc);
    await api(`/v1/rooms/${encodeURIComponent(room.id)}/joins/${encodeURIComponent(join.id)}/answer`, {
      method: "POST",
      token,
      body: { answer: serialize(pc.localDescription) }
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
      updateChannelButtons();
      if (joinSession) setState("idle", "Conexión cerrada");
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

  async function leaveRoom(callApi = true) {
    if (!joinSession) return;
    const session = joinSession;
    stopJoinTimers();
    if (callApi) {
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
    const cleaned = cleanChat(text);
    if (!cleaned || !localPlayerId) return;
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
    if (!localPlayerId && !hostSession && !joinSession) return;
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
    const next = normalizeProfile({ ...profile, name: $("#profileName").value });
    saveProfileLocal(next);
    const me = players.get(localPlayerId);
    if (me) {
      me.name = profile.name;
      me.avatar = { color: profile.color, body: profile.body, face: profile.face, accessory: profile.accessory };
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
      row.append(label, kick);
      box.append(row);
    }
  }

  async function kickPlayer(joinId) {
    if (!hostSession) return;
    const peer = hostSession.peers.get(joinId);
    try {
      await api(`/v1/rooms/${encodeURIComponent(hostSession.room.id)}/joins/${encodeURIComponent(joinId)}/kick`, {
        method: "POST",
        token: hostSession.token
      });
      safeSend(peer?.channel, { type: "lobby:kicked", reason: "Expulsado por el host" });
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
      maxPlayers: 2
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
    if (!hostSession && playerNumber !== 1) {
      showSessionBanner("LINK GBA ACTUAL: SOLO P1/P2", 2200);
      return;
    }

    rememberLocalLinkSession(room.id, playerNumber, role);

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
      status.textContent = `${room.name || "Sala"} · jugador ${playerNumber} · ${role === "host" ? "HOST" : "INVITADO"}`;
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
    const connectedPeers = [...hostSession.peers.values()]
      .filter((peer) => peer.channel?.readyState === "open");
    if (connectedPeers.length !== 1 || Number(connectedPeers[0]?.linkSlot) !== 1) {
      showSessionBanner("SE NECESITAN EXACTAMENTE 2 JUGADORES", 2400);
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
        time: Date.now()
      });
    }
    const launchDelay = 2400;
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

  function openModal(id) {
    $("#chatComposer").hidden = true;
    $(id).hidden = false;
  }

  function closeModal(id) {
    const modal = $(id);
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

  $("#apiBase").value = localStorage.getItem(API_KEY) || DEFAULT_API_BASE;
  $("#playerName").value = profile.name;
  buildEditorChoices();
  bindControls();
  log("ML3D Link Lobby v4 · bus GBA Cable Link listo.");
})();
