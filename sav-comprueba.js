/* Comprobación de un archivo de partida (.sav) de GBA, solo lectura.

   Todo se hace aquí, en el navegador: el archivo no se envía a ningún sitio.

   Entiende las partidas de Pokémon de tercera generación (Rubí, Zafiro,
   Esmeralda, Rojo Fuego, Verde Hoja): dos huecos de 14 secciones de 4 KB,
   cada sección con su firma y su suma de control. De cualquier otro juego
   solo puede mirar el tamaño y si está vacío.

   VERIFICADO CON UNA PARTIDA REAL DE ROJO FUEGO (firmas, sumas, orden de las
   secciones, nombre, tiempo, Pokédex y equipo, contrastados con lo que
   enseña el propio juego). El resto de juegos está escrito a partir de la
   documentación pública del formato y sigue sin verificar: el informe lo dice.

   Un informe «válido» no garantiza que no haya Pokémon modificados: un
   editor deja las sumas de control correctas. */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica();
  else raiz.ML3DSavComprueba = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SECTOR = 4096, FIRMA = 0x08012025, POR_HUECO = 14;
  const TAM_NORMAL = 131072, RELOJ = 16;
  /* Bytes de cada sección que entran en su suma, según la familia. */
  const largos = (cero, cuatro) => [cero, 0xF80, 0xF80, 0xF80, cuatro, 0xF80, 0xF80, 0xF80, 0xF80, 0xF80, 0xF80, 0xF80, 0xF80, 0x7D0];
  const FAMILIAS = {
    rs: { nombre: "Rubí / Zafiro", largos: largos(0x890, 0xC40), equipo: 0x234, claves: ["rubi", "rubí", "ruby", "zafiro", "sapphire"] },
    e: { nombre: "Esmeralda", largos: largos(0xF2C, 0xF08), equipo: 0x234, claves: ["esmeralda", "emerald"] },
    frlg: { nombre: "Rojo Fuego / Verde Hoja", largos: largos(0xF24, 0xEE8), equipo: 0x34, claves: ["rojo fuego", "rojofuego", "firered", "fire red", "verde hoja", "verdehoja", "leafgreen", "leaf green", "pokemonrf", "pokemon rf"] }
  };
  /* Código de cabecera del cartucho (tres letras) → familia. */
  const CODIGOS = { AXV: "rs", AXP: "rs", BPE: "e", BPR: "frlg", BPG: "frlg" };
  const ORIGEN = { 1: "Zafiro", 2: "Rubí", 3: "Esmeralda", 4: "Rojo Fuego", 5: "Verde Hoja", 15: "Colosseum / XD" };
  const ORDEN = ["GAEM", "GAME", "GEAM", "GEMA", "GMAE", "GMEA", "AGEM", "AGME", "AEGM", "AEMG", "AMGE", "AMEG", "EGAM", "EGMA", "EAGM", "EAMG", "EMGA", "EMAG", "MGAE", "MGEA", "MAGE", "MAEG", "MEGA", "MEAG"];
  /* Número interno 277–411 → número de la Pokédex nacional (252–386). Solo números. */
  const HOENN = [252, 253, 254, 255, 256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 266, 267, 268, 269, 270, 271, 272, 273, 274, 275, 290, 291, 292, 276, 277, 285, 286, 327, 278, 279, 283, 284, 320, 321, 300, 301, 352, 343, 344, 299, 324, 302, 339, 340, 370, 341, 342, 349, 350, 318, 319, 328, 329, 330, 296, 297, 309, 310, 322, 323, 363, 364, 365, 331, 332, 361, 362, 337, 338, 298, 325, 326, 311, 312, 303, 307, 308, 333, 334, 360, 355, 356, 315, 287, 288, 289, 316, 317, 357, 293, 294, 295, 366, 367, 368, 359, 353, 354, 336, 335, 369, 304, 305, 306, 351, 313, 314, 345, 346, 347, 348, 280, 281, 282, 371, 372, 373, 374, 375, 376, 377, 378, 379, 382, 383, 384, 380, 381, 385, 386, 358];
  const pokedex = (interno) => (interno >= 1 && interno <= 251 ? interno : interno >= 277 && interno <= 411 ? HOENN[interno - 277] : 0);

  /* Letras del juego (versiones occidentales). */
  const LETRAS = (() => {
    const t = { 0x00: " ", 0xAB: "!", 0xAC: "?", 0xAD: ".", 0xAE: "-", 0xB0: "…", 0xB1: "“", 0xB2: "”", 0xB3: "‘", 0xB4: "’", 0xB5: "♂", 0xB6: "♀", 0xB8: ",", 0xBA: "/", 0xF0: ":" };
    "ÀÁÂÇÈÉÊËÌ".split("").forEach((c, i) => (t[0x01 + i] = c));
    "ÎÏÒÓÔŒÙÚÛÑßàá".split("").forEach((c, i) => (t[0x0B + i] = c));
    "çèéêëì".split("").forEach((c, i) => (t[0x19 + i] = c));
    "îïòóôœùúûñºª".split("").forEach((c, i) => (t[0x20 + i] = c));
    for (let i = 0; i < 10; i++) t[0xA1 + i] = String(i);
    for (let i = 0; i < 26; i++) { t[0xBB + i] = String.fromCharCode(65 + i); t[0xD5 + i] = String.fromCharCode(97 + i); }
    return t;
  })();
  function texto(bytes, desde, largo) {
    let s = "";
    for (let i = 0; i < largo; i++) { const b = bytes[desde + i]; if (b === 0xFF) break; s += LETRAS[b] ?? "?"; }
    return s.trim();
  }

  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  function suma(b, desde, largo) {
    let s = 0;
    for (let i = 0; i < largo; i += 4) s = (s + u32(b, desde + i)) >>> 0;
    return ((s >>> 16) + (s & 0xFFFF)) & 0xFFFF;
  }
  const vacio = (b) => { for (let i = 0; i < b.length; i++) if (b[i] !== 0x00 && b[i] !== 0xFF) return false; return true; };
  const unos = (b, desde, largo) => { let n = 0; for (let i = 0; i < largo; i++) for (let v = b[desde + i]; v; v &= v - 1) n++; return n; };

  /* Un hueco: los 14 sectores que empiezan en `primero`. */
  function leeHueco(b, primero) {
    const sectores = [];
    for (let i = 0; i < POR_HUECO; i++) {
      const o = (primero + i) * SECTOR;
      if (o + SECTOR > b.length) { sectores.push({ falta: true }); continue; }
      sectores.push({ o, id: u16(b, o + 0xFF4), guardada: u16(b, o + 0xFF6), firma: u32(b, o + 0xFF8) === FIRMA, contador: u32(b, o + 0xFFC), blanco: vacio(b.subarray(o, o + SECTOR)) });
    }
    const presentes = sectores.filter((s) => !s.falta);
    const firmados = presentes.filter((s) => s.firma && s.id < POR_HUECO);
    /* Qué familia hace cuadrar más sumas. Una partida de Rubí/Zafiro cuadra
       también con los tamaños de las otras (lo que sobra son ceros), así que
       en caso de empate manda lo que dice la ficha del entrenador: 0 en
       Rubí/Zafiro, 1 en Rojo Fuego/Verde Hoja y otro valor en Esmeralda. */
    const ficha = firmados.find((s) => s.id === 0);
    const segunFicha = ficha ? (u32(b, ficha.o + 0xAC) === 0 ? "rs" : u32(b, ficha.o + 0xAC) === 1 ? "frlg" : "e") : "";
    let mejor = null;
    for (const [clave, f] of Object.entries(FAMILIAS)) {
      const bien = firmados.filter((s) => suma(b, s.o, f.largos[s.id]) === s.guardada).length;
      if (!mejor || bien > mejor.bien || (bien === mejor.bien && clave === segunFicha)) mejor = { clave, bien };
    }
    const porId = new Map();
    for (const s of firmados) if (!porId.has(s.id)) porId.set(s.id, s);
    const f = mejor ? FAMILIAS[mejor.clave] : null;
    const malas = f ? firmados.filter((s) => suma(b, s.o, f.largos[s.id]) !== s.guardada).map((s) => s.id) : [];
    const contador = firmados.length ? Math.max(...firmados.map((s) => s.contador)) : 0;
    return {
      primero, presentes: presentes.length, firmados: firmados.length, distintas: porId.size, enBlanco: presentes.filter((s) => s.blanco).length,
      sumasBien: mejor ? mejor.bien : 0, sumasMal: malas, familia: mejor && mejor.bien ? mejor.clave : "", contador,
      faltan: [...Array(POR_HUECO).keys()].filter((id) => !porId.has(id)),
      completo: presentes.length === POR_HUECO && porId.size === POR_HUECO && malas.length === 0, porId
    };
  }

  function leePokemon(b, o) {
    const pid = u32(b, o), ot = u32(b, o + 4);
    if (!pid && !ot) return null;
    const clave = (pid ^ ot) >>> 0, orden = ORDEN[pid % 24];
    const claro = new Uint8Array(48);
    for (let i = 0; i < 48; i += 4) { const w = (u32(b, o + 32 + i) ^ clave) >>> 0; claro[i] = w & 255; claro[i + 1] = (w >>> 8) & 255; claro[i + 2] = (w >>> 16) & 255; claro[i + 3] = w >>> 24; }
    let s = 0; for (let i = 0; i < 48; i += 2) s = (s + u16(claro, i)) & 0xFFFF;
    const g = orden.indexOf("G") * 12, m = orden.indexOf("M") * 12;
    const interno = u16(claro, g);
    return { mote: texto(b, o + 8, 10), nivel: b[o + 84], pokedex: pokedex(interno), interno, sumaBien: s === u16(b, o + 28), huevo: Boolean((u32(claro, m + 4) >>> 30) & 1), origen: ORIGEN[(u16(claro, m + 2) >> 7) & 15] || "" };
  }

  function leeDatos(b, hueco, familia) {
    const f = FAMILIAS[familia];
    const s0 = hueco.porId.get(0), s1 = hueco.porId.get(1);
    const d = {};
    if (s0) {
      const o = s0.o;
      d.entrenador = texto(b, o, 7);
      d.sexo = b[o + 8] === 0 ? "chico" : b[o + 8] === 1 ? "chica" : "";
      d.id = String(u16(b, o + 0x0A)).padStart(5, "0");
      d.tiempo = { horas: u16(b, o + 0x0E), minutos: b[o + 0x10], segundos: b[o + 0x11] };
      d.pokedex = { capturados: unos(b, o + 0x28, 49), vistos: unos(b, o + 0x5C, 49) };
      d.codigoJuego = u32(b, o + 0xAC);
    }
    if (s1 && f) {
      const n = u32(b, s1.o + f.equipo);
      d.equipo = [];
      if (n <= 6) for (let i = 0; i < n; i++) { const p = leePokemon(b, s1.o + f.equipo + 4 + i * 100); if (p) d.equipo.push(p); }
      else d.equipoRaro = n;
    }
    return d;
  }

  /**
   * @param {Uint8Array} bytes  el archivo, tal cual
   * @param {{juegos?: {nombre: string, codigo?: string}[]}} opciones  juegos de GBA de la biblioteca
   */
  function comprueba(bytes, opciones = {}) {
    const avisos = [], graves = [];
    const inf = { tamano: bytes.length, verificado: "Rojo Fuego", pokemon: false, familia: "", familiaNombre: "", datos: null, juegos: [], avisos, graves,
      nota: "Un informe válido no garantiza que no haya Pokémon modificados.", formato: "Verificado con una partida real de Rojo Fuego; el resto de juegos sin verificar." };
    let b = bytes;
    inf.vacio = !b.length || vacio(b);
    if (inf.vacio) { graves.push("El archivo está vacío: todo son ceros o FF."); return cierra(inf); }

    if (b.length === TAM_NORMAL + RELOJ) { inf.recorta = RELOJ; b = b.subarray(0, TAM_NORMAL); avisos.push("Lleva 16 bytes de reloj al final (131 088 bytes). Se recortan al importar."); }
    inf.tamanoTexto = b.length === TAM_NORMAL ? "128 KB, el normal de Pokémon de GBA" : b.length % 1024 ? `${bytes.length} bytes` : `${b.length / 1024} KB`;

    /* ¿Tiene secciones de Pokémon? */
    const total = Math.floor(b.length / SECTOR);
    let firmas = 0;
    for (let i = 0; i < total; i++) if (u32(b, i * SECTOR + 0xFF8) === FIRMA) firmas++;
    if (!firmas) {
      inf.otro = true;
      if (![512, 8192, 32768, 65536, TAM_NORMAL].includes(b.length)) graves.push(`Tamaño raro para una partida de GBA (${bytes.length} bytes).`);
      else avisos.push("No es una partida de Pokémon de GBA, o no se reconoce. Solo se ha podido mirar el tamaño y que no está vacía.");
      return cierra(inf);
    }
    inf.pokemon = true;
    const huecos = [leeHueco(b, 0), leeHueco(b, POR_HUECO)];
    inf.huecos = huecos.map((h, i) => ({ hueco: i + 1, presentes: h.presentes, firmados: h.firmados, sumasBien: h.sumasBien, sumasMal: h.sumasMal, faltan: h.faltan, contador: h.contador, completo: h.completo, enBlanco: h.enBlanco }));

    if (b.length !== TAM_NORMAL) {
      const k = b.length / 1024;
      graves.push(`Pesa ${Number.isInteger(k) ? k + " KB" : bytes.length + " bytes"} y una partida de Pokémon de GBA pesa 128 KB: ` +
        (b.length < TAM_NORMAL ? `faltan ${Math.round((TAM_NORMAL - b.length) / 1024)} KB. El segundo hueco de guardado tiene ${huecos[1].presentes} de sus 14 secciones.` : "sobran datos."));
    }
    /* El juego carga el hueco completo de contador más alto. */
    const buenos = huecos.filter((h) => h.completo).sort((x, y) => y.contador - x.contador);
    const reciente = huecos.slice().sort((x, y) => y.contador - x.contador)[0];
    const usa = buenos[0] || null;
    inf.huecoQueCarga = usa ? huecos.indexOf(usa) + 1 : 0;
    const lectura = usa || huecos.slice().sort((x, y) => y.sumasBien - x.sumasBien)[0];
    inf.familia = lectura.familia; inf.familiaNombre = lectura.familia ? FAMILIAS[lectura.familia].nombre : "";
    if (!usa) graves.push("Ningún hueco de guardado está completo y con las sumas correctas: el juego diría que la partida está dañada.");
    else if (usa !== reciente) avisos.push(`El guardado más reciente (hueco ${huecos.indexOf(reciente) + 1}) está incompleto o dañado. El juego cargaría el anterior (hueco ${inf.huecoQueCarga}) y avisaría de ello.`);
    else if (!buenos[1] && huecos.some((h) => h !== usa && h.firmados)) avisos.push("El guardado anterior, que el juego usa de reserva, está incompleto o dañado. El actual está bien.");

    if (lectura.familia) {
      inf.datos = leeDatos(b, lectura, lectura.familia);
      inf.datosDeHueco = huecos.indexOf(lectura) + 1;
      const d = inf.datos;
      /* La ficha del entrenador guarda 0 en Rubí/Zafiro y 1 en Rojo Fuego/Verde Hoja. */
      if (d.codigoJuego !== undefined) {
        const segunCodigo = d.codigoJuego === 0 ? "rs" : d.codigoJuego === 1 ? "frlg" : "e";
        if (segunCodigo !== lectura.familia) avisos.push(`Las sumas de control son de ${FAMILIAS[lectura.familia].nombre}, pero la ficha del entrenador apunta a ${FAMILIAS[segunCodigo].nombre}.`);
      }
      for (const p of d.equipo || []) if (!p.sumaBien) avisos.push(`Un Pokémon del equipo (${p.mote || "sin mote"}) tiene mal su suma de control: en el juego saldría como «huevo malo».`);
      if (d.equipoRaro !== undefined) avisos.push(`El equipo dice tener ${d.equipoRaro} Pokémon, que no es posible.`);
      /* Qué versión dentro de la familia: solo una pista. */
      const origenes = (d.equipo || []).map((p) => p.origen).filter(Boolean);
      const deLaFamilia = origenes.filter((o) => FAMILIAS[lectura.familia].nombre.includes(o));
      if (lectura.familia !== "e" && deLaFamilia.length) inf.versionProbable = deLaFamilia.sort((x, y) => deLaFamilia.filter((v) => v === y).length - deLaFamilia.filter((v) => v === x).length)[0];
    }
    /* Juegos de la biblioteca que encajan. */
    if (inf.familia) for (const j of opciones.juegos || []) {
      const codigo = String(j.codigo || "").slice(0, 3).toUpperCase();
      const nombre = String(j.nombre || "").toLowerCase();
      if (codigo && CODIGOS[codigo]) { if (CODIGOS[codigo] === inf.familia) inf.juegos.push({ nombre: j.nombre, por: "código del cartucho" }); }
      else if (FAMILIAS[inf.familia].claves.some((c) => nombre.includes(c))) inf.juegos.push({ nombre: j.nombre, por: "el nombre" });
    }
    return cierra(inf);
  }

  function cierra(inf) {
    inf.veredicto = inf.graves.length ? "no importar" : inf.avisos.length ? "válido con avisos" : "válido";
    delete inf.huecoQueCargaInterno;
    return inf;
  }

  /** Comprobación rápida, la mínima antes de importar: tamaño y vacío. */
  function rapida(bytes) {
    if (!bytes?.length || vacio(bytes)) return { ok: false, motivo: "El archivo está vacío." };
    const n = bytes.length === TAM_NORMAL + RELOJ ? TAM_NORMAL : bytes.length;
    if (![512, 8192, 32768, 65536, TAM_NORMAL].includes(n)) return { ok: false, motivo: `Tamaño raro para una partida de GBA (${bytes.length} bytes).` };
    return { ok: true, bytes: n === bytes.length ? bytes : bytes.subarray(0, n), recortado: n !== bytes.length };
  }

  return { comprueba, rapida, FAMILIAS, CODIGOS, TAM_NORMAL };
});
