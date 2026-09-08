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
  const speedSelect = document.getElementById("speed-select");
  const canvas = document.getElementById("screen");

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
  let startTime = 0;
  let fullscreenRequested = false;

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

  /*
   * Pantalla completa con el primer toque/clic.
   * El navegador exige interacción del usuario.
   */
  async function enterFullscreen() {
    if (fullscreenRequested) return;

    fullscreenRequested = true;

    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch (error) {
      console.log("Pantalla completa no disponible:", error);
    }
  }

  /*
   * Intentamos entrar en pantalla completa con la primera interacción.
   */
  window.addEventListener(
    "pointerdown",
    () => {
      enterFullscreen();
    },
    {
      once: true,
      passive: true
    }
  );

  document.querySelectorAll("[data-key]").forEach((button) => {
    const keyName = button.dataset.key;
    let pressed = false;

    function press() {
      if (pressed) return;

      pressed = true;
      button.classList.add("pressed");
      pressKey(keyName);
    }

    function release() {
      if (!pressed) return;

      pressed = false;
      button.classList.remove("pressed");
      releaseKey(keyName);
    }

    button.addEventListener(
      "touchstart",
      (event) => {
        event.preventDefault();
        enterFullscreen();
        press();
      },
      { passive: false }
    );

    button.addEventListener(
      "touchend",
      (event) => {
        event.preventDefault();
        release();
      },
      { passive: false }
    );

    button.addEventListener(
      "touchcancel",
      (event) => {
        event.preventDefault();
        release();
      },
      { passive: false }
    );

    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      enterFullscreen();
      press();
    });

    button.addEventListener("mouseup", (event) => {
      event.preventDefault();
      release();
    });

    button.addEventListener("mouseleave", (event) => {
      if (event.buttons === 0) {
        release();
      }
    });
  });

  /*
   * Teclado físico.
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

  /*
   * Carga del juego.
   */
  async function loadGame() {
    try {
      status.hidden = false;
      status.style.display = "";
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
        throw new Error("Falta GameBoyAdvanceEmulator");
      }

      if (typeof GameBoyAdvanceMemory !== "function") {
        throw new Error("Falta GameBoyAdvanceMemory");
      }

      emulator = new GameBoyAdvanceEmulator();

      /*
       * Velocidad guardada.
       * 95% es el valor inicial.
       */
      const savedSpeed = Number(
        localStorage.getItem("gba-speed") || "0.95"
      );

      emulator.setSpeed(savedSpeed);

      if (speedSelect) {
        speedSelect.value = String(savedSpeed);
      }

      emulator.attachPlayStatusHandler(() => {});

      /*
       * Arranque sin BIOS.
       */
      emulator.settings.offthreadGfxEnabled = false;
      emulator.settings.SKIPBoot = true;

      const blitter = new GfxGlueCode(240, 160);

      blitter.attachCanvas(canvas);

      emulator.attachGraphicsFrameHandler(blitter);
      emulator.attachROM(rom);

      emulator.settings.SKIPBoot = true;

      emulator.play();
      window.__gba = emulator;

      /*
       * Temporizador estable.
       *
       * IodineGBA espera el tiempo transcurrido,
       * no performance.now() absoluto.
       */
      startTime = Date.now();

      timer = window.setInterval(() => {
        if (!emulator) return;

        const elapsed = (Date.now() - startTime) >>> 0;

        emulator.timerCallback(elapsed);
      }, 8);

      status.hidden = true;
      status.style.display = "none";

      console.log(
        "Juego iniciado:",
        selected.rom,
        rom.length,
        "bytes",
        "velocidad:",
        savedSpeed
      );
    } catch (error) {
      console.error(error);

      status.hidden = false;
      status.style.display = "";
      status.textContent =
        "Error al iniciar el juego: " + error.message;
    }
  }

  menuButton.addEventListener("click", () => {
    menu.showModal();
  });

  speedSelect.addEventListener("change", () => {
    const speed = Number(speedSelect.value);

    if (!Number.isFinite(speed)) {
      return;
    }

    if (emulator) {
      emulator.setSpeed(speed);
    }

    localStorage.setItem("gba-speed", String(speed));
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
      timer = null;
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
