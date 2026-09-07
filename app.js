(() => {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const game = (params.get("game") || "pokemon").toLowerCase();

  const title = document.getElementById("game-title");
  const status = document.getElementById("status");
  const menu = document.getElementById("menu");
  const menuButton = document.getElementById("menu-button");
  const closeMenu = document.getElementById("close-menu");
  const fullscreenButton = document.getElementById("fullscreen");
  const reloadButton = document.getElementById("reload-game");

  const gameNames = {
    pokemon: "Pokémon",
    mario: "Mario",
    zelda: "Zelda"
  };

  const name = gameNames[game] || "GBA";

  title.textContent = name;
  status.textContent = `Juego seleccionado: ${name}`;

  /*
   * Esta primera versión NO carga todavía el emulador.
   * Solo comprobamos que:
   * 1. La URL NFC selecciona el juego.
   * 2. La interfaz funciona.
   * 3. Los controles táctiles generan eventos.
   */

  const keyMap = {
    UP: "ArrowUp",
    DOWN: "ArrowDown",
    LEFT: "ArrowLeft",
    RIGHT: "ArrowRight",
    A: "x",
    B: "z",
    L: "a",
    R: "s",
    START: "Enter",
    SELECT: "Shift"
  };

  function sendKey(keyName, pressed) {
    const key = keyMap[keyName];
    if (!key) return;

    document.dispatchEvent(
      new KeyboardEvent(
        pressed ? "keydown" : "keyup",
        {
          key,
          code: key,
          bubbles: true
        }
      )
    );
  }

  document.querySelectorAll("[data-key]").forEach((button) => {
    const keyName = button.dataset.key;
    let pressed = false;

    const down = (event) => {
      event.preventDefault();

      if (pressed) return;
      pressed = true;

      button.classList.add("pressed");
      sendKey(keyName, true);
    };

    const up = (event) => {
      event.preventDefault();

      if (!pressed) return;
      pressed = false;

      button.classList.remove("pressed");
      sendKey(keyName, false);
    };

    button.addEventListener("pointerdown", down);
    button.addEventListener("pointerup", up);
    button.addEventListener("pointercancel", up);
    button.addEventListener("pointerleave", up);
  });

  menuButton.addEventListener("click", () => {
    menu.showModal();
  });

  closeMenu.addEventListener("click", () => {
    menu.close();
  });

  fullscreenButton.addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error("Fullscreen:", error);
    }
  });

  reloadButton.addEventListener("click", () => {
    window.location.reload();
  });

})();
