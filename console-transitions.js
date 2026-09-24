(() => {
  "use strict";

  const ANIMATIONS_KEY = "ml3d-console-animations-enabled";

  const SP_TRANSITION_ASSETS = Object.freeze({
    ml3d: Object.freeze({ shell: "assets/gba-sp-ml3d.webp?v=1", lid: "assets/sp-lids/ml3d.webp?v=1" }),
    silver: Object.freeze({ shell: "assets/gba-sp-silver.jpg?v=4", lid: "assets/sp-lids/silver.webp?v=1" }),
    "gray-red": Object.freeze({ shell: "assets/gba-sp-gray-red.png?v=3", lid: "assets/sp-lids/gray-red.webp?v=1" }),
    "cream-burgundy": Object.freeze({ shell: "assets/gba-sp-cream-burgundy.png?v=full-1", lid: "assets/sp-lids/cream-burgundy.webp?v=1" }),
    "gold-zelda": Object.freeze({ shell: "assets/gba-sp-gold-zelda.png?v=full-1", lid: "assets/sp-lids/gold-zelda.webp?v=1" }),
    "yellow-character": Object.freeze({ shell: "assets/gba-sp-yellow-character.jpg?v=1", lid: "assets/sp-lids/yellow-character.webp?v=1" }),
    groudon: Object.freeze({ shell: "assets/gba-sp-groudon.webp?v=2", lid: "assets/sp-lids/groudon.webp?v=2" }),
    kyogre: Object.freeze({ shell: "assets/gba-sp-kyogre.webp?v=2", lid: "assets/sp-lids/kyogre.webp?v=2" }),
    rayquaza: Object.freeze({ shell: "assets/gba-sp-rayquaza.webp?v=2", lid: "assets/sp-lids/rayquaza.webp?v=2" })
  });

  let transitioning = false;
  let initialIntroPlayed = false;
  let initialIntroPromise = null;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const landscape = matchMedia("(orientation: landscape)");
  const activeMotions = new Set();
  const imageLoads = new Map();

  // A rotation also cancels pending lid loads and releases the transition lock.
  const stopLandscapeMotion = () => {
    if (!landscape.matches) return;
    activeMotions.forEach((controller) => controller.abort());
    document.body.classList.remove("ml3d-console-transitioning");
  };
  if (landscape.addEventListener) landscape.addEventListener("change", stopLandscapeMotion);
  else landscape.addListener(stopLandscapeMotion);

  /*
   * El handoff del cartucho y la apertura forman una sola transición visual.
   * En el mismo instante en que el cartucho empieza a salir ocultamos la app
   * real para que nunca pueda asomar un frame de la SP ya abierta.
   */
  const handoffStyle = document.createElement("style");
  handoffStyle.textContent = `
    body.ml3d-cartridge-handoff > .app {
      opacity: 0 !important;
      pointer-events: none !important;
    }
  `;
  document.head.appendChild(handoffStyle);

  function appElement() {
    return document.querySelector("body > .app");
  }

  function closeOpenMenus() {
    document.querySelectorAll("dialog[open]").forEach((dialog) => {
      try { dialog.close(); } catch (_) { dialog.removeAttribute("open"); }
    });
    document.getElementById("ml3d-radial-menu")?.remove();
  }

  function copyCanvases(source, clone) {
    const sources = source.querySelectorAll("canvas");
    clone.querySelectorAll("canvas").forEach((canvas, index) => {
      const original = sources[index];
      if (!original) return;
      canvas.width = original.width;
      canvas.height = original.height;
      try { canvas.getContext("2d").drawImage(original, 0, 0); } catch (_) {}
    });
  }

  const BOOT_DYNAMIC_PROPERTIES = Object.freeze([
    "display",
    "visibility",
    "opacity",
    "transform",
    "filter",
    "clip-path",
    "background-color",
    "color"
  ]);

  function copyComputedTree(sourceRoot, cloneRoot) {
    const sourceNodes = [sourceRoot, ...sourceRoot.querySelectorAll("*")];
    const cloneNodes = [cloneRoot, ...cloneRoot.querySelectorAll("*")];

    sourceNodes.forEach((sourceNode, index) => {
      const cloneNode = cloneNodes[index];
      if (!cloneNode) return;
      const computed = getComputedStyle(sourceNode);

      for (let propertyIndex = 0; propertyIndex < computed.length; propertyIndex += 1) {
        const property = computed[propertyIndex];
        cloneNode.style.setProperty(property, computed.getPropertyValue(property));
      }

      cloneNode.style.setProperty("animation", "none", "important");
      cloneNode.style.setProperty("transition", "none", "important");
    });

    return { sourceNodes, cloneNodes };
  }

  function createBootMirror(source, clone) {
    const sourceBoot = source.querySelector("#boot-screen");
    const cloneBoot = clone.querySelector("#boot-screen");
    if (!sourceBoot || !cloneBoot) return null;

    cloneBoot.classList.add("ml3d-transition-boot-snapshot");
    const mirror = copyComputedTree(sourceBoot, cloneBoot);

    return () => {
      mirror.sourceNodes.forEach((sourceNode, index) => {
        const cloneNode = mirror.cloneNodes[index];
        if (!cloneNode) return;
        const computed = getComputedStyle(sourceNode);
        BOOT_DYNAMIC_PROPERTIES.forEach((property) => {
          cloneNode.style.setProperty(property, computed.getPropertyValue(property), "important");
        });
      });
    };
  }

  function loadImage(src) {
    if (!src) return Promise.resolve(false);
    if (!imageLoads.has(src)) {
      imageLoads.set(src, new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve(true);
        image.onerror = () => resolve(false);
        image.src = src;
      }));
    }
    return imageLoads.get(src);
  }

  function reverseFrames(frames) {
    return frames.slice().reverse().map((frame) => ({ ...frame, offset: 1 - frame.offset }));
  }

  function motionFrames(rect, entering, settleBeforeOpening = false) {
    const drop = Math.max(innerHeight - rect.top + rect.height * .32, rect.height * .75);
    const frames = settleBeforeOpening ? [
      { transform: `translate3d(0,${drop}px,0) scale(.12)`, opacity: 0, offset: 0 },
      { transform: `translate3d(0,${drop * .48}px,0) scale(.28)`, opacity: 1, offset: .14 },
      { transform: `translate3d(0,${rect.height * .08}px,0) scale(.78)`, opacity: 1, offset: .27 },
      { transform: "translate3d(0,0,0) scale(1)", opacity: 1, offset: .34 },
      { transform: "translate3d(0,0,0) scale(1)", opacity: 1, offset: 1 }
    ] : [
      { transform: `translate3d(0,${drop}px,0) scale(.12)`, opacity: 0, offset: 0 },
      { transform: `translate3d(0,${drop * .58}px,0) scale(.18)`, opacity: 1, offset: .18 },
      { transform: `translate3d(0,${drop * .3}px,0) scale(.34)`, opacity: 1, offset: .34 },
      { transform: `translate3d(0,${rect.height * .12}px,0) scale(.58)`, opacity: 1, offset: .55 },
      { transform: `translate3d(0,${rect.height * .02}px,0) scale(.88)`, opacity: 1, offset: .82 },
      { transform: "translate3d(0,0,0) scale(1)", opacity: 1, offset: 1 }
    ];
    return entering ? frames : reverseFrames(frames);
  }

  async function createRepresentation(family, style, rect, direction, signal) {
    const source = appElement();
    if (!source) throw new Error("No se encontró el contenedor del emulador");

    const entering = direction === "in";
    const asset = family === "sp" ? SP_TRANSITION_ASSETS[style] : null;
    let hasLid = false;
    if (asset?.lid) {
      let onAbort;
      try {
        hasLid = await Promise.race([
          loadImage(asset.lid),
          new Promise((resolve) => {
            onAbort = () => resolve(false);
            signal.addEventListener("abort", onAbort, { once: true });
          })
        ]);
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    }
    if (signal.aborted || !animationsEnabled()) return null;

    /*
     * Todo el snapshot se construye fuera del DOM. De este modo la carcasa
     * interior nunca puede pintarse sola mientras esperamos/cargamos la tapa.
     */
    const overlay = document.createElement("div");
    overlay.className = `ml3d-console-transition-overlay is-${family}`;
    Object.assign(overlay.style, {
      left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`
    });

    const bootMirrors = [];
    const buildClone = () => {
      const clone = source.cloneNode(true);
      clone.querySelectorAll("dialog").forEach((node) => node.remove());
      const bootMirror = createBootMirror(source, clone);
      if (bootMirror) bootMirrors.push(bootMirror);
      clone.removeAttribute("id");
      clone.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
      copyCanvases(source, clone);
      return clone;
    };

    const shell = document.createElement("div");
    shell.className = "ml3d-console-transition-shell";
    shell.appendChild(buildClone());
    overlay.appendChild(shell);

    let topShell = null;
    let panel = null;
    if (hasLid) {
      shell.classList.add("ml3d-console-transition-base");

      topShell = document.createElement("div");
      topShell.className = "ml3d-console-transition-shell ml3d-console-transition-top";
      topShell.appendChild(buildClone());
      overlay.appendChild(topShell);

      panel = document.createElement("img");
      panel.className = "ml3d-console-transition-lid ml3d-console-transition-panel";
      panel.alt = "";
      panel.src = asset.lid;
      overlay.appendChild(panel);

      /* Estado inicial aplicado antes de insertar el overlay: cero flashes. */
      if (entering) {
        panel.style.transform = "rotateX(0deg)";
        panel.style.opacity = "1";
        topShell.style.transform = "rotateX(-90deg)";
        topShell.style.opacity = "0";
      } else {
        panel.style.transform = "rotateX(90deg)";
        panel.style.opacity = "0";
        topShell.style.transform = "rotateX(0deg)";
        topShell.style.opacity = "1";
      }
    }

    const initialMotion = motionFrames(rect, entering, hasLid)[0];
    overlay.style.transform = initialMotion.transform;
    overlay.style.opacity = String(initialMotion.opacity);

    document.body.appendChild(overlay);

    let mirrorFrame = 0;
    let mirrorActive = bootMirrors.length > 0;
    const syncBoot = () => {
      if (!mirrorActive) return;
      bootMirrors.forEach((mirror) => mirror());
      mirrorFrame = requestAnimationFrame(syncBoot);
    };
    if (mirrorActive) syncBoot();

    return {
      overlay,
      shell,
      topShell,
      panel,
      stopBootSync() {
        mirrorActive = false;
        if (mirrorFrame) cancelAnimationFrame(mirrorFrame);
      }
    };
  }

  async function animateRepresentation(family, style, direction) {
    const app = appElement();
    if (!app || !animationsEnabled()) return;
    const controller = new AbortController();
    activeMotions.add(controller);
    let view;
    const cleanup = () => {
      if (!view) return;
      view.stopBootSync();
      view.overlay.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
      view.overlay.remove();
    };
    controller.signal.addEventListener("abort", cleanup, { once: true });

    try {
      const rect = app.getBoundingClientRect();
      const entering = direction === "in";
      view = await createRepresentation(family, style, rect, direction, controller.signal);
      if (!view || controller.signal.aborted) return;
      const duration = reducedMotion.matches ? 100 : (family === "sp" && view.panel ? 2200 : 1100);
      const easing = entering ? "cubic-bezier(.18,.72,.16,1)" : "cubic-bezier(.58,.04,.82,.42)";

      if (reducedMotion.matches && view.panel) {
        view.panel.style.opacity = "0";
      }

      const animations = [
        view.overlay.animate(motionFrames(rect, entering, Boolean(view.panel)), { duration, easing, fill: "both" })
      ];

      if (family === "sp" && view.panel && !reducedMotion.matches) {
        const panelIn = [
          { transform: "rotateX(0deg)", opacity: 1, offset: 0 },
          { transform: "rotateX(0deg)", opacity: 1, offset: .34 },
          { transform: "rotateX(18deg)", opacity: 1, offset: .43 },
          { transform: "rotateX(58deg)", opacity: 1, offset: .57 },
          { transform: "rotateX(90deg)", opacity: 1, offset: .625 },
          { transform: "rotateX(90deg)", opacity: 0, offset: .626 },
          { transform: "rotateX(90deg)", opacity: 0, offset: 1 }
        ];
        const topIn = [
          { transform: "rotateX(-90deg)", opacity: 0, offset: 0 },
          { transform: "rotateX(-90deg)", opacity: 0, offset: .625 },
          { transform: "rotateX(-90deg)", opacity: 1, offset: .626 },
          { transform: "rotateX(-80deg)", opacity: 1, offset: .68 },
          { transform: "rotateX(-58deg)", opacity: 1, offset: .76 },
          { transform: "rotateX(-18deg)", opacity: 1, offset: .91 },
          { transform: "rotateX(0deg)", opacity: 1, offset: 1 }
        ];
        animations.push(view.panel.animate(entering ? panelIn : reverseFrames(panelIn), { duration, easing, fill: "both" }));
        animations.push(view.topShell.animate(entering ? topIn : reverseFrames(topIn), { duration, easing, fill: "both" }));
      }

      await Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
    } finally {
      cleanup();
      activeMotions.delete(controller);
    }
  }

  async function runLocked(task) {
    if (transitioning) return false;
    transitioning = true;
    const controller = new AbortController();
    activeMotions.add(controller);
    closeOpenMenus();
    document.body.classList.add("ml3d-console-transitioning");
    try {
      await task(controller.signal);
      return true;
    } finally {
      document.querySelectorAll(".ml3d-console-transition-overlay").forEach((node) => node.remove());
      document.body.classList.remove("ml3d-console-transitioning");
      transitioning = false;
      activeMotions.delete(controller);
    }
  }

  function currentAppearance() {
    return {
      family: document.body.dataset.appearanceFamily || "sp",
      style: document.body.dataset.spStyle || localStorage.getItem("ml3d-sp-style") || "silver"
    };
  }

  function animationsEnabled() {
    return !landscape.matches && localStorage.getItem(ANIMATIONS_KEY) !== "false";
  }

  async function playConsoleIntro(family, style) {
    if (!animationsEnabled()) return;
    await animateRepresentation(family, style, "in");
  }

  async function playConsoleOutro(family, style) {
    if (!animationsEnabled()) return;
    await animateRepresentation(family, style, "out");
  }

  async function switchAppearanceAnimated(nextFamily, nextStyle, applyAppearance) {
    if (transitioning) return false;
    if (!animationsEnabled()) {
      applyAppearance();
      return true;
    }
    const current = currentAppearance();
    if (current.family === nextFamily && (nextFamily !== "sp" || current.style === nextStyle)) return true;
    return runLocked(async (signal) => {
      await playConsoleOutro(current.family, current.style);
      applyAppearance();
      if (signal.aborted || !animationsEnabled()) return;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (signal.aborted || !animationsEnabled()) return;
      await playConsoleIntro(nextFamily, nextStyle);
    });
  }

  function playInitialIntro() {
    if (initialIntroPromise) return initialIntroPromise;
    if (initialIntroPlayed) return Promise.resolve();
    initialIntroPlayed = true;
    if (!animationsEnabled() || new URLSearchParams(location.search).get("skipintro") === "1") {
      return Promise.resolve();
    }
    const current = currentAppearance();
    initialIntroPromise = runLocked(() => playConsoleIntro(current.family, current.style));
    return initialIntroPromise;
  }

  window.SP_TRANSITION_ASSETS = SP_TRANSITION_ASSETS;
  window.ML3DConsoleTransitions = Object.freeze({
    playConsoleIntro, playConsoleOutro, switchAppearanceAnimated, playInitialIntro,
    get transitioning() { return transitioning; }
  });

  /*
   * Arrancamos la apertura en el MISMO handoff en que sale el cartucho.
   * BootIntro puede llamar a playInitialIntro de nuevo: recibirá esta misma
   * promesa y esperará a que termine, sin crear una segunda animación.
   */
  const startOnCartridgeHandoff = () => {
    if (document.body.classList.contains("ml3d-cartridge-handoff")) {
      playInitialIntro().catch(() => {});
    }
  };
  new MutationObserver(startOnCartridgeHandoff).observe(document.body, {
    attributes: true,
    attributeFilter: ["class"]
  });
  startOnCartridgeHandoff();

  Object.values(SP_TRANSITION_ASSETS).forEach((asset) => loadImage(asset.lid));
})();
