"use strict";

(function () {
  const LOGO_TIME = 3800;
  const WARNING_TIME = 2500;
  const FADE_TIME = 2000;

  let bootAudioContext = null;
  let soundUnlocked = false;

  function createAudioContext() {
    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) return null;

      if (!bootAudioContext) {
        bootAudioContext = new AudioContextClass();
      }

      return bootAudioContext;
    } catch (error) {
      console.log("No se pudo crear AudioContext:", error);
      return null;
    }
  }

  function unlockBootAudio() {
    const context = createAudioContext();

    if (!context) return;

    try {
      if (context.state === "suspended") {
        context.resume().catch(() => {});
      }

      soundUnlocked = true;
    } catch (error) {
      console.log("No se pudo desbloquear el audio:", error);
    }
  }

  function playBootSound() {
    const context = createAudioContext();

    if (!context) return;

    try {
      if (context.state === "suspended") {
        context.resume().catch(() => {});
        return;
      }

      const now = context.currentTime;

      const notes = [
        { frequency: 523.25, start: 0.00, length: 0.10 },
        { frequency: 659.25, start: 0.10, length: 0.10 },
        { frequency: 783.99, start: 0.20, length: 0.12 },
        { frequency: 1046.50, start: 0.32, length: 0.25 }
      ];

      notes.forEach((note) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();

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
          0.08,
          now + note.start + 0.01
        );

        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          now + note.start + note.length
        );

        oscillator.connect(gain);
        gain.connect(context.destination);

        oscillator.start(now + note.start);
        oscillator.stop(
          now + note.start + note.length + 0.02
        );
      });
    } catch (error) {
      console.log("No se pudo reproducir el sonido:", error);
    }
  }

  window.gbaBootIntro = {
    started: false,

    unlockAudio() {
      unlockBootAudio();

      if (soundUnlocked) {
        playBootSound();
      }
    },

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
         * Crear las letras individualmente.
         */

        if (bootBrand) {
          const text =
            bootBrand.textContent.trim();

          bootBrand.textContent = "";

          [...text].forEach((character, index) => {
            const letter =
              document.createElement("span");

            letter.className = "boot-letter";

            letter.textContent =
              character === " "
                ? "\u00A0"
                : character;

            letter.style.setProperty(
              "--letter-delay",
              `${0.7 + index * 0.055}s`
            );

            bootBrand.appendChild(letter);
          });
        }

        /*
         * Mostrar intro.
         */

        bootScreen.classList.remove(
          "boot-active",
          "update-active",
          "boot-finished"
        );

        bootScreen.classList.add("boot-active");

        /*
         * Intentar sonido automático.
         */

        unlockBootAudio();

        if (soundUnlocked) {
          playBootSound();
        }

        /*
         * Logo -> aviso.
         */

        window.setTimeout(() => {
          bootScreen.classList.add(
            "update-active"
          );
        }, LOGO_TIME);

        /*
         * Aviso -> desvanecimiento.
         */

        window.setTimeout(() => {
          bootScreen.classList.add(
            "boot-finished"
          );
        }, LOGO_TIME + WARNING_TIME);

        /*
         * Final de intro.
         */

        window.setTimeout(() => {
          resolve();
        }, LOGO_TIME + WARNING_TIME + FADE_TIME);
      });
    }
  };

  /*
   * Primer toque/clic:
   * desbloquea el audio de la intro.
   */

  window.addEventListener(
    "pointerdown",
    () => {
      if (
        window.gbaBootIntro &&
        window.gbaBootIntro.started
      ) {
        window.gbaBootIntro.unlockAudio();
      }
    },
    {
      passive: true
    }
  );

  window.addEventListener(
    "touchstart",
    () => {
      if (
        window.gbaBootIntro &&
        window.gbaBootIntro.started
      ) {
        window.gbaBootIntro.unlockAudio();
      }
    },
    {
      passive: true
    }
  );
})();
