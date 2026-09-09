"use strict";

(function () {
  const LOGO_TIME = 3800;
  const WARNING_TIME = 2500;
  const FADE_TIME = 2000;

  window.gbaBootIntro = {
    started: false,

    start() {
      
            const params =
        new URLSearchParams(window.location.search);

      const skipIntro =
        params.get("skipintro") === "1" ||
        params.get("menu") === "1";

      const bootScreen =
        document.getElementById("boot-screen");

      if (skipIntro) {
        this.started = true;

        if (bootScreen) {
          bootScreen.classList.add("boot-finished");
          bootScreen.style.display = "none";
          bootScreen.style.visibility = "hidden";
          bootScreen.style.opacity = "0";
          bootScreen.style.pointerEvents = "none";
        }

        return Promise.resolve();
      }
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
