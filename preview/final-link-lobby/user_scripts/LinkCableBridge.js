(() => {
  "use strict";

  if (window.ML3DLinkCable) return;

  const params = new URLSearchParams(location.search);
  if (params.get("linkTransport") === "dual") {
    window.ML3DLinkCable = {
      attachEmulator() { return false; },
      detachEmulator() {},
      configure() {},
      status() { return { disabled: true, transport: "dual" }; }
    };
    return;
  }

  const CHANNEL_NAME = "ml3d-gba-link-v1";
  const STORAGE_KEY = "ml3d-gba-link-session-v1";

  let emulator = null;
  let serial = null;
  let localSequence = 0;
  let localReady = false;
  let localModeMulti = false;
  let remoteReady = false;
  let readyTimer = 0;
  let transferInFlight = false;
  let activeTransferSeq = "";
  let localHardwareComplete = false;
  let hostCompletionReleaseRequested = false;
  let expectedRemoteHardwareAcks = 0;
  const remoteHardwareAcks = new Set();
  const remoteNextWordAcks = new Set();
  const remotePreparedWords = new Map();
  let awaitingGuestNextWord = false;
  let guestNextWordFallbackTimer = 0;
  let lastGuestPollSeq = "";
  let lastGuestReplyWord = 0xFFFF;
  let lastGuestReplyBaud = 0;
  let transferCount = 0;
  let lastState = "boot";
  let waitStartedAt = 0;
  let lastWaitMs = null;
  let waitSamples = 0;
  let waitTotalMs = 0;
  let waitMaxMs = 0;
  let errorCount = 0;
  let debugFrozen = false;
  let debugStartedAt = performance.now();
  const debugHistory = [];
  let config = loadConfig();
  const bus = typeof BroadcastChannel === "function"
    ? new BroadcastChannel(CHANNEL_NAME)
    : null;

  function sanitizePlayerNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(3, n | 0)) : 0;
  }

  function normalizeConfig(value = {}) {
    const roomId = String(value.roomId || "").trim().slice(0, 120);
    return {
      roomId,
      playerNumber: sanitizePlayerNumber(value.playerNumber),
      role: value.role === "host" ? "host" : "guest"
    };
  }

  function loadConfig() {
    const queryRoom = String(params.get("linkRoom") || "").trim();
    if (queryRoom) {
      return normalizeConfig({
        roomId: queryRoom,
        playerNumber: params.get("linkPlayer"),
        role: params.get("linkRole")
      });
    }
    try {
      return normalizeConfig(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
    } catch {
      return normalizeConfig();
    }
  }

  function saveConfig(next) {
    config = normalizeConfig(next);
    remoteReady = false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {}
    if (serial) {
      serial.setLinkPlayerNumber(config.playerNumber);
      localModeMulti = (serial.SIOCNT_MODE | 0) === 2;
      localReady = false;
      if (localModeMulti) adapter.onSerialModeChange(2);
    }
    publishLocalReady();
    emitStatus("configured");
  }

  function shortSeq(value) {
    const seq = String(value || "");
    return seq ? seq.slice(-7) : "-";
  }

  function hex16(value) {
    return (Number(value) & 0xFFFF).toString(16).padStart(4, "0");
  }

  function recordDebugState(state, extra = {}) {
    if (params.get("linkDebug") !== "1" || debugFrozen) return;
    const waiting = Boolean(emulator?.IOCore?.linkCableWait);
    const elapsed = Math.max(0, Math.round(performance.now() - debugStartedAt));
    const wait = Number.isFinite(extra.waitMs)
      ? Math.round(extra.waitMs)
      : (Number.isFinite(lastWaitMs) ? Math.round(lastWaitMs) : null);
    const flags =
      `M${localModeMulti ? 1 : 0}L${localReady ? 1 : 0}R${remoteReady ? 1 : 0}W${waiting ? 1 : 0}`;
    const errorTag = extra.error ? " ERR" : "";
    const dataTag = Array.isArray(extra.words)
      ? ` d:${hex16(extra.words[0])}/${hex16(extra.words[1])}`
      : (extra.word === undefined ? "" : ` d:${hex16(extra.word)}`);
    debugHistory.push(
      `${String(elapsed).padStart(5, " ")} ${flags} TX${transferCount} ${state}` +
      ` s:${shortSeq(extra.seq)}` +
      dataTag +
      (extra.reason ? ` r:${String(extra.reason)}` : "") +
      (wait === null ? "" : ` t:${wait}ms`) +
      errorTag
    );
    while (debugHistory.length > 8) debugHistory.shift();
    if (extra.error) {
      errorCount += 1;
      debugFrozen = true;
      lastState = "ERROR-SNAPSHOT";
    }
  }

  function emitStatus(state, extra = {}) {
    if (!debugFrozen) lastState = state;
    recordDebugState(state, extra);
    updateDebug();
    window.dispatchEvent(new CustomEvent("ml3d-link-cable-status", {
      detail: { state, ...config, ...extra }
    }));
  }

  function updateDebug() {
    if (params.get("linkDebug") !== "1") return;
    let el = document.getElementById("ml3d-link-debug");
    if (!el) {
      el = document.createElement("div");
      el.id = "ml3d-link-debug";
      el.style.cssText = "position:fixed;right:6px;bottom:6px;z-index:2147483647;max-width:min(96vw,470px);padding:7px 9px;background:rgba(0,0,0,.88);color:#fff;font:10px/1.3 monospace;border:1px solid rgba(255,255,255,.32);border-radius:6px;pointer-events:none;white-space:pre;overflow:hidden";
      document.documentElement.appendChild(el);
    }
    const waiting = Boolean(emulator?.IOCore?.linkCableWait);
    const waitText = Number.isFinite(lastWaitMs) ? Math.round(lastWaitMs) + "ms" : "--";
    const avgWait = waitSamples ? Math.round(waitTotalMs / waitSamples) : 0;
    const title = debugFrozen ? "LINK ERROR SNAPSHOT" : "LINK TRACE";
    let siocnt0 = 0;
    try {
      siocnt0 = serial?.readSIOCNT0?.() ?? 0;
    } catch {}
    const visiblePlayerId = (Number(siocnt0) >> 4) & 0x3;
    let rcnt0 = 0;
    try {
      rcnt0 = serial?.readRCNT0?.() ?? 0;
    } catch {}
    el.textContent =
      `${title} ${config.role === "host" ? "H" : "G"} P${config.playerNumber} ID:${visiblePlayerId} S:${(Number(siocnt0) & 0xFF).toString(16).padStart(2, "0")} R:${(Number(rcnt0) & 0xFF).toString(16).padStart(2, "0")}\n` +
      `M:${localModeMulti ? 1 : 0} L:${localReady ? 1 : 0} R:${remoteReady ? 1 : 0} WAIT:${waiting ? 1 : 0}\n` +
      `TX:${transferCount} ACK:${config.role === "host" ? `${remoteHardwareAcks.size}/${expectedRemoteHardwareAcks}` : "-"} NEXT:${config.role === "host" ? `${remoteNextWordAcks.size}/${expectedRemoteHardwareAcks}` : (awaitingGuestNextWord ? "WAIT" : "OK")} BUF:${config.role === "host" ? remotePreparedWords.size : "-"} last:${waitText} avg:${avgWait}ms max:${Math.round(waitMaxMs)}ms err:${errorCount}\n` +
      (debugHistory.length ? debugHistory.join("\n") : lastState);
  }

  function sendLocal(packet) {
    if (!bus || !config.roomId) return false;
    bus.postMessage({
      ...packet,
      source: "emulator",
      roomId: config.roomId,
      playerNumber: config.playerNumber,
      role: config.role,
      time: Date.now()
    });
    return true;
  }

  function publishLocalReady() {
    if (!config.roomId) return false;
    return sendLocal({
      type: "gba:link:ready",
      ready: Boolean(localReady)
    });
  }

  function publishGuestPreparedWord(reason = "ready") {
    if (config.role !== "guest" || !config.roomId || !localReady) return false;
    const word = currentWord();
    sendLocal({
      type: "gba:link:prepared-word",
      playerNumber: config.playerNumber,
      word,
      reason
    });
    emitStatus("prepared-word", { word, reason });
    return true;
  }

  function maybeReleaseHostTransfer() {
    if (config.role !== "host" || !transferInFlight) return;
    if (expectedRemoteHardwareAcks < 1) return;
    if (remoteHardwareAcks.size < expectedRemoteHardwareAcks) return;
    if (remoteNextWordAcks.size < expectedRemoteHardwareAcks) return;

    if (!hostCompletionReleaseRequested && !localHardwareComplete) {
      hostCompletionReleaseRequested = true;
      const released = serial?.releaseExternalMultiplayerTransfer?.(false);
      emitStatus("host-sio-release", {
        seq: activeTransferSeq,
        released: Boolean(released),
        remoteAcks: remoteHardwareAcks.size,
        nextWordAcks: remoteNextWordAcks.size
      });
      return;
    }

    if (!localHardwareComplete) return;

    transferInFlight = false;
    emitStatus("transfer-synced", {
      seq: activeTransferSeq,
      remoteAcks: remoteHardwareAcks.size,
      nextWordAcks: remoteNextWordAcks.size,
      expectedAcks: expectedRemoteHardwareAcks
    });
    activeTransferSeq = "";
    localHardwareComplete = false;
    hostCompletionReleaseRequested = false;
    expectedRemoteHardwareAcks = 0;
    remoteHardwareAcks.clear();
    remoteNextWordAcks.clear();
  }

  function publishGuestNextWordReady(reason = "write") {
    if (config.role !== "guest" || !awaitingGuestNextWord || !activeTransferSeq) return;
    awaitingGuestNextWord = false;
    clearTimeout(guestNextWordFallbackTimer);
    guestNextWordFallbackTimer = 0;
    const word = currentWord();
    sendLocal({
      type: "gba:link:next-word-ready",
      seq: activeTransferSeq,
      playerNumber: config.playerNumber,
      word,
      reason
    });
    emitStatus("next-word-ready", {
      seq: activeTransferSeq,
      word,
      reason
    });
    transferInFlight = false;
    activeTransferSeq = "";
  }

  const adapter = {
    get playerNumber() {
      return config.playerNumber;
    },
    isConnected() {
      return Boolean(bus && config.roomId);
    },
    // Physical cable detection must not depend on the other game already
    // being in MULTI mode, otherwise the secondary GBA can never enter the
    // Multiplayer menu.
    isReady() {
      // Cable-visible readiness must be present as soon as the WebRTC-backed
      // cable exists. Super Mario probes this state while the secondary GBA is
      // still entering Multiplayer, so tying it to remoteReady creates a
      // circular entry deadlock.
      return this.isConnected();
    },
    canTransfer() {
      // Actual serial transfers remain gated until the remote core is stably
      // in MULTI mode. This is independent from the visible cable state.
      return this.isConnected() && remoteReady;
    },
    onHardwareTransferComplete(info = {}) {
      transferCount += 1;
      const error = Boolean(info.error);
      emitStatus("transfer-hw-complete", {
        seq: activeTransferSeq,
        words: Array.isArray(info.words) ? info.words.slice(0, 2) : undefined,
        error,
        waitMs: lastWaitMs
      });

      if (config.role === "guest") {
        sendLocal({
          type: "gba:link:hw-complete",
          seq: activeTransferSeq,
          playerNumber: config.playerNumber,
          error
        });
        if (error) {
          awaitingGuestNextWord = false;
          transferInFlight = false;
          activeTransferSeq = "";
          return;
        }

        // The transfer is physically complete, but the host must not start the
        // next round until the guest game has processed the SIO IRQ and prepared
        // its next SIOMLT_SEND word.
        awaitingGuestNextWord = true;
        clearTimeout(guestNextWordFallbackTimer);
        guestNextWordFallbackTimer = setTimeout(() => {
          publishGuestNextWordReady("post-irq-fallback");
        }, 17);
        return;
      }

      localHardwareComplete = true;
      if (error) {
        transferInFlight = false;
        activeTransferSeq = "";
        localHardwareComplete = false;
        hostCompletionReleaseRequested = false;
        expectedRemoteHardwareAcks = 0;
        remoteHardwareAcks.clear();
        remoteNextWordAcks.clear();
        return;
      }
      maybeReleaseHostTransfer();
    },
    onSendDataChange(word) {
      if (config.role !== "guest") return;
      if (awaitingGuestNextWord) {
        publishGuestNextWordReady("siomlt-send");
        return;
      }
      if (localReady && !transferInFlight) {
        publishGuestPreparedWord("siomlt-send-idle");
      }
    },
    onSerialModeChange(mode) {
      const nextModeMulti = (Number(mode) | 0) === 2;
      localModeMulti = nextModeMulti;
      clearTimeout(readyTimer);
      readyTimer = 0;

      if (!nextModeMulti) {
        if (localReady) {
          localReady = false;
          publishLocalReady();
        }
        emitStatus("local-mode", { modeMulti: false, ready: localReady });
        return;
      }

      // Games can touch MULTI briefly while probing the cable. Do not advertise
      // transfer readiness until the mode has remained stable long enough to
      // represent an actual multiplayer session.
      readyTimer = setTimeout(() => {
        readyTimer = 0;
        if (!serial || (serial.SIOCNT_MODE | 0) !== 2) return;
        localModeMulti = true;
        if (!localReady) {
          localReady = true;
          publishLocalReady();
        }
        if (config.role === "guest") {
          publishGuestPreparedWord("multi-ready");
        }
        emitStatus("local-ready", { modeMulti: true, ready: true });
      }, 250);
      emitStatus("local-mode", { modeMulti: true, ready: localReady });
    },
    startMultiplayerTransfer(info = {}) {
      if (transferInFlight) {
        emitStatus("transfer-overlap-suppressed", {
          word: Number(info.word) & 0xFFFF,
          baud: Number(info.baud) & 0x3
        });
        return false;
      }
      if (!this.canTransfer()) {
        emitStatus("transfer-waiting-remote", { remoteReady });
        return false;
      }

      const preparedPlayers = [...remotePreparedWords.keys()]
        .filter((playerNumber) => playerNumber > 0)
        .sort((a, b) => a - b);
      if (!preparedPlayers.length) {
        emitStatus("transfer-waiting-buffer", {
          word: Number(info.word) & 0xFFFF
        });
        return false;
      }

      const connectedCount = Math.max(1, Math.min(3, preparedPlayers.length));
      const words = [Number(info.word) & 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF];
      for (const playerNumber of preparedPlayers) {
        if (playerNumber > 3) continue;
        words[playerNumber] = remotePreparedWords.get(playerNumber).word & 0xFFFF;
      }

      transferInFlight = true;
      localHardwareComplete = false;
      hostCompletionReleaseRequested = false;
      expectedRemoteHardwareAcks = connectedCount;
      remoteHardwareAcks.clear();
      remoteNextWordAcks.clear();
      localSequence = (localSequence + 1) >>> 0;
      const seq = `${Date.now().toString(36)}-${localSequence.toString(36)}`;
      activeTransferSeq = seq;
      waitStartedAt = 0;

      // Consume the prepared words exactly once. The guest will publish the
      // next generation after processing this transfer's SIO IRQ.
      for (const playerNumber of preparedPlayers) {
        remotePreparedWords.delete(playerNumber);
      }

      sendLocal({
        type: "gba:link:prepared-transfer",
        seq,
        coreSequence: Number(info.sequence) || 0,
        words,
        connectedCount,
        baud: Number(info.baud) & 0x3
      });

      serial?.completeExternalMultiplayerTransfer?.(
        words,
        0,
        false,
        connectedCount,
        true
      );

      emitStatus("transfer-buffered-start", {
        seq,
        words: words.slice(0, 2),
        connectedCount,
        baud: Number(info.baud) & 0x3
      });
      return true;
    }
  };

  function attachEmulator(nextEmulator) {
    detachEmulator();
    emulator = nextEmulator || null;
    serial = emulator?.IOCore?.serial || null;
    if (!serial || typeof serial.attachLinkCable !== "function") {
      emitStatus("core-unavailable");
      return false;
    }
    serial.attachLinkCable(adapter);
    serial.setLinkPlayerNumber(config.playerNumber);
    localModeMulti = (serial.SIOCNT_MODE | 0) === 2;
    localReady = false;
    publishLocalReady();
    if (localModeMulti) adapter.onSerialModeChange(2);
    emitStatus("attached", { localModeMulti, localReady, remoteReady });
    return true;
  }

  function detachEmulator(target = null) {
    if (target && emulator && target !== emulator) return;
    try {
      serial?.detachLinkCable?.();
    } catch {}
    clearTimeout(readyTimer);
    readyTimer = 0;
    localModeMulti = false;
    localReady = false;
    remoteReady = false;
    transferInFlight = false;
    activeTransferSeq = "";
    localHardwareComplete = false;
    hostCompletionReleaseRequested = false;
    expectedRemoteHardwareAcks = 0;
    remoteHardwareAcks.clear();
    remoteNextWordAcks.clear();
    remotePreparedWords.clear();
    awaitingGuestNextWord = false;
    clearTimeout(guestNextWordFallbackTimer);
    guestNextWordFallbackTimer = 0;
    lastGuestPollSeq = "";
    lastGuestReplyWord = 0xFFFF;
    lastGuestReplyBaud = 0;
    publishLocalReady();
    serial = null;
    emulator = null;
    emitStatus("detached");
  }

  function currentWord() {
    if (!serial) return 0xFFFF;
    if (typeof serial.getLinkSendData === "function") {
      return serial.getLinkSendData() & 0xFFFF;
    }
    return Number(serial.SIODATA8) & 0xFFFF;
  }

  function handleLocalBusMessage(event) {
    const packet = event.data;
    if (!packet || packet.source !== "lobby") return;

    if (packet.type === "gba:link:configure") {
      if (packet.roomId) {
        saveConfig({
          roomId: packet.roomId,
          playerNumber: packet.playerNumber,
          role: packet.role
        });
      }
      return;
    }

    if (!config.roomId || packet.roomId !== config.roomId) return;

    if (packet.type === "gba:link:remote-ready") {
      remoteReady = Boolean(packet.ready);
      if (!remoteReady) remotePreparedWords.clear();
      emitStatus("remote-ready", { ready: remoteReady });
      return;
    }

    if (packet.type === "gba:link:poll") {
      const seq = String(packet.seq || "");
      const baud = Number(packet.baud) & 0x3;

      // Reliable DataChannel retries use the same transfer sequence. Re-send
      // the original word without restarting the emulated hardware transfer.
      if (seq && seq === lastGuestPollSeq) {
        sendLocal({
          type: "gba:link:reply",
          seq,
          word: lastGuestReplyWord,
          baud: lastGuestReplyBaud,
          retry: true
        });
        emitStatus("transfer-reply-repeat", {
          seq,
          word: lastGuestReplyWord,
          baud: lastGuestReplyBaud
        });
        return;
      }

      const playerNumber = sanitizePlayerNumber(packet.playerNumber);
      config.playerNumber = playerNumber;
      activeTransferSeq = seq;
      localHardwareComplete = false;
      waitStartedAt = performance.now();
      transferInFlight = true;
      if (serial?.beginExternalMultiplayerTransfer) {
        serial.beginExternalMultiplayerTransfer(playerNumber);
      }
      const replyWord = currentWord();
      lastGuestPollSeq = seq;
      lastGuestReplyWord = replyWord;
      lastGuestReplyBaud = baud;
      sendLocal({
        type: "gba:link:reply",
        seq,
        word: replyWord,
        baud
      });
      emitStatus("transfer-reply", {
        seq,
        word: replyWord,
        baud
      });
      return;
    }

    if (packet.type === "gba:link:remote-hw-complete") {
      const seq = String(packet.seq || "");
      if (config.role !== "host" || !transferInFlight || !seq || seq !== activeTransferSeq) {
        return;
      }
      remoteHardwareAcks.add(sanitizePlayerNumber(packet.playerNumber));
      emitStatus("remote-hw-complete", {
        seq,
        playerNumber: sanitizePlayerNumber(packet.playerNumber),
        error: Boolean(packet.error)
      });
      if (packet.error) {
        hostCompletionReleaseRequested = true;
        serial?.releaseExternalMultiplayerTransfer?.(true);
        emitStatus("remote-hw-error", { seq, playerNumber: sanitizePlayerNumber(packet.playerNumber), error: true });
        return;
      }
      maybeReleaseHostTransfer();
      return;
    }

    if (packet.type === "gba:link:remote-prepared-word") {
      if (config.role !== "host") return;
      const playerNumber = sanitizePlayerNumber(packet.playerNumber);
      const word = Number(packet.word) & 0xFFFF;
      remotePreparedWords.set(playerNumber, {
        word,
        reason: String(packet.reason || "prepared"),
        time: performance.now()
      });
      emitStatus("remote-prepared-word", {
        playerNumber,
        word,
        reason: String(packet.reason || "")
      });
      return;
    }

    if (packet.type === "gba:link:remote-next-word-ready") {
      const seq = String(packet.seq || "");
      if (config.role !== "host" || !transferInFlight || !seq || seq !== activeTransferSeq) {
        return;
      }
      const playerNumber = sanitizePlayerNumber(packet.playerNumber);
      const word = Number(packet.word) & 0xFFFF;
      remoteNextWordAcks.add(playerNumber);
      remotePreparedWords.set(playerNumber, {
        word,
        reason: String(packet.reason || "next"),
        time: performance.now()
      });
      emitStatus("remote-next-word-ready", {
        seq,
        playerNumber,
        word,
        reason: String(packet.reason || "")
      });
      maybeReleaseHostTransfer();
      return;
    }

    if (packet.type === "gba:link:prepared-transfer") {
      const seq = String(packet.seq || "");
      const playerNumber = sanitizePlayerNumber(packet.playerNumber ?? config.playerNumber);
      const words = Array.isArray(packet.words)
        ? packet.words.slice(0, 4).map((v) => Number(v) & 0xFFFF)
        : [0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF];
      while (words.length < 4) words.push(0xFFFF);
      const connectedCount = Math.max(0, Math.min(3, Number(packet.connectedCount) | 0));

      config.playerNumber = playerNumber;
      activeTransferSeq = seq;
      localHardwareComplete = false;
      transferInFlight = true;
      waitStartedAt = 0;

      serial?.beginExternalMultiplayerTransfer?.(playerNumber);
      serial?.completeExternalMultiplayerTransfer?.(
        words,
        playerNumber,
        false,
        connectedCount
      );

      emitStatus("transfer-buffered-staged", {
        seq,
        words: words.slice(0, 2),
        connectedCount
      });
      return;
    }

    if (packet.type === "gba:link:complete") {
      const words = Array.isArray(packet.words)
        ? packet.words.slice(0, 4).map((v) => Number(v) & 0xFFFF)
        : [0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF];

      while (words.length < 4) words.push(0xFFFF);

      if (waitStartedAt > 0) {
        lastWaitMs = Math.max(0, performance.now() - waitStartedAt);
        waitSamples += 1;
        waitTotalMs += lastWaitMs;
        waitMaxMs = Math.max(waitMaxMs, lastWaitMs);
      }
      waitStartedAt = 0;

      const connectedCount = Math.max(0, Math.min(3, Number(packet.connectedCount) | 0));
      if (config.role === "host") {
        expectedRemoteHardwareAcks = connectedCount;
      }

      serial?.completeExternalMultiplayerTransfer?.(
        words,
        sanitizePlayerNumber(packet.playerNumber ?? config.playerNumber),
        Boolean(packet.error),
        connectedCount
      );

      emitStatus("transfer-staged", {
        seq: packet.seq,
        error: Boolean(packet.error),
        waitMs: lastWaitMs,
        words: words.slice(0, 2),
        connectedCount
      });
      return;
    }

    if (packet.type === "gba:link:disconnect") {
      remoteReady = false;
      waitStartedAt = 0;
      emitStatus("remote-disconnect");
    }
  }

  if (bus) {
    bus.addEventListener("message", handleLocalBusMessage);
  }

  window.addEventListener("ml3d-rom-started", () => {
    if (window.__gba) attachEmulator(window.__gba);
  });

  window.addEventListener("pagehide", () => {
    detachEmulator();
  });

  window.ML3DLinkCable = {
    attachEmulator,
    detachEmulator,
    configure(next) {
      saveConfig({ ...config, ...next });
      return { ...config };
    },
    status() {
      return {
        ...config,
        attached: Boolean(serial),
        connected: adapter.isConnected(),
        localModeMulti,
        localReady,
        remoteReady,
        cableReady: adapter.isReady(),
        ready: adapter.canTransfer(),
        waiting: Boolean(emulator?.IOCore?.linkCableWait),
        transferInFlight,
        activeTransferSeq,
        localHardwareComplete,
        hostCompletionReleaseRequested,
        expectedRemoteHardwareAcks,
        remoteHardwareAcks: [...remoteHardwareAcks],
        remoteNextWordAcks: [...remoteNextWordAcks],
        remotePreparedWords: [...remotePreparedWords.entries()].map(([playerNumber, value]) => ({ playerNumber, ...value })),
        awaitingGuestNextWord,
        transferCount,
        lastWaitMs,
        waitSamples,
        waitTotalMs,
        waitMaxMs,
        errorCount,
        debugFrozen,
        debugHistory: debugHistory.slice(),
        lastState
      };
    }
  };

  if (window.__gba) attachEmulator(window.__gba);
  emitStatus(bus ? "ready" : "broadcastchannel-unavailable");
})();
