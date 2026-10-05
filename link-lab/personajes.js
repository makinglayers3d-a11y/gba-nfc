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
      host.append(lienzo);
      el.append(host);
    }
    return host.firstChild;
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
    requestAnimationFrame(pintaTodos);
  }

  /* ---------- pantalla de personalizar ---------- */

  const editor = { abierto: false, aspecto: null, hoja: null, pendiente: "", montado: false };

  function campo(texto, control) {
    const fila = document.createElement("div");
    fila.className = "personaje-campo";
    const etiqueta = document.createElement("label");
    etiqueta.textContent = texto;
    if (control.id) etiqueta.htmlFor = control.id;
    fila.append(etiqueta, control);
    return fila;
  }

  function desplegable(id, opciones, valor, alCambiar, vetadas = []) {
    const select = document.createElement("select");
    select.id = id;
    for (const [clave, nombre] of Object.entries(opciones)) {
      if (vetadas.includes(clave)) continue;
      const o = document.createElement("option");
      o.value = clave;
      o.textContent = typeof nombre === "string" ? nombre : nombre.nombre;
      select.append(o);
    }
    select.value = valor;
    select.addEventListener("change", () => { alCambiar(select.value); cambia(); });
    return select;
  }

  function casilla(texto, valor, alCambiar) {
    const linea = document.createElement("label");
    linea.className = "check-line";
    const caja = document.createElement("input");
    caja.type = "checkbox";
    caja.checked = valor;
    caja.addEventListener("change", () => { alCambiar(caja.checked); cambia(); });
    linea.append(caja, document.createTextNode(" " + texto));
    return linea;
  }

  function filaColor(clave) {
    const fila = document.createElement("div");
    fila.className = "personaje-color";
    const nombre = document.createElement("span");
    nombre.className = "personaje-color-nombre";
    nombre.textContent = NOMBRE_COLOR[clave] || clave;
    const muestras = document.createElement("div");
    muestras.className = "personaje-muestras";
    const pon = (color) => {
      if (color) editor.aspecto.colores[clave] = color; else delete editor.aspecto.colores[clave];
      libre.value = editor.aspecto.colores[clave] || M.colores[clave].sugeridos[0];
      cambia();
    };
    /* Los colores sugeridos del kit, como atajos. */
    for (const color of M.colores[clave].sugeridos) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "personaje-muestra";
      b.style.background = color;
      b.title = color;
      b.setAttribute("aria-label", `${NOMBRE_COLOR[clave] || clave} ${color}`);
      b.addEventListener("click", () => pon(color));
      muestras.append(b);
    }
    /* Y cualquier otro color. Es un color, no una imagen. */
    const libre = document.createElement("input");
    libre.type = "color";
    libre.className = "personaje-libre";
    libre.value = editor.aspecto.colores[clave] || M.colores[clave].sugeridos[0];
    libre.setAttribute("aria-label", `${NOMBRE_COLOR[clave] || clave}: otro color`);
    libre.addEventListener("input", () => { editor.aspecto.colores[clave] = libre.value.toLowerCase(); cambia(); });
    const original = document.createElement("button");
    original.type = "button";
    original.className = "personaje-original";
    original.textContent = "ORIGINAL";
    original.addEventListener("click", () => pon(""));
    muestras.append(libre, original);
    fila.append(nombre, muestras);
    return fila;
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

    const a = editor.aspecto;
    const raiz = document.createElement("div");
    raiz.className = "personaje-editor";

    const vista = document.createElement("canvas");
    vista.id = "personajeVista";
    vista.className = "personaje-vista";
    vista.width = CELDA_W * 4;
    vista.height = CELDA_H;
    vista.setAttribute("aria-label", "Vista previa del personaje en las cuatro direcciones");
    raiz.append(vista);

    raiz.append(
      campo("Cuerpo", desplegable("personajeCuerpo", M.cuerpos, a.cuerpo, (v) => { a.cuerpo = v; })),
      campo("Peinado", desplegable("personajePeinado", M.opciones.peinado, a.peinado, (v) => { a.peinado = v; })),
      campo("Parte de arriba", desplegable("personajeArriba", M.opciones.arriba, a.arriba, (v) => { a.arriba = v; }, VETADAS.arriba)),
      campo("Parte de abajo", desplegable("personajeAbajo", M.opciones.abajo, a.abajo, (v) => { a.abajo = v; }, VETADAS.abajo)),
      campo("Calzado", desplegable("personajeCalzado", M.opciones.calzado, a.calzado, (v) => { a.calzado = v; })),
      campo("Cabeza", desplegable("personajeCabeza", M.opciones.cabeza, a.complementos.cabeza, (v) => { a.complementos.cabeza = v; })),
      campo("Gafas", desplegable("personajeGafas", M.opciones.gafas, a.complementos.gafas, (v) => { a.complementos.gafas = v; })),
      casilla("Auriculares", a.complementos.auriculares, (v) => { a.complementos.auriculares = v; }),
      casilla("Cinta", a.complementos.cinta, (v) => { a.complementos.cinta = v; }),
      casilla("Mechas del color del pelo", a.sinMechas, (v) => { a.sinMechas = v; })
    );

    const colores = document.createElement("details");
    colores.className = "personaje-colores";
    const titulo = document.createElement("summary");
    titulo.textContent = "Colores";
    colores.append(titulo);
    for (const clave of Object.keys(M.colores)) colores.append(filaColor(clave));
    raiz.append(colores);

    const nota = document.createElement("p");
    nota.className = "hint";
    nota.textContent = "Se guarda en este dispositivo y lo ven los jugadores de tu sala.";
    raiz.append(nota);

    tarjeta.insertBefore(raiz, $("#saveProfile") || null);
    editor.montado = true;
    cambia();
  }

  /* Tras cada cambio se vuelve a componer la vista previa. */
  function cambia() {
    const aspecto = valida(editor.aspecto) || { ...DEFECTO };
    const clave = JSON.stringify(aspecto);
    editor.pendiente = clave;
    cola = cola.then(async () => {
      if (editor.pendiente !== clave) return;   /* ya hay un cambio más nuevo */
      try {
        const hoja = await comp.componer({ ...aspecto, frames: 8 });
        if (editor.pendiente === clave) editor.hoja = hoja;
      } catch (error) {
        console.error("ML3D personajes (vista previa):", error);
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
    /* rooms.js dice aquí cuál es el aspecto guardado del jugador. */
    actual: null,
    get porDefecto() { return DEFECTO ? JSON.parse(JSON.stringify(DEFECTO)) : null; }
  };
})();
