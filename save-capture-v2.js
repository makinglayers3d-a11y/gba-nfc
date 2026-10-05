(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const activeId = params.get("rom") || params.get("game") || "pokemon";

  function readStats() {
    try {
      return JSON.parse(localStorage.getItem(`ml3d-game-stats:${activeId}`) || "{}");
    } catch (_) {
      return {};
    }
  }

  function formatPlayed(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours) return `${hours} h ${String(minutes).padStart(2, "0")} min`;
    if (minutes) return `${minutes} min ${String(secs).padStart(2, "0")} s`;
    return `${secs} s`;
  }

  function pulseMenuOnArrival(capture) {
    const menuButton = document.getElementById("menu-button");
    if (!menuButton) return;

    window.setTimeout(() => {
      if (!capture.isConnected) return;
      menuButton.classList.remove("ml3d-save-absorb");
      void menuButton.offsetWidth;
      menuButton.classList.add("ml3d-save-absorb");

      window.setTimeout(() => {
        menuButton.classList.remove("ml3d-save-absorb");
      }, 620);
    }, 3430);
  }

  function enhanceCapture(capture) {
    if (!capture || capture.dataset.saveCaptureV2 === "1") return;
    capture.dataset.saveCaptureV2 = "1";

    const title = capture.querySelector(":scope > strong");
    const system = capture.querySelector(":scope > span");
    const oldFooter = capture.querySelector(":scope > small");
    if (title) title.classList.add("ml3d-save-title");
    if (system) system.classList.add("ml3d-save-system");
    if (oldFooter) oldFooter.remove();

    const stats = readStats();
    const now = new Date();
    const date = now.toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
    const time = now.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit"
    });

    const meta = document.createElement("div");
    meta.className = "ml3d-save-capture-meta";

    const played = document.createElement("div");
    played.innerHTML = `<span>TIEMPO JUGADO</span><b>${formatPlayed(stats.seconds)}</b>`;

    const savedAt = document.createElement("div");
    savedAt.innerHTML = `<span>GUARDADO</span><b>${date} · ${time}</b>`;

    meta.append(played, savedAt);
    capture.appendChild(meta);
    pulseMenuOnArrival(capture);
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(".ml3d-save-capture")) enhanceCapture(node);
        node.querySelectorAll?.(".ml3d-save-capture").forEach(enhanceCapture);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll(".ml3d-save-capture").forEach(enhanceCapture);
})();