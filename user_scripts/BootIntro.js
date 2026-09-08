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

        if (!bootScreen) {
          resolve();
          return;
        }

        bootScreen.classList.remove(
          "boot-active",
          "update-active",
          "boot-finished"
        );

        bootScreen.classList.add("boot-active");

        /*
         * Funciona automáticamente en PC.
         * En móviles el navegador puede bloquear
         * audio automático hasta una interacción.
         */
        playBootSound();

        window.setTimeout(() => {
          bootScreen.classList.add("update-active");
        }, LOGO_TIME);

        window.setTimeout(() => {
          bootScreen.classList.add("boot-finished");
        }, LOGO_TIME + WARNING_TIME);

        window.setTimeout(() => {
          resolve();
        }, LOGO_TIME + WARNING_TIME + FADE_TIME);
      });
    }
  };
})();
