(() => {
  "use strict";

  const CONFIG_URL = "dev-access-config.json";
  const MESSAGE_ORDER = ["work", "update", "announcement"];
  const STARTUP_NOTICE_KEY = "ml3d-startup-notices-shown-v1";
  const CHAT_CLIENT_KEY = "ml3d-help-chat-client-v1";
  const CHAT_SEEN_KEY = "ml3d-help-chat-seen-v1";
  const NEWS_SEEN_KEY = "ml3d-updates-seen-v1";
  const NEWS_REVISION = "2026-09-25-scalefx-ultra-1";
  const MAX_VIDEO_FILE_BYTES = 1050000;
  let chatUnreadCount = 0;
  let chatStatusTimer = 0;

  const MESSAGE_LABELS = {
    work: "MENSAJE DE TRABAJO",
    update: "MENSAJE DE ACTUALIZACIÓN",
    announcement: "MENSAJE DE COMUNICADO"
  };

  async function loadConfig() {
    const response = await fetch(`${CONFIG_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`No se pudo cargar la configuración (${response.status})`);
    return response.json();
  }

  async function api(path, options = {}) {
    const config = await loadConfig();
    if (!config.apiBase) throw new Error("El servicio de herramientas no está configurado.");
    const response = await fetch(config.apiBase.replace(/\/$/, "") + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Error del servidor (${response.status})`);
    return data;
  }

  function readChatClient(create = true) {
    try {
      const parsed = JSON.parse(localStorage.getItem(CHAT_CLIENT_KEY) || "null");
      if (parsed && parsed.clientId && parsed.clientToken) return parsed;
    } catch (_) {}
    if (!create) return null;
    const client = {
      clientId: crypto.randomUUID(),
      clientToken: crypto.randomUUID() + crypto.randomUUID()
    };
    localStorage.setItem(CHAT_CLIENT_KEY, JSON.stringify(client));
    return client;
  }

  function chatIdentityPayload(client) {
    const access = window.ml3dAccessIdentity || {};
    return {
      ...client,
      deviceId: String(access.deviceId || ""),
      sessionId: String(access.sessionId || "")
    };
  }

  function hasPendingNews() {
    try {
      return localStorage.getItem(NEWS_SEEN_KEY) !== NEWS_REVISION;
    } catch (_) {
      return true;
    }
  }

  function markNewsSeen() {
    try {
      localStorage.setItem(NEWS_SEEN_KEY, NEWS_REVISION);
    } catch (_) {}
  }

  function readChatSeen() {
    try {
      const value = JSON.parse(localStorage.getItem(CHAT_SEEN_KEY) || "null");
      if (value && typeof value === "object") {
        return {
          id: String(value.id || ""),
          at: String(value.at || "")
        };
      }
    } catch (_) {}
    return { id: "", at: "" };
  }

  function markChatSeen(message) {
    if (!message || message.sender !== "admin") return;
    const value = {
      id: String(message.id || ""),
      at: String(message.createdAt || "")
    };
    try {
      localStorage.setItem(CHAT_SEEN_KEY, JSON.stringify(value));
    } catch (_) {}
  }

  function isNewerAdminMessage(latestId, latestAt) {
    if (!latestId && !latestAt) return false;
    const seen = readChatSeen();
    if (latestId && seen.id && latestId === seen.id) return false;
    const latestTime = Date.parse(latestAt || "");
    const seenTime = Date.parse(seen.at || "");
    if (Number.isFinite(latestTime) && Number.isFinite(seenTime)) return latestTime > seenTime;
    if (latestId && seen.id) return latestId !== seen.id;
    return Boolean(latestId || latestAt);
  }

  function removeInlineDots() {
    document.querySelectorAll(".ml3d-chat-dot").forEach((dot) => dot.remove());
  }

  function removeFloatingDot() {
    document.querySelectorAll(".ml3d-chat-dot-floating").forEach((dot) => dot.remove());
  }

  function setInlineDot(target) {
    if (!target) return;
    const dot = document.createElement("span");
    dot.className = "ml3d-chat-dot";
    dot.setAttribute("aria-hidden", "true");
    target.appendChild(dot);
  }

  function setFloatingDot(target, id = "ml3d-chat-floating-dot", host = document.body) {
    if (!target || !host) return;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    document.getElementById(id)?.remove();
    const dot = document.createElement("span");
    dot.id = id;
    dot.className = "ml3d-chat-dot ml3d-chat-dot-floating";
    dot.setAttribute("aria-hidden", "true");
    dot.style.left = Math.round(rect.right - 7) + "px";
    dot.style.top = Math.round(rect.top - 7) + "px";
    host.appendChild(dot);
  }

  function bootIntroActive() {
    const boot = document.getElementById("boot-screen");
    if (!boot || boot.classList.contains("boot-finished")) return false;
    const style = getComputedStyle(boot);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function setUpdatesButtonVisualState(button, state) {
    if (!button) return;

    const props = ["color", "border-color", "background", "box-shadow", "text-shadow", "animation"];
    const clear = () => props.forEach((name) => button.style.removeProperty(name));

    button.classList.remove("ml3d-notify-chat", "ml3d-notify-news");

    if (state === "chat") {
      button.classList.add("ml3d-notify-chat");
      button.style.setProperty("color", "#fff8b5", "important");
      button.style.setProperty("border-color", "#ffe45e", "important");
      button.style.setProperty("background", "#3a3212f2", "important");
      button.style.setProperty("box-shadow", "0 0 12px #ffe45ecc, 0 0 28px #ffe45e77", "important");
      button.style.setProperty("text-shadow", "0 0 8px #ffe45e, 0 0 15px #ffe45eaa", "important");
      button.style.setProperty("animation", "ml3dQuestionChat 1.05s ease-in-out infinite", "important");
      return;
    }

    if (state === "news") {
      button.classList.add("ml3d-notify-news");
      button.style.setProperty("color", "#e9fcff", "important");
      button.style.setProperty("border-color", "#aaf4ff", "important");
      button.style.setProperty("background", "#153644f5", "important");
      button.style.setProperty("box-shadow", "0 0 10px #77eaffaa, 0 0 24px #77eaff66", "important");
      button.style.setProperty("text-shadow", "0 0 8px #8cecff, 0 0 15px #77eaff99", "important");
      button.style.setProperty("animation", "ml3dQuestionNews 1.35s ease-in-out infinite", "important");
      return;
    }

    clear();
  }

  function updateChatBadgePlacement() {
    const menuButton = document.getElementById("menu-button");
    const updatesButton = document.getElementById("ml3d-updates-button");
    const chatButton = document.getElementById("ml3d-chat-button");
    removeInlineDots();
    removeFloatingDot();

    const hasChat = chatUnreadCount > 0;
    const hasNews = hasPendingNews();
    const bootActive = bootIntroActive();

    if (updatesButton) {
      setUpdatesButtonVisualState(
        updatesButton,
        bootActive ? "none" : (hasChat ? "chat" : (hasNews ? "news" : "none"))
      );
    }

    if (bootActive || !hasChat) return;

    const menu = document.getElementById("menu");
    const updates = document.getElementById("ml3d-updates-panel");
    const updatesOpen = Boolean(updates && !updates.hidden);

    if (updatesOpen && chatButton) {
      // El punto vive en la capa superior del dialog, pero fuera del panel NOVEDADES.
      setFloatingDot(chatButton, "ml3d-chat-panel-floating-dot", menu || document.body);
    } else if (menu && menu.open && updatesButton) {
      setUpdatesButtonVisualState(updatesButton, "chat");
    } else {
      // En la pantalla principal: punto amarillo pulsante sobre MENÚ.
      setFloatingDot(menuButton, "ml3d-chat-floating-dot", document.body);
    }
  }

  async function refreshChatStatus() {
    const client = readChatClient(false);
    if (!client) {
      chatUnreadCount = 0;
      updateChatBadgePlacement();
      return;
    }
    try {
      const result = await api("/v1/emulator/chat/status", {
        method: "POST",
        body: JSON.stringify(chatIdentityPayload(client))
      });
      const serverUnread = Number(result.unreadCount || 0);
      const localUnread = isNewerAdminMessage(result.latestAdminId || "", result.latestAdminAt || null);
      chatUnreadCount = Math.max(serverUnread, localUnread ? 1 : 0);
    } catch (error) {
      console.warn("ML3D chat status:", error);
    }
    updateChatBadgePlacement();
  }

  function editorSrcdoc(id, placeholder) {
    const safePlaceholder = String(placeholder || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>
html,body{margin:0;width:100%;height:100%;background:transparent;color:#fff;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
textarea{box-sizing:border-box;width:100%;height:100%;margin:0;padding:12px;border:0;outline:0;resize:none;background:transparent;color:#fff;font:14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;caret-color:#fff;user-select:text;-webkit-user-select:text;-webkit-touch-callout:default;touch-action:auto}
textarea::placeholder{color:#9aabba}</style></head><body><textarea id="${id}" maxlength="4000" inputmode="text" autocomplete="off" autocapitalize="sentences" spellcheck="true" placeholder="${safePlaceholder}"></textarea></body></html>`;
  }

  function editorValue(frame, id) {
    try {
      return String(frame.contentDocument?.getElementById(id)?.value || "").trim();
    } catch (_) {
      return "";
    }
  }

  function ensureStyles() {
    if (document.getElementById("ml3d-emulator-tools-style")) return;
    const style = document.createElement("style");
    style.id = "ml3d-emulator-tools-style";
    style.textContent = `
      .ml3d-tools-overlay{
        position:fixed!important;inset:0!important;z-index:2147483647!important;display:flex!important;align-items:center!important;justify-content:center!important;
        box-sizing:border-box!important;width:100vw!important;height:100dvh!important;max-width:none!important;max-height:none!important;margin:0!important;
        padding:max(18px,env(safe-area-inset-top)) 18px max(18px,env(safe-area-inset-bottom))!important;border:0!important;
        background:rgba(0,0,0,.68)!important;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
        color:#fff;font-family:system-ui,sans-serif;pointer-events:auto!important;touch-action:auto!important
      }
      .ml3d-tools-card{
        position:relative;box-sizing:border-box;width:min(92vw,520px);max-height:min(82vh,680px);overflow:auto;
        padding:22px 20px 20px;border:1px solid #ffffff36;border-radius:18px;background:#101820f6;color:#fff;
        box-shadow:0 24px 70px #000d
      }
      .ml3d-tools-close{
        position:absolute!important;top:10px;right:10px;width:34px!important;min-width:34px!important;height:34px!important;
        min-height:34px!important;margin:0!important;padding:0!important;border-radius:50%!important;border:1px solid #ffffff35!important;
        background:#0005!important;color:inherit!important;font:900 21px/1 system-ui,sans-serif!important;box-shadow:none!important
      }
      .ml3d-tools-close::before,.ml3d-tools-close::after{content:none!important;display:none!important}
      .ml3d-tools-title{margin:0 42px 12px 0;font-size:17px;font-weight:950;letter-spacing:.06em}
      .ml3d-tools-message{white-space:pre-wrap;word-break:break-word;font-size:14px;line-height:1.55;color:inherit}
      .ml3d-help-row{display:grid;grid-template-columns:2fr 1fr;gap:8px;margin:0 0 4px}
      .ml3d-report-button,.ml3d-chat-button{
        position:relative;width:100%!important;min-height:42px!important;margin:0!important;padding:9px 12px!important;
        border:1px solid #8fe7ff66!important;border-radius:11px!important;background:#102331!important;color:#eafcff!important;
        font-size:11px!important;font-weight:950!important;letter-spacing:.08em!important;box-shadow:none!important
      }
      .ml3d-chat-dot{
        position:absolute;top:-5px;right:-5px;width:12px;height:12px;border-radius:50%;
        background:#ffe45e;border:2px solid #322b08;box-shadow:0 0 6px #ffe45e,0 0 15px #ffe45ecc;
        pointer-events:none;z-index:2147483647;animation:ml3dChatDotPulse .82s ease-in-out infinite
      }
      .ml3d-chat-dot-floating{
        position:fixed!important;right:auto!important;bottom:auto!important;transform:none!important;
        opacity:1!important;visibility:visible!important;filter:none!important;mix-blend-mode:normal!important
      }
      #menu{overflow:visible!important}
      #ml3d-chat-panel-floating-dot{z-index:2147483647!important}
      body.ml3d-console-transitioning #ml3d-chat-floating-dot{
        opacity:0!important;visibility:hidden!important
      }
      #ml3d-updates-button.ml3d-notify-chat{
        color:#fff8b5!important;border-color:#ffe45e!important;background:#3a3212f2!important;
        box-shadow:0 0 12px #ffe45ecc,0 0 28px #ffe45e77!important;
        animation:ml3dQuestionChat 1.05s ease-in-out infinite!important
      }
      #ml3d-updates-button.ml3d-notify-news{
        color:#e9fcff!important;border-color:#aaf4ff!important;background:#153644f5!important;
        box-shadow:0 0 10px #77eaffaa,0 0 24px #77eaff66!important;
        animation:ml3dQuestionNews 1.35s ease-in-out infinite!important
      }
      @keyframes ml3dChatDotPulse{
        0%,100%{opacity:.16;transform:scale(.62);box-shadow:0 0 2px #ffe45e55,0 0 5px #ffe45e44}
        50%{opacity:1;transform:scale(1.28);box-shadow:0 0 8px #ffe45e,0 0 20px #ffe45eee}
      }
      @keyframes ml3dQuestionChat{
        0%,100%{transform:translateY(0) rotate(0deg) scale(1)}
        30%{transform:translateY(-3px) rotate(-6deg) scale(1.08)}
        55%{transform:translateY(1px) rotate(5deg) scale(1.03)}
        78%{transform:translateY(-2px) rotate(-3deg) scale(1.07)}
      }
      @keyframes ml3dQuestionNews{
        0%,100%{transform:translateY(0) scale(1)}
        45%{transform:translateY(-2px) scale(1.07)}
        70%{transform:translateY(1px) scale(1.03)}
      }
      .ml3d-report-form label{display:block;margin:10px 0 6px;font-size:11px;font-weight:900;letter-spacing:.05em}
      .ml3d-report-editor{
        display:block;box-sizing:border-box;width:100%;height:150px;border:1px solid #ffffff30;border-radius:12px;
        background:#0005;overflow:hidden;pointer-events:auto!important
      }
      .ml3d-report-image-row{display:flex;align-items:center;gap:12px}
      .ml3d-report-image-add{
        flex:0 0 74px!important;width:74px!important;height:74px!important;min-width:74px!important;min-height:74px!important;
        margin:0!important;padding:0!important;border:1px solid #ffffff38!important;border-radius:12px!important;
        background:#ffffff0b!important;color:inherit!important;font:300 38px/1 system-ui,sans-serif!important;box-shadow:none!important;
        display:grid!important;place-items:center!important;cursor:pointer!important
      }
      .ml3d-report-image-add::before,.ml3d-report-image-add::after{content:none!important;display:none!important}
      .ml3d-report-image-help{font-size:11px;line-height:1.35;color:#a8b5c2}
      .ml3d-media-preview{margin-top:10px;border-radius:10px;border:1px solid #ffffff20;background:#000;overflow:hidden}
      .ml3d-media-preview img,.ml3d-media-preview video{display:block;width:100%;max-height:260px;object-fit:contain;background:#000}
      .ml3d-report-actions{display:flex;gap:9px;margin-top:14px}
      .ml3d-report-actions button{
        flex:1;min-height:42px;border:1px solid #ffffff34;border-radius:11px;background:#ffffff10;color:inherit;font-weight:900
      }
      .ml3d-report-actions .primary{background:#8fe3ff;color:#071019;border-color:#8fe3ff}
      .ml3d-report-status{margin-top:10px;font-size:12px;line-height:1.35;color:#a8dfff}
      .ml3d-chat-list{display:flex;flex-direction:column;gap:8px;max-height:46vh;overflow:auto;padding:4px 2px 8px}
      .ml3d-chat-message{max-width:86%;padding:9px 11px;border-radius:12px;font-size:13px;line-height:1.4;white-space:pre-wrap;word-break:break-word}
      .ml3d-chat-message img,.ml3d-chat-message video{display:block;width:100%;max-height:260px;object-fit:contain;margin-top:7px;border-radius:8px;background:#000}
      .ml3d-chat-message.user{align-self:flex-end;background:#1d6076}
      .ml3d-chat-message.admin{align-self:flex-start;background:#242d38}
      .ml3d-chat-time{display:block;margin-top:4px;font-size:9px;opacity:.65}
      .ml3d-chat-compose{margin-top:10px}
      .ml3d-chat-editor{display:block;box-sizing:border-box;width:100%;height:96px;border:1px solid #ffffff30;border-radius:12px;background:#0005;overflow:hidden}
      .ml3d-chat-actions{display:flex;gap:8px;margin-top:8px}
      .ml3d-chat-actions button{flex:1;min-height:40px;border:1px solid #ffffff34;border-radius:11px;background:#ffffff10;color:inherit;font-weight:900}
      .ml3d-chat-actions .primary{background:#8fe3ff;color:#071019;border-color:#8fe3ff}
      .ml3d-startup-notice-card{
        --ml3d-holo-rgb:0,217,255;
        isolation:isolate;overflow:auto!important;
        background:linear-gradient(145deg,rgba(var(--ml3d-holo-rgb),.34),rgba(4,20,30,.94))!important;
        border:1px solid rgba(var(--ml3d-holo-rgb),.82)!important;
        box-shadow:0 0 16px rgba(var(--ml3d-holo-rgb),.68),0 0 48px rgba(var(--ml3d-holo-rgb),.42),inset 0 0 30px rgba(var(--ml3d-holo-rgb),.18),0 24px 70px #000d!important;
        color:#f5feff!important;text-shadow:0 0 4px rgba(var(--ml3d-holo-rgb),.9)
      }
      .ml3d-startup-notice-card>*{position:relative;z-index:2}
      .ml3d-notice-text-box{
        box-sizing:border-box;display:flex;align-items:center;overflow:hidden;
        border:1px solid rgba(var(--ml3d-holo-rgb),.28);border-radius:10px;
        background:rgba(0,0,0,.12);padding:7px 9px;margin:0 0 9px 0
      }
      .ml3d-notice-title-box{margin-right:38px}
      .ml3d-notice-text-box .ml3d-tools-title,
      .ml3d-notice-text-box .ml3d-tools-message{
        box-sizing:border-box;width:100%;max-width:100%;margin:0!important;line-height:1.25;overflow:visible
      }
      .ml3d-notice-text-box .ml3d-tools-message{line-height:1.42}
      .ml3d-startup-notice-card::before{
        content:"";position:absolute;inset:0;z-index:1;pointer-events:none;
        background:repeating-linear-gradient(0deg,transparent 0 3px,rgba(var(--ml3d-holo-rgb),.08) 4px,rgba(var(--ml3d-holo-rgb),.06) 5px);
        mix-blend-mode:screen;animation:ml3dNoticeScan 3.2s linear infinite
      }
      .ml3d-startup-notice-card::after{
        content:"";position:absolute;inset:-20%;z-index:1;pointer-events:none;
        background:linear-gradient(100deg,transparent 40%,rgba(255,255,255,.22) 47%,rgba(var(--ml3d-holo-rgb),.16) 51%,transparent 58%);
        animation:ml3dNoticeSweep 4.8s ease-in-out infinite
      }
      .ml3d-rich-link{color:inherit;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2px;cursor:pointer}
      .ml3d-rich-anim-pulse{display:inline-block;animation:ml3dRichPulse 1.35s ease-in-out infinite}
      .ml3d-rich-anim-float{display:inline-block;animation:ml3dRichFloat 1.65s ease-in-out infinite}
      .ml3d-rich-anim-glow{display:inline-block;animation:ml3dRichGlow 1.55s ease-in-out infinite}
      .ml3d-rich-anim-shake{display:inline-block;animation:ml3dRichShake .72s ease-in-out infinite}
      @keyframes ml3dNoticeScan{from{background-position:0 0}to{background-position:0 28px}}
      @keyframes ml3dNoticeSweep{0%,58%{transform:translateX(-32%);opacity:.05}76%{opacity:.75}100%{transform:translateX(34%);opacity:.08}}
      @keyframes ml3dRichPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.08);opacity:.72}}
      @keyframes ml3dRichFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
      @keyframes ml3dRichGlow{0%,100%{filter:drop-shadow(0 0 0 currentColor)}50%{filter:drop-shadow(0 0 6px currentColor)}}
      @keyframes ml3dRichShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-2px)}75%{transform:translateX(2px)}}
      @media(max-width:420px){.ml3d-tools-card{width:96vw;padding:20px 15px 16px}.ml3d-tools-overlay{padding-left:8px;padding-right:8px}}
    `;
    document.head.appendChild(style);
  }

  function copyComputedStyle(source, target) {
    if (!source || !target) return;
    const computed = getComputedStyle(source);
    const props = [
      "background","backgroundColor","backgroundImage","border","borderColor","borderRadius",
      "boxShadow","color","fontFamily","textShadow","backdropFilter","webkitBackdropFilter"
    ];
    props.forEach((prop) => {
      const value = computed[prop];
      if (value) target.style[prop] = value;
    });
  }

  function styleLikeCurrentMenu(card) {
    const menuCard = document.querySelector("#menu .menu-card");
    if (menuCard) copyComputedStyle(menuCard, card);
  }

  function createOverlay(title) {
    ensureStyles();
    const overlay = document.createElement("div");
    overlay.className = "ml3d-tools-overlay";
    overlay.setAttribute("aria-label", title);
    const card = document.createElement("section");
    card.className = "ml3d-tools-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "ml3d-tools-close";
    close.setAttribute("aria-label", "Cerrar");
    close.textContent = "×";
    const heading = document.createElement("h2");
    heading.className = "ml3d-tools-title";
    heading.textContent = title;
    card.append(close, heading);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    styleLikeCurrentMenu(card);
    return { overlay, card, close };
  }

  function safeHttpLink(value) {
    try {
      const url = new URL(String(value || ""));
      return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
    } catch (_) {
      return "";
    }
  }

  function styleForRichIndex(spans, index) {
    const style = { color:null, bold:null, underline:null, animation:null, link:null };
    (Array.isArray(spans) ? spans : []).forEach((span) => {
      const start = Number(span?.start);
      const end = Number(span?.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || index < start || index >= end) return;
      if (span.color !== undefined && span.color !== null) style.color = String(span.color || "");
      if (span.bold !== undefined && span.bold !== null) style.bold = Boolean(span.bold);
      if (span.underline !== undefined && span.underline !== null) style.underline = Boolean(span.underline);
      if (span.animation !== undefined && span.animation !== null) style.animation = String(span.animation || "");
      if (span.link !== undefined && span.link !== null) style.link = safeHttpLink(span.link);
    });
    return style;
  }

  function richStyleKey(style) {
    return JSON.stringify([style.color,style.bold,style.underline,style.animation,style.link]);
  }

  function appendLinkifiedText(parent, value, style) {
    const text = String(value || "");
    const explicit = safeHttpLink(style.link);
    const applyStyle = (node) => {
      if (style.color) node.style.color = style.color;
      if (style.bold !== null) node.style.fontWeight = style.bold ? "800" : "400";
      if (style.underline !== null) node.style.textDecoration = style.underline ? "underline" : "none";
      const animation = ["pulse","float","glow","shake"].includes(style.animation) ? style.animation : "";
      if (animation) node.classList.add("ml3d-rich-anim-" + animation);
    };
    const addNode = (chunk, link) => {
      const node = link ? document.createElement("a") : document.createElement("span");
      node.textContent = chunk;
      if (link) {
        node.href = link;
        node.target = "_blank";
        node.rel = "noopener noreferrer";
        node.classList.add("ml3d-rich-link");
      }
      applyStyle(node);
      parent.appendChild(node);
    };
    if (explicit) {
      addNode(text, explicit);
      return;
    }
    const regex = /https?:\/\/[^\s]+/gi;
    let cursor = 0;
    for (const match of text.matchAll(regex)) {
      if (match.index > cursor) addNode(text.slice(cursor, match.index), "");
      addNode(match[0], safeHttpLink(match[0]));
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) addNode(text.slice(cursor), "");
  }

  function renderRichText(target, value, spans) {
    const text = String(value || "");
    target.textContent = "";
    if (!text) return;
    let start = 0;
    let current = styleForRichIndex(spans, 0);
    let currentKey = richStyleKey(current);
    for (let index = 1; index <= text.length; index++) {
      const next = index < text.length ? styleForRichIndex(spans, index) : null;
      const nextKey = next ? richStyleKey(next) : "";
      if (index === text.length || nextKey !== currentKey) {
        appendLinkifiedText(target, text.slice(start, index), current);
        start = index;
        current = next;
        currentKey = nextKey;
      }
    }
  }

  function fitTextToBox(target, box, maximumPx, minimumPx) {
    if (!target || !box) return;
    let size = Math.max(minimumPx, maximumPx);
    target.style.fontSize = size + "px";
    target.style.lineHeight = target.classList.contains("ml3d-tools-title") ? "1.18" : "1.35";
    for (let attempts = 0; attempts < 80 && size > minimumPx; attempts++) {
      if (target.scrollHeight <= box.clientHeight - 2 && target.scrollWidth <= box.clientWidth - 2) break;
      size -= .5;
      target.style.fontSize = size + "px";
    }
  }

  function showNotice(item) {
    return new Promise((resolve) => {
      const title = String(item.title || "").trim() || MESSAGE_LABELS[item.kind] || "AVISO";
      const design = item.design && typeof item.design === "object" ? item.design : {};
      const ui = createOverlay(title);
      ui.card.classList.add("ml3d-startup-notice-card");
      const holo = /^#[0-9a-f]{6}$/i.test(String(design.hologramColor || ""))
        ? String(design.hologramColor)
        : "#00d9ff";
      const holoRgb = [
        parseInt(holo.slice(1, 3), 16),
        parseInt(holo.slice(3, 5), 16),
        parseInt(holo.slice(5, 7), 16)
      ].join(",");
      ui.card.style.setProperty("--ml3d-holo-rgb", holoRgb);
      const widthPct = Math.max(45, Math.min(96, Number(design.cardWidthPct) || 88));
      const minHeightPct = Math.max(0, Math.min(78, Number(design.cardMinHeightPct) || 0));
      ui.card.style.width = `${widthPct}vw`;
      ui.card.style.maxWidth = "860px";
      if (minHeightPct > 0) ui.card.style.minHeight = `${minHeightPct}vh`;

      const heading = ui.card.querySelector(".ml3d-tools-title");
      let titleBox = null;
      if (heading) {
        titleBox = document.createElement("div");
        titleBox.className = "ml3d-notice-text-box ml3d-notice-title-box";
        titleBox.style.width = `${Math.max(35, Math.min(100, Number(design.titleBoxWidthPct) || 100))}%`;
        titleBox.style.height = `${Math.max(38, Math.min(180, Number(design.titleBoxHeightPx) || 64))}px`;
        heading.parentNode.insertBefore(titleBox, heading);
        titleBox.appendChild(heading);
        heading.style.color = String(design.titleColor || "#ffffff");
        heading.style.fontWeight = design.titleBold === false ? "400" : "900";
        heading.style.textDecoration = design.titleUnderline ? "underline" : "none";
        heading.style.textAlign = ["left","center","right"].includes(design.titleAlign) ? design.titleAlign : "left";
        heading.style.transform = `translate(${Number(design.titleOffsetX) || 0}px,${Number(design.titleOffsetY) || 0}px)`;
        renderRichText(heading, title, design.titleSpans);
        const titleMax = Math.max(11, Math.min(38, Number(design.titleFontSize) || 17));
        heading.style.fontSize = titleMax + "px";
        if (design.titleAutoFit !== false) {
          requestAnimationFrame(() => fitTextToBox(heading, titleBox, titleMax, 9));
        }
      }

      const bodyValue = String(item.body || "");
      if (bodyValue.trim()) {
        const bodyBox = document.createElement("div");
        bodyBox.className = "ml3d-notice-text-box ml3d-notice-body-box";
        bodyBox.style.width = `${Math.max(35, Math.min(100, Number(design.bodyBoxWidthPct) || 100))}%`;
        bodyBox.style.height = `${Math.max(60, Math.min(360, Number(design.bodyBoxHeightPx) || 140))}px`;
        const text = document.createElement("div");
        text.className = "ml3d-tools-message";
        const bodyMax = Math.max(10, Math.min(34, Number(design.bodyFontSize) || 14));
        text.style.fontSize = bodyMax + "px";
        text.style.color = String(design.bodyColor || "#ffffff");
        text.style.fontWeight = design.bodyBold ? "800" : "400";
        text.style.textDecoration = design.bodyUnderline ? "underline" : "none";
        text.style.textAlign = ["left","center","right"].includes(design.bodyAlign) ? design.bodyAlign : "left";
        text.style.transform = `translate(${Number(design.bodyOffsetX) || 0}px,${Number(design.bodyOffsetY) || 0}px)`;
        renderRichText(text, bodyValue, design.bodySpans);
        bodyBox.appendChild(text);
        ui.card.appendChild(bodyBox);
        if (design.bodyAutoFit !== false) {
          requestAnimationFrame(() => fitTextToBox(text, bodyBox, bodyMax, 8));
        }
      }

      if (item.mediaData) {
        const mediaRow = document.createElement("div");
        mediaRow.style.display = "flex";
        mediaRow.style.marginTop = "14px";
        mediaRow.style.justifyContent = design.mediaAlign === "left" ? "flex-start" : (design.mediaAlign === "right" ? "flex-end" : "center");
        const media = String(item.mediaType || "").startsWith("video/")
          ? document.createElement("video")
          : document.createElement("img");
        media.src = item.mediaData;
        media.style.width = `${Math.max(20, Math.min(100, Number(design.mediaWidthPct) || 100))}%`;
        media.style.maxHeight = "46vh";
        media.style.objectFit = "contain";
        media.style.borderRadius = "10px";
        media.style.background = "#000";
        if (media.tagName === "VIDEO") {
          media.controls = true;
          media.playsInline = true;
        }
        mediaRow.appendChild(media);
        ui.card.appendChild(mediaRow);
      }

      const done = () => {
        ui.overlay.remove();
        resolve();
      };
      ui.close.addEventListener("click", done, { once: true });
      ui.overlay.addEventListener("click", (event) => {
        if (event.target === ui.overlay) done();
      });
    });
  }

  async function showStartupMessages() {
    let payload;
    try {
      payload = await api("/v1/emulator/messages");
    } catch (error) {
      console.warn("ML3D emulator messages:", error);
      return;
    }

    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const active = messages.filter((item) =>
      item &&
      item.enabled &&
      (
        String(item.title || "").trim() ||
        String(item.body || "").trim() ||
        item.mediaData
      )
    );
    if (!active.length) {
      try { sessionStorage.removeItem(STARTUP_NOTICE_KEY); } catch (_) {}
      return;
    }

    const signature = active
      .map((item) => [item.kind, item.updatedAt || "", item.title || "", item.body || "", Boolean(item.mediaData)].join("|"))
      .join("::");
    try {
      if (sessionStorage.getItem(STARTUP_NOTICE_KEY) === signature) return;
    } catch (_) {}

    const byKind = new Map(active.map((item) => [item.kind, item]));
    for (const kind of MESSAGE_ORDER) {
      const item = byKind.get(kind);
      if (!item) continue;
      await showNotice(item);
    }

    try {
      sessionStorage.setItem(STARTUP_NOTICE_KEY, signature);
    } catch (_) {}
  }

  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No se pudo abrir la imagen.")); };
      img.src = url;
    });
  }

  async function imageToDataUrl(file) {
    if (!file) return null;
    if (!file.type.startsWith("image/")) throw new Error("Selecciona una imagen válida.");
    const img = await loadImageFile(file);
    const maxSide = 900;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    canvas.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let quality = .72;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length > 320000 && quality > .42) {
      quality -= .08;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    if (dataUrl.length > 340000) throw new Error("La imagen es demasiado grande. Prueba con una captura más pequeña.");
    return dataUrl;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
      reader.readAsDataURL(file);
    });
  }

  async function mediaToData(file) {
    if (!file) return { data: null, type: "" };
    if (file.type.startsWith("image/")) {
      return { data: await imageToDataUrl(file), type: "image/jpeg" };
    }
    if (file.type.startsWith("video/")) {
      if (file.size > MAX_VIDEO_FILE_BYTES) {
        throw new Error("El vídeo es demasiado grande. Usa un vídeo corto de aproximadamente 1 MB.");
      }
      const data = await fileToDataUrl(file);
      if (data.length > 1500000) {
        throw new Error("El vídeo es demasiado grande para enviarlo.");
      }
      const allowed = ["video/mp4", "video/webm", "video/quicktime"];
      if (!allowed.includes(file.type.toLowerCase())) {
        throw new Error("Usa un vídeo MP4, WebM o MOV.");
      }
      return { data, type: file.type.toLowerCase() };
    }
    throw new Error("Selecciona una imagen o un vídeo.");
  }

  function renderMediaPreview(container, data, type) {
    container.innerHTML = "";
    container.hidden = !data;
    if (!data) return;
    if (String(type || "").startsWith("video/")) {
      const video = document.createElement("video");
      video.controls = true;
      video.preload = "metadata";
      video.src = data;
      container.appendChild(video);
    } else {
      const image = document.createElement("img");
      image.alt = "Archivo adjunto";
      image.src = data;
      container.appendChild(image);
    }
  }

  function openReportDialog() {
    if (document.querySelector(".ml3d-tools-overlay[data-ml3d-report='1']")) return;

    const settingsMenu = document.getElementById("menu");
    if (settingsMenu && settingsMenu.open) {
      try { settingsMenu.close(); } catch (_) {}
      window.setTimeout(openReportDialog, 120);
      return;
    }

    const ui = createOverlay("REPORTES");
    ui.overlay.dataset.ml3dReport = "1";
    const form = document.createElement("div");
    form.className = "ml3d-report-form";
    form.innerHTML = `
      <label>Mensaje</label>
      <iframe id="ml3d-report-editor" class="ml3d-report-editor" title="Mensaje del reporte"></iframe>
      <label>Imagen o vídeo (opcional)</label>
      <div class="ml3d-report-image-row">
        <button type="button" class="ml3d-report-image-add" aria-label="Añadir imagen o vídeo">+</button>
        <div class="ml3d-report-image-help">Pulsa + para añadir una imagen o un vídeo corto.</div>
        <input id="ml3d-report-image" type="file" accept="image/*,video/mp4,video/webm,video/quicktime" hidden>
      </div>
      <div class="ml3d-media-preview" hidden></div>
      <div class="ml3d-report-actions">
        <button type="button" class="secondary">Cancelar</button>
        <button type="button" class="primary">Enviar reporte</button>
      </div>
      <div class="ml3d-report-status" aria-live="polite"></div>
    `;
    ui.card.appendChild(form);

    const editorFrame = form.querySelector("#ml3d-report-editor");
    const fileInput = form.querySelector("input[type=file]");
    const addImage = form.querySelector(".ml3d-report-image-add");
    const preview = form.querySelector(".ml3d-media-preview");
    const cancel = form.querySelector(".secondary");
    const send = form.querySelector(".primary");
    const status = form.querySelector(".ml3d-report-status");
    let mediaData = null;
    let mediaType = "";

    const close = () => {
      ui.overlay.remove();
    };
    ui.close.addEventListener("click", close, { once: true });
    cancel.addEventListener("click", close);
    ["keydown","keyup","keypress"].forEach((type) => {
      form.addEventListener(type, (event) => event.stopPropagation());
    });

    addImage.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", async () => {
      mediaData = null;
      mediaType = "";
      renderMediaPreview(preview, null, "");
      status.textContent = "";
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      try {
        status.textContent = "Preparando archivo…";
        const prepared = await mediaToData(file);
        mediaData = prepared.data;
        mediaType = prepared.type;
        renderMediaPreview(preview, mediaData, mediaType);
        status.textContent = mediaType.startsWith("video/") ? "Vídeo preparado." : "Imagen preparada.";
      } catch (error) {
        fileInput.value = "";
        status.textContent = error.message;
      }
    });

    editorFrame.srcdoc = editorSrcdoc("report-text", "Describe el problema, sugerencia o incidencia…");

    function reportMessage() {
      return editorValue(editorFrame, "report-text");
    }

    send.addEventListener("click", async () => {
      const message = reportMessage();
      if (!message && !mediaData) {
        status.textContent = "Escribe un mensaje o adjunta una imagen/vídeo.";
        return;
      }
      send.disabled = true;
      cancel.disabled = true;
      status.textContent = "Enviando reporte…";
      try {
        const params = new URLSearchParams(location.search);
        const client = readChatClient(true);
        const result = await api("/v1/emulator/reports", {
          method: "POST",
          body: JSON.stringify({
            ...chatIdentityPayload(client),
            message,
            mediaData,
            mediaType,
            pageUrl: (location.origin + location.pathname).slice(0, 1500),
            userAgent: navigator.userAgent.slice(0, 500),
            game: (params.get("rom") || params.get("game") || "").slice(0, 240)
          })
        });
        status.textContent = `Reporte enviado · ${result.id ? result.id.slice(0, 8) : "OK"}`;
        send.textContent = "Enviado";
        refreshChatStatus();
        setTimeout(close, 900);
      } catch (error) {
        send.disabled = false;
        cancel.disabled = false;
        status.textContent = error.message;
      }
    });
  }

  function renderChatMessages(container, messages) {
    container.innerHTML = "";
    if (!messages.length) {
      const empty = document.createElement("div");
      empty.className = "ml3d-report-status";
      empty.textContent = "Todavía no hay mensajes. Puedes escribir para continuar la incidencia.";
      container.appendChild(empty);
      return;
    }
    messages.forEach((item) => {
      const bubble = document.createElement("div");
      bubble.className = "ml3d-chat-message " + (item.sender === "admin" ? "admin" : "user");
      if (item.body) {
        const text = document.createElement("div");
        text.textContent = item.body;
        bubble.appendChild(text);
      }
      if (item.mediaData) {
        if (String(item.mediaType || "").startsWith("video/")) {
          const video = document.createElement("video");
          video.controls = true;
          video.preload = "metadata";
          video.src = item.mediaData;
          bubble.appendChild(video);
        } else {
          const image = document.createElement("img");
          image.alt = "Imagen adjunta";
          image.src = item.mediaData;
          bubble.appendChild(image);
        }
      }
      const time = document.createElement("span");
      time.className = "ml3d-chat-time";
      time.textContent = item.createdAt ? new Date(item.createdAt).toLocaleString() : "";
      bubble.appendChild(time);
      container.appendChild(bubble);
    });
    container.scrollTop = container.scrollHeight;
  }

  function openHelpChat() {
    if (document.querySelector(".ml3d-tools-overlay[data-ml3d-chat='1']")) return;
    const settingsMenu = document.getElementById("menu");
    if (settingsMenu && settingsMenu.open) {
      try { settingsMenu.close(); } catch (_) {}
      window.setTimeout(openHelpChat, 120);
      return;
    }

    const ui = createOverlay("CHAT DE AYUDA");
    ui.overlay.dataset.ml3dChat = "1";
    const client = readChatClient(false);
    const body = document.createElement("div");
    const list = document.createElement("div");
    list.className = "ml3d-chat-list";
    const compose = document.createElement("div");
    compose.className = "ml3d-chat-compose";
    body.append(list, compose);
    ui.card.appendChild(body);
    let poll = 0;

    const close = () => {
      if (poll) clearInterval(poll);
      ui.overlay.remove();
      refreshChatStatus();
    };
    ui.close.addEventListener("click", close, { once: true });

    if (!client) {
      const empty = document.createElement("div");
      empty.className = "ml3d-report-status";
      empty.textContent = "Envía primero una incidencia desde REPORTES para iniciar tu chat de ayuda.";
      list.appendChild(empty);
      return;
    }

    compose.innerHTML = `
      <iframe class="ml3d-chat-editor" title="Escribir mensaje"></iframe>
      <div class="ml3d-report-image-row">
        <button type="button" class="ml3d-report-image-add ml3d-chat-media-add" aria-label="Añadir imagen o vídeo">+</button>
        <div class="ml3d-report-image-help">Imagen o vídeo corto</div>
        <input class="ml3d-chat-media-input" type="file" accept="image/*,video/mp4,video/webm,video/quicktime" hidden>
      </div>
      <div class="ml3d-media-preview ml3d-chat-media-preview" hidden></div>
      <div class="ml3d-chat-actions">
        <button type="button" class="secondary">Actualizar</button>
        <button type="button" class="primary">Enviar</button>
      </div>
      <div class="ml3d-report-status" aria-live="polite"></div>`;
    const frame = compose.querySelector("iframe");
    const refresh = compose.querySelector(".secondary");
    const send = compose.querySelector(".primary");
    const status = compose.querySelector(".ml3d-report-status");
    const mediaAdd = compose.querySelector(".ml3d-chat-media-add");
    const mediaInput = compose.querySelector(".ml3d-chat-media-input");
    const mediaPreview = compose.querySelector(".ml3d-chat-media-preview");
    let chatMediaData = null;
    let chatMediaType = "";
    frame.srcdoc = editorSrcdoc("chat-text", "Escribe tu mensaje…");

    mediaAdd.addEventListener("click", () => mediaInput.click());
    mediaInput.addEventListener("change", async () => {
      chatMediaData = null;
      chatMediaType = "";
      renderMediaPreview(mediaPreview, null, "");
      const file = mediaInput.files && mediaInput.files[0];
      if (!file) return;
      try {
        status.textContent = "Preparando archivo…";
        const prepared = await mediaToData(file);
        chatMediaData = prepared.data;
        chatMediaType = prepared.type;
        renderMediaPreview(mediaPreview, chatMediaData, chatMediaType);
        status.textContent = "";
      } catch (error) {
        mediaInput.value = "";
        status.textContent = error.message;
      }
    });

    const load = async () => {
      try {
        const result = await api("/v1/emulator/chat/history", {
          method: "POST",
          body: JSON.stringify(chatIdentityPayload(client))
        });
        const messages = Array.isArray(result.messages) ? result.messages : [];
        renderChatMessages(list, messages);
        const latestAdmin = [...messages].reverse().find((item) => item.sender === "admin");
        if (latestAdmin) markChatSeen(latestAdmin);
        chatUnreadCount = 0;
        updateChatBadgePlacement();
        status.textContent = "";
      } catch (error) {
        status.textContent = error.message === "Chat no autorizado"
          ? "Envía primero una incidencia desde REPORTES para iniciar tu chat de ayuda."
          : error.message;
      }
    };

    refresh.addEventListener("click", load);
    send.addEventListener("click", async () => {
      const message = editorValue(frame, "chat-text");
      if (!message && !chatMediaData) {
        status.textContent = "Escribe un mensaje o adjunta una imagen/vídeo.";
        return;
      }
      send.disabled = true;
      status.textContent = "Enviando…";
      try {
        await api("/v1/emulator/chat/messages", {
          method: "POST",
          body: JSON.stringify({ ...chatIdentityPayload(client), message, mediaData: chatMediaData, mediaType: chatMediaType })
        });
        frame.srcdoc = editorSrcdoc("chat-text", "Escribe tu mensaje…");
        chatMediaData = null;
        chatMediaType = "";
        mediaInput.value = "";
        renderMediaPreview(mediaPreview, null, "");
        await load();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        send.disabled = false;
      }
    });

    load();
    poll = window.setInterval(load, 6000);
  }

  function ensureReportButton() {
    const list = document.querySelector("#ml3d-updates-panel .ml3d-updates-list");
    if (!list) return false;
    if (document.getElementById("ml3d-help-row")) {
      updateChatBadgePlacement();
      return true;
    }

    const row = document.createElement("div");
    row.id = "ml3d-help-row";
    row.className = "ml3d-help-row";

    const reportButton = document.createElement("button");
    reportButton.id = "ml3d-report-button";
    reportButton.type = "button";
    reportButton.className = "ml3d-report-button";
    reportButton.textContent = "REPORTES";
    reportButton.setAttribute("aria-label", "Enviar reporte");

    const chatButton = document.createElement("button");
    chatButton.id = "ml3d-chat-button";
    chatButton.type = "button";
    chatButton.className = "ml3d-chat-button";
    chatButton.textContent = "CHAT";
    chatButton.setAttribute("aria-label", "Abrir chat de ayuda");

    reportButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openReportDialog();
    });
    chatButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openHelpChat();
    });

    row.append(reportButton, chatButton);
    list.prepend(row);

    const menu = document.getElementById("menu");
    const updates = document.getElementById("ml3d-updates-panel");
    const updatesButton = document.getElementById("ml3d-updates-button");
    if (updatesButton && updatesButton.dataset.ml3dNewsSeenBound !== "1") {
      updatesButton.dataset.ml3dNewsSeenBound = "1";
      updatesButton.addEventListener("click", () => {
        window.setTimeout(() => {
          if (updates && !updates.hidden) {
            markNewsSeen();
            updateChatBadgePlacement();
          }
        }, 0);
      });
    }
    if (menu && menu.dataset.ml3dChatBadgeObserver !== "1") {
      menu.dataset.ml3dChatBadgeObserver = "1";
      new MutationObserver(() => {
        updateChatBadgePlacement();
        refreshChatStatus();
      }).observe(menu, { attributes: true, attributeFilter: ["open"] });
    }
    if (updates && updates.dataset.ml3dChatBadgeObserver !== "1") {
      updates.dataset.ml3dChatBadgeObserver = "1";
      new MutationObserver(() => {
        updateChatBadgePlacement();
        refreshChatStatus();
      }).observe(updates, { attributes: true, attributeFilter: ["hidden"] });
    }

    updateChatBadgePlacement();
    return true;
  }

  function installReportButton() {
    if (ensureReportButton()) return;
    const observer = new MutationObserver(() => {
      if (ensureReportButton()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function installChatStatusWatch() {
    refreshChatStatus();
    if (!chatStatusTimer) chatStatusTimer = window.setInterval(refreshChatStatus, 5000);
    window.addEventListener("focus", refreshChatStatus);
    window.addEventListener("resize", updateChatBadgePlacement);
    window.addEventListener("orientationchange", () => window.setTimeout(updateChatBadgePlacement, 180));

    const menuButton = document.getElementById("menu-button");
    if (menuButton && menuButton.dataset.ml3dNotificationBound !== "1") {
      menuButton.dataset.ml3dNotificationBound = "1";
      menuButton.addEventListener("click", () => {
        window.setTimeout(updateChatBadgePlacement, 40);
        window.setTimeout(refreshChatStatus, 90);
      });
    }

    const updatesButton = document.getElementById("ml3d-updates-button");
    if (updatesButton && updatesButton.dataset.ml3dNotificationSyncBound !== "1") {
      updatesButton.dataset.ml3dNotificationSyncBound = "1";
      updatesButton.addEventListener("click", () => {
        window.setTimeout(updateChatBadgePlacement, 40);
        window.setTimeout(updateChatBadgePlacement, 160);
      });
    }

    const boot = document.getElementById("boot-screen");
    if (boot && boot.dataset.ml3dNotificationObserver !== "1") {
      boot.dataset.ml3dNotificationObserver = "1";
      new MutationObserver(() => {
        window.setTimeout(updateChatBadgePlacement, 0);
      }).observe(boot, { attributes: true, attributeFilter: ["class", "style"] });
    }

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshChatStatus();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      ensureStyles();
      installReportButton();
      installChatStatusWatch();
    }, { once: true });
  } else {
    ensureStyles();
    installReportButton();
    installChatStatusWatch();
  }

  window.ml3dEmulatorTools = {
    showStartupMessages,
    openReportDialog,
    openHelpChat,
    refreshChatStatus
  };
})();