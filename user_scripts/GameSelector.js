"use strict";

(function () {
  const REPO_API =
    "https://api.github.com/repos/makinglayers3d-a11y/gba-nfc/contents/games";

  const selectGameButton =
    document.getElementById("select-game-button");

  const gameSelector =
    document.getElementById("game-selector");

  const closeGameSelector =
    document.getElementById("close-game-selector");

  const gameList =
    document.getElementById("game-list");

  if (
    !selectGameButton ||
    !gameSelector ||
    !closeGameSelector ||
    !gameList
  ) {
    return;
  }

  async function loadGameList() {
    gameList.innerHTML =
      '<div class="game-list-status">Cargando juegos…</div>';

    try {
      const response = await fetch(REPO_API, {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      const files = await response.json();

      const games = files
        .filter((file) => {
          return (
            file.type === "file" &&
            file.name.toLowerCase().endsWith(".gba")
          );
        })
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, {
            sensitivity: "base"
          })
        );

      if (games.length === 0) {
        gameList.innerHTML =
          '<div class="game-list-status">No hay juegos GBA.</div>';
        return;
      }

      gameList.innerHTML = "";

      for (const game of games) {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "game-option";
        button.textContent = game.name;

        button.addEventListener("click", () => {
          const url = new URL(window.location.href);

          url.searchParams.set("rom", game.name);

          window.location.href = url.toString();
        });

        gameList.appendChild(button);
      }
    } catch (error) {
      console.error("No se pudo cargar la lista de juegos:", error);

      gameList.innerHTML =
        '<div class="game-list-status">' +
        "No se pudo cargar la lista de juegos." +
        "</div>";
    }
  }

  selectGameButton.addEventListener("click", async () => {
    gameSelector.showModal();
    await loadGameList();
  });

  closeGameSelector.addEventListener("click", () => {
    gameSelector.close();
  });
})();
