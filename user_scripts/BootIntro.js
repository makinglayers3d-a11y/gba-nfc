"use strict";

(function () {
  const LOGO_TIME = 3800;
  const WARNING_TIME = 2500;
  const FADE_TIME = 2000;

  let audioContext = null;

  function playBootSound() {
    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) return;

      if (!audioContext) {
        audioContext = new AudioContextClass();
      }

      if (audioContext.state === "suspended") {
        audioContext.resume().catch(() => {});
      }

      const now = audioContext.currentTime;

      /*
       * Chime original inspirado en consolas portátiles clásicas.
       * No reproduce el audio original de Nintendo.
       */

      const notes = [
        { frequency: 523.25, delay: 0, duration: 0.12 },
        { frequency: 659.25, delay: 0.11, duration: 0.12 },
        { frequency: 783.99, delay: 0.22, duration: 0.16 },
        { frequency: 1046.5, delay: 0.36, duration: 0.28 }
      ];

      notes.forEach((note) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();

        oscillator.type = "square";
        oscillator.frequency.setValueAtTime(
          note.frequency,
          now + note.delay
        );

        gain.gain.setValueAtTime(0.0001, now + note.delay);
        gain.gain.exponentialRampToValueAtTime(
          0.08,
          now + note.delay + 0.01
        );
        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          now + note.delay + note.duration
        );

        oscillator.connect(gain);
        gain.connect(audioContext.destination);

        oscillator.start(now + note.delay);
        oscillator.stop(now + note.delay + note.duration + 0.02);
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
        const bootScreen = document.getElementById("boot-screen");

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
         * Intentamos reproducir el chime.
         * En algunos móviles el navegador bloqueará
         * el sonido automático hasta una interacción.
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
