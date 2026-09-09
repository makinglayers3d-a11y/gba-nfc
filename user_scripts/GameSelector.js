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
        marginBottom: "2%"
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
          "linear-gradient(to bottom, transparent 0%, #000 13%, #000 87%, transparent 100%)"
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
        marginTop: "2%"
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

function renderList() {
  if (
    !listTrack ||
    !listViewport ||
    !games.length
  ) {
    return;
  }

  /*
   * Guardamos los elementos para reutilizarlos
   * entre cambios de selección.
   *
   * Esto permite que las transiciones CSS
   * sean realmente animadas.
   */
  if (!listTrack._gameItems) {
    listTrack._gameItems = new Map();
  }

  const itemMap =
    listTrack._gameItems;

  const count =
    games.length;

  /*
   * Relación de cada juego respecto
   * al seleccionado.
   *
   * -3 = tres posiciones arriba
   * -2 = dos posiciones arriba
   * -1 = una posición arriba
   *  0 = seleccionado
   * +1 = una posición abajo
   * +2 = dos posiciones abajo
   * +3 = tres posiciones abajo
   */
  function getRelative(index) {
    let relative =
      index - selectedIndex;

    /*
     * Lista circular.
     */
    if (relative > count / 2) {
      relative -= count;
    }

    if (relative < -count / 2) {
      relative += count;
    }

    return relative;
  }

  /*
   * Actualizamos / creamos los elementos.
   */
  games.forEach(
    (game, index) => {

      let item =
        itemMap.get(
          game.filename
        );

      if (!item) {

        item =
          document.createElement(
            "div"
          );

        itemMap.set(
          game.filename,
          item
        );

        listTrack.appendChild(
          item
        );
      }

      item.textContent =
        friendlyName(
          game.filename
        );

      const relative =
        getRelative(index);

      const distance =
        Math.abs(relative);

      const selected =
        relative === 0;

      /*
       * Solo mostramos:
       *
       * 3 arriba
       * seleccionado
       * 3 abajo
       */
      const visible =
        distance <= 3;

      /*
       * Tamaño progresivo.
       */
      let fontSize;
      let opacity;
      let fontWeight;
      let padding;

      if (distance === 0) {

        fontSize =
          "clamp(17px, 4.9vw, 28px)";

        opacity =
          "1";

        fontWeight =
          "900";

        padding =
          "9px 14px";

      } else if (distance === 1) {

        fontSize =
          "clamp(13px, 3.5vw, 20px)";

        opacity =
          "0.78";

        fontWeight =
          "800";

        padding =
          "3px 8px";

      } else if (distance === 2) {

        fontSize =
          "clamp(10px, 2.7vw, 15px)";

        opacity =
          "0.50";

        fontWeight =
          "700";

        padding =
          "2px 8px";

      } else {

        fontSize =
          "clamp(8px, 2.1vw, 12px)";

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

          /*
           * Pegados al lateral izquierdo.
           */
          left:
            "0",

          width:
            "84%",

          minHeight:
            selected
              ? "48px"
              : "0",

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

          borderRadius:
            selected
              ? "14px"
              : "8px",

          /*
           * El cuadro gris solo pertenece
           * al juego seleccionado.
           */
          background:
            selected
              ? "rgba(105,105,105,0.50)"
              : "transparent",

          border:
            selected
              ? "1px solid rgba(255,255,255,0.16)"
              : "1px solid transparent",

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

          opacity:
            visible
              ? opacity
              : "0",

          /*
           * Animación tipo carrusel/rueda.
           */
          transition:
            [
              "top 420ms cubic-bezier(0.22,0.61,0.36,1)",
              "font-size 360ms cubic-bezier(0.22,0.61,0.36,1)",
              "opacity 300ms ease",
              "padding 360ms ease",
              "background 360ms ease",
              "box-shadow 360ms ease",
              "min-height 360ms ease"
            ].join(", ")
        }
      );
    }
  );

  /*
   * Ocultamos elementos que hayan desaparecido
   * del conjunto visible, pero los conservamos
   * en el DOM para poder reutilizarlos.
   */
  itemMap.forEach(
    (item, filename) => {

      const index =
        games.findIndex(
          (game) =>
            game.filename === filename
        );

      if (index < 0) {
        item.remove();
        itemMap.delete(
          filename
        );
        return;
      }

      const relative =
        getRelative(index);

      if (
        Math.abs(relative) > 3
      ) {
        item.style.display =
          "none";

        item.style.opacity =
          "0";
      }
    }
  );

  /*
   * Buscamos el elemento seleccionado.
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

  /*
   * Forzamos el cálculo de layout.
   */
  const selectedHeight =
    selectedElement.getBoundingClientRect().height;

  const viewportHeight =
    listViewport.clientHeight;

  /*
   * Centro fijo.
   */
  const centerY =
    viewportHeight / 2;

  /*
   * Margen mínimo entre el cuadro gris
   * y el título inmediatamente anterior
   * o siguiente.
   */
  const firstGap =
    4;

  /*
   * A partir del primero, la separación
   * va disminuyendo.
   *
   * 1 -> 4 px
   * 2 -> 3 px
   * 3 -> 2 px
   */
  function gapForDistance(distance) {

    if (distance === 1) {
      return firstGap;
    }

    if (distance === 2) {
      return 3;
    }

    return 2;
  }

  /*
   * Colocamos el seleccionado.
   */
  selectedElement.style.display =
    "flex";

  selectedElement.style.top =
    `${centerY}px`;

  selectedElement.style.transform =
    "translateY(-50%)";

  /*
   * Medimos de nuevo por seguridad.
   */
  const selectedRect =
    selectedElement.getBoundingClientRect();

  /*
   * Altura real de cada lado del
   * cuadro seleccionado.
   */
  const selectedHalfHeight =
    selectedRect.height / 2;

  /*
   * Recogemos los juegos visibles
   * de cada lado.
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
        distance > 3
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

  /*
   * Los ordenamos desde el centro
   * hacia fuera.
   */
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
   * Colocamos los títulos superiores.
   *
   * Cada uno se calcula a partir
   * del anterior, así nunca invade
   * el cuadro gris ni otro título.
   */
  let previousCenter =
    centerY;

  let previousHalfHeight =
    selectedHalfHeight;

  above.forEach(
    (entry) => {

      const item =
        entry.item;

      const distance =
        entry.distance;

      const height =
        item.getBoundingClientRect().height;

      const halfHeight =
        height / 2;

      const gap =
        gapForDistance(
          distance
        );

      const center =
        previousCenter -
        previousHalfHeight -
        gap -
        halfHeight;

      item.style.top =
        `${center}px`;

      item.style.transform =
        "translateY(-50%)";

      previousCenter =
        center;

      previousHalfHeight =
        halfHeight;
    }
  );

  /*
   * Colocamos los títulos inferiores.
   *
   * Exactamente el mismo sistema,
   * pero hacia abajo.
   */
  previousCenter =
    centerY;

  previousHalfHeight =
    selectedHalfHeight;

  below.forEach(
    (entry) => {

      const item =
        entry.item;

      const distance =
        entry.distance;

      const height =
        item.getBoundingClientRect().height;

      const halfHeight =
        height / 2;

      const gap =
        gapForDistance(
          distance
        );

      const center =
        previousCenter +
        previousHalfHeight +
        gap +
        halfHeight;

      item.style.top =
        `${center}px`;

      item.style.transform =
        "translateY(-50%)";

      previousCenter =
        center;

      previousHalfHeight =
        halfHeight;
    }
  );
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
