#!/usr/bin/env node
/*
 * Ejercita runtime/ml3d-mgba-link.js en node, con los mínimos stubs de
 * navegador que hacen falta.
 *
 * No sustituye a la prueba en Chrome: el audio real y los 60 fps de vsync solo
 * se ven ahí. Lo que cubre es todo lo demás —planificador con cable, avance de
 * las consolas ocultas, cambio de visible, input, savedata, memoria, detach y
 * cierre—, que es donde estarian los fallos de logica. Asi la sesion en el
 * navegador confirma en vez de depurar.
 *
 *   node scripts/runtime-check.cjs [rom]
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");

const PROJECT_DIR = path.resolve(__dirname, "..");
const REPO_DIR = path.resolve(PROJECT_DIR, "..");
const DIST = path.join(PROJECT_DIR, "dist", "multi");
const ROM_PATH = process.argv[2]
	? path.resolve(process.argv[2])
	: path.join(PROJECT_DIR, "test-rom.gba");

const failed = [];
function check(label, ok, detail) {
	console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail !== undefined ? " — " + detail : ""}`);
	if (!ok) failed.push(label + (detail !== undefined ? ` (${detail})` : ""));
}
const measured = [];
function info(label, value) {
	console.log(`       ${label}: ${value}`);
	measured.push(`${label} = ${value}`);
}
const mib = (n) => (n / 1048576).toFixed(2) + " MiB";

/* La ROM libre de las pruebas (ver test-rom.LICENSE.txt), reconocida por su
   huella: una demo del cable que pinta dos colores y no guarda partida. Solo
   con ella se relaja la comprobacion de imagen y se salta la de savedata; con
   cualquier otra ROM las dos siguen siendo obligatorias. */
const ROM_LIBRE = fs.existsSync(ROM_PATH) &&
	require("crypto").createHash("sha256").update(fs.readFileSync(ROM_PATH)).digest("hex") ===
		"305cbd56bf77ebe1597be5dafa5fd3617e0bf19b81b85ac56e98048133e342df";

/* --- stubs de navegador ---------------------------------------------------
 * Solo lo que el runtime toca. El canvas es de verdad en lo que importa: se le
 * pide createImageData y se le escribe el framebuffer, asi que un puntero mal
 * leido revienta aqui igual que en Chrome. */
global.window = global;
global.document = { createElement: () => ({}), head: { appendChild() {} } };
global.performance = performance;
global.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 1);
global.cancelAnimationFrame = (handle) => clearTimeout(handle);
/* El runtime trae mgba.js con fetch, para evaluarlo en su propio ambito. En el
   navegador eso es una URL; aqui es una ruta de disco, y el fetch de node no
   lee ficheros: fallaba con "fetch failed" antes de abrir una sola consola.
   Se le da un fetch que sirve del disco lo que exista en disco. */
/* Y evaluado asi, el glue de mgba.js no ve el require del modulo, que es con
   lo que carga el .wasm en node. */
global.require = require;
global.__dirname = DIST;
global.__filename = path.join(DIST, "mgba.js");
const fetchDeRed = global.fetch;
global.fetch = async (url, init) => {
	const ruta = String(url);
	if (fs.existsSync(ruta)) {
		const datos = fs.readFileSync(ruta);
		return {
			ok: true,
			status: 200,
			text: async () => datos.toString("utf8"),
			arrayBuffer: async () => datos.buffer.slice(datos.byteOffset, datos.byteOffset + datos.byteLength)
		};
	}
	return fetchDeRed(url, init);
};

let blits = 0;
let lastColours = 0;
/* Contar volcados no vale: con el empaquetado a RGBA fuera del camino del
   cable, putImageData se llamaba igual y la pantalla salia negra. Lo que hay
   que mirar es el contenido. */
function distinctColours(data) {
	const seen = new Set();
	for (let i = 0; i < data.length; i += 4) {
		seen.add(data[i] | (data[i + 1] << 8) | (data[i + 2] << 16));
		if (seen.size > 64) break;
	}
	return seen.size;
}
function makeCanvas() {
	return {
		width: 0,
		height: 0,
		getContext: () => ({
			createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
			putImageData: (image) => { ++blits; lastColours = distinctColours(image.data); }
		})
	};
}

(async () => {
	if (!fs.existsSync(path.join(DIST, "mgba.js"))) {
		console.error(`::error::falta ${DIST}/mgba.js — compila la fase multi primero`);
		process.exit(1);
	}
	if (!fs.existsSync(ROM_PATH)) {
		console.error(`::error::no existe la ROM ${ROM_PATH}`);
		process.exit(1);
	}

	/* loadClassicScript vuelve enseguida si el global ya existe, asi que no hace
	   falta simular la carga por <script>. */
	global.createMgbaModule = require(path.join(DIST, "mgba.js"));
	require(path.join(PROJECT_DIR, "runtime", "ml3d-mgba-link.js"));
	check("el runtime se registra en window", typeof window.ML3DMgbaLink === "function");

	const rom = new Uint8Array(fs.readFileSync(ROM_PATH));
	console.log(`ROM: ${path.basename(ROM_PATH)} (${mib(rom.length)})\n`);

	for (const seats of [2, 3, 4]) {
		console.log(`=== ${seats} consolas ===`);
		blits = 0;
		const canvas = makeCanvas();
		const runtime = await window.ML3DMgbaLink.create({
			wasmDir: DIST + path.sep, rom, seats, canvas, logLevel: 1
		});

		check("abre todas las consolas", runtime.seats.length === seats, runtime.seats.length + "");
		check("el cable las engancha todas",
			runtime.status().attached === seats, `${runtime.status().attached} de ${seats}`);
		check("los asientos salen consecutivos desde 0",
			runtime.seats.every((s, i) => s.seat === i),
			runtime.seats.map((s) => s.seat).join(", "));

		const heapLinked = runtime.status().heap;
		info("heap con el cable puesto", mib(heapLinked));

		/* Avance: se llama al bucle por dentro para no depender del rAF. */
		const before = runtime.status().seats.map((s) => s.frames);
		const started = performance.now();
		for (let f = 0; f < 600; ++f) { runtime.advanceFrame(); runtime.blit(); }
		const elapsed = (performance.now() - started) / 1000;
		const after = runtime.status().seats.map((s) => s.frames);
		const delta = after.map((f, i) => f - before[i]);

		info("frames por consola en 600 vueltas", delta.join(" / "));
		info("velocidad del conjunto", (600 / elapsed).toFixed(1) + " frames/s de reloj real");
		/* Un umbral de verdad, no "mas de cero": con el planificador roto salia
		   2 / 0 y la comprobacion de desviacion lo daba por bueno porque 2 y 0
		   se parecen. Cada consola tiene que hacer casi los 600 frames. */
		check("todas las consolas avanzan, visible y ocultas",
			delta.every((d) => d >= 540), delta.join(" / ") + " de 600");
		check("ninguna consola se queda atras",
			Math.max(...delta) - Math.min(...delta) <= 4,
			"desviacion " + (Math.max(...delta) - Math.min(...delta)) + " frames");
		check("la consola visible se pinta con imagen de verdad",
			blits > 0 && lastColours > (ROM_LIBRE ? 1 : 4),
			`${blits} volcados, ${lastColours} colores distintos en el ultimo`);
		info("colores distintos en el framebuffer", lastColours);

		/* Input: solo a la visible, y tiene que llegar solo a ella. */
		runtime.press(0, "START", true);
		check("el input entra en la consola a la que se dirige",
			runtime.seats[0].mask === (1 << window.ML3DMgbaLink.KEY.START),
			"mascara 0x" + runtime.seats[0].mask.toString(16));
		check("el input no toca a las demas",
			runtime.seats.slice(1).every((s) => s.mask === 0));
		runtime.press(0, "START", false);

		/* Cambiar de visible no puede reiniciar ni parar a nadie. */
		const beforeSwitch = runtime.status().seats.map((s) => s.frames);
		runtime.setVisible(1);
		for (let f = 0; f < 60; ++f) { runtime.advanceFrame(); runtime.blit(); }
		const afterSwitch = runtime.status().seats.map((s) => s.frames);
		check("cambiar de consola visible no reinicia ninguna",
			afterSwitch.every((f, i) => f >= beforeSwitch[i]),
			beforeSwitch.join("/") + " → " + afterSwitch.join("/"));
		check("cambiar de consola visible sigue pintando",
			runtime.visible === 1 && blits > 0);

		/* Savedata por instancia, aunque la ROM sea una sola copia. */
		const dumps = runtime.seats.map((_, i) => runtime.sram(i));
		if (ROM_LIBRE) {
			info("cada consola tiene su savedata", "omitida, la ROM libre no guarda partida");
		} else {
			check("cada consola tiene su savedata",
				dumps.every((d) => d && d.length > 0),
				dumps.map((d) => (d ? d.length : 0)).join(" / ") + " bytes");
		}
		if (dumps[0]) {
			check("la savedata se puede volver a cargar", runtime.loadSram(0, dumps[0]));
		}

		/* Estabilidad de memoria con el cable corriendo. */
		const heapMid = runtime.status().heap;
		for (let f = 0; f < 600; ++f) runtime.advanceFrame();
		const heapEnd = runtime.status().heap;
		info("heap antes / despues de 600 frames mas", mib(heapMid) + " / " + mib(heapEnd));
		check("el heap no crece mientras corre",
			Math.abs(heapEnd - heapMid) < 65536, "delta " + (heapEnd - heapMid) + " bytes");

		/* El bucle real de rAF, aunque sea un momento, para tocar tick(). */
		runtime.start();
		await new Promise((resolve) => setTimeout(resolve, 300));
		const running = runtime.running;
		runtime.stop();
		check("el bucle de rAF arranca y para", running && !runtime.running);

		/* Detach y cierre. */
		runtime.detachAll();
		check("soltar el cable vacia el coordinador",
			runtime.status().attached === 0, runtime.status().attached + " enganchadas");
		const beforeFree = runtime.status().seats.map((s) => s.frames);
		for (let f = 0; f < 60; ++f) runtime.advanceFrame();
		check("las consolas siguen corriendo sin cable",
			runtime.status().seats.every((s, i) => s.frames > beforeFree[i]));

		runtime.destroy();
		check("cerrar todo deja el modulo vacio", runtime.seats.length === 0);
		console.log();
	}

	console.log();
	if (measured.length) {
		console.log(`::notice title=Runtime::` + measured.join(" · "));
	}
	if (failed.length) {
		console.error(`::error::runtime-check: ${failed.length} fallo(s) — ${failed.join(" | ")}`);
		process.exit(1);
	}
	console.log("runtime-check: OK");
})().catch((error) => {
	console.error("::error::" + (error && error.stack ? error.stack : error));
	process.exit(1);
});
