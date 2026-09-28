/*
 * Capa de runtime para el mGBA multi-instancia con Cable Link.
 *
 * El SDK publicado no vale aqui: abre su propio modulo WASM y se lo queda, y el
 * cable necesita que las cuatro consolas vivan en el MISMO modulo, porque el
 * coordinador de lockstep guarda a sus jugadores en una Table propia. Asi que
 * esto conduce el modulo directamente.
 *
 * Reparto de responsabilidades:
 *   - una sola consola es la visible: se pinta y suena;
 *   - las ocultas corren igual, sin pintar y con el audio descartado;
 *   - el cable lo lleva el coordinador nativo, aqui solo se reparte tiempo.
 *
 * No sabe nada de lobby, de WebRTC ni de asientos remotos. Eso va por encima.
 */
(() => {
	"use strict";

	const FRAME_CYCLES = 280896;
	const MAX_SEATS = 4;

	/* enum GBAKey de include/mgba/internal/gba/input.h */
	const KEY = { A: 0, B: 1, SELECT: 2, START: 3, RIGHT: 4, LEFT: 5, UP: 6, DOWN: 7, R: 8, L: 9 };

	/* El worklet solo hace de cola: recibe bloques estereo ya remuestreados y
	   los va soltando. Sin SharedArrayBuffer, que exigiria COOP/COEP. */
	const WORKLET = `
class ML3DSink extends AudioWorkletProcessor {
	constructor() {
		super();
		this.queue = [];
		this.offset = 0;
		this.queued = 0;
		this.port.onmessage = (event) => {
			if (event.data === null) { this.queue = []; this.offset = 0; this.queued = 0; return; }
			this.queue.push(event.data);
			this.queued += event.data.length / 2;
		};
	}
	process(inputs, outputs) {
		const left = outputs[0][0];
		const right = outputs[0][1] || outputs[0][0];
		for (let i = 0; i < left.length; ++i) {
			const block = this.queue[0];
			if (!block) { left[i] = 0; right[i] = 0; continue; }
			left[i] = block[this.offset];
			right[i] = block[this.offset + 1];
			this.offset += 2;
			--this.queued;
			if (this.offset >= block.length) { this.queue.shift(); this.offset = 0; }
		}
		this.port.postMessage(this.queued);
		return true;
	}
}
registerProcessor("ml3d-mgba-sink", ML3DSink);
`;

	/* mgba.js es UMD, no un modulo ES: define el global createMgbaModule. */
	function loadClassicScript(url) {
		return new Promise((resolve, reject) => {
			if (window.createMgbaModule) return resolve();
			const tag = document.createElement("script");
			tag.src = url;
			tag.onload = () => resolve();
			tag.onerror = () => reject(new Error("no se pudo cargar " + url));
			document.head.appendChild(tag);
		});
	}

	class ML3DMgbaLink {
		constructor(Module, options) {
			this.M = Module;
			this.canvas = options.canvas;
			this.ctx2d = options.canvas ? options.canvas.getContext("2d") : null;
			this.image = null;
			this.seats = [];            /* { id, mask, seat } por asiento */
			this.visible = 0;
			this.running = false;
			this.rafHandle = 0;
			this.ran = [];              /* ciclos acumulados, para el round-robin */
			this.audio = null;
			this.onStatus = options.onStatus || (() => {});
			this.frames = 0;
			this.lastFpsAt = 0;
			this.fps = 0;
		}

		/**
		 * Abre `seats` consolas sobre una sola copia de la ROM y, si se pide,
		 * las engancha al cable.
		 */
		static async create(options) {
			const dir = options.wasmDir || "../dist/multi/";
			await loadClassicScript(dir + "mgba.js");
			if (typeof window.createMgbaModule !== "function") {
				throw new Error("mgba.js no ha definido createMgbaModule");
			}
			const Module = await window.createMgbaModule({ locateFile: (p) => dir + p });
			Module._mgbawasm_init();
			Module._mgbawasm_set_log_level(options.logLevel ?? 1);

			const runtime = new ML3DMgbaLink(Module, options);
			runtime.shareRom(options.rom);
			const count = Math.min(Math.max(1, options.seats || 1), MAX_SEATS);
			for (let i = 0; i < count; ++i) runtime.openSeat();
			if (options.link !== false && count > 1) runtime.attachAll();
			return runtime;
		}

		shareRom(bytes) {
			const ptr = this.M._malloc(bytes.length);
			this.M.HEAPU8.set(bytes, ptr);
			const shared = this.M._mgbawasm_rom_share(ptr, bytes.length);
			this.M._free(ptr);
			if (!shared) throw new Error("mgbawasm_rom_share falló");
			return shared;
		}

		openSeat() {
			const id = this.M._mgbawasm_instance_open(-1, 0, 1);
			if (id < 0) throw new Error("no se pudo abrir otra consola");
			this.seats.push({ id, mask: 0, seat: -1 });
			this.ran.push(0);
			return id;
		}

		attachAll() {
			this.seats.forEach((s, i) => {
				if (!this.M._mgbawasm_link_attach(s.id, i)) {
					throw new Error("link_attach falló en la consola " + s.id);
				}
			});
			this.refreshSeats();
		}

		detachAll() {
			for (const s of this.seats) this.M._mgbawasm_link_detach(s.id);
			this.refreshSeats();
		}

		refreshSeats() {
			for (const s of this.seats) s.seat = this.M._mgbawasm_link_seat(s.id);
		}

		get linked() {
			return this.M._mgbawasm_link_attached() > 0;
		}

		/* ------------------------------------------------------------ audio */

		/**
		 * Audio solo de la consola visible.
		 *
		 * El GBA emite a 32768 Hz y sube a 65536 en marcha, mientras el
		 * AudioContext va a lo suyo, asi que hay que remuestrear. Se hace aqui
		 * con interpolacion lineal en vez de rehacer el contexto cada vez que
		 * el juego cambia de resolucion, que sonaria a corte.
		 */
		async startAudio() {
			if (this.audio) return;
			const ctx = new (window.AudioContext || window.webkitAudioContext)();
			const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
			await ctx.audioWorklet.addModule(url);
			URL.revokeObjectURL(url);

			const node = new AudioWorkletNode(ctx, "ml3d-mgba-sink", {
				numberOfInputs: 0,
				numberOfOutputs: 1,
				outputChannelCount: [2]
			});
			const gain = ctx.createGain();
			gain.gain.value = 1;
			node.connect(gain).connect(ctx.destination);

			this.audio = { ctx, node, gain, queued: 0, scratch: 0, scratchFrames: 0, carry: 0 };
			node.port.onmessage = (event) => { this.audio.queued = event.data; };
			if (ctx.state === "suspended") await ctx.resume();
		}

		/** Vacía la cola: se usa al cambiar de consola visible. */
		flushAudio() {
			if (!this.audio) return;
			this.audio.node.port.postMessage(null);
			this.audio.queued = 0;
			this.audio.carry = 0;
		}

		pumpAudio() {
			const audio = this.audio;
			if (!audio) return;
			const visible = this.seats[this.visible];
			const available = this.M._mgbawasm_audio_available(visible.id);
			if (available <= 0) return;

			if (audio.scratchFrames < available) {
				if (audio.scratch) this.M._free(audio.scratch);
				audio.scratch = this.M._malloc(available * 4);   /* estéreo int16 */
				audio.scratchFrames = available;
			}
			const got = this.M._mgbawasm_read_audio(visible.id, audio.scratch, available);
			if (got <= 0) return;

			const src = this.M.HEAP16.subarray(audio.scratch >> 1, (audio.scratch >> 1) + got * 2);
			const srcRate = this.M._mgbawasm_sample_rate(visible.id) || 32768;
			const ratio = srcRate / audio.ctx.sampleRate;

			const outFrames = Math.floor((got - audio.carry) / ratio);
			if (outFrames <= 0) return;
			const out = new Float32Array(outFrames * 2);
			let pos = audio.carry;
			for (let i = 0; i < outFrames; ++i) {
				const index = Math.min(Math.floor(pos), got - 1) * 2;
				out[i * 2] = src[index] / 32768;
				out[i * 2 + 1] = src[index + 1] / 32768;
				pos += ratio;
			}
			audio.carry = pos - got;
			if (audio.carry < 0) audio.carry = 0;
			audio.node.port.postMessage(out, [out.buffer]);
		}

		/* ------------------------------------------------------------ video */

		blit() {
			if (!this.ctx2d) return;
			const visible = this.seats[this.visible];
			const width = this.M._mgbawasm_video_width(visible.id);
			const height = this.M._mgbawasm_video_height(visible.id);
			if (!width || !height) return;
			if (this.canvas.width !== width || this.canvas.height !== height) {
				this.canvas.width = width;
				this.canvas.height = height;
				this.image = null;
			}
			if (!this.image) this.image = this.ctx2d.createImageData(width, height);
			const ptr = this.M._mgbawasm_video_ptr(visible.id);
			this.image.data.set(this.M.HEAPU8.subarray(ptr, ptr + width * height * 4));
			this.ctx2d.putImageData(this.image, 0, 0);
		}

		/* -------------------------------------------------------- ejecución */

		/**
		 * Un frame para todas las consolas.
		 *
		 * Con cable: se le da tiempo a la despierta que menos ha corrido, y se
		 * ordena por los ciclos que devuelve link_run y no por el reloj emulado,
		 * porque mTiming es un int32 que mGBA reajusta. Sin cable: un frame a
		 * cada una y ya.
		 */
		advanceFrame() {
			if (!this.linked) {
				for (const s of this.seats) this.M._mgbawasm_run_frame(s.id);
			} else {
				const target = Math.min(...this.ran) + FRAME_CYCLES;
				let guard = 0;
				while (++guard < 4096) {
					let pick = -1;
					let least = Infinity;
					for (let i = 0; i < this.seats.length; ++i) {
						if (this.ran[i] >= target) continue;
						if (this.M._mgbawasm_link_asleep(this.seats[i].id)) continue;
						if (this.ran[i] < least) { least = this.ran[i]; pick = i; }
					}
					if (pick < 0) break;
					this.ran[pick] += this.M._mgbawasm_link_run(
						this.seats[pick].id, target - this.ran[pick]);
				}
			}
			/* Las ocultas no suenan: su cola se descarta para que no sature. */
			this.seats.forEach((s, i) => {
				if (i !== this.visible) this.M._mgbawasm_drop_audio(s.id);
			});
		}

		tick(now) {
			if (!this.running) return;

			/* Realimentacion por nivel de cola: el GBA va a 59,7275 Hz y la
			   pantalla a 60, asi que sin esto el audio deriva. Un frame de mas
			   o de menos segun lo que quede encolado. */
			let frames = 1;
			if (this.audio) {
				const ms = (this.audio.queued / this.audio.ctx.sampleRate) * 1000;
				if (ms < 40) frames = 2;
				else if (ms > 140) frames = 0;
			}
			for (let f = 0; f < frames; ++f) {
				this.advanceFrame();
				this.pumpAudio();
			}

			this.blit();
			++this.frames;
			if (now - this.lastFpsAt >= 1000) {
				this.fps = this.frames * 1000 / (now - this.lastFpsAt);
				this.frames = 0;
				this.lastFpsAt = now;
				this.onStatus(this.status());
			}
			this.rafHandle = requestAnimationFrame((t) => this.tick(t));
		}

		start() {
			if (this.running) return;
			this.running = true;
			this.lastFpsAt = performance.now();
			this.frames = 0;
			this.rafHandle = requestAnimationFrame((t) => this.tick(t));
		}

		stop() {
			this.running = false;
			if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
			this.rafHandle = 0;
		}

		/* ------------------------------------------------------------ input */

		setKeys(index, mask) {
			const s = this.seats[index];
			if (!s) return;
			s.mask = mask;
			this.M._mgbawasm_set_keys(s.id, mask);
		}

		press(index, keyName, down) {
			const s = this.seats[index];
			if (!s || KEY[keyName] === undefined) return;
			const bit = 1 << KEY[keyName];
			this.setKeys(index, down ? (s.mask | bit) : (s.mask & ~bit));
		}

		/* --------------------------------------------------- consola visible */

		/** Cambia quién se ve y se oye. No reinicia ni para ninguna consola. */
		setVisible(index) {
			if (index < 0 || index >= this.seats.length || index === this.visible) return;
			this.visible = index;
			this.image = null;
			this.flushAudio();
		}

		/* ---------------------------------------------------------- savedata */

		sram(index) {
			const s = this.seats[index];
			if (!s) return null;
			const size = this.M._mgbawasm_sram_save(s.id);
			if (!size) return null;
			const ptr = this.M._mgbawasm_sram_ptr(s.id);
			return Uint8Array.from(this.M.HEAPU8.subarray(ptr, ptr + size));
		}

		loadSram(index, bytes) {
			const s = this.seats[index];
			if (!s || !bytes || !bytes.length) return false;
			const ptr = this.M._malloc(bytes.length);
			this.M.HEAPU8.set(bytes, ptr);
			const ok = this.M._mgbawasm_sram_load(s.id, ptr, bytes.length);
			this.M._free(ptr);
			return Boolean(ok);
		}

		/* ------------------------------------------------------ diagnóstico */

		status() {
			return {
				fps: this.fps,
				visible: this.visible,
				linked: this.linked,
				attached: this.M._mgbawasm_link_attached(),
				heap: this.M._mgbawasm_heap_used() >>> 0,
				linear: this.M.HEAPU8.length,
				audioQueued: this.audio ? this.audio.queued : 0,
				sampleRate: this.seats.length
					? this.M._mgbawasm_sample_rate(this.seats[this.visible].id) : 0,
				seats: this.seats.map((s, i) => ({
					id: s.id,
					seat: this.M._mgbawasm_link_seat(s.id),
					asleep: Boolean(this.M._mgbawasm_link_asleep(s.id)),
					frames: this.M._mgbawasm_frame_counter(s.id),
					cycles: this.ran[i],
					mask: s.mask
				}))
			};
		}

		destroy() {
			this.stop();
			this.detachAll();
			for (const s of this.seats) this.M._mgbawasm_instance_close(s.id);
			this.seats = [];
			this.ran = [];
			this.M._mgbawasm_rom_release();
			if (this.audio) {
				if (this.audio.scratch) this.M._free(this.audio.scratch);
				try { this.audio.ctx.close(); } catch (_) {}
				this.audio = null;
			}
		}
	}

	ML3DMgbaLink.KEY = KEY;
	ML3DMgbaLink.FRAME_CYCLES = FRAME_CYCLES;
	window.ML3DMgbaLink = ML3DMgbaLink;
})();
