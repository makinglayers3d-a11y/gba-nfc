(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const roomId = String(params.get("linkRoom") || "");
  const mySeat = Math.max(0, Math.min(1, Number(params.get("linkPlayer")) | 0));
  const role = params.get("linkRole") === "host" ? "host" : "guest";
  const selfTest = params.get("linkSelfTest") === "1";
  const requestedTransferCycles = Math.max(0, Number(params.get("linkTransferCycles")) | 0);
  const progressiveTransfer = params.get("linkProgressive") === "1";
  const enabled = Boolean(roomId) || selfTest;
  const BUS_NAME = "ml3d-gba-link-v1";
  const FRAME_CYCLES = 280896;
  const INPUT_DELAY = 4;
  const RING = 256;
  const UNKNOWN = -1;

  let localMask = 0;
  const selfTestMasks = [0, 0];
  let controller = null;
  let pendingStart = null;

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
    test: selfTest ? {
      setSeatMask(seat, mask) {
        seat = Number(seat) | 0;
        if (seat < 0 || seat > 1) return false;
        selfTestMasks[seat] = Number(mask) & 0x3ff;
        return true;
      },
      press(seat, key) {
        seat = Number(seat) | 0;
        key = Number(key) | 0;
        if (seat < 0 || seat > 1 || key < 0 || key > 9) return false;
        selfTestMasks[seat] |= (1 << key);
        return true;
      },
      release(seat, key) {
        seat = Number(seat) | 0;
        key = Number(key) | 0;
        if (seat < 0 || seat > 1 || key < 0 || key > 9) return false;
        selfTestMasks[seat] &= ~(1 << key);
        return true;
      },
      releaseAll() {
        selfTestMasks[0] = 0;
        selfTestMasks[1] = 0;
      },
      get masks() {
        return selfTestMasks.slice();
      },
      get controller() {
        return controller || null;
      }
    } : null
  };

  if (!enabled || typeof BroadcastChannel !== "function") return;

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

  function makeHiddenCore(rom) {
    const core = new GameBoyAdvanceEmulator();
    core.attachPlayStatusHandler(() => {});
    core.settings.offthreadGfxEnabled = false;
    core.settings.SKIPBoot = true;
    core.attachROM(rom.slice());
    core.play();
    try {
      core.audioPushNewState?.();
    } catch {}
    return core;
  }

  class LocalDualLink {
    constructor(visible, hidden, hash) {
      this.visible = visible;
      this.hidden = hidden;
      this.romHash = hash;
      this.cores = mySeat === 0 ? [visible, hidden] : [hidden, visible];
      this.serials = this.cores.map((core) => core.IOCore.serial);
      // The cycle counter is coordinator-only metadata. Normalize both cores
      // at the moment the deterministic session is created so pre-session UI
      // activity can never become a permanent scheduling skew.
      for (const core of this.cores) {
        if (core?.IOCore) {
          core.IOCore.linkCycleCounter = 0;
          core.IOCore.cyclesOveriteratedPreviously = 0;
          core.IOCore.linkIterationCut = false;
        }
      }
      this.frame = 0;
      this.sessionId = "";
      this.started = false;
      this.remoteReady = false;
      this.remoteHash = "";
      this.pendingTransfer = null;
      this.transferCount = 0;
      this.finishSyncCount = 0;
      this.localTransferArmed = false;
      this.normalPrepared = [null, null];
      this.normalTransferCount = 0;
      this.normalTrace = [];
      this.normalAttemptTrace = [];
      this.lastLinkError = "";
      this.startSkewLast = 0;
      this.startSkewMin = Infinity;
      this.startSkewMax = -Infinity;
      this.startSkewTotal = 0;
      this.startSkewCount = 0;
      this.recentTransfers = [];
      this.sendWordHistory = [[], []];
      this.siocntWrites = [[], []];
      this.siocntReads = [[], []];
      this.rcntWrites = [[], []];
      this.siomultiReads = [[], []];
      this.criticalSiomultiReads = [[], []];
      this.comparisonTrace = [[], []];
      this.mainReturnTrace = [[], []];
      this.instructionRing = [[], []];
      this.error60Trace = [[], []];
      this.resetTrace = [[], []];
      this.protocolTransition = null;
      this.protocolTransitionRemaining = 0;
      this.wedged = false;
      this.inputTimer = null;
      this.readyTimer = null;
      this.tickTimer = null;
      this.lastApplied = [0, 0];
      this.inputs = new Int16Array(RING * 2).fill(UNKNOWN);
      this.sentFrames = new Set();
      this.lastTickAt = performance.now();
      this.stallCount = 0;
      this.debug = null;

      for (let frame = 0; frame < INPUT_DELAY; frame++) {
        this.setInput(frame, 0, 0);
        this.setInput(frame, 1, 0);
      }

      this.installLocalCable();
      this.buildDebug();
      if (selfTest) {
        this.remoteReady = true;
        this.remoteHash = this.romHash;
        setTimeout(() => this.start("ci-selftest", INPUT_DELAY), 0);
      } else {
        this.publishReady();
        this.readyTimer = setInterval(() => {
          if (!this.started) this.publishReady();
        }, 500);
      }
    }

    slot(frame, seat) {
      return (frame % RING) * 2 + seat;
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
        protocol: "dual-core-v1"
      });
    }

    maybeHostStart() {
      if (role !== "host" || this.started || !this.remoteReady) return;
      if (!this.remoteHash || this.remoteHash !== this.romHash) {
        this.setDebugError("ROM DISTINTA");
        return;
      }
      const sessionId =
        (crypto.randomUUID?.() || (Date.now().toString(36) + "-" + Math.random().toString(36).slice(2)));
      sendLocal({
        type: "gba:lockstep:start",
        sessionId,
        delay: INPUT_DELAY,
        romHash: this.romHash
      });
      this.start(sessionId, INPUT_DELAY);
    }

    acceptRemoteReady(packet) {
      this.remoteReady = Boolean(packet.ready !== false);
      this.remoteHash = String(packet.romHash || "");
      this.renderDebug();
      this.maybeHostStart();
    }

    start(sessionId, delay) {
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
      this.frame = 0;
      this.lastTickAt = performance.now();
      try {
        this.visible.audioPushNewState?.();
        this.hidden.audioPushNewState?.();
      } catch {}
      this.tickTimer = setInterval(() => this.tick(), 1000 / 60);
      this.renderDebug();
    }

    installLocalCable() {
      try {
        window.ML3DLinkCable?.detachEmulator?.(this.visible);
      } catch {}
      document.getElementById("ml3d-link-debug")?.remove();

      const makeAdapter = (seat) => ({
        playerNumber: seat,
        localDeterministic: true,
        isConnected: () => true,
        isReady: () =>
          (this.serials[0]?.SIOCNT_MODE | 0) === 2 &&
          (this.serials[1]?.SIOCNT_MODE | 0) === 2,
        canTransfer: () => {
          if (seat !== 0) return true;
          return (this.serials[1]?.SIOCNT_MODE | 0) === 2;
        },
        onSerialModeChange: (mode) => {
          mode = Number(mode) | 0;
          if (mode !== 0 && mode !== 1) {
            this.normalPrepared[seat] = null;
          }
          this.renderDebug();
        },
        onSendDataChange: (word) => {
          const core = this.cores[seat];
          const cycle = Number(core?.IOCore?.linkCycleCounter) || 0;
          const cpu = core?.IOCore?.cpu;
          const pc = Number(cpu?.registers?.[15] ?? 0) >>> 0;
          const thumb = Boolean((Number(cpu?.modeFlags) | 0) & 0x20);
          const history = this.sendWordHistory[seat];
          history.push({
            cycle,
            word: Number(word) & 0xffff,
            pc,
            thumb
          });
          if (history.length > 256) history.splice(0, history.length - 256);
        },
        onLinkError: (error) => {
          this.lastLinkError = String(error?.stack || error?.message || error || "unknown");
          this.renderDebug();
        },
        onHardwareTransferComplete: () => {
          if (!this.localTransferArmed) return;
          if (seat === 1) {
            // Match mGBA's finish hard-sync: the clock owner must not expose
            // completion/IRQ until the secondary has finished the same transfer.
            this.finishSyncCount += 1;
            this.serials[0]?.releaseExternalMultiplayerTransfer?.(false);
            return;
          }
          if (seat === 0) {
            this.transferCount += 1;
            this.localTransferArmed = false;
            this.renderDebug();
          }
        },
        startNormalTransfer: (info = {}) => {
          const mode = Number(info.mode) | 0;
          if (mode !== 0 && mode !== 1) return false;

          const core = this.cores[seat];
          const prepared = {
            seat,
            sequence: Number(info.sequence) | 0,
            mode,
            data: Number(info.data) >>> 0,
            internalClock: !!info.internalClock,
            fastClock: !!info.fastClock,
            cycle: Number(core?.IOCore?.linkCycleCounter) || 0,
            frame: this.frame
          };
          this.normalPrepared[seat] = prepared;
          this.normalAttemptTrace.push({
            ...prepared,
            peer: this.normalPrepared[seat ^ 1] ? { ...this.normalPrepared[seat ^ 1] } : null
          });
          if (this.normalAttemptTrace.length > 256) this.normalAttemptTrace.shift();

          const peer = this.normalPrepared[seat ^ 1];
          if (!peer || peer.mode !== mode) return true;

          // Normal serial requires exactly one clock source. Do not fabricate
          // a transfer if both ends claim master or both wait for external clock.
          if (prepared.internalClock === peer.internalClock) return true;

          const p0 = this.normalPrepared[0];
          const p1 = this.normalPrepared[1];
          if (!p0 || !p1) return true;

          // Consume before completing because IRQ handlers can immediately
          // configure the next transfer.
          this.normalPrepared[0] = null;
          this.normalPrepared[1] = null;

          const masterSeat = p0.internalClock ? 0 : 1;
          this.normalTrace.push({
            frame: this.frame,
            mode,
            masterSeat,
            p0: p0.data >>> 0,
            p1: p1.data >>> 0,
            p0Cycle: p0.cycle,
            p1Cycle: p1.cycle,
            fastClock: !!(p0.fastClock || p1.fastClock)
          });
          if (this.normalTrace.length > 256) this.normalTrace.shift();

          this.serials[0]?.completeExternalNormalTransfer?.(p1.data >>> 0);
          this.serials[1]?.completeExternalNormalTransfer?.(p0.data >>> 0);
          this.normalTransferCount += 1;
          this.renderDebug();
          return true;
        },
        onNormalTransferComplete: () => {},
                startMultiplayerTransfer: (info = {}) => {
          if (seat !== 0 || this.pendingTransfer || this.localTransferArmed) return false;
          // The secondary has its own copy of the cartridge and reaches MULTI
          // on its own schedule. Until it does there is nobody to clock, so
          // leave BUSY clear and let the parent retry, exactly as a cable with
          // an unready peer behaves.
          if ((this.serials[1]?.SIOCNT_MODE | 0) !== 2) return false;
          this.pendingTransfer = {
            sequence: Number(info.sequence) | 0,
            word: Number(info.word) & 0xffff,
            baud: Number(info.baud) & 0x3,
            parentCycle: Number(this.cores[0].IOCore.linkCycleCounter) || 0
          };
          try {
            const io = this.cores[0].IOCore;
            if (typeof io.flagLinkIterationEnd === "function") io.flagLinkIterationEnd();
            else io.flagIterationEnd();
          } catch {}
          return true;
        }
      });

      this.serials[0].attachLinkCable(makeAdapter(0));
      this.serials[0].setLinkPlayerNumber(0);
      this.serials[1].attachLinkCable(makeAdapter(1));
      this.serials[1].setLinkPlayerNumber(1);

      for (let seat = 0; seat < 2; seat++) {
        const io = this.cores[seat]?.IOCore;
        if (io) {
          io.linkInstructionObserver = (logicalPc, rawPc) => {
            const cpu = io.cpu;
            if (!cpu?.registers) return;
            const regs = Array.from(cpu.registers.slice(0, 8), (v) => Number(v) >>> 0);

            const ring = this.instructionRing[seat];
            ring.push({
              frame: this.frame,
              cycle: Number(io.linkCycleCounter) || 0,
              logicalPc: Number(logicalPc) >>> 0,
              rawPc: Number(rawPc) >>> 0,
              r0: regs[0] >>> 0,
              r1: regs[1] >>> 0,
              r2: regs[2] >>> 0,
              r3: regs[3] >>> 0,
              r4: regs[4] >>> 0,
              r5: regs[5] >>> 0,
              r6: regs[6] >>> 0,
              r7: regs[7] >>> 0
            });
            if (ring.length > 32) ring.shift();

            if (logicalPc === 0x080C9900) {
              const traces = this.resetTrace[seat];
              traces.push({
                frame: this.frame,
                cycle: Number(io.linkCycleCounter) || 0,
                history: ring.slice(),
                bus: [
                  this.serials[seat].SIODATA_A & 0xffff,
                  this.serials[seat].SIODATA_B & 0xffff,
                  this.serials[seat].SIODATA_C & 0xffff,
                  this.serials[seat].SIODATA_D & 0xffff
                ],
                siocnt: ((this.serials[seat].readSIOCNT1?.() ?? 0) << 8) |
                  (this.serials[seat].readSIOCNT0?.() ?? 0),
                rcnt: ((this.serials[seat].readRCNT1?.() ?? 0) << 8) |
                  (this.serials[seat].readRCNT0?.() ?? 0)
              });
              if (traces.length > 16) traces.shift();
            }

            if (logicalPc === 0x080C9D1C) {
              const traces = this.error60Trace[seat];
              traces.push({
                frame: this.frame,
                cycle: Number(io.linkCycleCounter) || 0,
                history: ring.slice(),
                bus: [
                  this.serials[seat].SIODATA_A & 0xffff,
                  this.serials[seat].SIODATA_B & 0xffff,
                  this.serials[seat].SIODATA_C & 0xffff,
                  this.serials[seat].SIODATA_D & 0xffff
                ],
                siocnt: ((this.serials[seat].readSIOCNT1?.() ?? 0) << 8) |
                  (this.serials[seat].readSIOCNT0?.() ?? 0)
              });
              if (traces.length > 16) traces.shift();
            }

            // Exact protocol comparisons that can return Link error 0x71.
            if (logicalPc === 0x080C9D28 && (regs[0] >>> 0) !== 0) {
              const statePtr = regs[7] >>> 0;
              const mem = io.memory;
              const raw8 = (address) => {
                address = Number(address) >>> 0;
                const region = address >>> 24;
                if (region === 0x02 && mem?.externalRAM) return mem.externalRAM[address & 0x3ffff] & 0xff;
                if (region === 0x03 && mem?.internalRAM) return mem.internalRAM[address & 0x7fff] & 0xff;
                return null;
              };
              const raw16 = (address) => {
                const lo = raw8(address);
                const hi = raw8((Number(address) + 1) >>> 0);
                return lo === null || hi === null ? null : (lo | (hi << 8)) & 0xffff;
              };
              const list = this.mainReturnTrace[seat];
              list.push({
                frame: this.frame,
                cycle: Number(io.linkCycleCounter) || 0,
                code: regs[0] >>> 0,
                statePtr,
                state: raw8((statePtr + 0x18) >>> 0),
                playerMask: raw8((statePtr + 0x1e) >>> 0),
                substate: raw8((statePtr + 0x1d) >>> 0),
                timer: raw16((statePtr + 0x16) >>> 0),
                siocnt: ((this.serials[seat].readSIOCNT1?.() ?? 0) << 8) |
                  (this.serials[seat].readSIOCNT0?.() ?? 0),
                rcnt: ((this.serials[seat].readRCNT1?.() ?? 0) << 8) |
                  (this.serials[seat].readRCNT0?.() ?? 0),
                bus: [
                  this.serials[seat].SIODATA_A & 0xffff,
                  this.serials[seat].SIODATA_B & 0xffff,
                  this.serials[seat].SIODATA_C & 0xffff,
                  this.serials[seat].SIODATA_D & 0xffff
                ],
                regs: Array.from(cpu.registers, (v) => Number(v) >>> 0)
              });
              if (list.length > 128) list.splice(0, list.length - 128);
            }

            if (
              logicalPc === 0x080C9958 ||
              logicalPc === 0x080C9988 ||
              logicalPc === 0x080C99A8 ||
              logicalPc === 0x080C99D2 ||
              logicalPc === 0x080C99E4 ||
              logicalPc === 0x080C9D1C ||
              logicalPc === 0x080C9D22 ||
              logicalPc === 0x080C9EC4 ||
              logicalPc === 0x080C9F24 ||
              logicalPc === 0x080C9F58 ||
              logicalPc === 0x080C98B4 ||
              logicalPc === 0x080C98C6 ||
              logicalPc === 0x080C98CA ||
              logicalPc === 0x080C98E0 ||
              logicalPc === 0x080C98EE ||
              logicalPc === 0x080C98F0 ||
              logicalPc === 0x080C9900
            ) {
              const list = this.comparisonTrace[seat];
              list.push({
                frame: this.frame,
                cycle: Number(io.linkCycleCounter) || 0,
                logicalPc: Number(logicalPc) >>> 0,
                rawPc: Number(rawPc) >>> 0,
                r0: regs[0] >>> 0,
                r1: regs[1] >>> 0,
                r2: regs[2] >>> 0,
                r3: regs[3] >>> 0,
                r4: regs[4] >>> 0,
                r5: regs[5] >>> 0,
                r6: regs[6] >>> 0,
                r7: regs[7] >>> 0,
                lr: regs[14] >>> 0,
                sp: regs[13] >>> 0,
                bus: [
                  this.serials[seat].SIODATA_A & 0xffff,
                  this.serials[seat].SIODATA_B & 0xffff,
                  this.serials[seat].SIODATA_C & 0xffff,
                  this.serials[seat].SIODATA_D & 0xffff
                ]
              });
              if (list.length > 512) list.splice(0, list.length - 512);
            }
          };
        }

        this.serials[seat].linkSIOCNTWriteObserver = (entry) => {
          const cycle = Number(this.cores[seat]?.IOCore?.linkCycleCounter) || 0;
          const list = this.siocntWrites[seat];
          const core = this.cores[seat];
          const cpu = core?.IOCore?.cpu;
          const regs = cpu?.registers;
          const ram = core?.IOCore?.memory?.internalRAM;
          const pc = Number(regs?.[15] ?? 0) >>> 0;
          const lr = Number(regs?.[14] ?? 0) >>> 0;
          list.push({
            cycle,
            ...entry,
            pc,
            logicalPc: (pc - 0x40) >>> 0,
            lr,
            r0: Number(regs?.[0] ?? 0) >>> 0,
            r1: Number(regs?.[1] ?? 0) >>> 0,
            r2: Number(regs?.[2] ?? 0) >>> 0,
            r3: Number(regs?.[3] ?? 0) >>> 0,
            iwramCEC: ram ? (Number(ram[0x0CEC]) & 0xff) : null,
            iwramCF0: ram ? (Number(ram[0x0CF0]) & 0xff) : null,
            iwramD04: ram ? (Number(ram[0x0D04]) & 0xff) : null,
            bus: [
              this.serials[seat].SIODATA_A & 0xffff,
              this.serials[seat].SIODATA_B & 0xffff,
              this.serials[seat].SIODATA_C & 0xffff,
              this.serials[seat].SIODATA_D & 0xffff
            ]
          });
          if (list.length > 512) list.splice(0, list.length - 512);
        };
        this.serials[seat].linkSIOCNTReadObserver = (value) => {
          const core = this.cores[seat];
          const io = core?.IOCore;
          const cpu = io?.cpu;
          const regs = cpu?.registers;
          const ram = io?.memory?.internalRAM;
          const rawPc = Number(regs?.[15] ?? 0) >>> 0;
          const thumb = !!((Number(cpu?.modeFlags) | 0) & 0x20);
          const logicalPc = thumb ? ((rawPc - 4) >>> 0) : ((rawPc - 8) >>> 0);
          const list = this.siocntReads[seat];
          list.push({
            frame: this.frame,
            cycle: Number(io?.linkCycleCounter) || 0,
            value: Number(value) & 0xffff,
            mode: this.serials[seat].SIOCNT_MODE | 0,
            rawPc,
            logicalPc,
            thumb,
            iwramCEC: ram ? (Number(ram[0x0CEC]) & 0xff) : null,
            iwramCF0: ram ? (Number(ram[0x0CF0]) & 0xff) : null,
            iwramD04: ram ? (Number(ram[0x0D04]) & 0xff) : null,
            bus: [
              this.serials[seat].SIODATA_A & 0xffff,
              this.serials[seat].SIODATA_B & 0xffff,
              this.serials[seat].SIODATA_C & 0xffff,
              this.serials[seat].SIODATA_D & 0xffff
            ]
          });
          if (list.length > 2048) list.splice(0, list.length - 2048);
        };
        this.serials[seat].linkRCNTWriteObserver = (byteIndex, data) => {
          const core = this.cores[seat];
          const cycle = Number(core?.IOCore?.linkCycleCounter) || 0;
          const cpu = core?.IOCore?.cpu;
          const regs = cpu?.registers;
          const pc = Number(regs?.[15] ?? 0) >>> 0;
          const lr = Number(regs?.[14] ?? 0) >>> 0;
          const list = this.rcntWrites[seat];
          list.push({
            cycle,
            byteIndex: Number(byteIndex) | 0,
            data: Number(data) & 0xff,
            pc,
            logicalPc: (pc - 0x40) >>> 0,
            lr
          });
          if (list.length > 256) list.splice(0, list.length - 256);
        };
        this.serials[seat].linkSIOMULTIReadObserver = (index, word) => {
          const core = this.cores[seat];
          const cycle = Number(core?.IOCore?.linkCycleCounter) || 0;
          const cpu = core?.IOCore?.cpu;
          const pc = Number(cpu?.registers?.[15] ?? 0) >>> 0;
          // Iodine's visible r15 is ahead of the currently executing Thumb
          // instruction in this ROM. Empirically SIOMULTI @080C96F6 appears
          // as r15=080C9736, so expose the logical instruction address too.
          const logicalPc = (pc - 0x40) >>> 0;
          const regs = cpu?.registers ? Array.from(cpu.registers.slice(0, 8), (v) => Number(v) >>> 0) : [];
          const entry = {
            cycle,
            pc,
            logicalPc,
            index: Number(index) | 0,
            word: Number(word) & 0xffff,
            regs
          };
          const list = this.siomultiReads[seat];
          list.push(entry);
          if (list.length > 1024) list.splice(0, list.length - 1024);

          if (logicalPc >= 0x080C9E00 && logicalPc <= 0x080C9FA0 && regs.length >= 4) {
            const mem = core?.IOCore?.memory;
            const raw8 = (address) => {
              address = Number(address) >>> 0;
              const region = address >>> 24;
              if (region === 0x02 && mem?.externalRAM) {
                return mem.externalRAM[address & 0x3ffff] & 0xff;
              }
              if (region === 0x03 && mem?.internalRAM) {
                return mem.internalRAM[address & 0x7fff] & 0xff;
              }
              return null;
            };
            const raw32 = (address) => {
              const b0 = raw8(address);
              const b1 = raw8((Number(address) + 1) >>> 0);
              const b2 = raw8((Number(address) + 2) >>> 0);
              const b3 = raw8((Number(address) + 3) >>> 0);
              if ([b0,b1,b2,b3].some((v) => v === null)) return null;
              return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
            };
            const statePtr = regs[3] >>> 0;
            const critical = this.criticalSiomultiReads[seat];
            critical.push({
              ...entry,
              statePtr,
              state: raw8((statePtr + 0x18) >>> 0),
              playerMask: raw8((statePtr + 0x1e) >>> 0),
              expected: raw32((statePtr + 4) >>> 0),
              bus: [
                this.serials[seat].SIODATA_A & 0xffff,
                this.serials[seat].SIODATA_B & 0xffff,
                this.serials[seat].SIODATA_C & 0xffff,
                this.serials[seat].SIODATA_D & 0xffff
              ]
            });
            if (critical.length > 512) critical.splice(0, critical.length - 512);
          }
        };
      }
    }

    carryTransfer() {
      const pending = this.pendingTransfer;
      if (!pending) return false;
      const childCycles = Number(this.cores[1].IOCore.linkCycleCounter) || 0;
      if (childCycles < pending.parentCycle) return false;
      if ((this.serials[1].SIOCNT_MODE | 0) !== 2) {
        this.pendingTransfer = null;
        this.serials[0].SIOTransferStarted = false;
        return false;
      }

      const startSkew = childCycles - pending.parentCycle;
      this.startSkewLast = startSkew;
      this.startSkewMin = Math.min(this.startSkewMin, startSkew);
      this.startSkewMax = Math.max(this.startSkewMax, startSkew);
      this.startSkewTotal += startSkew;
      this.startSkewCount += 1;

      const currentChildWord = this.serials[1].getLinkSendData() & 0xffff;
      const childHistory = this.sendWordHistory[1];
      let timestampedChildWord = currentChildWord;
      let timestampedCycle = childCycles;
      for (let i = childHistory.length - 1; i >= 0; --i) {
        if (childHistory[i].cycle <= pending.parentCycle) {
          timestampedChildWord = childHistory[i].word & 0xffff;
          timestampedCycle = childHistory[i].cycle;
          break;
        }
      }

      const serialSnapshot = this.serials.map((serial, seat) => {
        let low = 0, high = 0, rcntLow = 0, rcntHigh = 0;
        try { low = serial?.readSIOCNT0?.() ?? 0; } catch {}
        try { high = serial?.readSIOCNT1?.() ?? 0; } catch {}
        try { rcntLow = serial?.readRCNT0?.() ?? 0; } catch {}
        try { rcntHigh = serial?.readRCNT1?.() ?? 0; } catch {}
        return {
          seat,
          mode: serial?.SIOCNT_MODE ?? null,
          busy: !!serial?.SIOTransferStarted,
          irqEnabled: !!serial?.SIOCNT_IRQ,
          siocnt: ((Number(high) & 0xff) << 8) | (Number(low) & 0xff),
          rcnt: ((Number(rcntHigh) & 0xff) << 8) | (Number(rcntLow) & 0xff),
          send: Number(serial?.getLinkSendData?.() ?? 0) & 0xffff,
          a: Number(serial?.SIODATA_A ?? 0) & 0xffff,
          b: Number(serial?.SIODATA_B ?? 0) & 0xffff,
          c: Number(serial?.SIODATA_C ?? 0) & 0xffff,
          d: Number(serial?.SIODATA_D ?? 0) & 0xffff
        };
      });

      const effectiveChildWord = currentChildWord;

      const transferRecord = {
        frame: this.frame,
        sequence: pending.sequence,
        parentCycle: pending.parentCycle,
        childCycle: childCycles,
        skew: startSkew,
        hostWord: pending.word & 0xffff,
        currentChildWord,
        effectiveChildWord,
        timestampedChildWord,
        timestampedCycle,
        baud: pending.baud,
        serial: serialSnapshot
      };

      this.recentTransfers.push(transferRecord);
      if (this.recentTransfers.length > 160) this.recentTransfers.shift();

      if (
        !this.protocolTransition &&
        (pending.word & 0xffff) === 0xf00f &&
        currentChildWord === 0xfdfd
      ) {
        this.protocolTransition = {
          detectedAtFrame: this.frame,
          detectedAtSequence: pending.sequence,
          before: this.recentTransfers.slice(),
          after: [],
          sendHistory: this.sendWordHistory.map((history) => history.slice(-160))
        };
        this.protocolTransitionRemaining = 40;
      } else if (this.protocolTransition && this.protocolTransitionRemaining > 0) {
        this.protocolTransition.after.push(transferRecord);
        this.protocolTransitionRemaining -= 1;
      }

      const childWord = effectiveChildWord;
      const words = [pending.word, childWord, 0xffff, 0xffff];

      this.serials[1].beginExternalMultiplayerTransfer(1);
      this.localTransferArmed = true;

      // Host timing starts now but completion remains held until P1 actually
      // reaches its own hardware-complete event.
      this.serials[0].completeExternalMultiplayerTransfer(
        words, 0, false, 1, true, pending.baud, 0,
        requestedTransferCycles || undefined,
        progressiveTransfer ? [2840, 5461] : undefined
      );
      this.serials[1].completeExternalMultiplayerTransfer(
        words, 1, false, 1, false, pending.baud,
        Math.max(0, childCycles - pending.parentCycle),
        requestedTransferCycles || undefined,
        progressiveTransfer ? [2840, 5461] : undefined
      );

      this.pendingTransfer = null;
      return true;
    }

    applyMask(seat, mask) {
      const core = this.cores[seat];
      const previous = this.lastApplied[seat] & 0x3ff;
      mask &= 0x3ff;
      const changed = previous ^ mask;
      for (let key = 0; key < 10; key++) {
        const bit = 1 << key;
        if (!(changed & bit)) continue;
        if (mask & bit) core.keyDown(key);
        else core.keyUp(key);
      }
      this.lastApplied[seat] = mask;
    }

    publishLocalInput() {
      const target = this.frame + INPUT_DELAY;
      if (this.sentFrames.has(target)) return;
      this.sentFrames.add(target);

      if (selfTest) {
        this.setInput(target, 0, selfTestMasks[0]);
        this.setInput(target, 1, selfTestMasks[1]);
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
      if (seat === mySeat || seat < 0 || seat > 1) return;
      this.setInput(Number(packet.frame), seat, Number(packet.mask));
    }

    frameReady() {
      return this.getInput(this.frame, 0) !== UNKNOWN &&
        this.getInput(this.frame, 1) !== UNKNOWN;
    }

    stepCore(seat, cycles) {
      const io = this.cores[seat].IOCore;
      const before = Number(io.linkCycleCounter) || 0;
      io.enter(Math.max(1, cycles | 0));
      const after = Number(io.linkCycleCounter) || 0;

      if (after > before) return true;

      // A tiny negative overrun can legitimately consume a scheduler slice
      // without advancing hardware. Clear it once and retry on the next round
      // instead of declaring the whole dual-core session wedged.
      if ((io.cyclesOveriteratedPreviously | 0) < 0) {
        io.cyclesOveriteratedPreviously = 0;
        return true;
      }
      return false;
    }

    runFrame() {
      const masks = [this.getInput(this.frame, 0), this.getInput(this.frame, 1)];
      this.applyMask(0, masks[0]);
      this.applyMask(1, masks[1]);

      // Preserve the emulator shell lifecycle even though the coordinator owns
      // the clock. Direct IOCore stepping alone skips start/end callbacks used
      // by renderer/audio glue.
      for (const core of this.cores) {
        try { core.runStartJobs?.(); } catch {}
      }

      const frameTarget = (this.frame + 1) * FRAME_CYCLES;
      const targets = [frameTarget, frameTarget];

      let rounds = 0;
      let noProgressRounds = 0;
      const MAX_ROUNDS = 12000;
      while (rounds++ < MAX_ROUNDS) {
        if (this.pendingTransfer && this.carryTransfer()) continue;

        const c0 = Number(this.cores[0].IOCore.linkCycleCounter) || 0;
        const c1 = Number(this.cores[1].IOCore.linkCycleCounter) || 0;
        const done0 = c0 >= targets[0];
        const done1 = c1 >= targets[1];
        if (done0 && done1 && !this.pendingTransfer) break;

        let seat;
        if (this.pendingTransfer) {
          seat = 1;
        } else if (done0) {
          seat = 1;
        } else if (done1) {
          seat = 0;
        } else {
          seat = c0 <= c1 ? 0 : 1;
        }

        const current = Number(this.cores[seat].IOCore.linkCycleCounter) || 0;
        let remaining = Math.max(1, targets[seat] - current);
        const multi =
          (this.serials[0].SIOCNT_MODE | 0) === 2 ||
          (this.serials[1].SIOCNT_MODE | 0) === 2;
        // Before MULTI there is no cable edge to catch, so use coarse slices.
        // In MULTI keep the two local GBAs within roughly 1K cycles so the
        // child cannot drift most of a transfer ahead of the parent.
        const slice = multi ? 1024 : 65536;

        if (this.pendingTransfer && seat === 1) {
          remaining = Math.max(
            1,
            Math.min(remaining, Math.max(1, this.pendingTransfer.parentCycle - current))
          );
        } else if (multi && seat === 1) {
          // P0 owns the serial clock. Never let P1 execute beyond P0's current
          // virtual timestamp, otherwise P1 can run game logic for hundreds of
          // cycles before seeing a START that should already have made it BUSY.
          const parentNow = Number(this.cores[0].IOCore.linkCycleCounter) || 0;
          const childGap = parentNow - current;
          if (childGap <= 0) {
            // Give P0 the next slice instead of allowing P1 into the future.
            const parentCurrent = Number(this.cores[0].IOCore.linkCycleCounter) || 0;
            const parentRemaining = Math.max(1, targets[0] - parentCurrent);
            const progressed = this.stepCore(0, Math.min(slice, parentRemaining));
            if (progressed) {
              noProgressRounds = 0;
            } else {
              noProgressRounds += 1;
              if (noProgressRounds >= 16) {
                this.wedged = true;
                break;
              }
            }
            continue;
          }
          remaining = Math.max(1, Math.min(remaining, childGap));
        }

        const progressed = this.stepCore(seat, Math.min(slice, remaining));
        if (progressed) {
          noProgressRounds = 0;
        } else if (!this.pendingTransfer) {
          noProgressRounds += 1;
          if (noProgressRounds >= 16) {
            this.wedged = true;
            break;
          }
        }
      }

      if (rounds >= MAX_ROUNDS) this.wedged = true;

      try {
        this.visible.submitAudioBuffer?.();
        this.hidden.submitAudioBuffer?.();
      } catch {}

      for (const core of this.cores) {
        try { core.runEndJobs?.(); } catch {}
      }

      this.inputs[this.slot(this.frame, 0)] = UNKNOWN;
      this.inputs[this.slot(this.frame, 1)] = UNKNOWN;
      this.frame += 1;
      return !this.wedged;
    }

    tick() {
      if (!this.started || this.wedged) {
        this.renderDebug();
        return;
      }

      this.publishLocalInput();

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
      const s0 = this.serials?.[0];
      const s1 = this.serials?.[1];
      const c0 = Number(this.cores?.[0]?.IOCore?.linkCycleCounter) || 0;
      const c1 = Number(this.cores?.[1]?.IOCore?.linkCycleCounter) || 0;
      const current0 = this.getInput(this.frame, 0);
      const current1 = this.getInput(this.frame, 1);
      let s0v = 0, s1v = 0, r0v = 0, r1v = 0;
      try { s0v = s0?.readSIOCNT0?.() ?? 0; } catch {}
      try { s1v = s1?.readSIOCNT0?.() ?? 0; } catch {}
      try { r0v = s0?.readRCNT0?.() ?? 0; } catch {}
      try { r1v = s1?.readRCNT0?.() ?? 0; } catch {}
      const hx = (value) => (Number(value) & 0xff).toString(16).padStart(2, "0");
      this.debug.textContent =
        `LOCAL LINK ${role === "host" ? "H" : "G"} P${mySeat} ${this.started ? "RUN" : "SYNC"}\n` +
        (!this.started ? `ESPERANDO PEER:${this.remoteReady ? "OK" : "..."} ROM:${this.remoteHash ? (this.remoteHash === this.romHash ? "OK" : "DIFF") : "..."}\n` : "") +
        `F:${this.frame} IN:${current0 === UNKNOWN ? "-" : current0.toString(16)}/${current1 === UNKNOWN ? "-" : current1.toString(16)} D:${INPUT_DELAY}\n` +
        `M:${s0?.SIOCNT_MODE ?? "-"}/${s1?.SIOCNT_MODE ?? "-"} BUSY:${s0?.SIOTransferStarted ? 1 : 0}/${s1?.SIOTransferStarted ? 1 : 0} S:${hx(s0v)}/${hx(s1v)} R:${hx(r0v)}/${hx(r1v)}\n` +
        `XFER:${this.transferCount} HS:${this.finishSyncCount} PEND:${this.pendingTransfer ? 1 : 0}/${this.localTransferArmed ? 1 : 0} Δ:${Math.round(c0 - c1)} SK:${this.startSkewCount ? `${this.startSkewLast}/${this.startSkewMin}..${this.startSkewMax}` : "-"} T:${Math.round((this.frame + 1) * FRAME_CYCLES - Math.min(c0, c1))} STALL:${this.stallCount}` +
        (this.lastLinkError ? `\nADAPTER ERROR: ${this.lastLinkError.split("\n")[0]}` : "") +
        (this.wedged ? "\nWEDGED" : "");
    }

    status() {
      return {
        roomId,
        mySeat,
        role,
        started: this.started,
        sessionId: this.sessionId,
        frame: this.frame,
        transfers: this.transferCount,
        finishSyncs: this.finishSyncCount,
        normalTransfers: this.normalTransferCount,
        normalTrace: this.normalTrace.slice(),
        normalAttemptTrace: this.normalAttemptTrace.slice(),
        normalPrepared: this.normalPrepared.map((entry) => entry ? { ...entry } : null),
        pendingTransfer: Boolean(
          this.pendingTransfer ||
          this.localTransferArmed ||
          this.normalPrepared[0] ||
          this.normalPrepared[1]
        ),
        remoteReady: this.remoteReady,
        romHash: this.romHash,
        remoteHash: this.remoteHash,
        wedged: this.wedged,
        stalls: this.stallCount,
        transferCycles: requestedTransferCycles || null,
        progressiveTransfer,
        coreExecution: this.cores.map((core, seat) => {
          const io = core?.IOCore;
          const cpu = io?.cpu;
          const regs = cpu?.registers;
          const mem = io?.memory;
          return {
            seat,
            pc: regs ? (Number(regs[15]) >>> 0) : null,
            sp: regs ? (Number(regs[13]) >>> 0) : null,
            lr: regs ? (Number(regs[14]) >>> 0) : null,
            r0: regs ? (Number(regs[0]) >>> 0) : null,
            r1: regs ? (Number(regs[1]) >>> 0) : null,
            modeFlags: cpu ? (Number(cpu.modeFlags) & 0xff) : null,
            thumb: cpu ? !!(Number(cpu.modeFlags) & 0x20) : null,
            systemStatus: io ? (Number(io.systemStatus) | 0) : null,
            halted: io ? !!((Number(io.systemStatus) | 0) & 0x20) : null,
            stopped: io ? !!((Number(io.systemStatus) | 0) & 0x40) : null,
            irq: io?.irq ? {
              ie: Number(io.irq.interruptsEnabled) | 0,
              if: Number(io.irq.interruptsRequested) | 0,
              ime: Number(io.irq.IME) | 0,
              match: (Number(io.irq.interruptsEnabled) | 0) & (Number(io.irq.interruptsRequested) | 0)
            } : null,
            ewramC0: mem?.externalRAM
              ? Array.from(mem.externalRAM.slice(0xc0, 0xe0), (v) => Number(v) & 0xff)
              : null,
            recentInstructions: (this.instructionRing[seat] || []).slice(-16)
          };
        }),
        startSkew: {
          last: this.startSkewLast,
          min: Number.isFinite(this.startSkewMin) ? this.startSkewMin : null,
          max: Number.isFinite(this.startSkewMax) ? this.startSkewMax : null,
          avg: this.startSkewCount ? this.startSkewTotal / this.startSkewCount : null,
          count: this.startSkewCount
        },
        recentTransfers: this.recentTransfers.slice(),
        protocolTransition: this.protocolTransition ? {
          detectedAtFrame: this.protocolTransition.detectedAtFrame,
          detectedAtSequence: this.protocolTransition.detectedAtSequence,
          before: this.protocolTransition.before.slice(),
          after: this.protocolTransition.after.slice(),
          sendHistory: this.protocolTransition.sendHistory.map((history) => history.slice())
        } : null,
        siocntWrites: this.siocntWrites.map((list) => list.slice()),
        siocntReads: this.siocntReads.map((list) => list.slice()),
        rcntWrites: this.rcntWrites.map((list) => list.slice()),
        siomultiReads: this.siomultiReads.map((list) => list.slice()),
        criticalSiomultiReads: this.criticalSiomultiReads.map((list) => list.slice()),
        comparisonTrace: this.comparisonTrace.map((list) => list.slice()),
        mainReturnTrace: this.mainReturnTrace.map((list) => list.slice()),
        error60Trace: this.error60Trace.map((list) => list.slice()),
        resetTrace: this.resetTrace.map((list) => list.slice())
      };
    }

    destroy() {
      clearInterval(this.readyTimer);
      clearInterval(this.tickTimer);
      this.readyTimer = null;
      this.tickTimer = null;
      try {
        this.serials[0]?.detachLinkCable?.();
        this.serials[1]?.detachLinkCable?.();
      } catch {}
      try {
        this.hidden?.stop?.();
      } catch {}
      this.debug?.remove();
      this.started = false;
    }
  }

  async function bootLocalDual() {
    const runtime = window.ML3DLinkRuntime;
    const visible = runtime?.emulator;
    const rom = runtime?.romBytes;
    if (!visible || !rom || !rom.byteLength) return;

    runtime.stopTimers?.();
    try {
      window.ML3DLinkCable?.detachEmulator?.(visible);
    } catch {}

    const hash = await fingerprint(rom);
    const hidden = makeHiddenCore(rom);
    controller?.destroy?.();
    controller = new LocalDualLink(visible, hidden, hash);

    if (pendingStart) {
      const start = pendingStart;
      pendingStart = null;
      controller.start(String(start.sessionId || ""), Number(start.delay));
    }
  }

  bus.addEventListener("message", (event) => {
    const packet = event.data;
    if (!packet || packet.source !== "lobby" || packet.roomId !== roomId) return;

    if (packet.type === "gba:lockstep:remote-ready") {
      controller?.acceptRemoteReady(packet);
      return;
    }

    if (packet.type === "gba:lockstep:start") {
      if (String(packet.romHash || "") && controller && packet.romHash !== controller.romHash) {
        controller.setDebugError("ROM DISTINTA");
        return;
      }
      if (!controller) pendingStart = packet;
      else controller.start(String(packet.sessionId || ""), Number(packet.delay));
      return;
    }

    if (packet.type === "gba:lockstep:remote-input") {
      controller?.acceptRemoteInput(packet);
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
