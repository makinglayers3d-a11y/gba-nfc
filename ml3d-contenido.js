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
  let avisaPase;
  const paseListo = new Promise((resolve) => { avisaPase = resolve; });

  window.addEventListener("ml3d-access-identity", (event) => {
    const nuevo = String(event.detail?.contentPass || "");
    if (!nuevo || nuevo === pase) return;
    pase = nuevo;
    catalogo = null;
    refresca();
    avisaPase();
  });

  window.addEventListener("ml3d-access-config", (event) => {
    const url = String(event.detail?.apiBase || "").replace(/\/+$/, "");
    if (url) base = url;
  });

  /* La dirección del worker llega con dev=1. El emulador público también la
     necesita para leer los ajustes generales, así que si no ha llegado se lee
     del mismo fichero de configuración. */
  async function direccion() {
    if (base) return base;
    try {
      const config = await (await fetch("dev-access-config.json", { cache: "no-store" })).json();
      const url = ["localhost", "127.0.0.1"].includes(location.hostname)
        ? location.origin + "/acceso"
        : String(config?.apiBase || "");
      if (url && !base) base = url.replace(/\/+$/, "");
    } catch (_) {}
    return base;
  }

  /* Ajustes generales del emulador. Hoy uno: si el envío de juegos entre
     jugadores está permitido. Lo decide el interruptor de la app de gestión.
     Si el worker no contesta, apagado. */
  async function ajustes() {
    let envioRoms = false;
    try {
      const url = await direccion();
      if (url) {
        const respuesta = await fetch(url + "/v1/settings", { cache: "no-store" });
        if (respuesta.ok) envioRoms = (await respuesta.json()).envioRoms === true;
      }
    } catch (_) {}
    window.ML3D_ENVIO_ROMS = envioRoms;
    return { envioRoms };
  }
  ajustes();

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
      /* Nombre para mostrar y carátula de cada juego; vive junto a los juegos. */
      gestion: datos.gestion && typeof datos.gestion === "object" ? datos.gestion : null,
      /* Identificadores antiguos de enlace (?game=), etiquetas de cartucho y
         carcasas: tablas que no viven en la página, sino tras el acceso. */
      alias: datos.alias && typeof datos.alias === "object" ? datos.alias : {},
      etiquetas: Array.isArray(datos.etiquetas) ? datos.etiquetas : [],
      carcasasInfo: Array.isArray(datos.carcasasInfo) ? datos.carcasasInfo : [],
      /* Qué juegos tienen vídeo de vista previa: así no se pide ninguno que
         no exista. */
      vistasPrevias: Array.isArray(datos.vistasPrevias) ? datos.vistasPrevias : [],
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
        pintaCarcasa();
        avisa();
        return datos;
      });
    return pidiendo;
  }

  /* --------------------------------------------------------------- carcasas
   *
   * La carcasa se pinta desde CSS con la variable --ml3d-sp-shell, que apunta
   * a una carpeta pública. Aquí se pisa esa variable con la dirección del
   * worker cuando hay permiso, y con la carcasa de ML3D cuando no lo hay.
   *
   * Hasta que el worker contesta no se toca nada y manda el CSS: así no hay
   * un parpadeo de carcasa mientras llega la verificación.
   */
  const CARCASA_ML3D = Object.freeze({
    shell: "assets/gba-sp-ml3d.webp?v=1",
    lid: "assets/sp-lids/ml3d.webp?v=1"
  });
  let carcasaPintada = "";

  function carcasaDe(id) {
    if (!catalogo || !id || id === CARCASA_PUBLICA) return null;
    if (base && pase && catalogo.carcasas.includes(id)) {
      const ruta = base + "/v1/content/skin/" + encodeURIComponent(id);
      return { shell: conPase(ruta), lid: conPase(ruta + "/lid") };
    }
    return CARCASA_ML3D;
  }

  function pintaCarcasa() {
    const cuerpo = document.body;
    if (!cuerpo) return;
    const estilo = cuerpo.dataset.spStyle || "";
    const carcasa = carcasaDe(estilo);
    /* El pase se renueva cada poco y cambia la dirección; si la carcasa es la
       misma no se vuelve a pintar, o se descargaría de nuevo en cada renovación. */
    const clave = estilo + "|" + (carcasa === CARCASA_ML3D ? "ml3d" : carcasa ? "worker" : "css");
    if (clave === carcasaPintada) return;
    carcasaPintada = clave;
    if (carcasa) cuerpo.style.setProperty("--ml3d-sp-shell", 'url("' + carcasa.shell + '")');
    else cuerpo.style.removeProperty("--ml3d-sp-shell");
  }

  window.addEventListener("ml3d-sp-style-changed", pintaCarcasa);

  /* Sin dev=1 es el emulador público, sin juegos: no hay nada que preguntar al
     worker. Se da por contestado desde el principio, y con eso la carcasa es
     la de ML3D y el aviso sale sin esperar a nadie. Una demo sin dev=1 también
     es público: enseña el emulador, no la biblioteca. */
  const PUBLICO = (() => {
    const p = new URLSearchParams(window.location.search);
    return p.get("dev") !== "1";
  })();
  if (PUBLICO) {
    catalogo = { ...SIN_ACCESO, mensaje: "" };
    pintaCarcasa();
    document.addEventListener("DOMContentLoaded", pintaCarcasa);
  }

  window.ML3DContenido = {
    CARCASA_PUBLICA,

    /** Emulador público: se entró sin dev=1 y no hay biblioteca. */
    publico: PUBLICO,

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
      /* Preguntar sin pase devolvería "sin acceso" a un tester que todavía se
         está verificando, y el aviso saldría antes de tiempo. Se espera al
         pase; quien no lo consiga se queda en la puerta de acceso. */
      if (!pase) await paseListo;
      return catalogo || refresca();
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

    /**
     * Imágenes de la carcasa que toca enseñar para este estilo: la pedida si
     * hay permiso, la de ML3D si no. Null mientras no se sepa, y entonces
     * quien llame usa las suyas.
     */
    carcasa(id) {
      return carcasaDe(id);
    },

    /**
     * Dirección del vídeo de vista previa de un juego, o null si no tiene o no
     * hay acceso. Lo entrega el worker, como la carátula.
     */
    urlVistaPrevia(nombreJuego) {
      if (!base || !pase || !catalogo) return null;
      const fichero = String(nombreJuego || "").replace(/\.(gba|gbc|gb)$/i, "") + ".mp4";
      if (!(catalogo.vistasPrevias || []).includes(fichero)) return null;
      return conPase(base + "/v1/content/preview/" + encodeURIComponent(fichero));
    },

    /**
     * Etiqueta de cartucho que no es de ML3D: la describe el catálogo y la
     * imagen la entrega el worker. Null si no hay acceso o no existe.
     */
    etiqueta(id) {
      if (!base || !pase || !catalogo) return null;
      const dato = (catalogo.etiquetas || []).find((e) => e.id === id);
      const fichero = String(dato?.asset || "").replace(/^privado:/, "");
      if (!dato || !fichero) return null;
      return {
        src: conPase(base + "/v1/content/label/" + encodeURIComponent(fichero)),
        crop: dato.crop,
        destination: dato.destination,
        preserveAspect: Boolean(dato.preserveAspect)
      };
    },

    /** Para enterarse de cuándo cambia el acceso. */
    alCambiar(funcion) {
      oyentes.add(funcion);
      if (catalogo) { try { funcion(catalogo); } catch (e) { console.error(e); } }
      return () => oyentes.delete(funcion);
    },

    ajustes,

    /**
     * Un tester pide un juego de la biblioteca que su acceso no incluye. Llega
     * a la app de gestión. Devuelve { ok, status } o { ok: false, reason }.
     */
    async pideJuego(nombre) {
      if (!base || !pase) return { ok: false, reason: "sin_acceso" };
      try {
        const respuesta = await fetch(base + "/v1/access/game-request", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-ML3D-Content-Pass": pase },
          body: JSON.stringify({ game: String(nombre || "") })
        });
        const datos = await respuesta.json().catch(() => ({}));
        return respuesta.ok ? datos : { ok: false, reason: datos.reason || "error" };
      } catch (_) {
        return { ok: false, reason: "sin_conexion" };
      }
    },

    /** Las peticiones de juego de este dispositivo y cómo han quedado. */
    async misPeticiones() {
      if (!base || !pase) return [];
      try {
        const respuesta = await fetch(base + "/v1/access/game-requests", {
          headers: { "X-ML3D-Content-Pass": pase }, cache: "no-store"
        });
        if (!respuesta.ok) return [];
        const datos = await respuesta.json();
        return Array.isArray(datos.requests) ? datos.requests : [];
      } catch (_) {
        return [];
      }
    },

    /** Solo para pruebas: fija la dirección del worker a mano. */
    _base(url) {
      base = String(url || "").replace(/\/+$/, "");
    }
  };
})();
