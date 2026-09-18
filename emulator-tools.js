(() => {
  "use strict";

  const CONFIG_URL = "dev-access-config.json";
  const MESSAGE_ORDER = ["work", "update", "announcement"];

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
      .ml3d-report-button{
        width:100%!important;min-height:42px!important;margin:0 0 4px!important;padding:9px 12px!important;
        border:1px solid #8fe7ff66!important;border-radius:11px!important;background:#102331!important;color:#eafcff!important;
        font-size:11px!important;font-weight:950!important;letter-spacing:.08em!important;box-shadow:none!important
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
      .ml3d-report-preview{display:block;width:100%;max-height:240px;object-fit:contain;margin-top:10px;border-radius:10px;border:1px solid #ffffff20;background:#000}
      .ml3d-report-actions{display:flex;gap:9px;margin-top:14px}
      .ml3d-report-actions button{
        flex:1;min-height:42px;border:1px solid #ffffff34;border-radius:11px;background:#ffffff10;color:inherit;font-weight:900
      }
      .ml3d-report-actions .primary{background:#8fe3ff;color:#071019;border-color:#8fe3ff}
      .ml3d-report-status{margin-top:10px;font-size:12px;line-height:1.35;color:#a8dfff}
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
      <label>Imagen (opcional)</label>
      <div class="ml3d-report-image-row">
        <button type="button" class="ml3d-report-image-add" aria-label="Añadir imagen">+</button>
        <div class="ml3d-report-image-help">Pulsa + para añadir una captura o imagen.</div>
        <input id="ml3d-report-image" type="file" accept="image/*" hidden>
      </div>
      <img class="ml3d-report-preview" alt="Vista previa del reporte" hidden>
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
    const preview = form.querySelector(".ml3d-report-preview");
    const cancel = form.querySelector(".secondary");
    const send = form.querySelector(".primary");
    const status = form.querySelector(".ml3d-report-status");
    let imageData = null;

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
      imageData = null;
      preview.hidden = true;
      status.textContent = "";
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      try {
        status.textContent = "Preparando imagen…";
        imageData = await imageToDataUrl(file);
        preview.src = imageData;
        preview.hidden = false;
        status.textContent = "Imagen preparada.";
      } catch (error) {
        fileInput.value = "";
        status.textContent = error.message;
      }
    });

    editorFrame.srcdoc = `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>
html,body{margin:0;width:100%;height:100%;background:transparent;color:#fff;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
textarea{box-sizing:border-box;width:100%;height:100%;margin:0;padding:12px;border:0;outline:0;resize:none;background:transparent;color:#fff;font:14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;caret-color:#fff;user-select:text;-webkit-user-select:text;-webkit-touch-callout:default;touch-action:auto}
textarea::placeholder{color:#9aabba}
</style>
</head>
<body>
<textarea id="report-text" maxlength="4000" inputmode="text" autocomplete="off" autocapitalize="sentences" spellcheck="true" placeholder="Describe el problema, sugerencia o incidencia…"></textarea>
</body>
</html>`;

    function reportMessage() {
      try {
        return String(editorFrame.contentDocument?.getElementById("report-text")?.value || "").trim();
      } catch (_) {
        return "";
      }
    }

    send.addEventListener("click", async () => {
      const message = reportMessage();
      if (!message) {
        status.textContent = "Escribe un mensaje antes de enviar.";
        return;
      }
      send.disabled = true;
      cancel.disabled = true;
      status.textContent = "Enviando reporte…";
      try {
        const params = new URLSearchParams(location.search);
        const result = await api("/v1/emulator/reports", {
          method: "POST",
          body: JSON.stringify({
            message,
            imageData,
            pageUrl: (location.origin + location.pathname).slice(0, 1500),
            userAgent: navigator.userAgent.slice(0, 500),
            game: (params.get("rom") || params.get("game") || "").slice(0, 240)
          })
        });
        status.textContent = `Reporte enviado · ${result.id ? result.id.slice(0, 8) : "OK"}`;
        send.textContent = "Enviado";
        setTimeout(close, 900);
      } catch (error) {
        send.disabled = false;
        cancel.disabled = false;
        status.textContent = error.message;
      }
    });
  }

  function ensureReportButton() {
    const list = document.querySelector("#ml3d-updates-panel .ml3d-updates-list");
    if (!list || document.getElementById("ml3d-report-button")) return Boolean(list);
    const button = document.createElement("button");
    button.id = "ml3d-report-button";
    button.type = "button";
    button.className = "ml3d-report-button";
    button.textContent = "REPORTES";
    button.setAttribute("aria-label", "Enviar reporte");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openReportDialog();
    });
    list.prepend(button);
    return true;
  }

  function installReportButton() {
    if (ensureReportButton()) return;
    const observer = new MutationObserver(() => {
      if (ensureReportButton()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installReportButton, { once: true });
  } else {
    installReportButton();
  }

  window.ml3dEmulatorTools = {
    showStartupMessages,
    openReportDialog
  };
})();