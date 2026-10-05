(() => {
  "use strict";

  /* Aviso para quien no tiene la biblioteca de juegos.
   *
   * Dos casos:
   *  - Emulador público: se entró sin dev=1. No hay juegos y no los habrá por
   *    este camino; la llave de tester es el cartucho con dev=1.
   *  - Con dev=1 y sin acceso a contenido: el servidor lo dice en el catálogo.
   *
   * El emulador sigue funcionando: la carcasa de ML3D es pública y los
   * controles responden. Lo que falta es la biblioteca, y eso es lo que este
   * aviso explica, en vez de dejar una pantalla negra sin decir por qué.
   *
   * No lleva botón para pedir acceso a propósito: el acceso se pide desde un
   * enlace de tester, no desde el emulador público.
   */

  const ID = "ml3d-aviso-sin-acceso";

  function quitar() {
    document.getElementById(ID)?.remove();
  }

  function mostrar(mensajeDelServidor) {
    if (document.getElementById(ID) || window.ML3DContenido?.hayAcceso) return;

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
    titulo.textContent = "Emulador sin biblioteca de juegos";

    const cuerpo = document.createElement("div");
    cuerpo.style.cssText = "opacity:.88";
    cuerpo.textContent = mensajeDelServidor ||
      "El emulador funciona, pero los juegos de la biblioteca solo están " +
      "disponibles para testers, con un cartucho de tester.";

    const cerrar = document.createElement("button");
    cerrar.type = "button";
    cerrar.textContent = "Entendido";
    cerrar.style.cssText =
      "margin-top:12px;padding:9px 20px;border:0;border-radius:9px;cursor:pointer;" +
      "background:#3b6fd4;color:#fff;font:600 14px system-ui,sans-serif";
    cerrar.addEventListener("click", quitar);

    caja.append(titulo, cuerpo, cerrar);
    document.documentElement.appendChild(caja);
  }

  /* Con dev=1 el catálogo llega tras verificarse: si trae acceso, el aviso
     sobra; si no, se enseña lo que diga el servidor. */
  window.addEventListener("ml3d-contenido", (evento) => {
    const estado = evento.detail;
    if (estado?.acceso) { quitar(); return; }
    mostrar(estado?.mensaje);
  });

  /* En el emulador público no hay nada que esperar. */
  if (window.ML3DContenido?.publico) mostrar("");

  /* Peticiones de juego resueltas: el tester se entera una vez de cada una.
     Denegada, se le dice que no se ha concedido; aprobada, que ya lo tiene. */
  const VISTAS = "ml3d-peticiones-juego-vistas";
  let peticionesMiradas = false;

  function avisoBreve(texto) {
    const caja = document.createElement("div");
    caja.setAttribute("role", "status");
    caja.style.cssText =
      "position:fixed;left:50%;top:18px;transform:translateX(-50%);" +
      "z-index:2147483000;max-width:min(92vw,520px);box-sizing:border-box;" +
      "padding:12px 16px;border-radius:12px;background:rgba(16,22,30,.96);" +
      "color:#eef2f8;border:1px solid rgba(255,255,255,.14);" +
      "box-shadow:0 10px 30px rgba(0,0,0,.45);text-align:center;cursor:pointer;" +
      "font:14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif";
    caja.textContent = texto;
    caja.addEventListener("click", () => caja.remove());
    document.body.append(caja);
    setTimeout(() => caja.remove(), 12000);
  }

  async function miraPeticiones() {
    if (peticionesMiradas || !window.ML3DContenido?.hayAcceso) return;
    peticionesMiradas = true;
    let vistas = [];
    try { vistas = JSON.parse(localStorage.getItem(VISTAS) || "[]"); } catch (_) {}
    const resueltas = (await window.ML3DContenido.misPeticiones())
      .filter((p) => (p.status === "approved" || p.status === "rejected") && !vistas.includes(p.id));
    if (!resueltas.length) return;
    const nombre = (p) => String(p.game || "").replace(/[.](gba|gbc|gb)$/i, "");
    const si = resueltas.filter((p) => p.status === "approved").map(nombre);
    const no = resueltas.filter((p) => p.status === "rejected").map(nombre);
    const frases = [];
    if (si.length) frases.push("Acceso concedido: " + si.join(", ") + ".");
    if (no.length) frases.push("No se ha concedido el acceso a: " + no.join(", ") + ".");
    avisoBreve(frases.join(" "));
    try {
      localStorage.setItem(VISTAS, JSON.stringify([...vistas, ...resueltas.map((p) => p.id)].slice(-200)));
    } catch (_) {}
  }

  window.addEventListener("ml3d-contenido", miraPeticiones);
})();
