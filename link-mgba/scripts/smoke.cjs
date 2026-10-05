#!/usr/bin/env node
/*
 * Headless validation of a built core, in node, with no browser.
 *
 * The glue is linked with -sENVIRONMENT=web,node, so the same artifact CI
 * uploads is the one tested here. Phase 1 checks that our own build boots a
 * real cartridge and produces picture and sound; phase 2 checks that two cores
 * in one module stay independent and that the shared ROM is actually shared.
 *
 * Usage:
 *   node scripts/smoke.cjs upstream [rom]
 *   node scripts/smoke.cjs multi    [rom]
 *
 * Env:
 *   SMOKE_SECONDS      seconds of the phase 2 stability run (default 60)
 *   SMOKE_FRAMES       frames of the boot run (default 600, ~10 s emulated)
 *   SMOKE_MODE=leak    run the memory-residue experiment instead of phase 2
 *   SMOKE_LEAK_FRAMES  frames per core in that experiment (default 1800)
 *   SMOKE_MODE=link    run the native SIO lockstep test (phase 3)
 *   SMOKE_LINK_SEATS   consoles on the cable in that test (default 2)
 *   SMOKE_LINK_FRAMES  frames per console in that test (default 2400, ~40 s)
 *   SMOKE_MODE=trace   memory-residue trace; needs patches/diagnostics/ applied
 */

"use strict";

const fs = require("fs");
const path = require("path");

const STAGE = process.argv[2] || "upstream";
if (STAGE !== "upstream" && STAGE !== "multi") {
	console.error("usage: node scripts/smoke.cjs [upstream|multi] [rom]");
	process.exit(2);
}

const PROJECT_DIR = path.resolve(__dirname, "..");
const REPO_DIR = path.resolve(PROJECT_DIR, "..");
const DIST = path.join(PROJECT_DIR, "dist", STAGE);
const ROM_PATH = process.argv[3]
	? path.resolve(process.argv[3])
	: path.join(PROJECT_DIR, "test-rom.gba");

const BOOT_FRAMES = Number(process.env.SMOKE_FRAMES || 600);
const STABILITY_SECONDS = Number(process.env.SMOKE_SECONDS || 60);
/* SMOKE_MODE=leak cambia la fase 2 por el experimento de residuo de memoria. */
const MODE = process.env.SMOKE_MODE || "full";
const LEAK_FRAMES = Number(process.env.SMOKE_LEAK_FRAMES || 1800);

/* enum GBAKey de include/mgba/internal/gba/input.h */
const KEY = { A: 0, B: 1, SELECT: 2, START: 3, RIGHT: 4, LEFT: 5, UP: 6, DOWN: 7, R: 8, L: 9 };

const failed = [];

/* La ROM libre de las pruebas (ver test-rom.LICENSE.txt), reconocida por su
   huella. Es una demo del cable: pesa 39 KiB, pinta dos colores, no guarda
   partida y su pantalla no cambia al pulsar un boton. Las comprobaciones que
   necesitan un juego grande y con graficos se saltan SOLO con ella; con
   cualquier otra ROM siguen siendo obligatorias. */
const ROM_SIN_PARTIDA = new Set([
	"305cbd56bf77ebe1597be5dafa5fd3617e0bf19b81b85ac56e98048133e342df"
]);

function sha256(bytes) {
	return require("crypto").createHash("sha256").update(bytes).digest("hex");
}

let romLibre = null;
function esRomLibre() {
	if (romLibre === null) {
		romLibre = fs.existsSync(ROM_PATH) && ROM_SIN_PARTIDA.has(sha256(fs.readFileSync(ROM_PATH)));
	}
	return romLibre;
}

/* Como check, pero se salta con la ROM libre y deja dicho por que. */
function checkSalvoRomLibre(label, ok, detail, motivo) {
	if (esRomLibre()) info(label, "omitida con la ROM libre: " + motivo);
	else check(label, ok, detail);
}

function check(label, ok, detail) {
	console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail !== undefined ? " — " + detail : ""}`);
	if (!ok) failed.push(label + (detail !== undefined ? " (" + detail + ")" : ""));
}

const measured = [];

function info(label, value) {
	console.log(`       ${label}: ${value}`);
	measured.push(label + " = " + value);
}

function mib(bytes) {
	return (bytes / 1048576).toFixed(2) + " MiB";
}

/**
 * Bytes handed out by malloc, or null.
 *
 * mgbawasm_heap_used only exists in the multi shim: the upstream one is a
 * literal copy of the published shim and must export exactly what the package
 * exports, which is what check-exports.sh enforces. So phase 1 measures the
 * linear memory and nothing finer.
 */
function heapUsed(Module) {
	return typeof Module._mgbawasm_heap_used === "function"
		? Module._mgbawasm_heap_used() >>> 0
		: null;
}

/* -------------------------------------------------------------------------- */

/* Lo que el nucleo escribe por printf: el shim enruta mLog ahi, asi que un
   warning de mGBA aparece en esta lista y no solo perdido en el log del paso. */
const coreLog = [];

async function loadModule() {
	const glue = path.join(DIST, "mgba.js");
	if (!fs.existsSync(glue)) {
		console.error(`::error::no existe ${glue} — compila la fase ${STAGE} primero`);
		process.exit(1);
	}
	const factory = require(glue);
	const capture = (line) => {
		coreLog.push(String(line));
		console.log("       [core] " + line);
	};
	const Module = await factory({
		locateFile: (p) => path.join(DIST, p),
		print: capture,
		printErr: capture
	});
	Module._mgbawasm_init();
	Module._mgbawasm_set_log_level(1);   /* solo FATAL, ERROR y WARN */
	return Module;
}

/** Copies the ROM into the module heap, runs `use(ptr, len)`, frees. */
function withRomInHeap(Module, bytes, use) {
	const ptr = Module._malloc(bytes.length);
	Module.HEAPU8.set(bytes, ptr);
	try {
		return use(ptr, bytes.length);
	} finally {
		Module._free(ptr);
	}
}

/** Copy of the visible framebuffer, so later frames do not overwrite it. */
function grabFrame(Module, ...id) {
	const ptr = Module._mgbawasm_video_ptr(...id);
	const width = Module._mgbawasm_video_width(...id);
	const height = Module._mgbawasm_video_height(...id);
	if (!ptr || !width || !height) return null;
	return Uint8Array.from(Module.HEAPU8.subarray(ptr, ptr + width * height * 4));
}

/** Distinct RGBA values in a frame. 1 means a flat colour, i.e. nothing drawn. */
function distinctColours(frame) {
	const seen = new Set();
	for (let i = 0; i < frame.length; i += 4) {
		seen.add(frame[i] | (frame[i + 1] << 8) | (frame[i + 2] << 16));
		if (seen.size > 64) break;
	}
	return seen.size;
}

function sameBytes(a, b) {
	if (!a || !b || a.length !== b.length) return false;
	for (let i = 0; i < a.length; ++i) if (a[i] !== b[i]) return false;
	return true;
}

/* ------------------------------------------------------------ fase 1 ------ */

async function smokeUpstream(rom) {
	const Module = await loadModule();
	console.log("\n=== Fase 1 · un nucleo, shim original ===");
	info("memoria lineal al arrancar", mib(Module.HEAPU8.length));

	const loaded = withRomInHeap(Module, rom, (ptr, len) =>
		/* rom, romBytes, bios, biosBytes, platform=-1 (auto), gbModel=NULL, skipBios */
		Module._mgbawasm_load(ptr, len, 0, 0, -1, 0, 1));
	check("mgbawasm_load", loaded === 1, "devuelve " + loaded);
	if (loaded !== 1) return;

	const platform = Module._mgbawasm_platform();
	check("plataforma detectada como GBA", platform === 0, "enum mPlatform " + platform);
	info("sample rate", Module._mgbawasm_sample_rate() + " Hz");
	info("framerate", (Module._mgbawasm_framerate_micro() / 1e6).toFixed(4) + " Hz");
	info("memoria lineal con la ROM y un nucleo", mib(Module.HEAPU8.length));

	let audioSeen = 0;
	for (let i = 0; i < BOOT_FRAMES; ++i) {
		Module._mgbawasm_run_frame();
		audioSeen += Module._mgbawasm_audio_available();
		if (Module._mgbawasm_audio_available() > 1024) {
			const out = Module._malloc(1024 * 4);
			Module._mgbawasm_read_audio(out, 1024);
			Module._free(out);
		}
	}

	check("el contador de frames avanza", Module._mgbawasm_frame_counter() >= BOOT_FRAMES,
		Module._mgbawasm_frame_counter() + " frames");

	const frame = grabFrame(Module);
	check("resolucion 240x160", Module._mgbawasm_video_width() === 240 && Module._mgbawasm_video_height() === 160,
		Module._mgbawasm_video_width() + "x" + Module._mgbawasm_video_height());
	check("la pantalla tiene imagen", frame !== null && distinctColours(frame) > 4,
		frame ? distinctColours(frame) + " colores distintos" : "sin framebuffer");
	check("el nucleo produce audio", audioSeen > 0, audioSeen + " muestras acumuladas");

	Module._mgbawasm_unload();
	check("mgbawasm_unload no rompe nada", true);
}

/* ------------------------------------------------------------ fase 2 ------ */

async function smokeMulti(rom) {
	const Module = await loadModule();
	console.log("\n=== Fase 2 · dos nucleos, un modulo, ROM compartida ===");

	if (heapUsed(Module) === null) {
		console.error("::error::este build no exporta mgbawasm_heap_used: parece la fase upstream, no multi");
		process.exit(1);
	}

	const heap0 = heapUsed(Module);
	info("heap con 0 nucleos y sin ROM", mib(heap0));

	const shared = withRomInHeap(Module, rom, (ptr, len) => Module._mgbawasm_rom_share(ptr, len));
	check("mgbawasm_rom_share", shared === rom.length, shared + " bytes de " + rom.length);
	const heapRom = heapUsed(Module);
	info("heap con la ROM compartida y 0 nucleos", mib(heapRom));

	const id0 = Module._mgbawasm_instance_open(-1, 0, 1);
	check("abre el nucleo 0", id0 === 0, "id " + id0);
	const heap1 = heapUsed(Module);
	info("heap con 1 nucleo", mib(heap1) + `  (+${mib(heap1 - heapRom)})`);

	const id1 = Module._mgbawasm_instance_open(-1, 0, 1);
	check("abre el nucleo 1", id1 === 1, "id " + id1);
	const heap2 = heapUsed(Module);
	info("heap con 2 nucleos", mib(heap2) + `  (+${mib(heap2 - heap1)})`);

	check("hay 2 instancias", Module._mgbawasm_instance_count() === 2,
		Module._mgbawasm_instance_count() + " instancias");

	/* La prueba de que la ROM se comparte de verdad: el segundo nucleo cuesta
	   cerca de 1 MiB, no el tamano del cartucho. Margen amplio a proposito: lo
	   que se descarta es una copia entera de la ROM, no unos KiB de mas. */
	const perCore = heap2 - heap1;
	checkSalvoRomLibre("el 2.º nucleo NO duplica la ROM", perCore < rom.length / 2,
		mib(perCore) + " por nucleo frente a " + mib(rom.length) + " de ROM",
		"con 39 KiB de ROM una copia de mas no se distingue del coste del nucleo");
	info("coste por nucleo extra", mib(perCore));

	/* Determinismo: misma ROM, mismo reset, misma entrada → mismo frame. */
	for (let i = 0; i < BOOT_FRAMES; ++i) {
		Module._mgbawasm_run_frame(id0);
		Module._mgbawasm_run_frame(id1);
		Module._mgbawasm_drop_audio(id0);
		Module._mgbawasm_drop_audio(id1);
	}
	const f0 = grabFrame(Module, id0);
	const f1 = grabFrame(Module, id1);
	check("los dos contadores de frames avanzan igual",
		Module._mgbawasm_frame_counter(id0) === Module._mgbawasm_frame_counter(id1)
			&& Module._mgbawasm_frame_counter(id0) >= BOOT_FRAMES,
		Module._mgbawasm_frame_counter(id0) + " / " + Module._mgbawasm_frame_counter(id1));
	if (esRomLibre()) {
		/* La demo es texto sobre fondo: dos colores bastan para saber que pinta. */
		check("los dos tienen imagen",
			f0 && f1 && distinctColours(f0) >= 2 && distinctColours(f1) >= 2,
			f0 && f1 ? distinctColours(f0) + " y " + distinctColours(f1) + " colores" : "sin framebuffer");
	} else {
		check("los dos tienen imagen",
			f0 && f1 && distinctColours(f0) > 4 && distinctColours(f1) > 4,
			f0 && f1 ? distinctColours(f0) + " y " + distinctColours(f1) + " colores" : "sin framebuffer");
	}
	check("sin entrada, los dos frames son identicos (deterministas)", sameBytes(f0, f1));

	/* Entrada independiente: solo el nucleo 1 pulsa START, y solo su pantalla
	   cambia. Si esto falla con un juego concreto, prueba con otro antes de
	   sospechar del nucleo. */
	const startMask = 1 << KEY.START;
	for (let i = 0; i < 900; ++i) {
		Module._mgbawasm_set_keys(id1, i % 20 < 10 ? startMask : 0);
		Module._mgbawasm_run_frame(id0);
		Module._mgbawasm_run_frame(id1);
		Module._mgbawasm_drop_audio(id0);
		Module._mgbawasm_drop_audio(id1);
	}
	const g0 = grabFrame(Module, id0);
	const g1 = grabFrame(Module, id1);
	checkSalvoRomLibre("la entrada de un nucleo no llega al otro", !sameBytes(g0, g1),
		sameBytes(g0, g1) ? "las dos pantallas siguen iguales tras 900 frames pulsando START solo en el 1" : "pantallas distintas",
		"su pantalla no cambia al pulsar; se comprueba por el cable en la prueba de enlace");
	Module._mgbawasm_set_keys(id1, 0);

	/* Framebuffers en direcciones distintas: dos punteros, no uno compartido. */
	check("cada nucleo tiene su propio framebuffer",
		Module._mgbawasm_video_ptr(id0) !== Module._mgbawasm_video_ptr(id1),
		"0x" + Module._mgbawasm_video_ptr(id0).toString(16) + " / 0x" + Module._mgbawasm_video_ptr(id1).toString(16));

	/* Audio. En una sesion Link solo suena una consola, asi que hay tres cosas
	   que comprobar: que el nucleo visible produce muestras, que drop_audio
	   vacia de verdad, y —la que importa— que un buffer que nadie drena no
	   acaba atascando a su nucleo. Ese era el riesgo anotado en LINK-MGBA.md. */
	for (let i = 0; i < 60; ++i) Module._mgbawasm_run_frame(id0);
	const pending = Module._mgbawasm_audio_available(id0);
	check("el nucleo visible produce audio", pending > 0, pending + " muestras en cola");
	info("sample rate", Module._mgbawasm_sample_rate(id0) + " Hz");

	const dropped = Module._mgbawasm_drop_audio(id0);
	check("drop_audio vacia la cola", dropped === pending && Module._mgbawasm_audio_available(id0) === 0,
		"descartadas " + dropped + ", quedan " + Module._mgbawasm_audio_available(id0));

	const silentBefore = Module._mgbawasm_frame_counter(id1);
	for (let i = 0; i < 300; ++i) Module._mgbawasm_run_frame(id1);   /* sin drenar nada */
	const silentAdvance = Module._mgbawasm_frame_counter(id1) - silentBefore;
	check("un nucleo al que nadie le drena el audio sigue avanzando", silentAdvance === 300,
		silentAdvance + " frames de 300");
	info("cola del nucleo sin drenar tras 300 frames", Module._mgbawasm_audio_available(id1) + " muestras");
	Module._mgbawasm_drop_audio(id1);

	/* Estabilidad: los dos a la vez un rato largo, vigilando fugas. */
	console.log(`\n--- Estabilidad: ${STABILITY_SECONDS} s con los dos nucleos ---`);
	const heapBeforeRun = heapUsed(Module);
	const linearBeforeRun = Module.HEAPU8.length;
	const startedAt = Date.now();
	const deadline = startedAt + STABILITY_SECONDS * 1000;
	/* Muestreado cada 10 s en vez de solo al principio y al final: una fuga
	   lenta y una meseta se distinguen por el recorrido, no por los extremos. */
	const samples = [];
	let nextSample = startedAt;
	let frames = 0;
	while (Date.now() < deadline) {
		for (let i = 0; i < 60; ++i) {
			Module._mgbawasm_run_frame(id0);
			Module._mgbawasm_run_frame(id1);
			Module._mgbawasm_drop_audio(id0);
			Module._mgbawasm_drop_audio(id1);
		}
		frames += 60;
		const now = Date.now();
		if (now >= nextSample) {
			samples.push({ t: Math.round((now - startedAt) / 1000), heap: heapUsed(Module), frames });
			nextSample = now + 10000;
		}
	}
	const elapsed = (Date.now() - startedAt) / 1000;
	const heapAfterRun = heapUsed(Module);
	samples.push({ t: Math.round(elapsed), heap: heapAfterRun, frames });

	info("frames por nucleo", frames);
	info("fps por nucleo (sin limite de reloj)", (frames / elapsed).toFixed(1));
	info("heap antes / despues", mib(heapBeforeRun) + " / " + mib(heapAfterRun));
	info("memoria lineal antes / despues", mib(linearBeforeRun) + " / " + mib(Module.HEAPU8.length));

	const heaps = samples.map((s) => s.heap);
	const spread = Math.max(...heaps) - Math.min(...heaps);
	info("heap min / max durante la ejecucion", mib(Math.min(...heaps)) + " / " + mib(Math.max(...heaps)));
	info("recorrido del heap", mib(spread));
	console.log("       muestras (s, heap, frames):");
	for (const s of samples) {
		console.log(`         ${String(s.t).padStart(4)}s  ${mib(s.heap)}  ${s.frames}`);
	}
	/* El recorrido cubre tambien el antes-contra-despues: spread >= |delta|. */
	check("el heap se mantiene plano durante la ejecucion", spread < 1048576,
		"recorrido " + mib(spread));

	check("los dos siguen avanzando al final",
		Module._mgbawasm_frame_counter(id0) > BOOT_FRAMES + 900
			&& Module._mgbawasm_frame_counter(id1) > BOOT_FRAMES + 900,
		Module._mgbawasm_frame_counter(id0) + " / " + Module._mgbawasm_frame_counter(id1));

	/* Cerrar y reabrir: el ciclo de vida tiene que aguantar, porque una sesion
	   Link abre y cierra asientos cada partida. */
	Module._mgbawasm_instance_close(id1);
	check("cierra el nucleo 1", Module._mgbawasm_instance_count() === 1,
		Module._mgbawasm_instance_count() + " instancias");
	const reopened = Module._mgbawasm_instance_open(-1, 0, 1);
	check("reabre un nucleo en el hueco liberado", reopened === 1, "id " + reopened);
	Module._mgbawasm_instance_close(reopened);
	Module._mgbawasm_instance_close(id0);
	check("cierra todo", Module._mgbawasm_instance_count() === 0,
		Module._mgbawasm_instance_count() + " instancias");
	const heapEnd = heapUsed(Module);
	info("heap tras cerrar los dos (la ROM sigue compartida)", mib(heapEnd));
	Module._mgbawasm_rom_release();
	info("heap tras liberar la ROM", mib(heapUsed(Module)));
	check("volver al punto de partida no deja mas de 1 MiB suelto",
		heapUsed(Module) - heap0 < 1048576,
		"delta " + mib(heapUsed(Module) - heap0));
}

/* ------------------------------------------- experimento de residuo ------ */

/**
 * Una vuelta completa: modulo nuevo, ROM compartida, N nucleos, F frames en
 * cada uno, cerrar todo, soltar la ROM, medir lo que queda.
 *
 * Cada vuelta estrena modulo porque el residuo se mide contra su propia linea
 * base: con MODULARIZE cada llamada a la factoria trae su memoria lineal y sus
 * globales, asi que reutilizar uno arrastraria el residuo de la vuelta anterior
 * y no habria forma de separarlos.
 */
async function leakCycle(rom, cores, frames) {
	const Module = await loadModule();
	const base = heapUsed(Module);

	withRomInHeap(Module, rom, (ptr, len) => Module._mgbawasm_rom_share(ptr, len));

	const ids = [];
	for (let i = 0; i < cores; ++i) {
		const id = Module._mgbawasm_instance_open(-1, 0, 1);
		if (id < 0) throw new Error(`instance_open fallo con ${cores} nucleos (i=${i})`);
		ids.push(id);
	}

	for (let f = 0; f < frames; ++f) {
		for (const id of ids) {
			Module._mgbawasm_run_frame(id);
			Module._mgbawasm_drop_audio(id);
		}
	}

	const peak = heapUsed(Module);
	for (const id of ids) Module._mgbawasm_instance_close(id);
	const afterClose = heapUsed(Module);
	Module._mgbawasm_rom_release();
	const afterRelease = heapUsed(Module);

	return { cores, frames, base, peak, afterClose, afterRelease, residue: afterRelease - base };
}

function kib(bytes) {
	return (bytes / 1024).toFixed(0) + " KiB";
}

/**
 * N ciclos de abrir, correr y cerrar un asiento, todos en el MISMO modulo.
 *
 * leakCycle mide el residuo de un modulo que abre N nucleos una vez, que no es
 * lo que hace una sesion Link: esa abre y cierra asientos en cada partida sobre
 * el modulo que ya esta cargado. Si lo que no vuelve al cerrar no se reaprovecha
 * en la siguiente apertura, el residuo crece con las partidas y entonces si es
 * una fuga acumulativa.
 */
async function leakReopen(rom, cycles, frames) {
	const Module = await loadModule();
	const base = heapUsed(Module);
	withRomInHeap(Module, rom, (ptr, len) => Module._mgbawasm_rom_share(ptr, len));

	let peak = base;
	for (let c = 0; c < cycles; ++c) {
		const id = Module._mgbawasm_instance_open(-1, 0, 1);
		if (id < 0) throw new Error(`instance_open fallo en el ciclo ${c}`);
		for (let f = 0; f < frames; ++f) {
			Module._mgbawasm_run_frame(id);
			Module._mgbawasm_drop_audio(id);
		}
		peak = Math.max(peak, heapUsed(Module));
		Module._mgbawasm_instance_close(id);
	}

	const afterClose = heapUsed(Module);
	Module._mgbawasm_rom_release();
	const afterRelease = heapUsed(Module);
	return { cycles, frames, base, peak, afterClose, afterRelease, residue: afterRelease - base };
}

async function leakExperiment(rom) {
	console.log("\n=== Experimento · residuo de memoria tras cerrar ===");
	console.log(`ROM ${mib(rom.length)} · ${LEAK_FRAMES} frames por nucleo en las vueltas "con frames"\n`);

	const rows = [];
	for (const cores of [1, 2, 3, 4]) rows.push(await leakCycle(rom, cores, LEAK_FRAMES));
	for (const cores of [1, 2, 3, 4]) rows.push(await leakCycle(rom, cores, 0));
	/* El doble de frames con los mismos nucleos: si el residuo dependiera del
	   tiempo de ejecucion en vez del numero de instancias, seria aqui donde se
	   veria, y seria la unica forma que tendria de ser una fuga de verdad. */
	rows.push(await leakCycle(rom, 2, LEAK_FRAMES * 2));

	console.log("cores | frames | heap pico | tras cerrar | tras rom_release | residuo");
	console.log("----- | ------ | --------- | ----------- | ---------------- | -------");
	for (const r of rows) {
		console.log(
			`${String(r.cores).padStart(5)} | ${String(r.frames).padStart(6)} | ` +
			`${mib(r.peak).padStart(9)} | ${mib(r.afterClose).padStart(11)} | ` +
			`${mib(r.afterRelease).padStart(16)} | ${kib(r.residue).padStart(8)}`);
	}
	console.log();

	const withFrames = rows.filter((r) => r.frames === LEAK_FRAMES);
	const withoutFrames = rows.filter((r) => r.frames === 0);
	const doubleRun = rows[rows.length - 1];
	const twoWithFrames = withFrames.find((r) => r.cores === 2);

	for (const r of withFrames) measured.push(`residuo ${r.cores}c/${r.frames}f = ${kib(r.residue)}`);
	for (const r of withoutFrames) measured.push(`residuo ${r.cores}c/0f = ${kib(r.residue)}`);
	measured.push(`residuo 2c/${doubleRun.frames}f = ${kib(doubleRun.residue)}`);

	/* Cuanto crece el residuo por cada nucleo añadido. */
	const stepsWith = withFrames.slice(1).map((r, i) => r.residue - withFrames[i].residue);
	const stepsWithout = withoutFrames.slice(1).map((r, i) => r.residue - withoutFrames[i].residue);
	info("residuo por nucleo añadido, con frames", stepsWith.map(kib).join(" / "));
	info("residuo por nucleo añadido, sin frames", stepsWithout.map(kib).join(" / "));

	/* Que tamaño tiene la savedata de un nucleo que ha corrido: si el residuo
	   por nucleo coincide, la hipotesis queda confirmada de un vistazo. */
	const probe = await loadModule();
	withRomInHeap(probe, rom, (ptr, len) => probe._mgbawasm_rom_share(ptr, len));
	const probeId = probe._mgbawasm_instance_open(-1, 0, 1);
	for (let f = 0; f < LEAK_FRAMES; ++f) {
		probe._mgbawasm_run_frame(probeId);
		probe._mgbawasm_drop_audio(probeId);
	}
	const sramBytes = probe._mgbawasm_sram_save(probeId);
	info("savedata de un nucleo que ha corrido", sramBytes ? kib(sramBytes) : "el cartucho no tiene");
	probe._mgbawasm_instance_close(probeId);
	probe._mgbawasm_rom_release();

	/* --- veredicto ---------------------------------------------------------- */
	const maxResidue = Math.max(...rows.map((r) => r.residue));
	const scalesPerCore = stepsWith.every((s) => Math.abs(s - stepsWith[0]) < 16384) && stepsWith[0] > 16384;
	const needsFrames = withoutFrames.every((r) => r.residue < 16384);

	console.log("--- veredicto ---");
	if (maxResidue <= 0) {
		console.log("No hay residuo: todo vuelve al punto de partida.");
	} else if (scalesPerCore && needsFrames) {
		console.log(`El residuo escala por nucleo (~${kib(stepsWith[0])} cada uno) y solo aparece`);
		console.log("cuando el nucleo ha ejecutado frames, asi que va ligado al uso de savedata.");
	} else if (scalesPerCore) {
		console.log(`El residuo escala por nucleo (~${kib(stepsWith[0])}) haya corrido o no.`);
	} else {
		console.log("El residuo no escala con el numero de nucleos: es una asignacion unica del modulo.");
	}
	console.log(`Residuo maximo observado: ${kib(maxResidue)} (${mib(maxResidue)}).`);

	/* Lo que decide si esto se puede dejar pasar: que no dependa del tiempo de
	   ejecucion y que este acotado con los cuatro asientos de una sala llena. */
	check("el residuo no depende de cuanto corran los nucleos",
		Math.abs(doubleRun.residue - twoWithFrames.residue) < 16384,
		`2 nucleos: ${kib(twoWithFrames.residue)} con ${LEAK_FRAMES} frames, ` +
		`${kib(doubleRun.residue)} con ${LEAK_FRAMES * 2}`);

	const fourCores = withFrames.find((r) => r.cores === 4);
	check("el residuo con cuatro asientos esta acotado por debajo de 1 MiB",
		fourCores.residue < 1048576, kib(fourCores.residue));

	info("residuo con 4 nucleos (sala llena)", kib(fourCores.residue));

	/* --- de donde salen los 128 KiB ----------------------------------------- */
	/* El residuo solo aparece cuando el nucleo ha corrido, y 128 KiB es
	   exactamente GBA_SIZE_FLASH1M, que es lo que GBASavedataInitFlash reserva
	   siempre aunque el cartucho resulte ser FLASH512 (64 KiB). Si el salto de
	   0 a 128 KiB cae en el mismo punto en que la savedata pasa a existir,
	   queda atado; si no coincide, es otra reserva y hay que buscarla en otro
	   sitio. Se barre el numero de frames para encontrar los dos umbrales. */
	console.log("\n--- Cuando aparece el residuo, frente a cuando aparece la savedata ---");
	console.log("frames | savedata | residuo");
	console.log("------ | -------- | -------");
	let firstResidue = null;
	let firstSavedata = null;
	for (const frames of [0, 30, 60, 120, 240, 480, 960, 1800]) {
		const Module = await loadModule();
		const base = heapUsed(Module);
		withRomInHeap(Module, rom, (ptr, len) => Module._mgbawasm_rom_share(ptr, len));
		const id = Module._mgbawasm_instance_open(-1, 0, 1);
		for (let f = 0; f < frames; ++f) {
			Module._mgbawasm_run_frame(id);
			Module._mgbawasm_drop_audio(id);
		}
		const sram = Module._mgbawasm_sram_save(id);
		Module._mgbawasm_instance_close(id);
		Module._mgbawasm_rom_release();
		const residue = heapUsed(Module) - base;

		if (residue > 16384 && firstResidue === null) firstResidue = frames;
		if (sram > 0 && firstSavedata === null) firstSavedata = frames;
		console.log(`${String(frames).padStart(6)} | ${(sram ? kib(sram) : "no").padStart(8)} | ${kib(residue).padStart(8)}`);
	}
	console.log();
	info("primer frame con residuo", firstResidue === null ? "nunca" : firstResidue);
	info("primer frame con savedata", firstSavedata === null ? "nunca" : firstSavedata);
	if (firstResidue !== null && firstResidue === firstSavedata) {
		console.log("Los dos umbrales coinciden: el residuo es la savedata.");
	} else {
		console.log("Los umbrales NO coinciden: el residuo no es la savedata.");
	}

	/* --- reapertura en el mismo modulo -------------------------------------- */
	/* Lo de arriba mide modulos de usar y tirar. Una sesion Link abre y cierra
	   asientos en cada partida sobre el modulo ya cargado, asi que la pregunta
	   que decide si esto es una fuga de verdad es si el hueco se reaprovecha. */
	console.log("\n--- Reabriendo asientos en el mismo modulo ---");
	const reopenRows = [];
	for (const cycles of [1, 2, 4, 8]) reopenRows.push(await leakReopen(rom, cycles, LEAK_FRAMES));

	console.log("ciclos | frames | heap pico | tras cerrar | tras rom_release | residuo");
	console.log("------ | ------ | --------- | ----------- | ---------------- | -------");
	for (const r of reopenRows) {
		console.log(
			`${String(r.cycles).padStart(6)} | ${String(r.frames).padStart(6)} | ` +
			`${mib(r.peak).padStart(9)} | ${mib(r.afterClose).padStart(11)} | ` +
			`${mib(r.afterRelease).padStart(16)} | ${kib(r.residue).padStart(8)}`);
	}
	console.log();
	for (const r of reopenRows) measured.push(`residuo ${r.cycles} reaperturas = ${kib(r.residue)}`);

	const once = reopenRows[0];
	const eight = reopenRows[reopenRows.length - 1];
	const growth = eight.residue - once.residue;
	info("crecimiento de 1 a 8 reaperturas", kib(growth));

	if (growth < 16384) {
		console.log("El hueco se reaprovecha: reabrir asientos no suma residuo.");
	} else {
		console.log(`Cada reapertura deja ~${kib(growth / 7)} mas: el residuo crece con las partidas.`);
	}

	/* Esta es la comprobacion que separa "retencion acotada" de "fuga": si
	   reabrir asientos suma, una sesion larga crece sin techo. */
	check("reabrir asientos en el mismo modulo no acumula residuo",
		growth < 16384,
		`${kib(once.residue)} con 1 reapertura, ${kib(eight.residue)} con 8`);

	/* Y el listón alto: con la fuga cerrada no deberia quedar practicamente
	   nada, ni con cuatro asientos ni con ocho reaperturas. */
	const worst = Math.max(maxResidue, ...reopenRows.map((r) => r.residue));
	check("el residuo vuelve practicamente a la linea base",
		worst < 65536, "peor caso " + kib(worst));
	info("peor residuo de todo el experimento", kib(worst));
}

/* ------------------------------------------------------ cable Link ------- */

const FRAME_CYCLES = 280896;          /* un frame de GBA */
const LINK_SLICE = 16384;             /* rodaja por vuelta del planificador */
const GBA_SIO_MULTI = 2;              /* enum GBASIOMode */

/** Reserva un buffer de int32 en el heap del modulo y lo lee con signo. */
function withInts(Module, count, use) {
	const ptr = Module._malloc(count * 4);
	try {
		return use(ptr, () => Array.from(Module.HEAP32.subarray(ptr >> 2, (ptr >> 2) + count)));
	} finally {
		Module._free(ptr);
	}
}

/**
 * Da tiempo a la consola despierta que menos ha corrido.
 *
 * No se usa el reloj emulado para decidir sino los ciclos que devuelve
 * link_run, porque mTiming es un int32 que el propio mGBA reajusta y comparar
 * valores absolutos entre dos nucleos no es fiable. Lo que cuenta aqui es
 * cuanto ha corrido cada uno desde que arranco la prueba.
 *
 * Que siempre haya alguien despierto no es suerte: el coordinador lo garantiza
 * —su _verifyAwake afirma que nunca duermen todos a la vez— y si aun asi
 * ocurriera, seria un bloqueo y hay que verlo, no taparlo.
 */
function linkStep(Module, ids, ran) {
	let pick = -1;
	let least = Infinity;
	for (const id of ids) {
		if (Module._mgbawasm_link_asleep(id)) continue;
		if (ran[id] < least) {
			least = ran[id];
			pick = id;
		}
	}
	if (pick < 0) return -1;
	ran[pick] += Module._mgbawasm_link_run(pick, LINK_SLICE);
	return pick;
}

async function linkExperiment(rom, seats) {
	console.log(`\n=== Cable Link nativo · ${seats} consolas en un modulo ===`);
	const Module = await loadModule();

	withRomInHeap(Module, rom, (ptr, len) => Module._mgbawasm_rom_share(ptr, len));
	const ids = [];
	for (let i = 0; i < seats; ++i) ids.push(Module._mgbawasm_instance_open(-1, 0, 1));
	check("abre las consolas", ids.every((id) => id >= 0), "ids " + ids.join(", "));
	if (!ids.every((id) => id >= 0)) return;

	const heapBefore = heapUsed(Module);

	/* --- enganche --- */
	for (const id of ids) {
		check(`engancha la consola ${id} al cable`,
			Module._mgbawasm_link_attach(id, id) === 1, "asiento pedido " + id);
	}
	check("el coordinador ve todas las consolas",
		Module._mgbawasm_link_attached() === seats,
		Module._mgbawasm_link_attached() + " de " + seats);

	const heapLinked = heapUsed(Module);
	info("coste del cable en memoria", kib(heapLinked - heapBefore));

	/* --- ejecucion con el patron de botones del barrido --- */
	const KEYS = [1 << KEY.START, 1 << KEY.A, 1 << KEY.DOWN, 1 << KEY.A, 1 << KEY.RIGHT];
	const ran = {};
	for (const id of ids) ran[id] = 0;

	let transfers = 0;
	let prevActive = 0;
	let multiSeen = 0;
	let bothInMulti = 0;
	let agreed = 0;
	let sample = null;
	let stalls = 0;
	let entradaPorCable = null;
	let emptySeatsIdle = 0;
	let emptySeatsBusy = 0;
	const payloads = new Set();

	const totalCycles = FRAME_CYCLES * Number(process.env.SMOKE_LINK_FRAMES || 2400);
	const coordN = 9;
	const coreN = 11;

	withInts(Module, coordN, (coordPtr, readCoord) => {
		withInts(Module, coreN, (corePtr, readCore) => {
			let slice = 0;
			/* Tope de reloj real ademas del de ciclos emulados: con el cable
			   las consolas se duermen mucho y las rodajas se multiplican, asi
			   que sin esto una sincronia mala se comeria el timeout del job en
			   vez de reportarse. */
			const deadline = Date.now() + Number(process.env.SMOKE_LINK_SECONDS || 300) * 1000;
			while (Math.min(...ids.map((id) => ran[id])) < totalCycles) {
				if (Date.now() > deadline) {
					console.log("[js] tope de tiempo real alcanzado, se corta aqui");
					break;
				}
				/* Patron de botones, el mismo en todas: cambia cada ~30 frames. */
				if (slice % 512 === 0) {
					const mask = KEYS[(slice / 512) % KEYS.length];
					for (const id of ids) Module._mgbawasm_set_keys(id, mask);
				} else if (slice % 512 === 256) {
					for (const id of ids) Module._mgbawasm_set_keys(id, 0);
				}

				const advanced = linkStep(Module, ids, ran);
				if (advanced < 0) { ++stalls; break; }

				Module._mgbawasm_link_coordinator_state(coordPtr);
				const coord = readCoord();
				if (coord[1] && !prevActive) ++transfers;   /* flanco de subida */
				prevActive = coord[1];

				if (++slice % 16 === 0) {
					const states = ids.map((id) => {
						Module._mgbawasm_link_core_state(id, corePtr);
						return readCore();
					});
					const inMulti = states.filter((s) => s[3] === GBA_SIO_MULTI).length;
					if (inMulti) ++multiSeen;
					if (inMulti === seats) ++bothInMulti;

					/* La prueba de fuego: SIOMULTI0..3 iguales en todas las
					   consolas y con algo distinto de la linea en reposo. */
					const multi = states.map((s) => s.slice(6, 10).map((w) => w & 0xffff));
					const words = multi.map((m) => m.join(","));
					const same = words.every((w) => w === words[0]);
					const live = multi[0].slice(0, seats).some((w) => w !== 0xffff);
					if (same && live && inMulti === seats) {
						++agreed;
						/* Los asientos que no existen tienen que leerse como la
						   linea en reposo, igual que un cable real sin nadie
						   enchufado en esa punta. */
						if (multi[0].slice(seats).every((w) => w === 0xffff)) {
							++emptySeatsIdle;
						} else {
							++emptySeatsBusy;
						}
						/* Variedad de la carga util: si el juego solo esta
						   saludando, todas las muestras seran iguales. */
						payloads.add(multi[0].slice(0, seats).join(","));
						if (!sample) {
							sample = { coord: coord.slice(), states: states.map((s) => s.slice()) };
						}
					}
				}
				for (const id of ids) Module._mgbawasm_drop_audio(id);
			}

			/* Entrada aislada, por el cable. La demo manda en cada turno el
			   estado de sus botones, asi que lo que llega por el asiento de una
			   consola dice que botones tiene pulsados ESA consola. Se pulsa A solo
			   en la del asiento 1: su palabra tiene que cambiar y la del asiento 0
			   tiene que seguir como en reposo. La pantalla de la demo no sirve
			   para esto, y por eso la comprobacion de la fase 2 se salta con ella. */
			if (esRomLibre() && seats >= 2 && stalls === 0) {
				const muestrea = (teclas, rodajas, descarta) => {
					const vistos = ids.map(() => new Set());
					ids.forEach((id, i) => Module._mgbawasm_set_keys(id, teclas(i)));
					for (let n = 0; n < rodajas; ++n) {
						if (linkStep(Module, ids, ran) < 0) break;
						if (n >= descarta && n % 4 === 0) {
							Module._mgbawasm_link_core_state(ids[0], corePtr);
							const palabras = readCore().slice(6, 10).map((w) => w & 0xffff);
							for (let k = 0; k < seats; ++k) vistos[k].add(palabras[k]);
						}
						for (const id of ids) Module._mgbawasm_drop_audio(id);
					}
					return vistos;
				};
				const reposo = muestrea(() => 0, 4000, 1500);
				const pulsando = muestrea((i) => (i === 1 ? 1 << KEY.A : 0), 4000, 1500);
				for (const id of ids) Module._mgbawasm_set_keys(id, 0);
				const nuevas = (k) => [...pulsando[k]].filter((w) => !reposo[k].has(w));
				entradaPorCable = { propia: nuevas(1), ajena: nuevas(0) };
			}
		});
	});

	info("ciclos corridos por consola", ids.map((id) => ran[id]).join(" / "));
	info("asientos confirmados", ids.map((id) => Module._mgbawasm_link_seat(id)).join(" / "));
	info("muestras con alguna consola en MULTI", multiSeen);
	info("muestras con todas en MULTI", bothInMulti);
	info("muestras con SIOMULTI coincidente y vivo", agreed);
	info("transferencias detectadas", transfers);

	check("el coordinador reparte asientos consecutivos desde el 0",
		ids.every((id, i) => Module._mgbawasm_link_seat(id) === i),
		ids.map((id) => Module._mgbawasm_link_seat(id)).join(", "));
	check("nunca se bloquean todas las consolas a la vez", stalls === 0, stalls + " bloqueos");

	/* Lo que separa "las dos avanzan" de "las dos hablan". */
	check("las consolas entran en modo MULTI", bothInMulti > 0, bothInMulti + " muestras");
	check("hay transferencias por el cable", transfers > 0, transfers + " transferencias");
	check("SIOMULTI coincide entre consolas con datos vivos", agreed > 0, agreed + " muestras");

	if (entradaPorCable) {
		const hex = (lista) => lista.map((w) => "0x" + w.toString(16)).join(", ") || "ninguna";
		check("la entrada de una consola no llega a otra (por el cable)",
			entradaPorCable.propia.length > 0 && entradaPorCable.ajena.length === 0,
			"al pulsar A en el asiento 1: palabras nuevas suyas " + hex(entradaPorCable.propia) +
			"; nuevas del asiento 0 " + hex(entradaPorCable.ajena));
	}

	info("asientos vacios en reposo / ocupados", emptySeatsIdle + " / " + emptySeatsBusy);
	info("cargas utiles distintas observadas", payloads.size);
	if (seats < 4) {
		check("los asientos vacios se leen como linea en reposo (0xFFFF)",
			emptySeatsBusy === 0, emptySeatsBusy + " muestras con un asiento vacio ocupado");
	}

	if (sample) {
		console.log("\n--- muestra de un intercambio real ---");
		console.log(`  coordinador: consolas=${sample.coord[0]} activa=${sample.coord[1]} ` +
			`modo=${sample.coord[2]} ciclo=${sample.coord[3]} ` +
			`multiData=[${sample.coord.slice(4, 8).map((w) => "0x" + (w & 0xffff).toString(16)).join(", ")}]`);
		sample.states.forEach((s, i) => {
			console.log(`  consola ${i}: asiento=${s[2]} modo=${s[3]} ` +
				`SIOCNT=0x${(s[4] & 0xffff).toString(16)} RCNT=0x${(s[5] & 0xffff).toString(16)} ` +
				`SIOMULTI=[${s.slice(6, 10).map((w) => "0x" + (w & 0xffff).toString(16)).join(", ")}] ` +
				`envia=0x${(s[10] & 0xffff).toString(16)}`);
		});
		info("muestra SIOMULTI", sample.states[0].slice(6, 10)
			.map((w) => "0x" + (w & 0xffff).toString(16)).join(","));
	}

	/* COMMERROR es el bit 6 de SIOCNT en multijugador. */
	const errors = ids.filter((id) => {
		let bad = 0;
		withInts(Module, coreN, (ptr, read) => {
			Module._mgbawasm_link_core_state(id, ptr);
			bad = read()[4] & 0x40;
		});
		return bad;
	});
	check("ninguna consola termina con COMMERROR", errors.length === 0, errors.join(", ") || "ninguna");

	/* --- desenganche y que todo siga en pie --- */
	for (const id of ids) Module._mgbawasm_link_detach(id);
	check("el coordinador se queda sin consolas", Module._mgbawasm_link_attached() === 0,
		Module._mgbawasm_link_attached() + " enganchadas");

	const framesBefore = ids.map((id) => Module._mgbawasm_frame_counter(id));
	for (let f = 0; f < 120; ++f) {
		for (const id of ids) {
			Module._mgbawasm_run_frame(id);
			Module._mgbawasm_drop_audio(id);
		}
	}
	check("las consolas siguen corriendo tras soltar el cable",
		ids.every((id, i) => Module._mgbawasm_frame_counter(id) - framesBefore[i] === 120),
		ids.map((id, i) => Module._mgbawasm_frame_counter(id) - framesBefore[i]).join(" / "));

	const sram = ids.map((id) => Module._mgbawasm_sram_save(id));
	/* La ROM libre de las pruebas no guarda partida: no tiene savedata que pueda
	   sobrevivir. Se salta solo con esa ROM, reconocida por su huella; con
	   cualquier otra la comprobacion sigue siendo obligatoria. */
	if (esRomLibre()) {
		info("la savedata sobrevive al cable", "omitida, esta ROM no guarda partida");
	} else {
		check("la savedata sobrevive al cable", sram.every((s) => s > 0), sram.map(kib).join(" / "));
	}

	/* Soltar el ultimo asiento deja un aviso de mGBA por diseño: _removePlayer
	   llama a _reconfigPlayers DESPUES de quitar al jugador, y con la tabla ya
	   vacia ese avisa. Es inherente a la API, no de nuestro orden de detach, y
	   no se silencia: se espera exactamente ese y cualquier otro falla. */
	const KNOWN_DETACH_WARNING = "Reconfiguring player IDs with no players attached";
	const known = coreLog.filter((l) => l.includes(KNOWN_DETACH_WARNING)).length;
	const unexpected = coreLog.filter((l) => !l.includes(KNOWN_DETACH_WARNING));
	info("avisos conocidos al soltar el ultimo asiento", known);
	check("no hay avisos del nucleo mas alla del conocido de detach",
		unexpected.length === 0,
		unexpected.length ? unexpected.slice(0, 3).join(" | ") : "ninguno");

	for (const id of ids) Module._mgbawasm_instance_close(id);
	Module._mgbawasm_rom_release();
	const residue = heapUsed(Module);
	info("residuo tras cerrar todo", kib(residue));
	check("el cable no deja residuo", residue < 65536, kib(residue));
}

/* --------------------------------------- residuo del coordinador --------- */

/**
 * Un ciclo completo de cable sobre nucleos que ya existen: enganchar, correr,
 * soltar. Los nucleos se abren una vez y se cierran al final, para que lo que
 * se mida sea el coste del cable y no el de las instancias.
 */
async function linkLeakCycle(rom, seats, cycles) {
	const Module = await loadModule();
	const base = heapUsed(Module);
	withRomInHeap(Module, rom, (ptr, len) => Module._mgbawasm_rom_share(ptr, len));

	const ids = [];
	for (let i = 0; i < seats; ++i) ids.push(Module._mgbawasm_instance_open(-1, 0, 1));
	const opened = heapUsed(Module);

	let peak = opened;
	for (let c = 0; c < cycles; ++c) {
		for (const id of ids) Module._mgbawasm_link_attach(id, id);
		const ran = {};
		for (const id of ids) ran[id] = 0;
		for (let s = 0; s < 400; ++s) {
			if (linkStep(Module, ids, ran) < 0) break;
			for (const id of ids) Module._mgbawasm_drop_audio(id);
		}
		peak = Math.max(peak, heapUsed(Module));
		for (const id of ids) Module._mgbawasm_link_detach(id);
	}

	const afterDetach = heapUsed(Module);
	for (const id of ids) Module._mgbawasm_instance_close(id);
	Module._mgbawasm_rom_release();
	const afterRelease = heapUsed(Module);

	return {
		seats, cycles, peak,
		linkResidue: afterDetach - opened,     /* lo que deja el cable con los nucleos vivos */
		residue: afterRelease - base           /* lo que queda al final de todo */
	};
}

async function linkLeakExperiment(rom) {
	console.log("\n=== Residuo del coordinador · ciclos de enganche y suelta ===");

	const rows = [];
	for (const seats of [2, 4]) {
		for (const cycles of [1, 2, 4, 8]) {
			rows.push(await linkLeakCycle(rom, seats, cycles));
		}
	}

	console.log("asientos | ciclos | heap pico | residuo del cable | residuo final");
	console.log("-------- | ------ | --------- | ----------------- | -------------");
	for (const r of rows) {
		console.log(
			`${String(r.seats).padStart(8)} | ${String(r.cycles).padStart(6)} | ` +
			`${mib(r.peak).padStart(9)} | ${kib(r.linkResidue).padStart(17)} | ` +
			`${kib(r.residue).padStart(13)}`);
		measured.push(`residuo ${r.seats}c/${r.cycles}ciclos = ${kib(r.residue)}`);
	}
	console.log();

	const two = rows.filter((r) => r.seats === 2);
	const four = rows.filter((r) => r.seats === 4);
	const growthCycles = two[two.length - 1].residue - two[0].residue;
	const growthSeats = four[0].residue - two[0].residue;

	info("crecimiento de 1 a 8 ciclos (2 asientos)", kib(growthCycles));
	info("crecimiento de 2 a 4 asientos (1 ciclo)", kib(growthSeats));

	console.log("--- veredicto ---");
	if (growthCycles < 1024 && growthSeats < 1024) {
		console.log("El residuo no depende ni de los ciclos ni de los asientos:");
		console.log("es la reserva unica de la Table del coordinador, que se crea");
		console.log("una vez por modulo en el primer attach y no se deshace.");
	} else {
		console.log("El residuo crece: hay que soltarlo antes de seguir.");
	}

	check("el residuo del coordinador no crece con los ciclos de enganche",
		growthCycles < 1024,
		`${kib(two[0].residue)} con 1 ciclo, ${kib(two[two.length - 1].residue)} con 8`);
	check("el residuo del coordinador no crece con los asientos",
		growthSeats < 1024,
		`${kib(two[0].residue)} con 2 asientos, ${kib(four[0].residue)} con 4`);
	check("el residuo del coordinador esta acotado por debajo de 8 KiB",
		Math.max(...rows.map((r) => r.residue)) < 8192,
		"peor caso " + kib(Math.max(...rows.map((r) => r.residue))));
}

/* ------------------------------------ trafico Link mas alla del saludo --- */

/**
 * El handshake de arranque intercambia siempre lo mismo, asi que probar que el
 * cable mueve datos no prueba que mueva datos *de partida*. Para eso hay que
 * llegar al modo Link del juego, y eso pide navegar su menu.
 *
 * Sin ver la pantalla no se puede navegar a ciegas con garantias, asi que esto
 * prueba unas pocas secuencias cortas y se queda con la primera que produzca
 * cargas utiles distintas entre si. Es lo minimo que hace falta: no intenta
 * entender el menu, solo reconocer cuando el trafico deja de ser constante.
 */
async function trafficExperiment(rom) {
	console.log("\n=== Trafico Link real · busqueda acotada de secuencia ===");

	const CANDIDATES = [
		{ name: "START A", keys: ["START", "A"] },
		{ name: "START A A", keys: ["START", "A", "A"] },
		{ name: "START A DOWN A", keys: ["START", "A", "DOWN", "A"] },
		{ name: "START A DOWN DOWN A", keys: ["START", "A", "DOWN", "DOWN", "A"] },
		{ name: "START A DOWN DOWN DOWN A", keys: ["START", "A", "DOWN", "DOWN", "DOWN", "A"] },
		{ name: "START A UP A", keys: ["START", "A", "UP", "A"] },
	];

	const BOOT_FRAMES_TRAFFIC = 240;
	const HOLD = 8;
	const GAP = 24;
	const MEASURE_FRAMES = Number(process.env.SMOKE_TRAFFIC_FRAMES || 900);
	const seats = 2;

	const results = [];
	for (const candidate of CANDIDATES) {
		const Module = await loadModule();
		withRomInHeap(Module, rom, (ptr, len) => Module._mgbawasm_rom_share(ptr, len));
		const ids = [];
		for (let i = 0; i < seats; ++i) ids.push(Module._mgbawasm_instance_open(-1, 0, 1));
		for (const id of ids) Module._mgbawasm_link_attach(id, id);

		const ran = {};
		for (const id of ids) ran[id] = 0;
		const payloads = new Set();
		let transfers = 0;
		let prevActive = 0;
		let held = -1;

		/* La secuencia arranca tras el boot y cada tecla se mantiene HOLD frames
		   con GAP de separacion; despues se mide sin tocar nada. */
		const totalFrames = BOOT_FRAMES_TRAFFIC + candidate.keys.length * (HOLD + GAP) + MEASURE_FRAMES;

		withInts(Module, 9, (coordPtr, readCoord) => {
			withInts(Module, 11, (corePtr, readCore) => {
				let slice = 0;
				const deadline = Date.now() + 120000;
				while (Math.min(...ids.map((id) => ran[id])) < totalFrames * FRAME_CYCLES) {
					if (Date.now() > deadline) break;

					const frame = Math.floor(Math.min(...ids.map((id) => ran[id])) / FRAME_CYCLES);
					const into = frame - BOOT_FRAMES_TRAFFIC;
					let mask = 0;
					if (into >= 0) {
						const index = Math.floor(into / (HOLD + GAP));
						if (index < candidate.keys.length && into % (HOLD + GAP) < HOLD) {
							mask = 1 << KEY[candidate.keys[index]];
						}
					}
					if (mask !== held) {
						for (const id of ids) Module._mgbawasm_set_keys(id, mask);
						held = mask;
					}

					if (linkStep(Module, ids, ran) < 0) break;
					for (const id of ids) Module._mgbawasm_drop_audio(id);

					Module._mgbawasm_link_coordinator_state(coordPtr);
					const coord = readCoord();
					if (coord[1] && !prevActive) ++transfers;
					prevActive = coord[1];

					if (++slice % 16 === 0 && frame > BOOT_FRAMES_TRAFFIC) {
						const states = ids.map((id) => {
							Module._mgbawasm_link_core_state(id, corePtr);
							return readCore();
						});
						if (states.every((s) => s[3] === GBA_SIO_MULTI)) {
							const multi = states[0].slice(6, 10).map((w) => w & 0xffff);
							const same = states.every((s) =>
								s.slice(6, 10).map((w) => w & 0xffff).join(",") === multi.join(","));
							if (same && multi.slice(0, seats).some((w) => w !== 0xffff)) {
								payloads.add(multi.slice(0, seats).join(","));
							}
						}
					}
				}
			});
		});

		const sampleValues = Array.from(payloads).slice(0, 6);
		console.log(`  ${candidate.name.padEnd(26)} cargas distintas=${String(payloads.size).padStart(3)} ` +
			`transferencias=${String(transfers).padStart(5)}  ${sampleValues.join(" | ")}`);
		results.push({ name: candidate.name, payloads: payloads.size, transfers, sampleValues });

		for (const id of ids) Module._mgbawasm_link_detach(id);
		for (const id of ids) Module._mgbawasm_instance_close(id);
		Module._mgbawasm_rom_release();
	}

	const best = results.reduce((a, b) => (b.payloads > a.payloads ? b : a), results[0]);
	console.log();
	info("mejor secuencia", best.name);
	info("cargas utiles distintas con la mejor secuencia", best.payloads);
	info("transferencias con la mejor secuencia", best.transfers);
	if (best.sampleValues.length) {
		info("muestras de carga util", best.sampleValues.join(" | "));
	}

	check("el trafico Link va mas alla de una sola carga util constante",
		best.payloads > 1,
		`${best.payloads} carga(s) distinta(s) con "${best.name}"`);
}

/* --------------------------------------------- traza de un solo core ----- */

/**
 * El escenario minimo, con el fork instrumentado: abrir un nucleo, correr hasta
 * que la savedata existe, cerrar, soltar la ROM. Nada mas, para que el historial
 * de reservas y liberaciones de esos 128 KiB se lea entero y sin ruido.
 *
 * Necesita patches/0001-diag-savedata-trace.patch en el build; sin el no sale
 * ninguna linea ML3DTRACE y el modo lo dice en vez de callarse.
 */
async function traceExperiment(rom) {
	console.log("\n=== Traza · un nucleo, ciclo completo ===");
	const Module = await loadModule();
	const marker = coreLog.length;

	const base = heapUsed(Module);
	console.log(`[js] heap base = ${kib(base)}`);

	withRomInHeap(Module, rom, (ptr, len) => Module._mgbawasm_rom_share(ptr, len));
	console.log(`[js] ROM compartida · heap = ${kib(heapUsed(Module))}`);

	const id = Module._mgbawasm_instance_open(-1, 0, 1);
	console.log(`[js] instance_open -> id ${id} · heap = ${kib(heapUsed(Module))}`);

	/* Se corre de 10 en 10 hasta que la savedata aparece, para que la traza
	   ancle el frame exacto en el que se reserva. */
	let frames = 0;
	let sram = 0;
	while (frames < 600 && !sram) {
		for (let i = 0; i < 10; ++i) {
			Module._mgbawasm_run_frame(id);
			Module._mgbawasm_drop_audio(id);
		}
		frames += 10;
		sram = Module._mgbawasm_sram_save(id);
	}
	console.log(`[js] savedata visible en el frame ${frames} · ${sram ? kib(sram) : "no aparecio"}`);
	const beforeClose = heapUsed(Module);
	console.log(`[js] antes de cerrar · heap = ${kib(beforeClose)}`);

	Module._mgbawasm_instance_close(id);
	const afterClose = heapUsed(Module);
	console.log(`[js] instance_close · heap = ${kib(afterClose)} (libera ${kib(beforeClose - afterClose)})`);

	Module._mgbawasm_rom_release();
	const afterRelease = heapUsed(Module);
	console.log(`[js] rom_release · heap = ${kib(afterRelease)}`);
	console.log(`[js] residuo = ${kib(afterRelease - base)}`);

	const lines = coreLog.slice(marker);
	const trace = lines.filter((l) => l.includes("ML3DTRACE"));
	const maps = lines.filter((l) => l.includes("ML3DMAP"));

	console.log(`\n--- ${trace.length} linea(s) ML3DTRACE (savedata) ---`);
	for (const line of trace) console.log("  " + line);
	console.log(`\n--- ${maps.length} linea(s) ML3DMAP (reservas anonimas) ---`);
	for (const line of maps) console.log("  " + line);

	if (!trace.length && !maps.length) {
		console.log("\nNinguna. El build no lleva los parches de instrumentacion.");
		check("el build lleva los parches de traza", false, "0 lineas de traza");
		return;
	}

	/* Toda reserva anonima pasa por aqui, asi que este cruce ve el bloque
	   perdido venga del subsistema que venga. Y compara tamanos: munmap SI usa
	   el tamano, asi que liberar con uno distinto del de la reserva no suelta
	   el bloque aunque la linea de liberacion exista. */
	const live = new Map();
	const mismatched = [];
	for (const line of maps) {
		const ptr = /ptr=(0x[0-9a-f]+)/.exec(line)?.[1];
		const size = Number(/size=(\d+)/.exec(line)?.[1] || 0);
		if (!ptr || ptr === "0x0") continue;
		if (line.includes("alloc")) {
			live.set(ptr, size);
		} else if (line.includes("free")) {
			const allocSize = live.get(ptr);
			if (allocSize !== undefined && allocSize !== size) {
				mismatched.push({ ptr, allocSize, size });
			}
			live.delete(ptr);
		}
	}

	console.log("\n--- veredicto ---");
	if (mismatched.length) {
		console.log("Reservas liberadas con un tamano distinto del reservado:");
		for (const m of mismatched) {
			console.log(`  ${m.ptr}: reservado ${kib(m.allocSize)}, liberado ${kib(m.size)}` +
				`  -> se pierden ${kib(m.allocSize - m.size)}`);
		}
		const lost = mismatched.reduce((a, m) => a + (m.allocSize - m.size), 0);
		console.log(`Total perdido por desajuste de tamano: ${kib(lost)}`);
		info("perdido por desajuste de tamano", kib(lost));
	}
	if (live.size) {
		console.log(`${live.size} reserva(s) sin liberacion correspondiente:`);
		for (const [ptr, size] of live) console.log(`  ${ptr}  ${kib(size)}`);
	}
	if (!mismatched.length && !live.size) {
		console.log("Reservas y liberaciones cuadran en puntero y en tamano.");
	}

	info("residuo del ciclo trazado", kib(afterRelease - base));
	info("reservas sin liberar", live.size);
	info("liberaciones con tamano desajustado", mismatched.length);
}

/* -------------------------------------------------------------------------- */

(async () => {
	if (!fs.existsSync(ROM_PATH)) {
		console.error(`::error::no existe la ROM ${ROM_PATH}`);
		process.exit(1);
	}
	const rom = new Uint8Array(fs.readFileSync(ROM_PATH));
	console.log(`ROM: ${path.basename(ROM_PATH)} (${mib(rom.length)})`);
	console.log(`node ${process.version}`);

	if (STAGE === "upstream") {
		await smokeUpstream(rom);
	} else if (MODE === "link") {
		await linkExperiment(rom, Number(process.env.SMOKE_LINK_SEATS || 2));
	} else if (MODE === "linkleak") {
		await linkLeakExperiment(rom);
	} else if (MODE === "traffic") {
		await trafficExperiment(rom);
	} else if (MODE === "trace") {
		await traceExperiment(rom);
	} else if (MODE === "leak") {
		await leakExperiment(rom);
	} else {
		await smokeMulti(rom);
	}

	console.log();
	/* Item aparte: lo que el nucleo haya gritado. Con logLevel 1 solo salen
	   FATAL, ERROR y WARN, asi que cualquier linea aqui merece una mirada. */
	console.log(`=== Log del nucleo (${coreLog.length} linea(s), solo FATAL/ERROR/WARN) ===`);
	if (!coreLog.length) {
		console.log("       ninguna");
	} else {
		for (const line of coreLog.slice(0, 40)) console.log("       " + line);
		if (coreLog.length > 40) console.log(`       ... y ${coreLog.length - 40} mas`);
		console.log(`::warning title=Log del nucleo ${STAGE}::` +
			coreLog.length + " linea(s): " + coreLog.slice(0, 6).join(" | "));
	}

	console.log();
	/* Las medidas van tambien como ::notice::. El log del paso y el resumen del
	   run piden autenticacion para leerse por API; las anotaciones no, asi que
	   esta es la unica via por la que los numeros salen del run sin credenciales. */
	measured.push("lineas de log del nucleo = " + coreLog.length);
	if (measured.length) {
		const tag = MODE === "leak" ? "residuo" : STAGE;
		console.log(`::notice title=Medidas ${tag}::` + measured.join(" · "));
	}
	if (failed.length) {
		/* Las etiquetas van dentro del ::error:: porque una anotacion de Actions
		   se lee sin autenticacion y el log completo no. */
		console.error(`::error::smoke ${STAGE}: ${failed.length} fallo(s) — ${failed.join(" | ")}`);
		process.exit(1);
	}
	console.log(`smoke ${STAGE}: OK`);
})().catch((error) => {
	console.error("::error::" + (error && error.stack ? error.stack : error));
	process.exit(1);
});
