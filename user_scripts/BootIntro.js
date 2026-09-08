"use strict";

(function () {
  const LOGO_TIME = 3800;
  const WARNING_TIME = 2500;
  const FADE_TIME = 2000;

  let bootAudioContext = null;

  function playBootSound() {
    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) return;

      if (!bootAudioContext) {
        bootAudioContext = new AudioContextClass();
      }

      if (bootAudioContext.state === "suspended") {
        bootAudioContext.resume().catch(() => {});
      }

      const now = bootAudioContext.currentTime;

      const notes = [
        { frequency: 523.25, start: 0.00, length: 0.12 },
        { frequency: 659.25, start: 0.11, length: 0.12 },
        { frequency: 783.99, start: 0.22, length: 0.15 },
        { frequency: 1046.50, start: 0.36, length: 0.30 }
      ];

      notes.forEach((note) => {
        const oscillator = bootAudioContext.createOscillator();
        const gain = bootAudioContext.createGain();

        oscillator.type = "square";

        oscillator.frequency.setValueAtTime(
          note.frequency,
          now + note.start
        );

        gain.gain.setValueAtTime(
          0.0001,
          now + note.start
        );

        gain.gain.exponentialRampToValueAtTime(
          0.07,
          now + note.start + 0.01
        );

        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          now + note.start + note.length
        );

        oscillator.connect(gain);
        gain.connect(bootAudioContext.destination);

        oscillator.start(now + note.start);
        oscillator.stop(now + note.start + note.length + 0.02);
      });
    } catch (error) {
      console.log("Sonido de inicio no disponible:", error);
    }
  }

  window.gbaBootIntro = {
    started: false,
start() {
  if (this.started) {
    return Promise.resolve();
  }

  this.started = true;

  return new Promise((resolve) => {
    const bootScreen =
      document.getElementById("boot-screen");

    const bootBrand =
      document.getElementById("boot-brand");

    if (!bootScreen) {
      resolve();
      return;
    }

    /*
     * Convertimos:
     *
     * Makinglayers3d creations
     *
     * en letras individuales.
     */

    if (bootBrand) {
      const text =
        bootBrand.textContent.trim();

      bootBrand.textContent = "";

      [...text].forEach((character, index) => {
        const letter =
          document.createElement("span");

        letter.className =
          "boot-letter";

        /*
         * Los espacios normales no se conservan
         * visualmente de la misma forma dentro de
         * spans, así que usamos un espacio especial.
         */

        letter.textContent =
          character === " "
            ? "\u00A0"
            : character;

        /*
         * Cada letra recibe un retraso distinto.
         *
         * Primera letra:
         * 0.80 segundos
         *
         * Segunda:
         * 0.845 segundos
         *
         * Tercera:
         * 0.89 segundos
         *
         * etc.
         */

        letter.style.setProperty(
          "--letter-delay",
          `${0.8 + index * 0.045}s`
        );

        bootBrand.appendChild(letter);
      });
    }

    /*
     * Comenzamos la pantalla de arranque.
     */

    bootScreen.classList.remove(
      "boot-active",
      "update-active",
      "boot-finished"
    );

    bootScreen.classList.add(
      "boot-active"
    );

    /*
     * Sonido de inicio.
     */

    playBootSound();

    /*
     * Después de 3,8 segundos:
     * pasamos al aviso.
     */

    window.setTimeout(() => {
      bootScreen.classList.add(
        "update-active"
      );
    }, LOGO_TIME);

    /*
     * Después del tiempo del aviso:
     * comienza el desvanecimiento.
     */

    window.setTimeout(() => {
      bootScreen.classList.add(
        "boot-finished"
      );
    }, LOGO_TIME + WARNING_TIME);

    /*
     * Cuando termina completamente
     * el desvanecimiento, permitimos
     * que app.js cargue el juego.
     */

    window.setTimeout(() => {
      resolve();
    }, LOGO_TIME + WARNING_TIME + FADE_TIME);
  });
}
    
  };
})();
