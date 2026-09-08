"use strict";

(function () {
  const BOOT_DURATION = 3600;
  const UPDATE_DURATION = 2000;
  const TOTAL_DURATION = BOOT_DURATION + UPDATE_DURATION;

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

        bootScreen.classList.add("boot-active");

        window.setTimeout(() => {
          bootScreen.classList.add("update-active");
        }, BOOT_DURATION);

        window.setTimeout(() => {
          bootScreen.classList.add("boot-finished");

          window.setTimeout(() => {
            resolve();
          }, UPDATE_DURATION);
        }, TOTAL_DURATION);
      });
    }
  };
})();
