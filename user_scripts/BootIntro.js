"use strict";

(function () {
  const LOGO_TIME = 3800;
  const WARNING_TIME = 2500;
  const FADE_TIME = 2000;

     
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

      
        bootScreen.classList.remove(
          "boot-active",
          "update-active",
          "boot-finished"
        );

        bootScreen.classList.add("boot-active");

      

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

})();
