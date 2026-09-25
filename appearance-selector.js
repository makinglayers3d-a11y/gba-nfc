(() => {
  "use strict";

  const FAMILY_KEY = "ml3d-appearance-family";
  const SP_STYLE_KEY = "ml3d-sp-style";
  const ANIMATIONS_KEY = "ml3d-console-animations-enabled";
  const SP_STYLES = [
    "ml3d",
    "silver",
    "gray-red",
    "cream-burgundy",
    "gold-zelda",
    "yellow-character",
    "groudon",
    "kyogre",
    "rayquaza"
  ];

  const UPDATE_ITEMS = [
    ["GBA + GB + GBC", "IodineGBA y binjgb conviven con cambio estable entre los tres sistemas."],
    ["Selector renovado", "Nuevo selector visual con portadas y filtros TODOS, GB, GBC y GBA."],
    ["ROMs locales", "Carga .gba, .gb y .gbc desde el dispositivo; la ROM permanece solo en memoria."],
    ["Cambio sin recargar", "Alterna entre ROM local y catálogo deteniendo limpiamente el núcleo anterior."],
    ["Guardados locales", "Identidad estable para recuperar las partidas de una ROM local al volver a elegirla."],
    ["Nuevos estilos SP", "Silver, gris-roja, crema-burdeos, Zelda dorada y amarilla."],
    ["SP legendarias", "Carcasas Groudon, Kyogre y Rayquaza con geometría y controles alineados."],
    ["Tapas SP", "Cada modelo usa su tapa y una apertura/cierre realista desde la bisagra."],
    ["Cambio animado", "Transiciones completas entre estilos y familias de consola."],
    ["Control Anim.", "Interruptor persistente para activar o aplicar al instante los cambios de consola."],
    ["Nuevo arranque", "Secuencia continua: cartucho, apertura de consola, ML3D, aviso y juego."],
    ["Cartuchos dinámicos", "Color y etiqueta configurables mediante un catálogo seguro."],
    ["Etiquetas especiales", "Diseños de Pokémon y Zelda: The Minish Cap preparados para cada cartucho."],
    ["Reconocimiento", "Sonido y vibración acompañan la entrada del cartucho."],
    ["Guardado visual", "Tarjeta ML3D con captura, juego, sistema, tiempo, fecha, hora y SAVE OK."],
    ["Tarjeta absorbida", "La confirmación levita y termina entrando claramente en el botón MENU."],
    ["Controles y audio", "Mejoras en touch, teclado, volumen, mute y vibración configurable."],
    ["Touch Lab", "Herramientas, perfiles y calibración precisa de controles, incluida la disposición SP."],
    ["Selector SP horizontal", "Todos los estilos ocupan una fila deslizable con touch y ratón."],
    ["Estabilidad", "Transiciones más limpias, assets alineados y correcciones de carga y caché."]
  ];

  /* Remove state left behind by the retired custom SP colour editor. */
  localStorage.removeItem("ml3d-sp-shell-color");
  localStorage.removeItem("ml3d-sp-button-color");
  document.documentElement.style.removeProperty("--ml3d-custom-sp-shell");
  if (!SP_STYLES.includes(localStorage.getItem(SP_STYLE_KEY) || "silver")) {
    localStorage.setItem(SP_STYLE_KEY, "silver");
  }

  function injectMenuStyles() {
    if (document.getElementById("ml3d-menu-ui-styles")) return;

    const style = document.createElement("style");
    style.id = "ml3d-menu-ui-styles";
    style.textContent = `
      #menu { overflow: visible !important; }

      #ml3d-appearance-selector { margin: .35rem 0 .55rem !important; min-width: 0; }

      .ml3d-family-line {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 78px;
        align-items: stretch;
        gap: 8px;
        margin-bottom: 8px;
        min-width: 0;
      }

      .ml3d-family-line .ml3d-family-tabs {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
        gap: 7px !important;
        margin: 0 !important;
        min-width: 0;
      }

      .ml3d-family-line .ml3d-family-tabs button {
        min-width: 0 !important;
        min-height: 38px !important;
        height: 38px !important;
        padding: 0 8px !important;
        font-size: clamp(10px, 2.5vw, 13px) !important;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      #ml3d-animation-toggle {
        position: relative !important;
        width: 78px !important;
        min-width: 78px !important;
        height: 38px !important;
        min-height: 38px !important;
        margin: 0 !important;
        padding: 0 8px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 5px !important;
        border-radius: 999px !important;
        border: 1px solid #ffffff35 !important;
        background: #ffffff0c !important;
        color: inherit !important;
        box-shadow: none !important;
        text-shadow: none !important;
        font-size: 9px !important;
        font-weight: 900 !important;
        letter-spacing: .02em !important;
        overflow: hidden !important;
      }

      #ml3d-animation-toggle::after {
        content: "" !important;
        position: static !important;
        flex: 0 0 18px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #8b919a !important;
        box-shadow: inset 0 0 0 1px #ffffff30 !important;
        transform: none !important;
        animation: none !important;
      }

      #ml3d-animation-toggle[aria-pressed="true"] {
        border-color: #79f4ff !important;
        background: #0d789455 !important;
        box-shadow: 0 0 10px #36eaff44 !important;
      }

      #ml3d-animation-toggle[aria-pressed="true"]::after {
        background: #d9ffff !important;
        box-shadow: 0 0 8px #72f6ff, inset 0 0 0 1px #ffffffaa !important;
      }

      .ml3d-style-label {
        margin: 2px 0 6px !important;
        font-size: .78rem;
      }

      .ml3d-sp-swatches {
        display: flex !important;
        flex-wrap: nowrap !important;
        align-items: center !important;
        gap: 10px !important;
        width: 100%;
        max-width: 100%;
        min-width: 0;
        overflow-x: auto !important;
        overflow-y: hidden !important;
        padding: 4px 4px 7px !important;
        margin: 0 !important;
        scrollbar-width: none;
        -ms-overflow-style: none;
        overscroll-behavior-x: contain;
        scroll-snap-type: x proximity;
        touch-action: pan-x !important;
        -webkit-overflow-scrolling: touch;
      }

      .ml3d-sp-swatches::-webkit-scrollbar { display: none; }

      .ml3d-sp-swatches button {
        flex: 0 0 38px !important;
        width: 38px !important;
        min-width: 38px !important;
        height: 38px !important;
        min-height: 38px !important;
        scroll-snap-align: center;
      }

      #ml3d-updates-button {
        position: absolute !important;
        z-index: 120 !important;
        top: -18px !important;
        left: 22px !important;
        width: 36px !important;
        min-width: 36px !important;
        height: 36px !important;
        min-height: 36px !important;
        margin: 0 !important;
        padding: 0 !important;
        display: grid !important;
        place-items: center !important;
        border-radius: 50% !important;
        border: 1px solid #ffffff90 !important;
        background: #111922e8 !important;
        color: #fff !important;
        box-shadow: 0 7px 18px #0009, 0 0 12px #75dfff33 !important;
        text-shadow: 0 0 8px #8cecff !important;
        font: 950 20px/1 system-ui, sans-serif !important;
        overflow: visible !important;
      }

      #ml3d-updates-button::before,
      #ml3d-updates-button::after {
        content: none !important;
        display: none !important;
      }

      #ml3d-updates-button:active { transform: scale(.94) !important; }

      #ml3d-updates-panel {
        position: absolute;
        z-index: 115;
        inset: 10px;
        padding: 18px 16px 16px;
        overflow: auto;
        border: 1px solid #87dfff70;
        border-radius: 18px;
        background: linear-gradient(150deg, #111b27f7, #070c12fb);
        color: #fff;
        box-shadow: 0 24px 70px #000e, inset 0 0 28px #76dfff0c;
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
      }

      #ml3d-updates-panel[hidden] { display: none !important; }

      .ml3d-updates-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
      }

      .ml3d-updates-title {
        font-size: 15px;
        font-weight: 950;
        letter-spacing: .08em;
      }

      .ml3d-updates-subtitle {
        display: block;
        margin-top: 3px;
        color: #9aabba;
        font-size: 9px;
        font-weight: 800;
        letter-spacing: .08em;
      }

      #ml3d-updates-close {
        width: 32px !important;
        min-width: 32px !important;
        height: 32px !important;
        min-height: 32px !important;
        margin: 0 !important;
        padding: 0 !important;
        border-radius: 50% !important;
        border: 1px solid #ffffff2b !important;
        background: #ffffff0c !important;
        color: #fff !important;
        box-shadow: none !important;
        font-size: 18px !important;
        line-height: 1 !important;
      }

      #ml3d-updates-close::after { content: none !important; display: none !important; }

      .ml3d-updates-list {
        display: grid;
        gap: 8px;
      }

      .ml3d-update-item {
        padding: 9px 10px;
        border: 1px solid #ffffff12;
        border-radius: 11px;
        background: #ffffff08;
      }

      .ml3d-update-item strong {
        display: block;
        margin-bottom: 3px;
        color: #e9fbff;
        font-size: 11px;
        font-weight: 950;
      }

      .ml3d-update-item span {
        display: block;
        color: #a8b5c2;
        font-size: 9px;
        line-height: 1.35;
      }

      @media (max-width: 370px) {
        .ml3d-family-line { grid-template-columns: minmax(0, 1fr) 70px; gap: 6px; }
        #ml3d-animation-toggle { width: 70px !important; min-width: 70px !important; padding: 0 6px !important; }
        .ml3d-family-line .ml3d-family-tabs { gap: 5px !important; }
        .ml3d-sp-swatches { gap: 8px !important; }
      }

      /* Landscape uses the regular controls; retain the saved portrait skin. */
      @media (orientation: landscape) {
        #ml3d-appearance-selector .ml3d-family-line,
        #ml3d-appearance-selector [data-panel="sp"] {
          display: none !important;
        }
        #ml3d-appearance-selector [data-panel="custom"] {
          display: block !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function animationsEnabled() {
    return localStorage.getItem(ANIMATIONS_KEY) !== "false";
  }

  function setAnimationsEnabled(enabled, save = true) {
    enabled = Boolean(enabled);
    if (save) localStorage.setItem(ANIMATIONS_KEY, String(enabled));

    const button = document.getElementById("ml3d-animation-toggle");
    if (button) {
      button.setAttribute("aria-pressed", String(enabled));
      button.setAttribute(
        "aria-label",
        enabled
          ? "Desactivar animaciones de cambio de consola"
          : "Activar animaciones de cambio de consola"
      );
      button.title = enabled ? "Animaciones activadas" : "Animaciones desactivadas";
    }

    window.dispatchEvent(new CustomEvent("ml3d-console-animations-changed", {
      detail: { enabled }
    }));
  }

  function buildUpdatesUI() {
    const menu = document.getElementById("menu");
    const card = menu && menu.querySelector(".menu-card");
    if (!menu || !card) return;

    if (!document.getElementById("ml3d-updates-button")) {
      const button = document.createElement("button");
      button.id = "ml3d-updates-button";
      button.type = "button";
      button.textContent = "?";
      button.setAttribute("aria-label", "Ver novedades de ML3Demuler");
      button.setAttribute("aria-expanded", "false");
      menu.insertBefore(button, card);

      const panel = document.createElement("section");
      panel.id = "ml3d-updates-panel";
      panel.hidden = true;
      panel.setAttribute("aria-label", "Novedades de ML3Demuler");

      const head = document.createElement("div");
      head.className = "ml3d-updates-head";
      head.innerHTML = `
        <div>
          <div class="ml3d-updates-title">NOVEDADES</div>
          <span class="ml3d-updates-subtitle">PORT DEL REPO DE PRUEBAS AL PRINCIPAL</span>
        </div>
        <button id="ml3d-updates-close" type="button" aria-label="Cerrar novedades">×</button>`;

      const list = document.createElement("div");
      list.className = "ml3d-updates-list";
      UPDATE_ITEMS.forEach(([title, description]) => {
        const item = document.createElement("div");
        item.className = "ml3d-update-item";
        const strong = document.createElement("strong");
        strong.textContent = title;
        const span = document.createElement("span");
        span.textContent = description;
        item.append(strong, span);
        list.appendChild(item);
      });

      panel.append(head, list);
      menu.appendChild(panel);

      const setOpen = (open) => {
        panel.hidden = !open;
        button.setAttribute("aria-expanded", String(open));
      };

      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setOpen(panel.hidden);
      });

      head.querySelector("#ml3d-updates-close").addEventListener("click", (event) => {
        event.preventDefault();
        setOpen(false);
      });

      if (menu.dataset.ml3dUpdatesCloseBound !== "1") {
        menu.dataset.ml3dUpdatesCloseBound = "1";
        menu.addEventListener("close", () => setOpen(false));
      }
    }
  }

  function build() {
    injectMenuStyles();
    buildUpdatesUI();

    const section = document.querySelector("#menu .appearance-control");
    if (!section) return;

    let selector = document.getElementById("ml3d-appearance-selector");

    if (!selector) {
      const colorGroups = section.querySelectorAll(":scope > .color-group");
      selector = document.createElement("div");
      selector.id = "ml3d-appearance-selector";
      selector.innerHTML = `
        <div class="ml3d-family-line">
          <div class="ml3d-family-tabs" role="tablist" aria-label="Estilo de apariencia">
            <button type="button" data-family="custom">Personalizado</button>
            <button type="button" data-family="sp">SP</button>
          </div>
          <button id="ml3d-animation-toggle" type="button" aria-pressed="true"><span>Anim.</span></button>
        </div>
        <div class="ml3d-family-panel" data-panel="custom"><div class="ml3d-custom-slot"></div></div>
        <div class="ml3d-family-panel" data-panel="sp">
          <span class="ml3d-style-label">Color de Game Boy Advance SP</span>
          <div class="ml3d-sp-swatches">
            <button type="button" data-sp="ml3d" style="--swatch:linear-gradient(135deg,#009fe8 0 52%,#20262d 53%)" aria-label="SP personalizada ML3D" title="ML3D"></button>
            <button type="button" data-sp="silver" style="--swatch:#c8c9c9" aria-label="SP plateada" title="Plateada"></button>
            <button type="button" data-sp="gray-red" style="--swatch:linear-gradient(135deg,#c4c4c4 0 62%,#a31521 63%)" aria-label="SP gris con botones rojos" title="Gris y roja"></button>
            <button type="button" data-sp="cream-burgundy" style="--swatch:linear-gradient(135deg,#f3e4cd 0 62%,#741326 63%)" aria-label="SP crema con botones burdeos" title="Crema y burdeos"></button>
            <button type="button" data-sp="gold-zelda" style="--swatch:linear-gradient(135deg,#d8b64b 0 62%,#171717 63%)" aria-label="SP dorada Zelda" title="Dorada Zelda"></button>
            <button type="button" data-sp="yellow-character" style="--swatch:linear-gradient(135deg,#ffd70a 0 62%,#965d46 63%)" aria-label="SP amarilla" title="Amarilla"></button>
            <button type="button" data-sp="groudon" style="--swatch:linear-gradient(135deg,#d52f33 0 68%,#292929 69%)" aria-label="SP roja Groudon" title="Groudon"></button>
            <button type="button" data-sp="kyogre" style="--swatch:linear-gradient(135deg,#0867e8 0 68%,#17233c 69%)" aria-label="SP azul Kyogre" title="Kyogre"></button>
            <button type="button" data-sp="rayquaza" style="--swatch:linear-gradient(135deg,#08a873 0 68%,#075f50 69%)" aria-label="SP verde Rayquaza" title="Rayquaza"></button>
          </div>
        </div>`;

      section.insertBefore(selector, section.children[1] || null);

      const customSlot = selector.querySelector(".ml3d-custom-slot");
      colorGroups.forEach((group) => customSlot.appendChild(group));

      selector.addEventListener("click", async (event) => {
        const animationButton = event.target.closest("#ml3d-animation-toggle");
        if (animationButton) {
          setAnimationsEnabled(!animationsEnabled());
          return;
        }

        const familyButton = event.target.closest("[data-family]");
        if (familyButton) {
          await requestAppearance(familyButton.dataset.family, currentStyle());
          return;
        }

        const spButton = event.target.closest("[data-sp]");
        if (spButton) await requestAppearance("sp", spButton.dataset.sp);
      });
    }

    setAnimationsEnabled(animationsEnabled(), false);
    setFamily(localStorage.getItem(FAMILY_KEY) || "sp", false);
    setSP(localStorage.getItem(SP_STYLE_KEY) || "silver", false);
  }

  function currentStyle() {
    const style = document.body.dataset.spStyle || localStorage.getItem(SP_STYLE_KEY) || "silver";
    return SP_STYLES.includes(style) ? style : "silver";
  }

  async function requestAppearance(family, style) {
    family = family === "custom" ? "custom" : "sp";
    if (!SP_STYLES.includes(style)) style = "silver";

    const apply = () => {
      setFamily(family);
      setSP(style);
    };

    const transitions = window.ML3DConsoleTransitions;
    if (transitions && animationsEnabled()) {
      await transitions.switchAppearanceAnimated(family, style, apply);
    } else {
      apply();
    }
  }

  function setFamily(family, save = true) {
    family = family === "custom" ? "custom" : "sp";
    if (save) localStorage.setItem(FAMILY_KEY, family);
    document.body.dataset.appearanceFamily = family;

    document.querySelectorAll("#ml3d-appearance-selector [data-family]").forEach((button) => {
      const active = button.dataset.family === family;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });

    document.querySelectorAll("#ml3d-appearance-selector [data-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== family;
    });

    document.body.classList.toggle("sp-skin-test", family === "sp");
    document.body.classList.toggle("ml3d-custom-skin", family === "custom");

    window.dispatchEvent(new CustomEvent("ml3d-appearance-changed", {
      detail: { family, style: localStorage.getItem(SP_STYLE_KEY) || "silver" }
    }));
  }

  function setSP(style, save = true) {
    if (!SP_STYLES.includes(style)) style = "silver";
    if (save) localStorage.setItem(SP_STYLE_KEY, style);
    document.body.dataset.spStyle = style;

    document.querySelectorAll("#ml3d-appearance-selector [data-sp]").forEach((button) => {
      const active = button.dataset.sp === style;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      if (active && button.parentElement) {
        button.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      }
    });

    window.dispatchEvent(new CustomEvent("ml3d-sp-style-changed", { detail: { style } }));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
