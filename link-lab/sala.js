(() => {
  "use strict";

  /* La sala del lobby en pantalla: escala, profundidad, etiquetas y movimiento.

     rooms.js sabe dónde está cada jugador (data-x, data-y, en % de la sala,
     el punto donde pisa). Este fichero decide cómo se ve:

     - ESCALA. Sala y personajes llevan la misma escala (--k), respecto a una
       sala de referencia de 720x480 con personajes de 64x96. Si la pantalla
       da para ello, la escala es un número entero de píxeles reales de
       pantalla y lo que sobra queda como margen; si no cabe ni a 1x, se usa
       la escala justa (no entera) y el personaje se pinta sin suavizar.
     - PROFUNDIDAD. Quien pisa más abajo se dibuja delante.
     - ETIQUETAS. Nombres, "PAUSADO" y bocadillos van en una capa aparte, por
       encima de todos los cuerpos: el cuerpo de uno no tapa el nombre de otro.
     - MOVIMIENTO. Los demás jugadores no saltan a cada posición que llega
       por la red. Se les dibuja con un pequeño retraso, pasando a velocidad
       constante por las posiciones recibidas; el retraso crece solo si la
       red llega a trompicones, así un corte pequeño no se ve como un tirón. */

  const REF_ANCHO = 720;
  const REF_ALTO = 480;
  /* Calibración del movimiento de los demás jugadores. */
  const RETRASO_MIN = 150;      /* ms por detrás de la red, como poco */
  const RETRASO_MAX = 450;      /* y como mucho, con la red a trompicones */
  const HOLGURA = 1.5;          /* retraso = el mayor hueco reciente entre posiciones x esto */
  const MEMORIA_HUECOS = 4000;  /* ms que se recuerda un hueco grande */
  const PARADO = 250;           /* sin posiciones nuevas este tiempo = estaba parado */
  const TICK = 110;             /* cada cuánto llegan posiciones al andar, más o menos */
  const JUNTAS = 40;            /* ms; dos posiciones más juntas que esto cuentan como una */
  const UN_PASO = 4.7;          /* % de sala que se anda en tick y medio */
  const SALTO = 25;             /* % de sala; más lejos que esto no se anda: se aparece allí */

  const sala = document.getElementById("lobbyStage");
  const capa = document.getElementById("playersLayer");
  if (!sala || !capa) return;

  const etiquetas = document.createElement("div");
  etiquetas.id = "tagsLayer";
  etiquetas.className = "tags-layer";
  etiquetas.setAttribute("aria-hidden", "true");
  capa.after(etiquetas);

  /* ---------- luces del fondo ---------- */

  /* Bucles cortos de luz sobre el dibujo de la sala: el portal de abajo, el
     emblema del centro y el cartel de arriba. Son capas encima de la imagen;
     el dibujo no cambia. Se paran cuando la pestaña no se ve, y no se
     mueven si el sistema pide menos movimiento (eso lo hace el CSS). */
  const luces = document.createElement("div");
  luces.className = "sala-luces";
  luces.setAttribute("aria-hidden", "true");
  for (const cual of ["portal", "emblema", "cartel", "barrido"]) {
    const luz = document.createElement("div");
    luz.className = "sala-luz sala-luz-" + cual;
    luces.append(luz);
  }
  capa.before(luces);
  const paraLuces = () => luces.classList.toggle("paradas", document.hidden);
  document.addEventListener("visibilitychange", paraLuces);
  paraLuces();

  /* ---------- pantalla de la sala ---------- */

  /* El cartel del fondo hace de pantalla. Sin combate alterna cada 5 s entre
     el cartel tal cual y la tabla de resultados; con un combate en marcha
     dice quién juega, a qué y cuánto lleva. Solo texto: no hay vídeo. En un
     móvil es muy pequeña; ahí se abre a tamaño completo con A o desde el
     menú de la sala. */
  const pantalla = document.createElement("div");
  pantalla.className = "sala-pantalla";
  pantalla.hidden = true;
  capa.before(pantalla);
  function pintaPantalla() {
    const estado = window.ML3DCombates?.estado();
    const c = estado?.combate;
    let lineas = null;
    if (c) {
      const seg = c.inicio ? Math.max(0, Math.floor((Date.now() - c.inicio) / 1000)) : 0;
      lineas = ["EN CURSO", `${c.nombreA} vs ${c.nombreB}`, (c.juego || "").slice(0, 26), c.estado === "conectando" ? "conectando…" : `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, "0")}`];
    } else if (estado?.tabla.length && Math.floor(Date.now() / 5000) % 2 === 1) {
      lineas = ["RESULTADOS", ...estado.tabla.slice(0, 3).map((f, i) => `${i + 1}. ${f.nombre}  ${f.ganados}-${f.perdidos}-${f.empates}`)];
    }
    pantalla.hidden = !lineas;
    const texto = lineas ? lineas.join("\n") : "";
    if (pantalla.textContent !== texto) pantalla.textContent = texto;
    pantalla.classList.toggle("en-curso", Boolean(c));
  }
  setInterval(pintaPantalla, 500);

  /* ---------- escala ---------- */

  let k = 1;
  function mide() {
    const padre = sala.parentElement;
    if (!padre) return;
    let ancho = padre.clientWidth;
    if (!ancho) return;   /* la sala no está a la vista */
    /* Dentro del emulador la sala no puede pasar del alto de su pantalla. */
    if (document.body.classList.contains("ml3d-embed")) ancho = Math.min(ancho, Math.floor(window.innerHeight * REF_ANCHO / REF_ALTO));
    const dpr = window.devicePixelRatio || 1;
    const entero = Math.floor(ancho * dpr / REF_ANCHO + 1e-6);
    const final = entero >= 1 ? entero * REF_ANCHO / dpr : ancho;
    const nueva = final / REF_ANCHO;
    if (Math.abs(nueva - k) < 1e-6 && sala.style.width) return;
    k = nueva;
    sala.style.setProperty("width", final + "px", "important");
    sala.style.setProperty("--k", String(k));
    sala.dataset.escala = entero >= 1 ? `${entero}x` : "ajustada";
  }
  new ResizeObserver(mide).observe(sala.parentElement);
  window.addEventListener("resize", mide);

  /* ---------- jugadores ---------- */

  /* Gestos con icono sobre la cabeza. El salto no lleva icono: se ve. */
  const ICONO_GESTO = { saludo: "👋", aplauso: "👏", risa: "😄", corazon: "❤️" };

  const estado = new WeakMap();   /* .player -> { x, y, etiqueta, firma } */

  function etiquetaDe(el) {
    const e = document.createElement("div");
    e.className = "player-tag";
    e.dataset.playerId = el.dataset.playerId || "";
    etiquetas.append(e);
    return e;
  }

  /* La etiqueta copia el nombre, "PAUSADO" y el bocadillo que rooms.js deja
     en el jugador (allí quedan ocultos). Solo se rehace si algo cambia. */
  function copiaEtiqueta(el, st) {
    const nombre = el.querySelector(":scope > .player-name");
    const bocadillo = el.querySelector(":scope > .chat-bubble");
    const pausado = el.classList.contains("paused");
    const silenciado = el.classList.contains("silenciado");
    const gesto = ICONO_GESTO[el.dataset.gesto] || "";
    const listo = el.dataset.listo === "1";
    /* "DESAFIANDO" sobre quien ha lanzado un desafío; "EN COMBATE" sobre los dos que juegan. */
    const duelo = el.dataset.duelo || "";
    const firma = (nombre?.innerHTML || "") + "|" + (bocadillo?.textContent ?? "\u0000") + "|" + pausado + "|" + el.classList.contains("local") + "|" + silenciado + "|" + gesto + "|" + listo + "|" + duelo;
    if (st.firma === firma) return;
    st.firma = firma;
    const e = st.etiqueta;
    e.classList.toggle("local", el.classList.contains("local"));
    e.textContent = "";
    if (gesto) { const g = document.createElement("div"); g.className = "player-gesto"; g.textContent = gesto; e.append(g); }
    if (bocadillo) e.append(bocadillo.cloneNode(true));
    if (duelo) {
      const m = document.createElement("div");
      m.className = "player-duelo" + (duelo === "combate" ? " en-combate" : "");
      const tipo = window.ML3DCombates?.tipos[duelo.split(":")[1]] || "";
      m.textContent = duelo === "combate" ? "⚔ EN COMBATE" : "⚔ DESAFIANDO" + (tipo ? " · " + tipo.toUpperCase() : "");
      e.append(m);
    }
    if (pausado) { const p = document.createElement("div"); p.className = "player-paused-tag"; p.textContent = "PAUSADO"; e.append(p); }
    if (silenciado) { const s = document.createElement("div"); s.className = "player-silenciado"; s.textContent = "🔇 SILENCIADO"; e.append(s); }
    if (nombre) {
      const copia = nombre.cloneNode(true);
      /* "Listo": tiene su juego cargado y comprobado (lo decide embed.js). */
      if (listo) { const l = document.createElement("span"); l.className = "player-listo"; l.textContent = "✓"; l.title = "Listo"; copia.append(l); }
      e.append(copia);
    }
  }

  /* Otro jugador: se apunta cada posición nueva con su hora de llegada y se
     dibuja dónde estaba hace un rato, entre dos posiciones recibidas. */
  function sigue(st, tx, ty, ahora) {
    const p = st.puntos;
    const ultimo = p[p.length - 1];
    if (tx !== ultimo.x || ty !== ultimo.y) {
      if (Math.hypot(tx - ultimo.x, ty - ultimo.y) > SALTO) { st.puntos = [{ t: ahora, x: tx, y: ty }]; st.x = tx; st.y = ty; st.reloj = ahora - RETRASO_MIN; st.visto = ahora; return; }
      const hueco = ahora - ultimo.t;
      /* Tras un corte, las posiciones atrasadas llegan todas juntas. Dos casi
         a la vez son la misma: si se apuntaran las dos, el tramo entre ellas
         se recorrería en un instante, como un salto. */
      if (hueco < JUNTAS && p.length > 1) { ultimo.x = tx; ultimo.y = ty; }
      else {
      /* Mucho rato sin posiciones puede ser que estaba parado o que la red
         se cortó. Se distingue por lo andado: tras estar parado llega un
         paso; tras un corte, todo lo andado mientras tanto. */
      const estabaParado = hueco > PARADO && Math.hypot(tx - ultimo.x, ty - ultimo.y) <= UN_PASO;
      /* Parado: echó a andar hace un tick, no cuando llegó la posición
         anterior. Sin esto arrancaría a cámara lenta. */
      if (estabaParado) p.push({ t: ahora - TICK, x: ultimo.x, y: ultimo.y });
      else st.huecos.push({ t: ahora, ms: hueco });
      p.push({ t: ahora, x: tx, y: ty });
      while (p.length > 40) p.shift();
      }
    }
    while (st.huecos.length && ahora - st.huecos[0].t > MEMORIA_HUECOS) st.huecos.shift();
    let mayor = 0;
    for (const h of st.huecos) if (h.ms > mayor) mayor = h.ms;
    const retraso = Math.max(RETRASO_MIN, Math.min(RETRASO_MAX, mayor * HOLGURA));
    /* El reloj con el que se dibuja nunca va hacia atrás ni pega saltos: si
       el retraso cambia, va un poco más despacio o más deprisa hasta
       ajustarse (entre la mitad y un 25 % más que el tiempo real). */
    const pasado = Math.min(100, ahora - st.visto);
    st.reloj = Math.max(st.reloj + pasado * 0.5, Math.min(ahora - retraso, st.reloj + pasado * 1.25));
    st.visto = ahora;
    const pts = st.puntos;
    while (pts.length > 2 && pts[1].t <= st.reloj) pts.shift();
    const a = pts[0], b = pts[1];
    if (!b || st.reloj <= a.t) { st.x = a.x; st.y = a.y; }
    else { const f = Math.min(1, (st.reloj - a.t) / Math.max(1, b.t - a.t)); st.x = a.x + (b.x - a.x) * f; st.y = a.y + (b.y - a.y) * f; }
  }

  /* Dos personajes juntos: sus etiquetas se pisarían. La de quien está
     delante (más abajo) se queda en su sitio y las otras suben lo justo para
     quedar encima. Solo se vuelve a medir cuando algo ha cambiado. */
  let firmaEtiquetas = "";
  function separaEtiquetas() {
    const todas = [...etiquetas.children];
    const firma = todas.map((e) => e.style.left + e.style.top + e.childElementCount + ":" + e.textContent.length).join("|") + "|" + capa.clientWidth;
    if (firma === firmaEtiquetas) return;
    firmaEtiquetas = firma;
    const borde = etiquetas.getBoundingClientRect();
    const cajas = todas.map((e) => {
      const antes = Number(e.dataset.sube) || 0, corrida = Number(e.dataset.corre) || 0, r = e.getBoundingClientRect();
      /* Junto a una pared la etiqueta se salía de la sala y se cortaba: se
         corre de lado lo justo para caber entera. */
      let izq = r.left - corrida, der = r.right - corrida, corre = 0;
      if (der - izq < borde.width - 4) {
        if (izq < borde.left + 2) corre = borde.left + 2 - izq;
        else if (der > borde.right - 2) corre = borde.right - 2 - der;
      }
      corre = Math.round(corre);
      if (corrida !== corre) { e.dataset.corre = String(corre); e.style.setProperty("--corre", corre + "px"); }
      return { e, izq: izq + corre, der: der + corre, arr: r.top + antes, aba: r.bottom + antes, sube: 0 };
    }).sort((a, b) => b.aba - a.aba);
    const puestas = [];
    for (const c of cajas) {
      /* subir para librar una puede hacerla pisar otra: se repasa */
      for (let vuelta = 0; vuelta < puestas.length; vuelta++) {
        for (const p of puestas) {
          const pisa = c.izq < p.der && c.der > p.izq && c.arr - c.sube < p.aba - p.sube && c.aba - c.sube > p.arr - p.sube;
          if (pisa) c.sube = c.aba - (p.arr - p.sube) + 2;
        }
      }
      /* Arriba del todo no hay sitio para subir: antes que salirse de la sala
         y no verse, la etiqueta baja lo que haga falta. */
      const tope = c.arr - borde.top - 2;
      if (c.sube > tope) c.sube = tope;
      puestas.push(c);
      const px = Math.round(c.sube);
      if ((Number(c.e.dataset.sube) || 0) !== px) { c.e.dataset.sube = String(px); c.e.style.setProperty("--sube", px + "px"); }
    }
  }

  function cuadro(ahora) {
    const vivas = new Set();
    for (const el of capa.querySelectorAll(":scope > .player")) {
      const tx = Number(el.dataset.x), ty = Number(el.dataset.y);
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
      let st = estado.get(el);
      if (!st) { st = { x: tx, y: ty, etiqueta: etiquetaDe(el), firma: null, puntos: [{ t: ahora, x: tx, y: ty }], huecos: [], reloj: ahora - RETRASO_MIN, visto: ahora }; estado.set(el, st); }
      vivas.add(st.etiqueta);
      if (el.classList.contains("local")) { st.x = tx; st.y = ty; }
      else sigue(st, tx, ty, ahora);
      const izq = st.x.toFixed(3) + "%", arr = st.y.toFixed(3) + "%";
      if (el.style.left !== izq) el.style.left = izq;
      if (el.style.top !== arr) el.style.top = arr;
      /* Delante quien pisa más abajo. "important": el tema fija un z-index
         igual para todos con !important, y sin esto no se ordenaban. */
      const z = String(100 + Math.round(st.y * 10));
      if (el.style.getPropertyValue("z-index") !== z) el.style.setProperty("z-index", z, "important");
      copiaEtiqueta(el, st);
      if (st.etiqueta.style.left !== izq) st.etiqueta.style.left = izq;
      if (st.etiqueta.style.top !== arr) st.etiqueta.style.top = arr;
    }
    for (const e of [...etiquetas.children]) if (!vivas.has(e)) e.remove();
    separaEtiquetas();
    requestAnimationFrame(cuadro);
  }

  mide();
  requestAnimationFrame(cuadro);

  window.ML3DSala = { get escala() { return k; }, mide };
})();
