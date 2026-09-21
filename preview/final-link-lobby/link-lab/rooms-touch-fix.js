(() => {
  "use strict";

  const logEl = document.getElementById("log");
  const log = (message) => {
    if (!logEl) return;
    const time = new Date().toLocaleTimeString();
    logEl.textContent += `[${time}] ${message}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  };

  function dispatchLobbyKey(key) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
  }

  function focusLobby() {
    const stage = document.getElementById("lobbyStage");
    try { stage?.focus({ preventScroll: true }); } catch { stage?.focus(); }
  }

  function closeModalDirect(id) {
    const modal = document.getElementById(id);
    if (!modal) return false;
    modal.hidden = true;
    focusLobby();
    log(`Modal cerrado: ${id}.`);
    return true;
  }

  function openAvatarFallback() {
    const modal = document.getElementById("avatarModal");
    if (!modal) return;
    const profileName = document.getElementById("profileName");
    const playerName = document.getElementById("playerName");
    if (profileName && !profileName.value && playerName?.value) profileName.value = playerName.value;
    modal.hidden = false;
  }

  function openChatFallback() {
    const composer = document.getElementById("chatComposer");
    const input = document.getElementById("chatInput");
    if (!composer) return;
    composer.hidden = false;
    try { input?.focus({ preventScroll: false }); } catch { input?.focus(); }
  }

  function openSelectDirect() {
    const modal = document.getElementById("selectModal");
    const hostMenu = document.getElementById("hostMenu");
    const guestMenu = document.getElementById("guestMenu");
    if (!modal) return;

    const localName = document.querySelector(".player.local .player-name-text")?.textContent || "";
    const isHost = localName.includes("★");
    if (hostMenu) hostMenu.hidden = !isHost;
    if (guestMenu) guestMenu.hidden = isHost;
    modal.hidden = false;
    log(`SELECT directo: ${isHost ? "host" : "invitado"}.`);
  }

  function bind(id, action, fallbackCheck) {
    const button = document.getElementById(id);
    if (!button) return;

    let lastActivation = 0;
    const activate = (event) => {
      const now = performance.now();
      if (now - lastActivation < 350) return;
      lastActivation = now;
      event?.preventDefault?.();
      event?.stopPropagation?.();
      action();
      if (fallbackCheck) window.setTimeout(fallbackCheck, 30);
    };

    button.addEventListener("pointerup", activate, { passive: false });
    button.addEventListener("touchend", activate, { passive: false });
    button.addEventListener("click", activate, { passive: false });
  }

  function bindCloseButtons() {
    document.querySelectorAll("[data-close-modal]").forEach((button) => {
      let lastClose = 0;
      const close = (event) => {
        const now = performance.now();
        if (now - lastClose < 300) return;
        lastClose = now;
        event?.preventDefault?.();
        event?.stopPropagation?.();
        closeModalDirect(button.dataset.closeModal);
      };
      button.addEventListener("pointerup", close, { passive: false });
      button.addEventListener("touchend", close, { passive: false });
      button.addEventListener("click", close, { passive: false });
    });
  }

  bind("avatarButton", () => {
    log("L pulsado.");
    dispatchLobbyKey("l");
  }, () => {
    const modal = document.getElementById("avatarModal");
    if (modal?.hidden) {
      log("L: fallback directo de editor.");
      openAvatarFallback();
    }
  });

  bind("chatButton", () => {
    log("R pulsado.");
    dispatchLobbyKey("r");
  }, () => {
    const composer = document.getElementById("chatComposer");
    if (composer?.hidden) {
      log("R: fallback directo de chat.");
      openChatFallback();
    }
  });

  bind("selectButton", () => {
    log("SELECT pulsado.");
    openSelectDirect();
  });

  bindCloseButtons();

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!document.getElementById("avatarModal")?.hidden) closeModalDirect("avatarModal");
    else if (!document.getElementById("selectModal")?.hidden) closeModalDirect("selectModal");
  });

  log("Compatibilidad directa L/R/SELECT y cierre de modales v3 activa.");
})();

/* Mejora visual v4: añade partes profesionales al avatar sin cambiar el formato
   de perfil ni los paquetes WebRTC. */
(() => {
  "use strict";

  const moveTimers = new WeakMap();
  const lastPositions = new WeakMap();

  function part(className) {
    const el = document.createElement("span");
    el.className = className;
    return el;
  }

  function decorateAvatar(wrap) {
    if (!(wrap instanceof HTMLElement)) return;
    if (wrap.querySelector(":scope > .avatar-pro-layer")) return;

    const layer = document.createElement("span");
    layer.className = "avatar-pro-layer";
    layer.append(
      part("avatar-pro-ear left"),
      part("avatar-pro-ear right"),
      part("avatar-pro-neck"),
      part("avatar-pro-arm left"),
      part("avatar-pro-arm right"),
      part("avatar-pro-collar"),
      part("avatar-pro-belt"),
      part("avatar-pro-leg left"),
      part("avatar-pro-leg right"),
      part("avatar-pro-shoe left"),
      part("avatar-pro-shoe right")
    );
    wrap.append(layer);
  }

  function updatePlayerDepth(player) {
    if (!(player instanceof HTMLElement)) return;
    const top = parseFloat(player.style.top || "58");
    if (!Number.isFinite(top)) return;

    const normalized = Math.max(0, Math.min(1, (top - 28) / 60));
    const scale = 0.86 + normalized * 0.17;
    const scaleText = scale.toFixed(3);
    if (player.style.getPropertyValue("--depth-scale") !== scaleText) {
      player.style.setProperty("--depth-scale", scaleText);
    }

    const z = String(20 + Math.round(top));
    if (player.style.zIndex !== z) player.style.zIndex = z;

    const previous = lastPositions.get(player);
    const current = `${player.style.left}|${player.style.top}`;
    if (previous && previous !== current) {
      player.classList.add("is-moving");
      clearTimeout(moveTimers.get(player));
      moveTimers.set(player, setTimeout(() => player.classList.remove("is-moving"), 180));
    }
    lastPositions.set(player, current);
  }

  function refresh(root = document) {
    root.querySelectorAll?.(".avatar-wrap").forEach(decorateAvatar);
    root.querySelectorAll?.(".player").forEach(updatePlayerDepth);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node.matches(".avatar-wrap")) decorateAvatar(node);
          node.querySelectorAll?.(".avatar-wrap").forEach(decorateAvatar);
          if (node.matches(".player")) updatePlayerDepth(node);
          node.querySelectorAll?.(".player").forEach(updatePlayerDepth);
        });
      } else if (mutation.type === "attributes" && mutation.target instanceof HTMLElement && mutation.target.matches(".player")) {
        updatePlayerDepth(mutation.target);
      }
    }
  });

  const start = () => {
    refresh();
    observer.observe(document.body, {
      subtree:true,
      childList:true,
      attributes:true,
      attributeFilter:["style"]
    });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once:true });
  else start();
})();
