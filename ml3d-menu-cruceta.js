(() => {
  "use strict";

  /* El menú del emulador con la cruceta.

     Con el menú abierto, las flechas mueven un cursor por sus botones, A o
     Enter pulsan y B lo cierra. Antes esas teclas le llegaban al juego, que
     seguía detrás del menú. app.js llama aquí desde su manejador de teclado,
     con el botón de GBA ya traducido (UP, DOWN, LEFT, RIGHT, A, B, START...).

     El cursor va al botón más cercano en esa dirección, mirando dónde está
     cada uno en pantalla: el menú no es una lista, tiene filas de varios. */

  const menu = document.getElementById("menu");
  if (!menu) return;
  let actual = null;

  const visibles = () => [...menu.querySelectorAll("button, select, input, a[href]")].filter((el) => {
    if (el.disabled || el.closest("[hidden]")) return false;
    const r = el.getBoundingClientRect();
    return r.width > 3 && r.height > 3 && getComputedStyle(el).visibility !== "hidden";
  });

  function marca(el) {
    menu.querySelectorAll(".ml3d-menu-cursor").forEach((x) => x.classList.remove("ml3d-menu-cursor"));
    actual = el;
    if (!el) return;
    el.classList.add("ml3d-menu-cursor");
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function mueve(dir) {
    const cosas = visibles();
    if (!cosas.length) return;
    if (!actual || !cosas.includes(actual)) { marca(cosas[0]); return; }
    const o = actual.getBoundingClientRect();
    const ox = o.left + o.width / 2, oy = o.top + o.height / 2;
    const vertical = dir === "UP" || dir === "DOWN";
    const signo = dir === "UP" || dir === "LEFT" ? -1 : 1;
    let mejor = null, nota = Infinity;
    for (const el of cosas) {
      if (el === actual) continue;
      const r = el.getBoundingClientRect();
      const dx = r.left + r.width / 2 - ox, dy = r.top + r.height / 2 - oy;
      const avance = (vertical ? dy : dx) * signo;
      if (avance < 4) continue;   /* no está en esa dirección */
      /* Lo que se desvía de lado pesa más: mejor el de la misma fila o columna. */
      const desvio = vertical
        ? Math.max(0, Math.max(r.left - o.right, o.left - r.right))
        : Math.max(0, Math.max(r.top - o.bottom, o.top - r.bottom));
      const n = avance + desvio * 3 + Math.abs(vertical ? dx : dy) * 0.05;
      if (n < nota) { nota = n; mejor = el; }
    }
    if (mejor) marca(mejor);
  }

  /* Desplegables y deslizadores: izquierda y derecha cambian el valor. */
  function ajusta(el, paso) {
    if (el instanceof HTMLSelectElement) {
      const i = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + paso));
      if (i === el.selectedIndex) return true;
      el.selectedIndex = i;
    } else if (el instanceof HTMLInputElement && el.type === "range") {
      const salto = Number(el.step) || (Number(el.max || 100) - Number(el.min || 0)) / 20;
      const v = Math.max(Number(el.min || 0), Math.min(Number(el.max || 100), Number(el.value) + paso * salto));
      if (v === Number(el.value)) return true;
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else return false;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  /* Devuelve true si el menú está abierto y se queda con la pulsación. */
  function tecla(boton) {
    if (!menu.open) return false;
    /* Encima del menú puede haber otra ventana (el selector de juegos, el
       lobby): entonces no es cosa de este cursor. */
    const encima = [...document.querySelectorAll("dialog[open]")].some((d) => d !== menu && !menu.contains(d) && !d.contains(menu));
    if (encima || window.ML3DLobbyOverlay?.isOpen) return false;
    if (boton === "UP" || boton === "DOWN") mueve(boton);
    else if (boton === "LEFT" || boton === "RIGHT") {
      if (!actual || !ajusta(actual, boton === "LEFT" ? -1 : 1)) mueve(boton);
    } else if (boton === "A" || boton === "START") {
      if (actual && visibles().includes(actual)) actual.click(); else mueve("DOWN");
    } else if (boton === "B") document.getElementById("close-menu")?.click();
    return true;
  }

  menu.addEventListener("close", () => marca(null));

  const estilo = document.createElement("style");
  estilo.textContent = `#menu .ml3d-menu-cursor { outline: 3px solid #ffffff !important; outline-offset: 2px !important; }`;
  document.head.append(estilo);

  window.ML3DMenuCruceta = { tecla };
})();
