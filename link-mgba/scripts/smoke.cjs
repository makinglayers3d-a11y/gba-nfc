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
 *   SMOKE_SECONDS  seconds of the phase 2 stability run (default 60)
 *   SMOKE_FRAMES   frames of the boot run (default 600, ~10 s emulated)
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
	: path.join(REPO_DIR, "games", "Mario Kart - Super Circuit.gba");

const BOOT_FRAMES = Number(process.env.SMOKE_FRAMES || 600);
const STABILITY_SECONDS = Number(process.env.SMOKE_SECONDS || 60);

/* enum GBAKey de include/mgba/internal/gba/input.h */
const KEY = { A: 0, B: 1, SELECT: 2, START: 3, RIGHT: 4, LEFT: 5, UP: 6, DOWN: 7, R: 8, L: 9 };

let failures = 0;

function check(label, ok, detail) {
	console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail !== undefined ? " — " + detail : ""}`);
	if (!ok) ++failures;
}

function info(label, value) {
	console.log(`       ${label}: ${value}`);
}

function mib(bytes) {
	return (bytes / 1048576).toFixed(2) + " MiB";
}

/* -------------------------------------------------------------------------- */

async function loadModule() {
	const glue = path.join(DIST, "mgba.js");
	if (!fs.existsSync(glue)) {
		console.error(`::error::no existe ${glue} — compila la fase ${STAGE} primero`);
		process.exit(1);
	}
	const factory = require(glue);
	const Module = await factory({ locateFile: (p) => path.join(DIST, p) });
	Module._mgbawasm_init();
	Module._mgbawasm_set_log_level(1);
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
	const heapBefore = Module._mgbawasm_heap_used() >>> 0;
	info("heap tras inicializar el modulo", mib(heapBefore));

	const loaded = withRomInHeap(Module, rom, (ptr, len) =>
		/* rom, romBytes, bios, biosBytes, platform=-1 (auto), gbModel=NULL, skipBios */
		Module._mgbawasm_load(ptr, len, 0, 0, -1, 0, 1));
	check("mgbawasm_load", loaded === 1, "devuelve " + loaded);
	if (loaded !== 1) return;

	const platform = Module._mgbawasm_platform();
	check("plataforma detectada como GBA", platform === 0, "enum mPlatform " + platform);
	info("sample rate", Module._mgbawasm_sample_rate() + " Hz");
	info("framerate", (Module._mgbawasm_framerate_micro() / 1e6).toFixed(4) + " Hz");
	info("heap con la ROM y un nucleo", mib(Module._mgbawasm_heap_used() >>> 0));

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

	const heap0 = Module._mgbawasm_heap_used() >>> 0;
	info("heap con 0 nucleos y sin ROM", mib(heap0));

	const shared = withRomInHeap(Module, rom, (ptr, len) => Module._mgbawasm_rom_share(ptr, len));
	check("mgbawasm_rom_share", shared === rom.length, shared + " bytes de " + rom.length);
	const heapRom = Module._mgbawasm_heap_used() >>> 0;
	info("heap con la ROM compartida y 0 nucleos", mib(heapRom));

	const id0 = Module._mgbawasm_instance_open(-1, 0, 1);
	check("abre el nucleo 0", id0 === 0, "id " + id0);
	const heap1 = Module._mgbawasm_heap_used() >>> 0;
	info("heap con 1 nucleo", mib(heap1) + `  (+${mib(heap1 - heapRom)})`);

	const id1 = Module._mgbawasm_instance_open(-1, 0, 1);
	check("abre el nucleo 1", id1 === 1, "id " + id1);
	const heap2 = Module._mgbawasm_heap_used() >>> 0;
	info("heap con 2 nucleos", mib(heap2) + `  (+${mib(heap2 - heap1)})`);

	check("hay 2 instancias", Module._mgbawasm_instance_count() === 2,
		Module._mgbawasm_instance_count() + " instancias");

	/* La prueba de que la ROM se comparte de verdad: el segundo nucleo cuesta
	   cerca de 1 MiB, no el tamano del cartucho. Margen amplio a proposito: lo
	   que se descarta es una copia entera de la ROM, no unos KiB de mas. */
	const perCore = heap2 - heap1;
	check("el 2.º nucleo NO duplica la ROM", perCore < rom.length / 2,
		mib(perCore) + " por nucleo frente a " + mib(rom.length) + " de ROM");
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
	check("los dos tienen imagen",
		f0 && f1 && distinctColours(f0) > 4 && distinctColours(f1) > 4,
		f0 && f1 ? distinctColours(f0) + " y " + distinctColours(f1) + " colores" : "sin framebuffer");
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
	check("la entrada de un nucleo no llega al otro", !sameBytes(g0, g1),
		sameBytes(g0, g1) ? "las dos pantallas siguen iguales tras 900 frames pulsando START solo en el 1" : "pantallas distintas");
	Module._mgbawasm_set_keys(id1, 0);

	/* Framebuffers en direcciones distintas: dos punteros, no uno compartido. */
	check("cada nucleo tiene su propio framebuffer",
		Module._mgbawasm_video_ptr(id0) !== Module._mgbawasm_video_ptr(id1),
		"0x" + Module._mgbawasm_video_ptr(id0).toString(16) + " / 0x" + Module._mgbawasm_video_ptr(id1).toString(16));

	/* Estabilidad: los dos a la vez un rato largo, vigilando fugas. */
	console.log(`\n--- Estabilidad: ${STABILITY_SECONDS} s con los dos nucleos ---`);
	const heapBeforeRun = Module._mgbawasm_heap_used() >>> 0;
	const linearBeforeRun = Module.HEAPU8.length;
	const startedAt = Date.now();
	const deadline = startedAt + STABILITY_SECONDS * 1000;
	let frames = 0;
	while (Date.now() < deadline) {
		for (let i = 0; i < 60; ++i) {
			Module._mgbawasm_run_frame(id0);
			Module._mgbawasm_run_frame(id1);
			Module._mgbawasm_drop_audio(id0);
			Module._mgbawasm_drop_audio(id1);
		}
		frames += 60;
	}
	const elapsed = (Date.now() - startedAt) / 1000;
	const heapAfterRun = Module._mgbawasm_heap_used() >>> 0;

	info("frames por nucleo", frames);
	info("fps por nucleo (sin limite de reloj)", (frames / elapsed).toFixed(1));
	info("heap antes / despues", mib(heapBeforeRun) + " / " + mib(heapAfterRun));
	info("memoria lineal antes / despues", mib(linearBeforeRun) + " / " + mib(Module.HEAPU8.length));

	check("el heap no crece durante la ejecucion", heapAfterRun - heapBeforeRun < 1048576,
		"delta " + mib(heapAfterRun - heapBeforeRun));
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
	const heapEnd = Module._mgbawasm_heap_used() >>> 0;
	info("heap tras cerrar los dos (la ROM sigue compartida)", mib(heapEnd));
	Module._mgbawasm_rom_release();
	info("heap tras liberar la ROM", mib(Module._mgbawasm_heap_used() >>> 0));
	check("volver al punto de partida no deja mas de 1 MiB suelto",
		(Module._mgbawasm_heap_used() >>> 0) - heap0 < 1048576,
		"delta " + mib((Module._mgbawasm_heap_used() >>> 0) - heap0));
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
	} else {
		await smokeMulti(rom);
	}

	console.log();
	if (failures) {
		console.error(`::error::smoke ${STAGE}: ${failures} comprobacion(es) fallida(s)`);
		process.exit(1);
	}
	console.log(`smoke ${STAGE}: OK`);
})().catch((error) => {
	console.error("::error::" + (error && error.stack ? error.stack : error));
	process.exit(1);
});
