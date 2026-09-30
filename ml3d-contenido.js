(() => {
  "use strict";

  /* De dónde saca el emulador los juegos, las carátulas y las carcasas.
   *
   * Antes salían de carpetas públicas del sitio. Ahora viven en un almacén
   * privado y los entrega el worker, que comprueba en el servidor si este
   * dispositivo tiene acceso de tester antes de soltar nada.
   *
   * Este fichero es la única pieza de la página que sabe de dónde viene el
   * contenido. Todo lo demás le pide una dirección y se despreocupa, así que
   * el día que cambie el almacén solo hay que tocar aquí.
   *
   * Si no hay acceso no se rompe nada: el emulador funciona igual, con la
   * carcasa de ML3D —que es diseño propio y pública— y la biblioteca vacía.
   */

  const SIN_ACCESO = { acceso: false, juegos: [], carcasas: ["ml3d"] };
  const CARCASA_PUBLICA = "ml3d";

  let base = "";          /* dirección del worker */
  let pase = "";          /* el pase que devuelve la verificación */
  let catalogo = null;    /* lo último que dijo el worker */
  let pidiendo = null;    /* para no pedir el catálogo dos veces a la vez */
  const oyentes = new Set();

  /* El pase llega cuando dev-access.js termina de verificarse. Hasta entonces
     no se puede pedir nada protegido, así que se guarda y se avisa. */
  window.addEventListener("ml3d-access-identity", (event) => {
    const nuevo = String(event.detail?.contentPass || "");
    if (!nuevo || nuevo === pase) return;
    pase = nuevo;
    catalogo = null;
    refresca();
  });

  window.addEventListener("ml3d-access-config", (event) => {
    const url = String(event.detail?.apiBase || "").replace(/\/+$/, "");
    if (url) base = url;
  });

  function avisa() {
    for (const f of oyentes) {
      try { f(catalogo || SIN_ACCESO); } catch (e) { console.error(e); }
    }
    window.dispatchEvent(new CustomEvent("ml3d-contenido", { detail: catalogo || SIN_ACCESO }));
  }

  function conPase(url) {
    /* Las imágenes de CSS no pueden llevar cabeceras, así que el pase viaja en
       la dirección. Caduca en media hora y solo sirve para leer. */
    if (!pase) return url;
    return url + (url.includes("?") ? "&" : "?") + "pase=" + encodeURIComponent(pase);
  }

  async function pideCatalogo() {
    if (!base) return SIN_ACCESO;
    const respuesta = await fetch(base + "/v1/content/catalog", {
      headers: pase ? { "X-ML3D-Content-Pass": pase } : {},
      cache: "no-store"
    });
    const datos = await respuesta.json().catch(() => null);
    if (!datos || datos.ok !== true) return SIN_ACCESO;
    return {
      acceso: datos.acceso === true,
      juegos: Array.isArray(datos.juegos) ? datos.juegos : [],
      carcasas: Array.isArray(datos.carcasas) && datos.carcasas.length ? datos.carcasas : [CARCASA_PUBLICA],
      mensaje: String(datos.mensaje || "")
    };
  }

  async function refresca() {
    if (pidiendo) return pidiendo;
    pidiendo = pideCatalogo()
      .catch((error) => {
        console.warn("ML3D contenido: no se pudo leer el catálogo.", error);
        return SIN_ACCESO;
      })
      .then((datos) => {
        catalogo = datos;
        pidiendo = null;
        avisa();
        return datos;
      });
    return pidiendo;
  }

  window.ML3DContenido = {
    CARCASA_PUBLICA,

    /** Lo último que se sabe, sin ir a la red. */
    get estado() {
      return catalogo || SIN_ACCESO;
    },

    get hayAcceso() {
      return Boolean(catalogo?.acceso);
    },

    /** Pide el catálogo al worker (una sola vez aunque se llame a la vez). */
    async catalogo() {
      if (catalogo) return catalogo;
      return refresca();
    },

    /** Vuelve a preguntar, por ejemplo tras conceder o revocar un acceso. */
    recarga() {
      catalogo = null;
      return refresca();
    },

    /** Dirección de un juego. Sin acceso devuelve null, y quien llame decide. */
    urlJuego(nombreFichero) {
      if (!base || !pase) return null;
      return conPase(base + "/v1/content/rom/" + encodeURIComponent(nombreFichero));
    },

    /** Dirección de una carátula. */
    urlCaratula(nombreFichero) {
      if (!base || !pase) return null;
      return conPase(base + "/v1/content/cover/" + encodeURIComponent(nombreFichero));
    },

    /**
     * Dirección de una carcasa.
     *
     * La de ML3D no necesita pase: es diseño propio y se sirve a cualquiera,
     * para que quien no tenga acceso vea el emulador entero y no un hueco.
     */
    urlCarcasa(id, pieza) {
      if (!base) return null;
      const ruta = base + "/v1/content/skin/" + encodeURIComponent(id) + (pieza === "lid" ? "/lid" : "");
      return id === CARCASA_PUBLICA ? ruta : conPase(ruta);
    },

    /** Para enterarse de cuándo cambia el acceso. */
    alCambiar(funcion) {
      oyentes.add(funcion);
      if (catalogo) { try { funcion(catalogo); } catch (e) { console.error(e); } }
      return () => oyentes.delete(funcion);
    },

    /** Solo para pruebas: fija la dirección del worker a mano. */
    _base(url) {
      base = String(url || "").replace(/\/+$/, "");
    }
  };
})();
