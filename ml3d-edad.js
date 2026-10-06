(() => {
  "use strict";

  /* Comprobación de edad para entrar al lobby (ML3D Link).

     La primera vez que alguien abre el lobby en este dispositivo se le pide
     la fecha de nacimiento, sin decirle antes qué edad hace falta. Se calcula
     aquí mismo si la cumple.

     - La fecha NO se guarda ni se envía a ningún sitio. Solo se recuerda, en
       este navegador, si la comprobación se superó ("ok") o no ("no").
     - Si no la cumple, el lobby queda cerrado en este dispositivo y no se
       vuelve a preguntar: no vale reintentar con otra fecha. El resto del
       emulador sigue funcionando.
     - Vale para todos, testers incluidos, una vez por dispositivo.

     Límites, a sabiendas: es una declaración, no una verificación. Se salta
     borrando los datos del sitio, en una ventana privada, desde otro
     navegador o dispositivo, o diciendo otra fecha la primera vez. */

  const CLAVE = "ml3d-lobby-edad";
  const EDAD_MINIMA = 16;
  const TEXTO_CERRADO = "El lobby no está disponible en este dispositivo.";

  function lee() {
    try { return localStorage.getItem(CLAVE) || ""; } catch { return ""; }
  }
  function guarda(valor) {
    try { localStorage.setItem(CLAVE, valor); } catch {}
  }

  /* Años cumplidos hoy por quien nació ese día; null si la fecha no existe
     (30 de febrero) o es futura. */
  function edad(dia, mes, anio, hoy = new Date()) {
    const f = new Date(anio, mes - 1, dia);
    if (f.getFullYear() !== anio || f.getMonth() !== mes - 1 || f.getDate() !== dia || f > hoy) return null;
    let n = hoy.getFullYear() - anio;
    if (hoy.getMonth() < mes - 1 || (hoy.getMonth() === mes - 1 && hoy.getDate() < dia)) n--;
    return n;
  }

  function ventana() {
    let d = document.querySelector("dialog.ml3d-edad");
    if (d) return d;
    const estilo = document.createElement("style");
    estilo.textContent = `
      dialog.ml3d-edad { width: min(92vw, 360px); padding: 18px; border: 1px solid #42546a; border-radius: 16px; background: #111821; color: #f5f7fa; font: 16px/1.4 system-ui, sans-serif; }
      dialog.ml3d-edad::backdrop { background: rgba(0, 0, 0, .78); }
      dialog.ml3d-edad h2 { margin: 0 0 12px; font-size: 18px; }
      dialog.ml3d-edad p { margin: 0 0 12px; }
      dialog.ml3d-edad .ml3d-edad-fecha { display: grid; grid-template-columns: 1fr 1.6fr 1.2fr; gap: 8px; }
      dialog.ml3d-edad label { display: block; font-size: 12px; margin-bottom: 4px; color: #b9c4d0; }
      dialog.ml3d-edad select, dialog.ml3d-edad button { width: 100%; min-height: 44px; padding: 8px; border: 1px solid #42546a; border-radius: 10px; background: #0b1119; color: #f5f7fa; font: inherit; }
      dialog.ml3d-edad button { font-weight: 800; cursor: pointer; }
      dialog.ml3d-edad button.principal { background: #294a70; }
      dialog.ml3d-edad .ml3d-edad-botones { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 16px; }
      dialog.ml3d-edad .ml3d-edad-error { min-height: 1.4em; margin: 10px 0 0; color: #ffc7cc; font-size: 14px; }
    `;
    document.head.append(estilo);
    d = document.createElement("dialog");
    d.className = "ml3d-edad";
    document.body.append(d);
    return d;
  }

  function avisoCerrado() {
    return new Promise((resuelve) => {
      const d = ventana();
      d.innerHTML = `<p></p><div class="ml3d-edad-botones" style="grid-template-columns:1fr"><button type="button" class="principal">ENTENDIDO</button></div>`;
      d.querySelector("p").textContent = TEXTO_CERRADO;
      const cierra = () => { if (d.open) d.close(); resuelve(false); };
      d.querySelector("button").addEventListener("click", cierra);
      d.addEventListener("cancel", () => resuelve(false), { once: true });
      if (!d.open) d.showModal();
    });
  }

  function pregunta() {
    return new Promise((resuelve) => {
      const d = ventana();
      const anioActual = new Date().getFullYear();
      const opciones = (desde, hasta, texto) => {
        let html = `<option value="">${texto}</option>`;
        const paso = desde <= hasta ? 1 : -1;
        for (let n = desde; n !== hasta + paso; n += paso) html += `<option value="${n}">${n}</option>`;
        return html;
      };
      const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
      d.innerHTML = `
        <h2>Fecha de nacimiento</h2>
        <p>Indica tu fecha de nacimiento para continuar.</p>
        <div class="ml3d-edad-fecha">
          <div><label for="ml3dEdadDia">Día</label><select id="ml3dEdadDia">${opciones(1, 31, "Día")}</select></div>
          <div><label for="ml3dEdadMes">Mes</label><select id="ml3dEdadMes"><option value="">Mes</option>${MESES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("")}</select></div>
          <div><label for="ml3dEdadAnio">Año</label><select id="ml3dEdadAnio">${opciones(anioActual, 1900, "Año")}</select></div>
        </div>
        <p class="ml3d-edad-error" role="alert"></p>
        <div class="ml3d-edad-botones">
          <button type="button" data-accion="cancelar">CANCELAR</button>
          <button type="button" data-accion="seguir" class="principal">CONTINUAR</button>
        </div>`;
      const fin = (valor) => { if (d.open) d.close(); resuelve(valor); };
      d.querySelector('[data-accion="cancelar"]').addEventListener("click", () => fin(null));
      d.addEventListener("cancel", () => resuelve(null), { once: true });
      d.querySelector('[data-accion="seguir"]').addEventListener("click", () => {
        const dia = Number(d.querySelector("#ml3dEdadDia").value);
        const mes = Number(d.querySelector("#ml3dEdadMes").value);
        const anio = Number(d.querySelector("#ml3dEdadAnio").value);
        const n = dia && mes && anio ? edad(dia, mes, anio) : null;
        if (n === null) { d.querySelector(".ml3d-edad-error").textContent = "Esa fecha no es válida."; return; }
        /* La fecha se queda aquí: de esta función solo sale un sí o un no. */
        fin(n >= EDAD_MINIMA);
      });
      if (!d.open) d.showModal();
    });
  }

  let enCurso = null;
  /* Resuelve true si se puede entrar al lobby. */
  function pide() {
    if (lee() === "ok") return Promise.resolve(true);
    if (enCurso) return enCurso;
    enCurso = (async () => {
      if (lee() === "no") return avisoCerrado();
      const respuesta = await pregunta();
      if (respuesta === null) return false;   /* canceló: no se apunta nada */
      guarda(respuesta ? "ok" : "no");
      return respuesta ? true : avisoCerrado();
    })().finally(() => { enCurso = null; });
    return enCurso;
  }

  window.ML3DEdad = {
    get superada() { return lee() === "ok"; },
    pide,
    edad   /* para las pruebas */
  };
})();
