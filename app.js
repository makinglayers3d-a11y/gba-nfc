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
  const canvas = document.getElementById("screen");

  const gameConfig = {
    pokemon: {
      name: "Pokémon",
      rom: "games/PokemonRF.gba"
    }
  };

  const selected = gameConfig[game] || gameConfig.pokemon;
  title.textContent = selected.name;

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
      new KeyboardEvent(pressed ? "keydown" : "keyup", {
        key,
        code: key,
        bubbles: true,
        cancelable: true
      })
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

  async function verifyRom() {
    status.hidden = false;
    status.textContent = "Comprobando juego…";

    try {
      const response = await fetch(selected.rom, {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const rom = await response.arrayBuffer();

      if (rom.byteLength < 1024) {
        throw new Error("ROM demasiado pequeña");
      }

      canvas.width = 240;
      canvas.height = 160;

      status.hidden = true;

      console.log(
        "ROM cargada:",
        selected.rom,
        rom.byteLength,
        "bytes"
      );

      window.__gbaRom = new Uint8Array(rom);
      window.__gbaCanvas = canvas;

    } catch (error) {
      console.error("No se pudo cargar la ROM:", error);

      status.hidden = false;
      status.textContent =
        "No se pudo cargar el juego. Comprueba que games/PokemonRF.gba exista.";
    }
  }

  verifyRom();
})();
