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

  const ctx = canvas.getContext("2d", {
    alpha: false
  });

  const gameConfig = {
    pokemon: {
      name: "Pokémon",
      rom: "games/PokemonRF.gba"
    }
  };

  const selected = gameConfig[game] || gameConfig.pokemon;

  title.textContent = selected.name;
  status.textContent = "Cargando Pokémon…";

  canvas.width = 240;
  canvas.height = 160;

  let emulator = null;
  let timer = null;

  /*
   * Mapa de botones IodineGBA:
   * 0 A
   * 1 B
   * 2 SELECT
   * 3 START
   * 4 RIGHT
   * 5 LEFT
   * 6 UP
   * 7 DOWN
   * 8 R
   * 9 L
   */
  const keyMap = {
    A: 0,
    B: 1,
    SELECT: 2,
    START: 3,
    RIGHT: 4,
    LEFT: 5,
    UP: 6,
    DOWN: 7,
    R: 8,
    L: 9
  };

  function drawFrame(buffer) {
    if (!buffer || buffer.length < 240 * 160 * 3) {
      return;
    }

    const image = ctx.createImageData(240, 160);
    const data = image.data;

    let source = 0;
    let target = 0;

    while (source < 240 * 160 * 3) {
      data[target++] = buffer[source++];
      data[target++] = buffer[source++];
      data[target++] = buffer[source++];
      data[target++] = 255;
    }

    ctx.putImageData(image, 0, 0);
  }

  function pressKey(keyName) {
    if (!emulator) return;

    const value = keyMap[keyName];

    if (value === undefined) return;

    emulator.keyDown(value);
  }

  function releaseKey(keyName) {
    if (!emulator) return;

    const value = keyMap[keyName];

    if (value === undefined) return;

    emulator.keyUp(value);
  }

  document.querySelectorAll("[data-key]").forEach((button) => {
    const keyName = button.dataset.key;
    let pressed = false;

    const down = (event) => {
      event.preventDefault();

      if (pressed) return;

      pressed = true;
      button.classList.add("pressed");

      pressKey(keyName);
    };

    const up = (event) => {
      event.preventDefault();

      if (!pressed) return;

      pressed = false;
      button.classList.remove("pressed");

      releaseKey(keyName);
    };

    button.addEventListener("pointerdown", down);
    button.addEventListener("pointerup", up);
    button.addEventListener("pointercancel", up);
    button.addEventListener("pointerleave", up);
  });

  /*
   * Teclado físico también funciona.
   */
  const keyboardMap = {
    x: "A",
    z: "B",
    Enter: "START",
    Shift: "SELECT",
    ArrowRight: "RIGHT",
    ArrowLeft: "LEFT",
    ArrowUp: "UP",
    ArrowDown: "DOWN",
    s: "R",
    a: "L"
  };

  const keyboardPressed = new Set();

  window.addEventListener("keydown", (event) => {
    const keyName = keyboardMap[event.key];

    if (!keyName || keyboardPressed.has(event.key)) {
      return;
    }

    event.preventDefault();

    keyboardPressed.add(event.key);
    pressKey(keyName);
  });

  window.addEventListener("keyup", (event) => {
    const keyName = keyboardMap[event.key];

    if (!keyName) {
      return;
    }

    event.preventDefault();

    keyboardPressed.delete(event.key);
    releaseKey(keyName);
  });

  async function loadGame() {
    try {
      status.hidden = false;
      status.textContent = "Cargando Pokémon…";

      const response = await fetch(selected.rom, {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const rom = new Uint8Array(await response.arrayBuffer());

      if (rom.length < 1024) {
        throw new Error("ROM inválida");
      }

      if (typeof GameBoyAdvanceEmulator !== "function") {
        throw new Error("IodineGBA no se cargó correctamente");
      }

      emulator = new GameBoyAdvanceEmulator();

      /*
       * Saltamos la BIOS para no necesitar un archivo BIOS externo.
       */
      emulator.settings.SKIPBoot = true;

      emulator.attachGraphicsFrameHandler(drawFrame);

      emulator.attachROM(rom);

      emulator.play();

      timer = window.setInterval(() => {
        if (emulator) {
          emulator.timerCallback(
            performance.now() | 0
          );
        }
      }, 8);

      status.hidden = true;

      console.log(
        "Juego iniciado:",
        selected.rom,
        rom.length,
        "bytes"
      );
    } catch (error) {
      console.error(error);

      status.hidden = false;
      status.textContent =
        "Error al iniciar el juego: " + error.message;
    }
  }

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

  window.addEventListener("beforeunload", () => {
    if (timer) {
      clearInterval(timer);
    }

    if (emulator) {
      try {
        emulator.pause();
      } catch (error) {
        console.error(error);
      }
    }
  });

  loadGame();
})();
