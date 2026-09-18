(() => {
  "use strict";

  const CONFIG_URL = "dev-access-config.json";
  const MESSAGE_ORDER = ["work", "update", "announcement"];
  const STARTUP_NOTICE_KEY = "ml3d-startup-notices-shown-v1";
  const CHAT_CLIENT_KEY = "ml3d-help-chat-client-v1";
  const CHAT_SEEN_KEY = "ml3d-help-chat-seen-v1";
  const NEWS_SEEN_KEY = "ml3d-updates-seen-v1";
  const NEWS_REVISION = "2026-09-18-rich-media-1";
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
    document.getElementById("ml3d-chat-floating-dot")?.remove();
  }

  function setInlineDot(target) {
    if (!target) return;
    const dot = document.createElement("span");
    dot.className = "ml3d-chat-dot";
    dot.setAttribute("aria-hidden", "true");
    target.appendChild(dot);
  }

  function setFloatingDot(target) {
    if (!target) return;
    removeFloatingDot();
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dot = document.createElement("span");
    dot.id = "ml3d-chat-floating-dot";
    dot.className = "ml3d-chat-dot ml3d-chat-dot-floating";
    dot.setAttribute("aria-hidden", "true");
    dot.style.left = Math.round(rect.right - 6) + "px";
    dot.style.top = Math.round(rect.top - 5) + "px";
    document.body.appendChild(dot);
  }

  function updateChatBadgePlacement() {
    const menuButton = document.getElementById("menu-button");
    const updatesButton = document.getElementById("ml3d-updates-button");
    const chatButton = document.getElementById("ml3d-chat-button");
    removeInlineDots();
    removeFloatingDot();

    const hasChat = chatUnreadCount > 0;
    const hasNews = hasPendingNews();
    if (updatesButton) {
      updatesButton.classList.toggle("ml3d-notify-chat", hasChat);
      updatesButton.classList.toggle("ml3d-notify-news", !hasChat && hasNews);
    }

    if (!hasChat) return;

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
    const updatesOpen = Boolean(updates && !updates.hidden);

    if (updatesOpen && chatButton) {
      setInlineDot(chatButton);
    } else if (menu && menu.open && updatesButton) {
      // En el menú principal el propio botón ? se anima; no añadimos punto extra.
    } else {
      setFloatingDot(menuButton);
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
        body: JSON.stringify(client)
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
        background:#79e8ff;border:2px solid #102331;box-shadow:0 0 5px #79e8ff,0 0 13px #79e8ffbb;
        pointer-events:none;z-index:2147483647;animation:ml3dChatDotPulse .95s ease-in-out infinite
      }
      .ml3d-chat-dot-floating{
        position:fixed!important;right:auto!important;bottom:auto!important;transform:none!important;
        opacity:1!important;visibility:visible!important;filter:none!important;mix-blend-mode:normal!important
      }
      body.ml3d-console-transitioning #ml3d-chat-floating-dot{
        opacity:0!important;visibility:hidden!important
      }
      #ml3d-updates-button.ml3d-notify-chat{
        color:#e9fcff!important;border-color:#aaf4ff!important;background:#153644f5!important;
        box-shadow:0 0 10px #77eaffaa,0 0 24px #77eaff66!important;
        animation:ml3dQuestionChat 1.05s ease-in-out infinite!important
      }
      #ml3d-updates-button.ml3d-notify-news{
        color:#fff5a9!important;border-color:#ffe45e!important;background:#3a3212f2!important;
        box-shadow:0 0 10px #ffe45eaa,0 0 22px #ffe45e55!important;
        animation:ml3dQuestionNews 1.35s ease-in-out infinite!important
      }
      @keyframes ml3dChatDotPulse{
        0%,100%{opacity:.28;transform:scale(.72)}
        48%{opacity:1;transform:scale(1.18)}
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

  function showNotice(item) {
    return new Promise((resolve) => {
      const title = MESSAGE_LABELS[item.kind] || item.title || "AVISO";
      const ui = createOverlay(title);
      const text = document.createElement("div");
      text.className = "ml3d-tools-message";
      text.textContent = item.body || "";
      ui.card.appendChild(text);
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
    try {
      if (sessionStorage.getItem(STARTUP_NOTICE_KEY) === "1") return;
      sessionStorage.setItem(STARTUP_NOTICE_KEY, "1");
    } catch (_) {}

    let payload;
    try {
      payload = await api("/v1/emulator/messages");
    } catch (error) {
      console.warn("ML3D emulator messages:", error);
      return;
    }
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const byKind = new Map(messages.map((item) => [item.kind, item]));
    for (const kind of MESSAGE_ORDER) {
      const item = byKind.get(kind);
      if (!item || !item.enabled || !String(item.body || "").trim()) continue;
      await showNotice(item);
    }
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
            message,
            mediaData,
            mediaType,
            clientId: client.clientId,
            clientToken: client.clientToken,
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
          body: JSON.stringify(client)
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
          body: JSON.stringify({ ...client, message, mediaData: chatMediaData, mediaType: chatMediaType })
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
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshChatStatus();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      installReportButton();
      installChatStatusWatch();
    }, { once: true });
  } else {
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