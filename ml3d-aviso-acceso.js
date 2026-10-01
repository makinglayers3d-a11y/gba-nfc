(() => {
  "use strict";

  /* Aviso para quien no tiene acceso de tester.
   *
   * Hasta ahora, un navegador sin acceso se quedaba en "Preparando emulador…"
   * para siempre, sin decir por qué. Quien llegaba por una etiqueta NFC veía
   * una pantalla negra y no tenía forma de saber qué pasaba ni qué hacer.
   *
   * El emulador sigue funcionando: la carcasa de ML3D es pública y los
   * controles responden. Lo que falta es la biblioteca, y eso es lo que este
   * aviso explica.
   */

  const ID = "ml3d-aviso-sin-acceso";
  /* Margen antes de dar por hecho que no hay acceso: la verificación tarda, y
     un aviso que parpadea mientras carga asusta más que ayuda. */
  const ESPERA_MS = 9000;

  let yaHuboAcceso = false;

  function hayAcceso() {
    if (window.ml3dAccessPolicy) return true;
    if (window.ML3DContenido?.hayAcceso) return true;
    return false;
  }

  function quitar() {
    document.getElementById(ID)?.remove();
  }

  function mostrar(mensajeDelServidor) {
    if (document.getElementById(ID) || hayAcceso()) return;

    const caja = document.createElement("div");
    caja.id = ID;
    caja.style.cssText =
      "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);" +
      "z-index:2147483000;max-width:min(92vw,520px);box-sizing:border-box;" +
      "padding:16px 18px;border-radius:14px;background:rgba(16,22,30,.96);" +
      "color:#eef2f8;border:1px solid rgba(255,255,255,.14);" +
      "box-shadow:0 10px 30px rgba(0,0,0,.45);text-align:center;" +
      "font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif";

    const titulo = document.createElement("div");
    titulo.style.cssText = "font-weight:700;font-size:16px;margin-bottom:6px";
    titulo.textContent = "Todavía no tienes acceso";

    const cuerpo = document.createElement("div");
    cuerpo.style.cssText = "opacity:.88";
    cuerpo.textContent = mensajeDelServidor ||
      "La biblioteca de juegos es solo para probadores. El emulador funciona, " +
      "pero no hay juegos disponibles para esta cuenta.";

    const pie = document.createElement("div");
    pie.style.cssText = "margin-top:10px;font-size:13px;opacity:.7";
    pie.textContent = "Pide acceso desde el menú para que te lo concedan.";

    const cerrar = document.createElement("button");
    cerrar.type = "button";
    cerrar.textContent = "Entendido";
    cerrar.style.cssText =
      "margin-top:12px;padding:9px 20px;border:0;border-radius:9px;cursor:pointer;" +
      "background:#3b6fd4;color:#fff;font:600 14px system-ui,sans-serif";
    cerrar.addEventListener("click", quitar);

    caja.append(titulo, cuerpo, pie, cerrar);
    document.documentElement.appendChild(caja);
  }

  /* Si el acceso llega más tarde -se aprueba mientras la página está abierta-
     el aviso sobra. */
  window.addEventListener("ml3d-access-policy", () => {
    if (hayAcceso()) { yaHuboAcceso = true; quitar(); }
  });

  window.addEventListener("ml3d-contenido", (evento) => {
    const estado = evento.detail;
    if (estado?.acceso) { yaHuboAcceso = true; quitar(); return; }
    mostrar(estado?.mensaje);
  });

  setTimeout(() => {
    if (yaHuboAcceso || hayAcceso()) return;
    mostrar(window.ML3DContenido?.estado?.mensaje);
  }, ESPERA_MS);
})();
