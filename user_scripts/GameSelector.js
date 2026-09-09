"use strict";

(function () {
  const REPO_API =
    "https://api.github.com/repos/makinglayers3d-a11y/gba-nfc/contents/games";

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
  let selectedIndex = 0;

  let overlay = null;
  let listViewport = null;
  let listTrack = null;

  let menuOpen = false;
  let opening = false;

  let menuAudioContext = null;

  function friendlyName(filename) {
    return (
      knownNames[filename] ||
      filename.replace(/\.gba$/i, "")
    );
  }

  function slugFromFilename(filename) {
    if (knownSlugs[filename]) {
      return knownSlugs[filename];
    }

    return filename
      .replace(/\.gba$/i, "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "game";
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
        fontSize:
          "clamp(11px, 3vw, 18px)",
        fontWeight: "900",
        letterSpacing: "0.08em",
        marginBottom: "2%",
        zIndex: "2"
      }
    );

    listViewport =
      document.createElement("div");

    Object.assign(
      listViewport.style,
      {
        position: "relative",
        flex: "1",
        overflow: "hidden",
        maskImage:
          "linear-gradient(to bottom, transparent 0%, #000 13%, #000 87%, transparent 100%)",
        webkitMaskImage:
          "linear-gradient(to bottom, transparent 0%, #000 13%, #000 87%, transparent 100%)",
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
      "▲ ▼ MOVER   A / START ELEGIR   B VOLVER";

    Object.assign(
      footer.style,
      {
        fontSize:
          "clamp(6px, 1.7vw, 10px)",
        fontWeight: "800",
        letterSpacing: "0.02em",
        opacity: "0.52",
        marginTop: "2%",
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
      /\.gba$/i,
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

      item.textContent =
        friendlyName(
          game.filename
        );

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
    18;

  const gap3 =
    10;

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

      games =
        files
          .filter(
            (file) => {
              return (
                file.type === "file" &&
                file.name
                  .toLowerCase()
                  .endsWith(".gba")
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
        '<div class="game-list-status">No se pudo cargar la lista de juegos.</div>';

      return;
    }
  }

  async function openScreenSelector() {
    if (
      opening ||
      menuOpen
    ) {
      return;
    }

    opening = true;

    /*
     * Cerrar el menú HTML normal.
     */
    if (menu) {
      try {
        menu.close();
      } catch (error) {}
    }

    await loadGameList();

    if (!games.length) {
      opening = false;
      return;
    }

    buildOverlay();

    menuOpen = true;
    opening = false;

    renderList();
  }

  function handleKeyboard(event) {
    if (!menuOpen) {
      return;
    }

    switch (event.code) {
      case "ArrowUp":
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        moveSelection(-1);
        break;

      case "ArrowDown":
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        moveSelection(1);
        break;

      case "KeyX":
      case "Enter":
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        selectCurrentGame();
        break;

      case "KeyZ":
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        closeScreenSelector();
        break;
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
