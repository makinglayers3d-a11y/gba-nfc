(() => {
  "use strict";

  /* Personajes del lobby.

     Único sistema de avatares: el kit de personajes por capas de
     ./personajes/ (compositor.js + assets). Este fichero no dibuja capas: se
     lo pide al compositor, que se usa tal cual llega con el kit. Para
     actualizar prendas y peinados basta con sustituir esa carpeta; las
     opciones de la pantalla de personalizar salen de su manifest.json.

     - Por la red viaja solo el aspecto, un JSON pequeño. Nunca imágenes. Lo
       lleva rooms.js dentro del perfil del jugador; aquí no hay código de red.
     - Lo que llega se valida entero contra el manifest: identificadores
       conocidos, colores "#rrggbb" y tamaño máximo. Si algo no vale, ese
       jugador se ve con el personaje por defecto.
     - Solo opciones del kit. No se pueden subir imágenes.
     - En el lobby siempre se lleva parte de arriba y de abajo. */

  const BASE = "./personajes/";
  const VERSION = "1";
  const MAX_JSON = 1024;
  const CELDA_W = 64;
  const CELDA_H = 96;
  const MS_ANDAR = 85;
  const MS_SIGUE_ANDANDO = 210;
  const MAX_CACHE = 12;
  const FILA = { abajo: 0, izquierda: 1, derecha: 2, arriba: 3 };
  /* Opciones del kit que el lobby no ofrece ni acepta. */
  const VETADAS = { arriba: ["nada"], abajo: ["nada"] };
  const CLAVES = new Set(["version", "cuerpo", "frames", "peinado", "arriba", "abajo", "calzado", "complementos", "sinMechas", "colores"]);
  const CLAVES_COMPLEMENTOS = new Set(["cabeza", "gafas", "auriculares", "cinta"]);
  const NOMBRE_COLOR = {
    piel: "Piel", iris: "Ojos", pelo: "Pelo", mechas: "Mechas", prendaSuperior: "Parte de arriba", cuello: "Cuello",
    camisetaInterior: "Camiseta interior", detalles: "Detalles", prendaInferior: "Parte de abajo", calzado: "Calzado",
    suela: "Suela", ropaInterior: "Ropa interior", sombrero: "Sombrero", gafas: "Gafas", auriculares: "Auriculares", cinta: "Cinta"
  };

  let comp = null;
  let M = null;
  let DEFECTO = null;
  const tiene = (obj, clave) => Object.prototype.hasOwnProperty.call(obj, clave);
  const $ = (s, root = document) => root.querySelector(s);

  /* ---------- validación ---------- */

  /**
   * Devuelve el aspecto en forma canónica, o null si algo no es válido.
   * No deja pasar nada que no esté en el manifest: el objeto se reconstruye
   * campo a campo, no se copia.
   */
  function valida(valor) {
    if (!M || !valor || typeof valor !== "object" || Array.isArray(valor)) return null;
    let texto;
    try { texto = JSON.stringify(valor); } catch { return null; }
    if (typeof texto !== "string" || texto.length > MAX_JSON) return null;
    for (const clave of Object.keys(valor)) if (!CLAVES.has(clave)) return null;
    if (valor.version !== undefined && valor.version !== 1) return null;
    /* "frames" es del kit (qué hoja componer), no del aspecto: se admite si
       es uno de los dos valores del kit y no se conserva. */
    if (valor.frames !== undefined && valor.frames !== 4 && valor.frames !== 8) return null;

    const opcion = (campo, grupo = campo) => {
      const v = valor[campo];
      if (v === undefined) return DEFECTO[campo];
      if (typeof v !== "string" || !tiene(M.opciones[grupo], v) || (VETADAS[campo] || []).includes(v)) return undefined;
      return v;
    };
    const salida = { version: 1 };

    if (valor.cuerpo === undefined) salida.cuerpo = DEFECTO.cuerpo;
    else if (typeof valor.cuerpo === "string" && tiene(M.cuerpos, valor.cuerpo)) salida.cuerpo = valor.cuerpo;
    else return null;

    for (const campo of ["peinado", "arriba", "abajo", "calzado"]) {
      const v = opcion(campo);
      if (v === undefined) return null;
      salida[campo] = v;
    }

    const c = valor.complementos === undefined ? {} : valor.complementos;
    if (!c || typeof c !== "object" || Array.isArray(c)) return null;
    for (const clave of Object.keys(c)) if (!CLAVES_COMPLEMENTOS.has(clave)) return null;
    const cabeza = c.cabeza === undefined ? "nada" : c.cabeza;
    const gafas = c.gafas === undefined ? "nada" : c.gafas;
    if (typeof cabeza !== "string" || !tiene(M.opciones.cabeza, cabeza)) return null;
    if (typeof gafas !== "string" || !tiene(M.opciones.gafas, gafas)) return null;
    for (const clave of ["auriculares", "cinta"]) if (c[clave] !== undefined && typeof c[clave] !== "boolean") return null;
    salida.complementos = { cabeza, gafas, auriculares: c.auriculares === true, cinta: c.cinta === true };

    if (valor.sinMechas !== undefined && typeof valor.sinMechas !== "boolean") return null;
    salida.sinMechas = valor.sinMechas === true;

    const colores = valor.colores === undefined ? {} : valor.colores;
    if (!colores || typeof colores !== "object" || Array.isArray(colores)) return null;
    salida.colores = {};
    for (const [clave, color] of Object.entries(colores)) {
      if (!tiene(M.colores, clave) || typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) return null;
      salida.colores[clave] = color.toLowerCase();
    }
    return salida;
  }

  /* ---------- hojas: una por aspecto, compuestas de una en una ---------- */

  const hojas = new Map();    /* JSON canónico -> { reposo, andar } o promesa */
  let cola = Promise.resolve();

  function compone(clave, aspecto) {
    if (hojas.has(clave)) return;
    const entrada = { lista: false, reposo: null, andar: null };
    hojas.set(clave, entrada);
    /* Una composición detrás de otra: varias a la vez en el mismo frame se
       notan, sobre todo en un móvil. */
    cola = cola.then(async () => {
      try {
        entrada.reposo = await comp.componer({ ...aspecto, frames: 4 });
        entrada.andar = await comp.componer({ ...aspecto, frames: 8 });
        entrada.lista = true;
      } catch (error) {
        console.error("ML3D personajes:", error);
        hojas.delete(clave);
      }
    });
    /* Que la caché no crezca sin fin: fuera las más antiguas. */
    if (hojas.size > MAX_CACHE) {
      for (const vieja of hojas.keys()) {
        if (vieja === CLAVE_DEFECTO || vieja === clave) continue;
        hojas.delete(vieja);
        if (hojas.size <= MAX_CACHE) break;
      }
    }
  }

  let CLAVE_DEFECTO = "";

  /* Del texto que rooms.js deja en el jugador a su hoja. Lo que no valga se
     ve con el personaje por defecto. */
  const claveDe = new Map();   /* texto recibido -> JSON canónico */
  function hojaPara(texto) {
    let clave = claveDe.get(texto);
    if (clave === undefined) {
      let aspecto = null;
      if (texto) { try { aspecto = valida(JSON.parse(texto)); } catch { aspecto = null; } }
      clave = aspecto ? JSON.stringify(aspecto) : CLAVE_DEFECTO;
      if (claveDe.size > 64) claveDe.clear();
      claveDe.set(texto, clave);
      if (aspecto) compone(clave, aspecto);
    }
    const entrada = hojas.get(clave);
    if (entrada?.lista) return entrada;
    if (!entrada && clave !== CLAVE_DEFECTO) claveDe.delete(texto);   /* falló: se reintenta */
    return hojas.get(CLAVE_DEFECTO);   /* mientras se compone, el de por defecto */
  }

  /* ---------- pintar a los jugadores ---------- */

  const estado = new Map();   /* id -> { x, y, dir, ultimoMov, andando, inicio } */

  function lienzoDe(el) {
    let host = null;
    for (const hijo of el.children) if (hijo.classList?.contains("personaje-host")) { host = hijo; break; }
    if (!host) {
      host = document.createElement("div");
      host.className = "personaje-host";
      host.setAttribute("aria-hidden", "true");
      const lienzo = document.createElement("canvas");
      lienzo.className = "personaje-lienzo";
      lienzo.width = CELDA_W;
      lienzo.height = CELDA_H;
      const sombra = document.createElement("div");
      sombra.className = "personaje-sombra";
      host.append(sombra, lienzo);
      el.append(host);
    }
    return host.lastChild;
  }

  function pintaJugador(el, ahora) {
    const id = el.dataset.playerId || "";
    const lienzo = lienzoDe(el);
    const pos = { x: Number.parseFloat(el.style.left) || 0, y: Number.parseFloat(el.style.top) || 0 };
    const antes = estado.get(id) || { ...pos, dir: "abajo", ultimoMov: -Infinity, andando: false, inicio: 0 };
    const dx = pos.x - antes.x, dy = pos.y - antes.y;
    const movido = Math.abs(dx) > 0.02 || Math.abs(dy) > 0.02;
    let dir = antes.dir;
    if (movido) dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "izquierda" : "derecha") : (dy < 0 ? "arriba" : "abajo");
    const ultimoMov = movido ? ahora : antes.ultimoMov;
    const andando = movido || el.classList.contains("is-moving") || ahora - ultimoMov <= MS_SIGUE_ANDANDO;
    const inicio = andando ? (antes.andando ? antes.inicio : ahora) : 0;
    estado.set(id, { ...pos, dir, ultimoMov, andando, inicio });

    const hoja = hojaPara(el.dataset.aspecto || "");
    if (!hoja?.lista) return;
    const columna = andando ? Math.floor((ahora - inicio) / MS_ANDAR) % 8 : 0;
    const firma = (andando ? "a" : "r") + columna + dir + (hoja === hojas.get(CLAVE_DEFECTO) ? "d" : el.dataset.aspecto);
    if (lienzo.dataset.firma === firma) return;
    lienzo.dataset.firma = firma;
    const ctx = lienzo.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, CELDA_W, CELDA_H);
    ctx.drawImage(andando ? hoja.andar : hoja.reposo, columna * CELDA_W, FILA[dir] * CELDA_H, CELDA_W, CELDA_H, 0, 0, CELDA_W, CELDA_H);
  }

  function pintaTodos(ahora) {
    const vivos = new Set();
    for (const el of document.querySelectorAll("#playersLayer .player")) {
      vivos.add(el.dataset.playerId || "");
      pintaJugador(el, ahora);
    }
    for (const id of [...estado.keys()]) if (!vivos.has(id)) estado.delete(id);
    if (editor.abierto) pintaVistaPrevia(ahora);
    pintaRetratos();
    requestAnimationFrame(pintaTodos);
  }

  /* ---------- pantalla de personalizar ---------- */

  /* Arriba, la vista previa y las pestañas (Cuerpo, Peinado, Ropa,
     Accesorios); solo se ve una. Dentro, cada apartado es una tira horizontal
     de cuadros, uno por opción, con el personaje actual llevando esa opción.
     Debajo de cada tira, sus colores. */

  const editor = { abierto: false, aspecto: null, hoja: null, pendiente: "", montado: false, vuelta: 0, cuadros: [], colores: [], pestana: "cuerpo", cursor: { f: 1, c: 0 } };

  const PESTANAS = [["cuerpo", "Cuerpo"], ["peinado", "Peinado"], ["ropa", "Ropa"], ["accesorios", "Accesorios"]];

  /* Qué trozo de la celda (64x96, mirando al frente) enseña cada cuadro:
     x, y, ancho, alto y aumento. */
  const RECORTE = {
    entero: [0, 0, 64, 96, 1],
    cabeza: [0, 0, 64, 64, 1],
    torso: [0, 26, 64, 64, 1],
    piernas: [0, 32, 64, 64, 1],
    pies: [16, 64, 32, 32, 2]
  };

  /* capa: la del kit que pinta esa opción, para saber qué colores tiene.
     "" = nada que colorear; "*" = complemento, su color vale siempre. */
  const APARTADOS = [
    { id: "cuerpo", pestana: "cuerpo", titulo: "Cuerpo", recorte: "entero", colores: ["piel", "iris", "ropaInterior"],
      opciones: () => M.cuerpos, lee: (a) => a.cuerpo, pon: (a, v) => { a.cuerpo = v; }, capa: () => "base" },
    { id: "peinado", pestana: "peinado", titulo: "Peinado", recorte: "cabeza", colores: ["pelo", "mechas"], mechas: true,
      opciones: () => M.opciones.peinado, lee: (a) => a.peinado, pon: (a, v) => { a.peinado = v; }, capa: (v) => (v === "original" ? "base" : "hair_" + v) },
    { id: "arriba", pestana: "ropa", titulo: "Parte de arriba", recorte: "torso", colores: ["prendaSuperior", "cuello", "camisetaInterior", "detalles"],
      opciones: () => M.opciones.arriba, lee: (a) => a.arriba, pon: (a, v) => { a.arriba = v; }, capa: (v) => "top_" + v },
    { id: "abajo", pestana: "ropa", titulo: "Parte de abajo", recorte: "piernas", colores: ["prendaInferior", "detalles"],
      opciones: () => M.opciones.abajo, lee: (a) => a.abajo, pon: (a, v) => { a.abajo = v; }, capa: (v) => "bottom_" + v },
    { id: "calzado", pestana: "ropa", titulo: "Calzado", recorte: "pies", colores: ["calzado", "suela"],
      opciones: () => M.opciones.calzado, lee: (a) => a.calzado, pon: (a, v) => { a.calzado = v; }, capa: (v) => (v === "nada" ? "" : "shoes_" + v) },
    { id: "cabeza", pestana: "accesorios", titulo: "Sombrero", recorte: "cabeza", colores: ["sombrero"],
      opciones: () => M.opciones.cabeza, lee: (a) => a.complementos.cabeza, pon: (a, v) => { a.complementos.cabeza = v; }, capa: (v) => (v === "nada" ? "" : "*") },
    { id: "gafas", pestana: "accesorios", titulo: "Gafas", recorte: "cabeza", colores: ["gafas"],
      opciones: () => M.opciones.gafas, lee: (a) => a.complementos.gafas, pon: (a, v) => { a.complementos.gafas = v; }, capa: (v) => (v === "nada" ? "" : "*") },
    { id: "auriculares", pestana: "accesorios", titulo: "Auriculares", recorte: "cabeza", colores: ["auriculares"],
      opciones: () => ({ no: "Sin auriculares", si: "Con auriculares" }), lee: (a) => (a.complementos.auriculares ? "si" : "no"), pon: (a, v) => { a.complementos.auriculares = v === "si"; }, capa: (v) => (v === "si" ? "*" : "") },
    { id: "cinta", pestana: "accesorios", titulo: "Cinta", recorte: "cabeza", colores: ["cinta"],
      opciones: () => ({ no: "Sin cinta", si: "Con cinta" }), lee: (a) => (a.complementos.cinta ? "si" : "no"), pon: (a, v) => { a.complementos.cinta = v === "si"; }, capa: (v) => (v === "si" ? "*" : "") }
  ];

  /* ¿Tiene ese color algo que pintar con la opción elegida? Se mira en el
     manifest qué materiales lleva la capa. */
  function colorAplica(apartado, clave) {
    const capa = apartado.capa(apartado.lee(editor.aspecto));
    if (!capa) return false;
    if (capa === "*") return true;
    const material = M.colores[clave].material;
    const capas = M.capas["cuerpo" + editor.aspecto.cuerpo] || {};
    return Boolean(capas[capa]?.colores_base?.[material]);
  }

  function filaColor(clave) {
    const fila = document.createElement("div");
    fila.className = "personaje-color";
    fila.dataset.color = clave;
    const nombre = document.createElement("span");
    nombre.className = "personaje-color-nombre";
    nombre.textContent = NOMBRE_COLOR[clave] || clave;
    const muestras = document.createElement("div");
    muestras.className = "personaje-muestras personaje-fila";
    const sugeridos = M.colores[clave].sugeridos;
    /* Cualquier otro color. Es un color, no una imagen. */
    const libre = document.createElement("input");
    libre.type = "color";
    libre.className = "personaje-libre";
    libre.setAttribute("aria-label", `${NOMBRE_COLOR[clave] || clave}: otro color`);
    const original = document.createElement("button");
    const marca = () => {
      const actual = editor.aspecto.colores[clave] || "";
      libre.value = actual || sugeridos[0];
      for (const b of muestras.querySelectorAll(".personaje-muestra")) b.setAttribute("aria-pressed", String(b.dataset.valor === actual));
      original.setAttribute("aria-pressed", String(!actual));
    };
    const pon = (color, conCuadros = true) => {
      if (color) editor.aspecto.colores[clave] = color; else delete editor.aspecto.colores[clave];
      /* "Detalles" sale en dos apartados: las dos filas se marcan a la vez. */
      for (const otra of editor.colores) if (otra.clave === clave && otra.libre !== libre) otra.marca();
      if (conCuadros) marca();
      cambia(conCuadros);
    };
    /* Los colores sugeridos del kit, como atajos. */
    for (const color of sugeridos) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "personaje-muestra";
      b.dataset.valor = color;
      b.style.background = color;
      b.title = color;
      b.setAttribute("aria-label", `${NOMBRE_COLOR[clave] || clave} ${color}`);
      b.addEventListener("click", () => pon(color));
      muestras.append(b);
    }
    /* Mientras se arrastra el selector solo cambia la vista previa grande.
       Los cuadros se redibujan al soltar: en un móvil, redibujarlos a cada
       paso iba a tirones. */
    libre.addEventListener("input", () => pon(libre.value.toLowerCase(), false));
    libre.addEventListener("change", () => pon(libre.value.toLowerCase(), true));
    original.type = "button";
    original.className = "personaje-original";
    original.textContent = "ORIGINAL";
    original.addEventListener("click", () => pon(""));
    muestras.append(libre, original);
    fila.append(nombre, muestras);
    editor.colores.push({ clave, marca, libre });
    marca();
    return fila;
  }

  /* Los colores de un apartado: solo los que pintan algo con lo elegido. */
  function pintaColores(apartado, caja) {
    editor.colores = editor.colores.filter((c) => c.caja !== caja);
    caja.textContent = "";
    const desde = editor.colores.length;
    for (const clave of apartado.colores) if (colorAplica(apartado, clave)) caja.append(filaColor(clave));
    if (apartado.mechas && colorAplica(apartado, "mechas")) {
      const linea = document.createElement("label");
      linea.className = "check-line personaje-mechas personaje-fila";
      const casilla = document.createElement("input");
      casilla.type = "checkbox";
      casilla.checked = editor.aspecto.sinMechas;
      casilla.addEventListener("change", () => { editor.aspecto.sinMechas = casilla.checked; cambia(); });
      linea.append(casilla, document.createTextNode(" Mechas del color del pelo"));
      caja.append(linea);
    }
    for (const c of editor.colores.slice(desde)) c.caja = caja;
  }

  function ponPestana(id) {
    editor.pestana = id;
    const raiz = $("#avatarModal .personaje-editor");
    if (!raiz) return;
    for (const b of raiz.querySelectorAll(".personaje-pestana")) b.setAttribute("aria-selected", String(b.dataset.pestana === id));
    for (const s of raiz.querySelectorAll(".personaje-apartado")) s.hidden = s.dataset.pestana !== id;
    /* Lo elegido de cada tira, a la vista. */
    for (const c of editor.cuadros) {
      if (c.apartado.pestana === id && c.apartado.lee(editor.aspecto) === c.valor) c.boton.parentElement.scrollLeft = Math.max(0, c.boton.offsetLeft - c.boton.parentElement.offsetLeft - 8);
    }
    cambia();
  }

  function montaEditor() {
    const tarjeta = $("#avatarModal .modal-card");
    if (!tarjeta) return;
    /* La maqueta anterior del lobby se queda escondida; solo se usa su nombre
       y su botón de guardar. */
    for (const id of ["avatarPreview", "colorChoices", "bodyChoices", "faceChoices", "accessoryChoices"]) {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    }
    for (const etiqueta of tarjeta.querySelectorAll("label")) {
      if (!etiqueta.closest(".personaje-editor") && etiqueta.htmlFor !== "profileName") etiqueta.hidden = true;
    }
    tarjeta.querySelector(".personaje-editor")?.remove();
    editor.cuadros = [];
    editor.colores = [];

    const raiz = document.createElement("div");
    raiz.className = "personaje-editor";

    /* Vista previa y pestañas se quedan arriba al bajar por los apartados. */
    const cabecera = document.createElement("div");
    cabecera.className = "personaje-cabecera";
    const vista = document.createElement("canvas");
    vista.id = "personajeVista";
    vista.className = "personaje-vista";
    vista.width = CELDA_W * 4;
    vista.height = CELDA_H;
    vista.setAttribute("aria-label", "Vista previa del personaje en las cuatro direcciones");
    const pestanas = document.createElement("div");
    pestanas.className = "personaje-pestanas personaje-fila";
    pestanas.setAttribute("role", "tablist");
    for (const [id, texto] of PESTANAS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "personaje-pestana";
      b.dataset.pestana = id;
      b.setAttribute("role", "tab");
      b.textContent = texto;
      b.addEventListener("click", () => ponPestana(id));
      pestanas.append(b);
    }
    cabecera.append(vista);
    raiz.append(cabecera, pestanas);

    const cajas = [];
    for (const apartado of APARTADOS) {
      const seccion = document.createElement("section");
      seccion.className = "personaje-apartado";
      seccion.dataset.apartado = apartado.id;
      seccion.dataset.pestana = apartado.pestana;
      const titulo = document.createElement("h3");
      titulo.textContent = apartado.titulo;
      const tira = document.createElement("div");
      tira.className = "personaje-tira personaje-fila";
      tira.setAttribute("role", "group");
      tira.setAttribute("aria-label", apartado.titulo);
      const caja = document.createElement("div");
      caja.className = "personaje-colores";
      const [, , ancho, alto, aumento] = RECORTE[apartado.recorte];
      for (const [valor, dato] of Object.entries(apartado.opciones())) {
        if ((VETADAS[apartado.id] || []).includes(valor)) continue;
        const boton = document.createElement("button");
        boton.type = "button";
        boton.className = "personaje-opcion";
        boton.dataset.valor = valor;
        const lienzo = document.createElement("canvas");
        lienzo.width = ancho;
        lienzo.height = alto;
        lienzo.style.width = ancho * aumento + "px";
        lienzo.style.height = alto * aumento + "px";
        const nombre = document.createElement("span");
        nombre.textContent = typeof dato === "string" ? dato : dato.nombre;
        boton.append(lienzo, nombre);
        boton.addEventListener("click", () => {
          apartado.pon(editor.aspecto, valor);
          /* Otro cuerpo u otra prenda tienen otras zonas de color. */
          for (const [otro, suCaja] of cajas) if (otro === apartado || apartado.id === "cuerpo") pintaColores(otro, suCaja);
          cambia();
        });
        tira.append(boton);
        editor.cuadros.push({ apartado, valor, boton, lienzo });
      }
      seccion.append(titulo, tira, caja);
      raiz.append(seccion);
      cajas.push([apartado, caja]);
      pintaColores(apartado, caja);
    }

    const nota = document.createElement("p");
    nota.className = "hint";
    nota.textContent = "Se guarda en este dispositivo y lo ven los jugadores de tu sala.";
    raiz.append(nota);

    /* El personaje va arriba; el nombre queda abajo, junto a GUARDAR: en la
       pantalla pequeña del emulador lo primero que se ve son las opciones. */
    tarjeta.insertBefore(raiz, tarjeta.querySelector('label[for="profileName"]') || $("#saveProfile") || null);
    editor.montado = true;
    editor.cursor = { f: 1, c: -1 };
    ponPestana(editor.pestana);
    pintaCursor();
  }

  /* Tras cada cambio: la vista previa primero y después los cuadros de la
     pestaña abierta, uno a uno. Si llega otro cambio a mitad, lo que quedara
     por dibujar del anterior se deja. conCuadros = false: solo la vista
     previa (mientras se arrastra el selector de color). */
  function cambia(conCuadros = true) {
    const aspecto = valida(editor.aspecto) || { ...DEFECTO };
    const clave = JSON.stringify(aspecto);
    const vuelta = ++editor.vuelta;
    editor.pendiente = clave;
    for (const c of editor.cuadros) c.boton.setAttribute("aria-pressed", String(c.apartado.lee(editor.aspecto) === c.valor));
    cola = cola.then(async () => {
      if (editor.vuelta !== vuelta) return;
      try {
        const hoja = await comp.componer({ ...aspecto, frames: 8 });
        if (editor.vuelta !== vuelta) return;
        editor.hoja = hoja;
        if (!conCuadros) return;
        for (const c of editor.cuadros) {
          if (c.apartado.pestana !== editor.pestana || c.boton.dataset.pintado === clave) continue;
          const con = JSON.parse(clave);
          c.apartado.pon(con, c.valor);
          const reposo = await comp.componer({ ...con, frames: 4 });
          if (editor.vuelta !== vuelta) return;
          const [x, y, ancho, alto] = RECORTE[c.apartado.recorte];
          const ctx = c.lienzo.getContext("2d");
          ctx.clearRect(0, 0, ancho, alto);
          ctx.drawImage(reposo, x, y, ancho, alto, 0, 0, ancho, alto);
          c.boton.dataset.pintado = clave;
          /* Entre cuadro y cuadro se cede el paso, para no trabar la pantalla. */
          await new Promise((sigue) => setTimeout(sigue, 0));
        }
      } catch (error) {
        console.error("ML3D personajes (pantalla de personalizar):", error);
      }
    });
  }

  function pintaVistaPrevia(ahora) {
    const vista = document.getElementById("personajeVista");
    if (!vista || !editor.hoja) return;
    const columna = Math.floor(ahora / MS_ANDAR) % 8;
    if (vista.dataset.firma === editor.pendiente + columna) return;
    vista.dataset.firma = editor.pendiente + columna;
    const ctx = vista.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, vista.width, vista.height);
    for (let fila = 0; fila < 4; fila++) {
      ctx.drawImage(editor.hoja, columna * CELDA_W, fila * CELDA_H, CELDA_W, CELDA_H, fila * CELDA_W, 0, CELDA_W, CELDA_H);
    }
  }

  /* ---------- la pantalla de personalizar con los botones del emulador ---------- */

  /* Filas del cursor, de arriba abajo: las pestañas, de la pestaña abierta
     cada tira y cada fila de colores, el nombre y GUARDAR. */
  function filasCursor() {
    const tarjeta = $("#avatarModal .modal-card");
    if (!tarjeta || !editor.montado) return [];
    const filas = [];
    for (const fila of tarjeta.querySelectorAll(".personaje-fila, #profileName, #saveProfile")) {
      if (fila.closest("[hidden]")) continue;
      const cosas = fila.matches(".personaje-fila") ? [...fila.querySelectorAll("button, input")].filter((el) => !el.disabled) : [fila];
      if (cosas.length) filas.push(cosas);
    }
    return filas;
  }

  /* Al llegar a una fila, el cursor va a lo que está elegido en ella. */
  function elegidoDe(fila) {
    const i = fila.findIndex((el) => el.getAttribute("aria-pressed") === "true" || el.getAttribute("aria-selected") === "true");
    return i < 0 ? 0 : i;
  }

  function pintaCursor() {
    const filas = filasCursor();
    if (!filas.length) return;
    const k = editor.cursor;
    k.f = Math.max(0, Math.min(filas.length - 1, k.f));
    if (k.c < 0) k.c = elegidoDe(filas[k.f]);
    k.c = Math.max(0, Math.min(filas[k.f].length - 1, k.c));
    document.querySelectorAll(".embed-cursor").forEach((el) => el.classList.remove("embed-cursor"));
    /* El cursor es para quien maneja con botones; con ratón o dedo no hace
       falta, pero no estorba: es solo un contorno. */
    const el = filas[k.f][k.c];
    el.classList.add("embed-cursor");
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  /* Botón del emulador (UP, DOWN, LEFT, RIGHT, A, B, L, R, START, SELECT).
     Devuelve true si lo ha atendido; B y SELECT se dejan a quien llama, que
     cierra la ventana. */
  function tecla(boton) {
    if (!editor.abierto || !editor.montado) return false;
    const filas = filasCursor();
    if (!filas.length) return false;
    const k = editor.cursor;
    if (boton === "UP" || boton === "DOWN") {
      k.f = (k.f + (boton === "UP" ? -1 : 1) + filas.length) % filas.length;
      k.c = -1;
    } else if (boton === "LEFT" || boton === "RIGHT") {
      k.c = Math.max(0, Math.min(filas[k.f].length - 1, k.c + (boton === "LEFT" ? -1 : 1)));
    } else if (boton === "L" || boton === "R") {
      const i = PESTANAS.findIndex(([id]) => id === editor.pestana);
      ponPestana(PESTANAS[(i + (boton === "L" ? -1 : 1) + PESTANAS.length) % PESTANAS.length][0]);
      k.f = 1;
      k.c = -1;
    } else if (boton === "A" || boton === "START") {
      const el = filas[k.f]?.[k.c];
      if (!el) return true;
      if (el instanceof HTMLInputElement && el.type === "text") { el.focus(); el.select?.(); } else el.click();
    } else return false;
    pintaCursor();
    return true;
  }

  /* Retrato del personaje propio, parado y de frente, para cualquier lienzo
     con la clase "personaje-retrato" (el menú del lobby lo usa). */
  function pintaRetratos() {
    const lienzos = document.querySelectorAll("canvas.personaje-retrato");
    if (!lienzos.length) return;
    const propio = valida(window.ML3DPersonajes.actual?.());
    const texto = propio ? JSON.stringify(propio) : "";
    const hoja = hojaPara(texto);
    if (!hoja?.lista) return;
    const firma = hoja === hojas.get(CLAVE_DEFECTO) ? "d" : texto;
    for (const lienzo of lienzos) {
      if (lienzo.dataset.firma === firma) continue;
      lienzo.dataset.firma = firma;
      lienzo.width = CELDA_W;
      lienzo.height = CELDA_H;
      const ctx = lienzo.getContext("2d");
      ctx.clearRect(0, 0, CELDA_W, CELDA_H);
      ctx.drawImage(hoja.reposo, 0, 0, CELDA_W, CELDA_H, 0, 0, CELDA_W, CELDA_H);
    }
  }

  /* ---------- arranque ---------- */

  const listo = (async () => {
    const modulo = await import(BASE + "compositor.js?v=" + VERSION);
    comp = await modulo.Compositor.create(BASE + "assets/");
    M = comp.manifest;
    /* El personaje por defecto es el del kit. */
    DEFECTO = {
      version: 1,
      cuerpo: modulo.CONFIG_POR_DEFECTO.cuerpo,
      peinado: modulo.CONFIG_POR_DEFECTO.peinado,
      arriba: modulo.CONFIG_POR_DEFECTO.arriba,
      abajo: modulo.CONFIG_POR_DEFECTO.abajo,
      calzado: modulo.CONFIG_POR_DEFECTO.calzado,
      complementos: { cabeza: "nada", gafas: "nada", auriculares: false, cinta: false },
      sinMechas: false,
      colores: {}
    };
    CLAVE_DEFECTO = JSON.stringify(DEFECTO);
    compone(CLAVE_DEFECTO, DEFECTO);
    await cola;
    requestAnimationFrame(pintaTodos);

    /* El editor se abre y se cierra con la ventana de "Tu personaje". */
    const modal = document.getElementById("avatarModal");
    if (modal) {
      new MutationObserver(() => {
        const abierto = !modal.hidden;
        if (abierto && !editor.abierto) {
          editor.aspecto = JSON.parse(JSON.stringify(valida(window.ML3DPersonajes.actual?.()) || DEFECTO));
          montaEditor();
        }
        editor.abierto = abierto;
      }).observe(modal, { attributes: true, attributeFilter: ["hidden"] });
    }
    window.dispatchEvent(new CustomEvent("ml3d-personajes-listos"));
    return true;
  })().catch((error) => { console.error("ML3D personajes: no se pudo cargar el kit.", error); return false; });

  window.ML3DPersonajes = {
    listo,
    valida,
    /* El aspecto que se está editando, ya validado. rooms.js lo lee al guardar. */
    borrador() {
      return editor.montado && editor.aspecto ? valida(editor.aspecto) : null;
    },
    /* embed.js pasa aquí los botones del emulador mientras la pantalla de
       personalizar está abierta, y pide que se pinte el cursor. */
    tecla,
    cursor: pintaCursor,
    /* rooms.js dice aquí cuál es el aspecto guardado del jugador. */
    actual: null,
    get porDefecto() { return DEFECTO ? JSON.parse(JSON.stringify(DEFECTO)) : null; }
  };
})();
