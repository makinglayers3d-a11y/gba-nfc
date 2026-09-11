"use strict";

(function () {
  const REPO_API =
    "https://api.github.com/repos/makinglayers3d-a11y/gba-nfc-gb/contents/games";

  const selectGameButton =
    document.getElementById("select-game-button");

  const gameSelector =
    document.getElementById("game-selector");

  const closeGameSelector =
    document.getElementById("close-game-selector");

  const gameList =
    document.getElementById("game-list");

  const menu =
    document.getElementById("menu");

  const screenFrame =
    document.querySelector(".screen-frame");

  if (!screenFrame || !gameList) {
    return;
  }

  const params =
    new URLSearchParams(window.location.search);


  const knownNames = {
    "PokemonRF.gba": "Pokémon FireRed",
    "Super Mario Bros. 3.gba": "Super Mario Bros. 3",
    "The Legend of Zelda - The Minish Cap.gba":
      "The Legend of Zelda: The Minish Cap",
    
  };

  const knownSlugs = {
    "PokemonRF.gba": "pokemon",
    "Super Mario Bros. 3.gba": "mario3",
    "The Legend of Zelda - The Minish Cap.gba":
      "minishcap",
    
  };

 let games = [];
let allGames = [];
let selectedIndex = 0;

let currentFilter = "all";
let filterOpen = false;
let filterIndex = 0;
let filterTransitioning = false;

const FILTERS = [
  {
    id: "all",
    name: "TODOS"
  },
  {
    id: "gb",
    name: "GAME BOY"
  },
  {
    id: "gbc",
    name: "GAME BOY COLOR"
  },
  {
    id: "gba",
    name: "GAME BOY ADVANCE"
  }
];

let overlay = null;
let listViewport = null;
let listTrack = null;

let menuOpen = false;
let opening = false;

let menuAudioContext = null;

 function friendlyName(filename) {
  return (
    knownNames[filename] ||
    filename.replace(/\.(gba|gbc|gb)$/i, "")
  );
}

  function slugFromFilename(filename) {
    if (knownSlugs[filename]) {
      return knownSlugs[filename];
    }

    return filename
      .replace(/\.(gba|gbc|gb)$/i, "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "game";
  }
function applyGameFilter() {
  switch (currentFilter) {
    case "gb":
      games = allGames.filter((game) =>
        game.filename.toLowerCase().endsWith(".gb")
      );
      break;

    case "gbc":
      games = allGames.filter((game) =>
        game.filename.toLowerCase().endsWith(".gbc")
      );
      break;

    case "gba":
      games = allGames.filter((game) =>
        game.filename.toLowerCase().endsWith(".gba")
      );
      break;

    default:
      games = allGames;
      break;
  }

  selectedIndex = 0;
}
 async function openFilterSelector() {
  if (!menuOpen || filterOpen || filterTransitioning) {
    return;
  }

  filterTransitioning = true;

  await collapseGamesIntoSelected();

  filterOpen = true;

  const currentIndex =
    FILTERS.findIndex(
      (filter) =>
        filter.id === currentFilter
    );

  filterIndex =
    currentIndex >= 0
      ? currentIndex
      : 0;

  const panel = renderFilterSelector();

  if (panel) {
    await playFilterExpansion(panel);
  }

  filterTransitioning = false;
}

function renderFilterSelector() {
  if (!listTrack) {
    return null;
  }

  let panel = listTrack.querySelector(".gba-filter-panel");

  if (!panel) {
    listTrack.innerHTML = "";
    listTrack._gameItems = new Map();
    listTrack._filterItems = new Map();

    panel = document.createElement("div");
    panel.className = "gba-filter-panel";

    Object.assign(panel.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      background: "transparent",
      border: "0",
      boxSizing: "border-box",
      zIndex: "10"
    });

    listTrack.appendChild(panel);
  }

  if (!listTrack._filterItems) {
    listTrack._filterItems = new Map();
  }

  const itemMap = listTrack._filterItems;
  const count = FILTERS.length;

  function getRelative(index) {
    let relative = index - filterIndex;

    if (relative > count / 2) {
      relative -= count;
    }

    if (relative < -count / 2) {
      relative += count;
    }

    return relative;
  }

  FILTERS.forEach((filter, index) => {
    let item = itemMap.get(filter.id);

    if (!item) {
      item = document.createElement("div");
      itemMap.set(filter.id, item);
      panel.appendChild(item);
    }

    const relative = getRelative(index);
    const distance = Math.abs(relative);
    const selected = relative === 0;

    item.textContent = filter.name;

    Object.assign(item.style, {
      position: "absolute",
      left: "0",
      width: "84%",
      height: selected
        ? "56px"
        : distance === 1
          ? "30px"
          : distance === 2
            ? "22px"
            : "18px",
      display: "flex",
      alignItems: "center",
      boxSizing: "border-box",
      padding: selected
        ? "8px 14px"
        : distance === 1
          ? "2px 8px"
          : "1px 8px",
      background: selected
        ? "rgba(105,105,105,0.50)"
        : "transparent",
      border: selected
        ? "1px solid rgba(255,255,255,0.16)"
        : "1px solid transparent",
      borderRadius: selected ? "14px" : "8px",
      boxShadow: selected
        ? "0 7px 18px rgba(0,0,0,0.32)"
        : "none",
      color: "#ffffff",
      fontSize: selected
        ? "clamp(17px, 4.6vw, 26px)"
        : distance === 1
          ? "clamp(13px, 3.3vw, 19px)"
          : distance === 2
            ? "clamp(10px, 2.5vw, 14px)"
            : "clamp(8px, 1.9vw, 11px)",
      fontWeight: selected ? "900" : distance === 1 ? "800" : "700",
      lineHeight: "1.08",
      textAlign: "left",
      opacity: selected ? "1" : distance === 1 ? ".78" : distance === 2 ? ".48" : ".30",
      zIndex: selected ? "3" : "2",
      overflow: "hidden",
      transition: [
        "top 430ms cubic-bezier(0.22,0.61,0.36,1)",
        "font-size 380ms cubic-bezier(0.22,0.61,0.36,1)",
        "opacity 320ms ease",
        "height 380ms cubic-bezier(0.22,0.61,0.36,1)",
        "padding 380ms ease",
        "background 300ms ease",
        "box-shadow 300ms ease"
      ].join(", ")
    });

    item.dataset.relative = String(relative);
    item.dataset.distance = String(distance);
  });

  const centerY = panel.clientHeight / 2;
  const selectedHalf = 28;
  const above = [];
  const below = [];

  itemMap.forEach((item) => {
    const relative = Number(item.dataset.relative);
    const distance = Number(item.dataset.distance);

    if (relative === 0) {
      item.style.top = `${centerY}px`;
      item.style.transform = "translateY(-50%)";
    } else if (relative < 0) {
      above.push({ item, distance });
    } else {
      below.push({ item, distance });
    }
  });

  above.sort((a, b) => a.distance - b.distance);
  below.sort((a, b) => a.distance - b.distance);

  let previousTop = centerY - selectedHalf;
  above.forEach(({ item, distance }) => {
    const height = distance === 1 ? 30 : distance === 2 ? 22 : 18;
    const gap = distance === 1 ? 4 : distance === 2 ? 12 : 3;
    item.style.top = `${previousTop - gap - height}px`;
    item.style.transform = "none";
    previousTop -= gap + height;
  });

  let previousBottom = centerY + selectedHalf;
  below.forEach(({ item, distance }) => {
    const height = distance === 1 ? 30 : distance === 2 ? 22 : 18;
    const gap = distance === 1 ? 4 : distance === 2 ? 12 : 3;
    item.style.top = `${previousBottom + gap}px`;
    item.style.transform = "none";
    previousBottom += gap + height;
  });

  return panel;
}

function waitForAnimation(animation) {
  return animation.finished.catch(() => undefined);
}

async function collapseGamesIntoSelected() {
  if (!listTrack || !listTrack._gameItems || !games.length) {
    return;
  }

  const selectedGame = games[selectedIndex];
  const selectedItem = selectedGame
    ? listTrack._gameItems.get(selectedGame.filename)
    : null;

  if (!selectedItem) {
    return;
  }

  const selectedRect = selectedItem.getBoundingClientRect();
  const centerY = selectedRect.top + selectedRect.height / 2;
  const animations = [];

  listTrack._gameItems.forEach((item) => {
    if (item.style.display === "none") {
      return;
    }

    const rect = item.getBoundingClientRect();
    const offsetY = centerY - (rect.top + rect.height / 2);
    const isSelected = item === selectedItem;

    const animation = item.animate(
      isSelected
        ? [
            { transform: "translateY(-50%) scale(1)", filter: "brightness(1)" },
            { transform: "translateY(-50%) scale(1.045)", filter: "brightness(1.16)" }
          ]
        : [
            { translate: "0 0", opacity: getComputedStyle(item).opacity },
            { translate: `0 ${offsetY}px`, opacity: 0 }
          ],
      {
        duration: 420,
        easing: "cubic-bezier(.45, 0, .2, 1)",
        fill: "forwards"
      }
    );

    animations.push(waitForAnimation(animation));
  });

  await Promise.all(animations);
}

function playFilterExpansion(panel) {
  return waitForAnimation(
    panel.animate(
      [
        {
          opacity: 0,
          clipPath: "inset(50% 4% 50% 4% round 14px)",
          transform: "scaleX(.82)"
        },
        {
          opacity: 1,
          clipPath: "inset(0 0 0 0 round 16px)",
          transform: "scaleX(1)"
        }
      ],
      {
        duration: 440,
        easing: "cubic-bezier(.2, .8, .2, 1)",
        fill: "both"
      }
    )
  );
}

function playFilterCollapse(panel) {
  return waitForAnimation(
    panel.animate(
      [
        {
          opacity: 1,
          clipPath: "inset(0 0 0 0 round 16px)",
          transform: "scaleX(1)"
        },
        {
          opacity: 0,
          clipPath: "inset(50% 4% 50% 4% round 14px)",
          transform: "scaleX(.82)"
        }
      ],
      {
        duration: 380,
        easing: "cubic-bezier(.45, 0, .8, .2)",
        fill: "forwards"
      }
    )
  );
}

async function expandGamesFromSelected() {
  if (!listTrack || !listTrack._gameItems || !games.length) {
    return;
  }

  const selectedGame = games[selectedIndex];
  const selectedItem = selectedGame
    ? listTrack._gameItems.get(selectedGame.filename)
    : null;

  if (!selectedItem) {
    return;
  }

  const selectedRect = selectedItem.getBoundingClientRect();
  const centerY = selectedRect.top + selectedRect.height / 2;
  const animations = [];

  listTrack._gameItems.forEach((item) => {
    if (item.style.display === "none") {
      return;
    }

    const rect = item.getBoundingClientRect();
    const offsetY = centerY - (rect.top + rect.height / 2);
    const distance = Math.abs(offsetY);
    const finalOpacity = getComputedStyle(item).opacity;

    const animation = item.animate(
      [
        {
          translate: `0 ${offsetY}px`,
          opacity: 0,
          scale: ".72"
        },
        {
          translate: "0 0",
          opacity: finalOpacity,
          scale: "1"
        }
      ],
      {
        duration: 480,
        delay: Math.min(120, distance * .45),
        easing: "cubic-bezier(.2, .8, .2, 1)",
        fill: "both"
      }
    );

    animations.push(waitForAnimation(animation));
  });

  await Promise.all(animations);
}

function moveFilterSelection(delta) {
  if (!filterOpen || filterTransitioning) {
    return;
  }

  filterIndex += delta;

  if (
    filterIndex < 0
  ) {
    filterIndex =
      FILTERS.length - 1;
  }

  if (
    filterIndex >= FILTERS.length
  ) {
    filterIndex = 0;
  }

  playMenuMoveSound();
  renderFilterSelector();
}

async function selectCurrentFilter() {
  if (!filterOpen || filterTransitioning) {
    return;
  }

  const filter =
    FILTERS[filterIndex];

  if (!filter) {
    return;
  }

  filterTransitioning = true;

  const panel = listTrack
    ? listTrack.querySelector(".gba-filter-panel")
    : null;

  if (panel) {
    await playFilterCollapse(panel);
  }

  currentFilter =
    filter.id;

  applyGameFilter();

  filterOpen = false;

  renderList();
  updateCoverBackground();

  await expandGamesFromSelected();

  filterTransitioning = false;
}

function closeFilterSelector() {
  if (!filterOpen) {
    return;
  }

  filterOpen = false;

  renderList();
  updateCoverBackground();
}
  function findCurrentGame() {
    const currentRom =
      params.get("rom");

    const currentGame =
      (params.get("game") || "pokemon").toLowerCase();

    const index = games.findIndex((game) => {
      return (
        (currentRom &&
          game.filename === currentRom) ||
        slugFromFilename(game.filename) === currentGame
      );
    });

    selectedIndex =
      index >= 0 ? index : 0;
  }

  /*
   * Audio del selector.
   *
   * Creamos un contexto SOLO cuando el usuario mueve
   * el selector. De esta forma el navegador recibe la
   * creación del sonido como consecuencia directa del
   * gesto del usuario.
   */
  function getMenuAudioContext() {
    if (
      menuAudioContext &&
      menuAudioContext.state !== "closed"
    ) {
      return menuAudioContext;
    }

    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioContextClass) {
      return null;
    }

    try {
      menuAudioContext =
        new AudioContextClass();

      return menuAudioContext;
    } catch (error) {
      console.warn(
        "No se pudo crear el audio del selector:",
        error
      );

      return null;
    }
  }

  function playMenuMoveSound() {
    const context =
      getMenuAudioContext();

    if (!context) {
      return;
    }

    try {
      const startSound = () => {
        const now =
          context.currentTime;

        const oscillator =
          context.createOscillator();

        const gain =
          context.createGain();

        oscillator.type =
          "square";

        /*
         * Pitido corto de estilo Game Boy.
         */
        oscillator.frequency.setValueAtTime(
          740,
          now
        );

        oscillator.frequency.setValueAtTime(
          620,
          now + 0.035
        );

        gain.gain.setValueAtTime(
          0.0001,
          now
        );

        gain.gain.exponentialRampToValueAtTime(
          0.055,
          now + 0.003
        );

        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          now + 0.055
        );

        oscillator.connect(gain);
        gain.connect(context.destination);

        oscillator.start(now);
        oscillator.stop(now + 0.06);
      };

      /*
       * En iPhone/iPad el contexto puede arrancar suspendido.
       * Esperamos a resume() antes de programar el sonido.
       */
      if (
        context.state === "suspended" ||
        context.state === "interrupted"
      ) {
        const result =
          context.resume();

        if (
          result &&
          typeof result.then === "function"
        ) {
          result
            .then(() => {
              startSound();
            })
            .catch(() => {});
        } else {
          startSound();
        }
      } else {
        startSound();
      }
    } catch (error) {
      console.warn(
        "No se pudo reproducir el sonido del selector:",
        error
      );
    }
  }

  function playMenuSelectSound() {
    const context =
      getMenuAudioContext();

    if (!context) {
      return;
    }

    try {
      const startSound = () => {
        const now =
          context.currentTime;

        const oscillator =
          context.createOscillator();

        const gain =
          context.createGain();

        oscillator.type =
          "square";

        oscillator.frequency.setValueAtTime(
          1046,
          now
        );

        oscillator.frequency.setValueAtTime(
          1568,
          now + 0.055
        );

        gain.gain.setValueAtTime(
          0.0001,
          now
        );

        gain.gain.exponentialRampToValueAtTime(
          0.06,
          now + 0.003
        );

        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          now + 0.09
        );

        oscillator.connect(gain);
        gain.connect(context.destination);

        oscillator.start(now);
        oscillator.stop(now + 0.095);
      };

      if (
        context.state === "suspended" ||
        context.state === "interrupted"
      ) {
        const result =
          context.resume();

        if (
          result &&
          typeof result.then === "function"
        ) {
          result
            .then(() => {
              startSound();
            })
            .catch(() => {});
        } else {
          startSound();
        }
      } else {
        startSound();
      }
    } catch (error) {
      console.warn(
        "No se pudo reproducir el sonido de selección:",
        error
      );
    }
  }

  function buildOverlay() {
    if (overlay) {
      return;
    }

    overlay =
      document.createElement("div");

    overlay.id =
      "gba-game-menu";

    overlay.setAttribute(
      "role",
      "dialog"
    );

    overlay.setAttribute(
      "aria-label",
      "Seleccionar juego"
    );

const coverImage =
  document.createElement("img");

coverImage.alt = "";

Object.assign(
  coverImage.style,
  {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: "center",
    opacity: "0",
    transition:
      "opacity 350ms ease",
    pointerEvents: "none",
    zIndex: "0"
  }
);

const coverShade =
  document.createElement("div");

Object.assign(
  coverShade.style,
  {
    position: "absolute",
    inset: "0",
    background:
      "rgba(0,0,0,0.58)",
    pointerEvents: "none",
    zIndex: "1"
  }
);

overlay.appendChild(
  coverImage
);

overlay.appendChild(
  coverShade
);

    const title =
      document.createElement("div");
Object.assign(
  overlay.style,
  {
    position: "absolute",
    inset: "0",
    zIndex: "1000",
    display: "flex",
    flexDirection: "column",
    background: "#05080c",
    color: "#ffffff",
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    overflow: "hidden",
    userSelect: "none",
    webkitUserSelect: "none",
    touchAction: "none",
    padding: "7% 6% 5% 0"
  }
);
    title.textContent =
      "SELECT GAME";

   Object.assign(
  title.style,
  {
    position: "absolute",
    top: "5%",
    right: "5%",

    fontSize:
      "clamp(10px, 2.8vw, 16px)",

    fontWeight: "900",

    letterSpacing:
      "0.08em",

    marginBottom: "0",

    textAlign: "right",

    zIndex: "2"
  }
);

    listViewport =
      document.createElement("div");

    Object.assign(
  listViewport.style,
  {
    position: "absolute",
    inset: "0",

    overflow: "hidden",

    maskImage:
      "linear-gradient(to bottom, transparent 0%, #000 8%, #000 92%, transparent 100%)",

    webkitMaskImage:
      "linear-gradient(to bottom, transparent 0%, #000 8%, #000 92%, transparent 100%)",

    zIndex: "2"
  }
);

    listTrack =
      document.createElement("div");

   Object.assign(
  listTrack.style,
  {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    transform: "none"
  }
);

    const footer =
      document.createElement("div");

    footer.textContent =
      "▲ ▼ MOVER   A / START ELEGIR   SELECT FILTRO   B VOLVER";
   Object.assign(
  footer.style,
  {
    position: "absolute",

    right: "4%",
    bottom: "3%",

    fontSize:
      "clamp(6px, 1.6vw, 9px)",

    fontWeight: "800",

    letterSpacing:
      "0.02em",

    opacity: "0.52",

    marginTop: "0",

    textAlign: "right",

    zIndex: "2"
  }
); 

    listViewport.appendChild(
      listTrack
    );

    overlay.appendChild(title);
    overlay.appendChild(listViewport);
    overlay.appendChild(footer);

    screenFrame.appendChild(
      overlay
    );
  }
function updateCoverBackground() {
  if (!overlay || !games.length) {
    return;
  }

  const selectedGame =
    games[selectedIndex];

  if (!selectedGame) {
    return;
  }

  const filename =
    selectedGame.filename;

  const baseName =
    filename.replace(
       /\.(gba|gb|gbc)$/i,
      ""
    );

  const jpgPath =
    "covers/" +
    encodeURIComponent(
      baseName + ".jpg"
    );

  const pngPath =
    "covers/" +
    encodeURIComponent(
      baseName + ".png"
    );

  const fallbackPath =
    "covers/coverml3d.png";

  const oldImage =
    overlay.querySelector(
      ".gba-cover-background"
    );

  if (oldImage) {
    oldImage.remove();
  }

  const image =
    document.createElement("img");

  image.className =
    "gba-cover-background";

  image.alt = "";

  Object.assign(
    image.style,
    {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      objectFit: "cover",
      objectPosition: "center",
      opacity: "0",
      transition:
        "opacity 350ms ease",
      pointerEvents: "none",
      zIndex: "0"
    }
  );

  overlay.insertBefore(
    image,
    overlay.firstChild
  );

  /*
   * Probamos JPG primero.
   */
  image.src =
    jpgPath;

  image.onerror = () => {

    /*
     * Probamos PNG.
     */
    image.onerror = () => {

      /*
       * Finalmente usamos la
       * carátula ML3D.
       */
      image.onerror = null;

      image.src =
        fallbackPath;
    };

    image.src =
      pngPath;
  };

  image.onload = () => {

    requestAnimationFrame(
      () => {
        image.style.opacity =
          "1";
      }
    );
  };
}
function renderList() {
  if (listTrack) {
    const filterPanel =
      listTrack.querySelector(
        ".gba-filter-panel"
      );

    if (filterPanel) {
      filterPanel.remove();
    }
  }  
  if (
    !listTrack ||
    !listViewport ||
    !games.length
  ) {
    return;
  }

  if (!listTrack._gameItems) {
    listTrack._gameItems = new Map();
  }

  const itemMap =
    listTrack._gameItems;

  const count =
    games.length;

  const VISIBLE_SIDE =
    3;

  /*
   * Posición circular respecto al seleccionado.
   */
  function getRelative(index) {
    let relative =
      index - selectedIndex;

    if (relative > count / 2) {
      relative -= count;
    }

    if (relative < -count / 2) {
      relative += count;
    }

    return relative;
  }

  /*
   * Crear/reutilizar títulos.
   */
  games.forEach(
    (game, index) => {

      let item =
        itemMap.get(
          game.filename
        );

      if (!item) {
        item =
          document.createElement("div");

        itemMap.set(
          game.filename,
          item
        );

        listTrack.appendChild(
          item
        );
      }

      const relative =
        getRelative(index);

      const distance =
        Math.abs(relative);

      const selected =
        relative === 0;

      const visible =
        distance <= VISIBLE_SIDE;

      const filename =
  game.filename.toLowerCase();

let system = "GBA";

if (filename.endsWith(".gbc")) {
  system = "GBC";
} else if (filename.endsWith(".gb")) {
  system = "GB";
}

const gameName =
  friendlyName(
    game.filename
  );

item.textContent =
  gameName + " (" + system.toLowerCase() + ")";
      
      /*
       * Tamaños según distancia.
       */
      let fontSize;
      let opacity;
      let fontWeight;
      let padding;

      if (distance === 0) {

        fontSize =
          "clamp(17px, 4.6vw, 26px)";

        opacity =
          "1";

        fontWeight =
          "900";

        padding =
          "8px 14px";

      } else if (distance === 1) {

        fontSize =
          "clamp(13px, 3.3vw, 19px)";

        opacity =
          "0.78";

        fontWeight =
          "800";

        padding =
          "2px 8px";

      } else if (distance === 2) {

        fontSize =
          "clamp(10px, 2.5vw, 14px)";

        opacity =
          "0.48";

        fontWeight =
          "700";

        padding =
          "1px 8px";

      } else {

        fontSize =
          "clamp(8px, 1.9vw, 11px)";

        opacity =
          "0.30";

        fontWeight =
          "700";

        padding =
          "1px 8px";
      }

      Object.assign(
        item.style,
        {
          position:
            "absolute",

          left:
            "0",

          width:
            "84%",

          boxSizing:
            "border-box",

          display:
            visible
              ? "flex"
              : "none",

          alignItems:
            "center",

          padding:
            padding,

          /*
           * El cuadro gris pertenece
           * al título seleccionado.
           */
          background:
            selected
              ? "rgba(105,105,105,0.50)"
              : "transparent",

          border:
            selected
              ? "1px solid rgba(255,255,255,0.16)"
              : "1px solid transparent",

          borderRadius:
            selected
              ? "14px"
              : "8px",

          boxShadow:
            selected
              ? "0 7px 18px rgba(0,0,0,0.32)"
              : "none",

          color:
            "#ffffff",

          fontSize:
            fontSize,

          fontWeight:
            fontWeight,

          lineHeight:
            "1.08",

          textAlign:
            "left",

          whiteSpace:
            "normal",

          wordBreak:
            "break-word",

          /*
           * Alturas controladas para que los
           * cálculos no dependan de que un
           * título concreto tenga más o menos
           * líneas.
           */
          height:
            selected
              ? "56px"
              : distance === 1
                ? "30px"
                : distance === 2
                  ? "22px"
                  : "18px",

          overflow:
            "hidden",

          opacity:
            visible
              ? opacity
              : "0",

          zIndex:
            selected
              ? "3"
              : "2",

          transition:
            [
              "top 430ms cubic-bezier(0.22,0.61,0.36,1)",
              "font-size 380ms cubic-bezier(0.22,0.61,0.36,1)",
              "opacity 320ms ease",
              "height 380ms cubic-bezier(0.22,0.61,0.36,1)",
              "padding 380ms ease",
              "background 300ms ease",
              "box-shadow 300ms ease"
            ].join(", ")
        }
      );
    }
  );

  /*
   * Eliminamos juegos que ya no estén
   * en la lista.
   */
  itemMap.forEach(
    (item, filename) => {

      const exists =
        games.some(
          (game) =>
            game.filename === filename
        );

      if (!exists) {
        item.remove();

        itemMap.delete(
          filename
        );
      }
    }
  );

  /*
   * Datos del área visible.
   */
  const viewportHeight =
    listViewport.clientHeight;

  const centerY =
    viewportHeight / 2;

  /*
   * Altura FIJA del cuadro gris.
   */
  const selectedHeight =
    56;

  const selectedHalf =
    selectedHeight / 2;

  /*
   * Margen mínimo entre el borde
   * del cuadro y el juego vecino.
   */
  const gap1 =
    4;

  /*
   * Los siguientes juegos se van
   * comprimiendo.
   */
  const gap2 =
    12;

  const gap3 =
    3;

  /*
   * Separamos arriba y abajo.
   */
  const above = [];
  const below = [];

  games.forEach(
    (game, index) => {

      const relative =
        getRelative(index);

      const distance =
        Math.abs(relative);

      if (
        distance === 0 ||
        distance > VISIBLE_SIDE
      ) {
        return;
      }

      const item =
        itemMap.get(
          game.filename
        );

      if (!item) {
        return;
      }

      item.style.display =
        "flex";

      if (relative < 0) {
        above.push({
          item,
          distance
        });
      } else {
        below.push({
          item,
          distance
        });
      }
    }
  );

  above.sort(
    (a, b) =>
      a.distance -
      b.distance
  );

  below.sort(
    (a, b) =>
      a.distance -
      b.distance
  );

  /*
   * -------------------------
   * SELECCIONADO
   * -------------------------
   */
  const selectedGame =
    games[selectedIndex];

  if (!selectedGame) {
    return;
  }

  const selectedElement =
    itemMap.get(
      selectedGame.filename
    );

  if (!selectedElement) {
    return;
  }

  selectedElement.style.display =
    "flex";

  selectedElement.style.top =
    `${centerY}px`;

  selectedElement.style.transform =
    "translateY(-50%)";

  /*
   * -------------------------
   * ARRIBA
   * -------------------------
   */
  let previousBottom =
    centerY -
    selectedHalf;

  above.forEach(
    (entry) => {

      const item =
        entry.item;

      const distance =
        entry.distance;

      const height =
        distance === 1
          ? 30
          : distance === 2
            ? 22
            : 18;

      const halfHeight =
        height / 2;

      let gap;

      if (distance === 1) {
        gap =
          gap1;
      } else if (distance === 2) {
        gap =
          gap2;
      } else {
        gap =
          gap3;
      }

      const center =
        previousBottom -
        gap -
        halfHeight;

      item.style.top =
        `${center}px`;

      item.style.transform =
        "translateY(-50%)";

      previousBottom =
        center -
        halfHeight;
    }
  );

  /*
   * -------------------------
   * ABAJO
   * -------------------------
   */
  let previousTop =
    centerY +
    selectedHalf;

  below.forEach(
    (entry) => {

      const item =
        entry.item;

      const distance =
        entry.distance;

      const height =
        distance === 1
          ? 30
          : distance === 2
            ? 22
            : 18;

      const halfHeight =
        height / 2;

      let gap;

      if (distance === 1) {
        gap =
          gap1;
      } else if (distance === 2) {
        gap =
          gap2;
      } else {
        gap =
          gap3;
      }

      const center =
        previousTop +
        gap +
        halfHeight;

      item.style.top =
        `${center}px`;

      item.style.transform =
        "translateY(-50%)";

      previousTop =
        center +
        halfHeight;
    }
  );

  updateCoverBackground();
}
  
  function moveSelection(delta) {
    if (
      !menuOpen ||
      !games.length
    ) {
      return;
    }

    let next =
      selectedIndex + delta;

    if (next < 0) {
      next = games.length - 1;
    }

    if (next >= games.length) {
      next = 0;
    }

    if (next === selectedIndex) {
      return;
    }

    selectedIndex =
      next;

    renderList();

    /*
     * El sonido se produce como parte del
     * mismo gesto que ha provocado el movimiento.
     */
    playMenuMoveSound();
  }

  function closeScreenSelector() {
    menuOpen = false;

    if (overlay) {
      overlay.remove();
      overlay = null;
      listViewport = null;
      listTrack = null;
    }

    /*
     * No cerramos ni desconectamos nodos de audio.
     * En WebKit hay problemas conocidos cuando se
     * desconecta un ScriptProcessorNode y se vuelve
     * a conectar después.
     */
  }

  function selectCurrentGame() {
    if (!games.length) {
      return;
    }

    const selectedGame =
      games[selectedIndex];

    if (!selectedGame) {
      return;
    }

    playMenuSelectSound();

    const url =
      new URL(
        window.location.href
      );

    const slug =
      slugFromFilename(
        selectedGame.filename
      );

    url.searchParams.delete(
      "menu"
    );
    
   url.searchParams.set(
    "skipintro",
     "1"
   );
    
    if (
      knownSlugs[
        selectedGame.filename
      ]
    ) {
      url.searchParams.delete(
        "rom"
      );

      url.searchParams.set(
        "game",
        slug
      );
    } else {
      url.searchParams.set(
        "rom",
        selectedGame.filename
      );

      url.searchParams.set(
        "game",
        slug
      );
    }

    closeScreenSelector();

    window.setTimeout(
      () => {
        window.location.href =
          url.toString();
      },
      90
    );
  }

  async function loadGameList() {
    gameList.innerHTML =
      '<div class="game-list-status">Cargando juegos…</div>';

    try {
      const response =
        await fetch(
          REPO_API,
          {
            cache: "no-store"
          }
        );

      if (!response.ok) {
        throw new Error(
          "HTTP " + response.status
        );
      }

      const files =
        await response.json();

          allGames =
        files
          .filter(
            (file) => {
              const name =
                file.name.toLowerCase();

              return (
                file.type === "file" &&
                (
                  name.endsWith(".gba") ||
                  name.endsWith(".gb") ||
                  name.endsWith(".gbc")
                )
              );
            }
          )
          .map(
            (file) => ({
              filename: file.name
            })
          )
          .sort(
            (a, b) =>
              friendlyName(
                a.filename
              ).localeCompare(
                friendlyName(
                  b.filename
                ),
                undefined,
                {
                  sensitivity: "base"
                }
              )
          );

      games = allGames;

      findCurrentGame();

      if (!games.length) {
        gameList.innerHTML =
          '<div class="game-list-status">No hay juegos GBA.</div>';

        return;
      }
    } catch (error) {
      console.error(
        "No se pudo cargar la lista de juegos:",
        error
      );

      gameList.innerHTML =
        '<div class="game-list-status">No hay juegos compatibles.</div>';

      return;
    }
  }

  async function closeMenuIntoScreen() {
    if (!menu || !menu.open) {
      return;
    }

    const card = menu.querySelector(".menu-card");
    const source = card.getBoundingClientRect();
    const target = screenFrame.getBoundingClientRect();

    const sourceCenterX = source.left + source.width / 2;
    const sourceCenterY = source.top + source.height / 2;
    const targetCenterX = target.left + target.width / 2;
    const targetCenterY = target.top + target.height / 2;

    menu.style.setProperty(
      "--menu-screen-x",
      `${targetCenterX - sourceCenterX}px`
    );
    menu.style.setProperty(
      "--menu-screen-y",
      `${targetCenterY - sourceCenterY}px`
    );
    menu.style.setProperty(
      "--menu-screen-scale-x",
      String(target.width / source.width)
    );
    menu.style.setProperty(
      "--menu-screen-scale-y",
      String(target.height / source.height)
    );

    menu.classList.add("menu-closing-to-screen");

    await new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        card.removeEventListener("animationend", onAnimationEnd);
        resolve();
      };
      const onAnimationEnd = (event) => {
        if (event.target === card && event.animationName === "menuToScreen") {
          finish();
        }
      };

      card.addEventListener("animationend", onAnimationEnd);
      window.setTimeout(finish, 980);
    });

    menu.close();
    menu.classList.remove("menu-closing-to-screen");
    menu.style.removeProperty("--menu-screen-x");
    menu.style.removeProperty("--menu-screen-y");
    menu.style.removeProperty("--menu-screen-scale-x");
    menu.style.removeProperty("--menu-screen-scale-y");
  }

  async function openScreenSelector() {
    if (
      opening ||
      menuOpen
    ) {
      return;
    }

    opening = true;

    await loadGameList();

    if (!games.length) {
      opening = false;
      return;
    }

    await closeMenuIntoScreen();

    buildOverlay();

    menuOpen = true;
    opening = false;

    renderList();
  }

 function handleKeyboard(event) {
  if (!menuOpen) {
    return;
  }

  if (filterOpen) {
    switch (event.code) {
      case "ArrowUp":
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        moveFilterSelection(-1);
        return;

      case "ArrowDown":
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        moveFilterSelection(1);
        return;

      case "KeyX":
      case "Enter":
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        selectCurrentFilter();
        return;

      case "KeyZ":
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        closeFilterSelector();
        return;

      case "ShiftLeft":
      case "ShiftRight":
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
    }

    return;
  }

  switch (event.code) {
    case "ArrowUp":
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      moveSelection(-1);
      return;

    case "ArrowDown":
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      moveSelection(1);
      return;

    case "ShiftLeft":
    case "ShiftRight":
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openFilterSelector();
      return;

    case "KeyX":
    case "Enter":
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      selectCurrentGame();
      return;

    case "KeyZ":
    case "Escape":
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      closeScreenSelector();
      return;
  }
}
  function handlePointer(event) {
    if (!menuOpen) {
      return;
    }

    const target =
      event.target;

    if (
      !target ||
      !target.closest
    ) {
      return;
    }

    const keyButton =
      target.closest(
        "[data-key]"
      );

    if (!keyButton) {
      return;
    }

    const key =
      keyButton.dataset.key;

    if (filterOpen) {
      if (
        key === "UP"
      ) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        moveFilterSelection(-1);
        return;
      }

      if (
        key === "DOWN"
      ) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        moveFilterSelection(1);
        return;
      }

      if (
        key === "A" ||
        key === "START"
      ) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        selectCurrentFilter();
        return;
      }

      if (
        key === "SELECT"
      ) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }

      if (
        key === "B"
      ) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        closeFilterSelector();
        return;
      }

      return;
    }

    if (
      key === "UP"
    ) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      moveSelection(-1);
      return;
    }

    if (
      key === "DOWN"
    ) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      moveSelection(1);
      return;
    }

    if (
      key === "SELECT"
    ) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openFilterSelector();
      return;
    }

   if (
      key === "A" ||
      key === "START"
    ) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      selectCurrentGame();
      return;
    }

    if (
      key === "B"
    ) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      closeScreenSelector();
      return;
    }
  }
  if (selectGameButton) {
    selectGameButton.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        openScreenSelector();
      }
    );
  }

  if (closeGameSelector) {
    closeGameSelector.addEventListener(
      "click",
      () => {
        closeScreenSelector();
      }
    );
  }

  window.addEventListener(
    "keydown",
    handleKeyboard,
    true
  );

  window.addEventListener(
  "keyup",
  (event) => {
    if (!menuOpen || !filterOpen) {
      return;
    }

    if (
      event.code === "KeyX" ||
      event.code === "Enter" ||
      event.code === "KeyZ" ||
      event.code === "Escape" ||
      event.code === "ShiftLeft" ||
      event.code === "ShiftRight" ||
      event.code === "ArrowUp" ||
      event.code === "ArrowDown"
    ) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  },
  true
);
  
  /*
   * Los controles físicos siguen funcionando
   * cuando el selector está abierto.
   */
  document.addEventListener(
    "touchstart",
    handlePointer,
    true
  );

  document.addEventListener(
    "mousedown",
    handlePointer,
    true
  );

  /*
   * Si la tarjeta NFC abre ?menu=1,
   * mostramos el selector directamente.
   *
   * NO esperamos a que el emulador termine:
   * el selector vive directamente sobre .screen-frame.
   */
 window.gbaOpenGameSelector =
  openScreenSelector; 
})();
