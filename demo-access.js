(() => {
  "use strict";

  const CONFIG_URL = "dev-access-config.json";
  const CLIENT_KEY = "ml3d-demo-client-id";
  const SESSION_KEY = "ml3d-demo-session-id";
  const HEARTBEAT_MS = 30000;
  let trackingTimer = null;
  let expiryTimer = null;

  function id(storage, key) {
    let value = storage.getItem(key);
    if (!value) {
      value = crypto.randomUUID();
      storage.setItem(key, value);
    }
    return value;
  }

  async function config() {
    const response = await fetch(CONFIG_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudo comprobar la demo.");
    const data = await response.json();
    if (!data.apiBase) throw new Error("El servidor de demos no está configurado.");
    return data;
  }

  async function api(cfg, path, body) {
    const response = await fetch(cfg.apiBase.replace(/\/$/, "") + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      cache: "no-store",
      keepalive: path.endsWith("/heartbeat")
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || data.reason || "No se pudo validar la demo.");
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function fmtExpiry(value) {
    const date = new Date(Number(value || 0));
    if (!Number.isFinite(date.getTime())) return "";
    return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  function ensureStyle() {
    if (document.getElementById("ml3d-demo-style")) return;
    const style = document.createElement("style");
    style.id = "ml3d-demo-style";
    style.textContent =
      ".ml3d-demo-overlay{position:fixed;inset:0;z-index:2147483647;background:radial-gradient(circle at 50% 20%,#13202f 0,#070a0f 54%,#030406 100%);display:flex;align-items:center;justify-content:center;padding:20px;color:#fff;font-family:system-ui,-apple-system,sans-serif}" +
      ".ml3d-demo-card{width:min(470px,100%);max-height:min(760px,92vh);overflow:auto;background:rgba(13,20,29,.98);border:1px solid #31465a;border-radius:20px;padding:22px;box-sizing:border-box;box-shadow:0 28px 80px #000c}" +
      ".ml3d-demo-brand{font-size:12px;letter-spacing:.16em;color:#8fe3ff;font-weight:900;margin-bottom:6px}.ml3d-demo-card h1{font-size:25px;margin:0 0 8px}.ml3d-demo-card p{color:#c6d2dd;line-height:1.48}" +
      ".ml3d-demo-expiry{padding:10px 12px;border-radius:12px;background:#0a1119;border:1px solid #26394c;color:#9fdfff!important;font-weight:700}" +
      ".ml3d-demo-card label{display:block;font-size:13px;color:#dce8f2;margin:14px 0 6px}.ml3d-demo-card input[type=text]{width:100%;box-sizing:border-box;padding:13px 14px;border:1px solid #40566b;border-radius:12px;background:#070b10;color:#fff;font-size:17px;outline:none}" +
      ".ml3d-demo-card input[type=text]:focus{border-color:#8fe3ff;box-shadow:0 0 0 2px #8fe3ff22}.ml3d-demo-consent{display:flex!important;gap:10px;align-items:flex-start;font-size:13px!important;line-height:1.4}.ml3d-demo-consent input{margin-top:2px}" +
      ".ml3d-demo-actions{display:flex;gap:10px;margin-top:16px}.ml3d-demo-actions button{flex:1;border:0;border-radius:12px;padding:13px 14px;font-weight:900;font-size:15px;cursor:pointer}.ml3d-demo-primary{background:#8fe3ff;color:#061019}.ml3d-demo-secondary{background:#243445;color:#fff}" +
      ".ml3d-demo-terms{margin-top:12px;padding:12px;border-radius:12px;background:#080d13;border:1px solid #223243;font-size:12px;color:#b9c7d4}.ml3d-demo-terms h3{margin:7px 0;color:#fff;font-size:13px}.ml3d-demo-terms ul{padding-left:18px;margin:6px 0 10px}.ml3d-demo-terms li{margin:5px 0;line-height:1.42}.ml3d-demo-error{color:#ff9da7!important}.ml3d-demo-note{font-size:12px!important;color:#8fa2b4!important}.ml3d-demo-status{text-align:center;padding:16px 0}";
    document.head.appendChild(style);
  }

  function baseOverlay() {
    ensureStyle();
    const overlay = document.createElement("div");
    overlay.className = "ml3d-demo-overlay";
    document.body.appendChild(overlay);
    return overlay;
  }

  function blocked(state, expiresAt, message) {
    const overlay = document.querySelector(".ml3d-demo-overlay") || baseOverlay();
    const title =
      state === "expired" ? "La demo ha caducado" :
      state === "paused" ? "Demo pausada" :
      state === "revoked" ? "Demo finalizada" : "Demo no disponible";
    overlay.innerHTML =
      '<div class="ml3d-demo-card"><div class="ml3d-demo-brand">ML3DEMULER · DEMO</div><div class="ml3d-demo-status"><h1>' +
      title + '</h1><p>' + (message || "Este enlace ya no permite acceder al emulador.") + '</p>' +
      (expiresAt ? '<p class="ml3d-demo-note">Caducidad: ' + fmtExpiry(expiresAt) + '</p>' : "") +
      '</div></div>';
    return false;
  }

  function registrationOverlay(expiresAt) {
    const overlay = baseOverlay();
    overlay.innerHTML =
      '<div class="ml3d-demo-card" role="dialog" aria-modal="true">' +
      '<div class="ml3d-demo-brand">ML3DEMULER · DEMO</div>' +
      '<h1>Acceso a la demo</h1>' +
      '<p>Introduce tu usuario de Instagram para entrar. El usuario se mostrará en el historial de esta demo.</p>' +
      '<p class="ml3d-demo-expiry">Disponible hasta ' + fmtExpiry(expiresAt) + '</p>' +
      '<label for="ml3d-demo-instagram">Usuario de Instagram</label>' +
      '<input id="ml3d-demo-instagram" type="text" maxlength="31" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="@usuario">' +
      '<label class="ml3d-demo-consent"><input id="ml3d-demo-accept" type="checkbox"><span>He leído y acepto las condiciones de la demo y el aviso sobre el tratamiento de los datos indicados abajo.</span></label>' +
      '<button class="ml3d-demo-secondary ml3d-demo-toggle" type="button" style="width:100%;margin-top:8px;padding:10px;border:0;border-radius:10px">Ver condiciones y privacidad</button>' +
      '<div class="ml3d-demo-terms" hidden>' +
      '<h3>Condiciones de la demo</h3><ul>' +
      '<li>El acceso es temporal y solo estará disponible mientras este enlace permanezca activo y no haya alcanzado su fecha de caducidad.</li>' +
      '<li>La demo puede ser pausada o finalizada por el responsable de ML3Demuler. Al caducar, el emulador bloqueará el acceso desde este enlace.</li>' +
      '<li>La demo se ofrece para probar ML3Demuler. No garantiza disponibilidad permanente ni conservación de una sesión después de finalizar el acceso.</li>' +
      '<li>El usuario indicado debe corresponder a quien está utilizando la demo. ML3D no verifica automáticamente que la cuenta de Instagram introducida pertenezca a esa persona.</li>' +
      '</ul><h3>Datos registrados</h3>' +
      '<p>Se guardan el usuario de Instagram facilitado, fecha y hora de acceso, un identificador aleatorio de este navegador, información técnica básica del navegador, número de sesiones y tiempo efectivo de uso. Se utilizan para gestionar la demo y mantener su historial. El historial puede ser eliminado por el administrador. Para consultas sobre estos datos, utiliza el mismo canal por el que recibiste el enlace.</p>' +
      '</div>' +
      '<p class="ml3d-demo-message ml3d-demo-note">No se solicitará tu contraseña de Instagram.</p>' +
      '<div class="ml3d-demo-actions"><button class="ml3d-demo-primary" type="button">Entrar en la demo</button></div>' +
      '</div>';
    return overlay;
  }

  function scheduleExpiry(expiresAt) {
    if (expiryTimer) clearTimeout(expiryTimer);
    const target = Number(expiresAt || 0);
    if (!target) return;
    const check = () => {
      const remaining = target - Date.now();
      if (remaining <= 0) {
        blocked("expired", target);
        return;
      }
      expiryTimer = window.setTimeout(check, Math.min(remaining, 2147480000));
    };
    check();
  }

  function publish(info) {
    window.ml3dDemoAccess = {
      active: true,
      demoId: String(info.demoId || ""),
      instagram: String(info.instagram || ""),
      expiresAt: Number(info.expiresAt || 0)
    };
    window.dispatchEvent(new CustomEvent("ml3d-demo-access", { detail: window.ml3dDemoAccess }));
  }

  function startTracking(cfg, token, clientId, sessionId, info) {
    if (trackingTimer) clearInterval(trackingTimer);
    publish(info);
    scheduleExpiry(info.expiresAt);

    const heartbeat = async (force = false, resetBaseline = false) => {
      if (!force && document.visibilityState !== "visible") return;
      try {
        const result = await api(cfg, "/v1/demo/heartbeat", { token, clientId, sessionId, resetBaseline });
        if (result && result.ok) {
          window.ml3dDemoAccess.expiresAt = Number(result.expiresAt || window.ml3dDemoAccess.expiresAt || 0);
          scheduleExpiry(window.ml3dDemoAccess.expiresAt);
        }
      } catch (error) {
        if (error.status === 403 || error.status === 404) {
          if (trackingTimer) clearInterval(trackingTimer);
          if (expiryTimer) clearTimeout(expiryTimer);
          trackingTimer = null;
          expiryTimer = null;
          blocked(error.data && error.data.state || "unavailable", error.data && error.data.expiresAt || info.expiresAt);
        }
      }
    };

    heartbeat(true, true);
    trackingTimer = window.setInterval(() => heartbeat(false, false), HEARTBEAT_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        heartbeat(true, false);
      } else {
        heartbeat(true, true);
      }
    });
    window.addEventListener("pagehide", () => heartbeat(true, false), { once: true });
  }

  async function ensureAccess(params) {
    const token = String(params.get("demo") || "").trim();
    if (!token) return true;

    let cfg;
    try {
      cfg = await config();
    } catch (error) {
      blocked("unavailable", 0, error.message);
      return false;
    }

    const clientId = id(localStorage, CLIENT_KEY);
    const sessionId = id(sessionStorage, SESSION_KEY);
    let current;
    try {
      current = await api(cfg, "/v1/demo/status", { token, clientId });
    } catch (error) {
      blocked(error.data && error.data.state || "unavailable", error.data && error.data.expiresAt || 0, error.message);
      return false;
    }

    if (current.state !== "active") return blocked(current.state, current.expiresAt);
    if (current.registered) {
      startTracking(cfg, token, clientId, sessionId, current);
      return true;
    }

    const overlay = registrationOverlay(current.expiresAt);
    const input = overlay.querySelector("#ml3d-demo-instagram");
    const accepted = overlay.querySelector("#ml3d-demo-accept");
    const button = overlay.querySelector(".ml3d-demo-primary");
    const message = overlay.querySelector(".ml3d-demo-message");
    const terms = overlay.querySelector(".ml3d-demo-terms");
    const toggle = overlay.querySelector(".ml3d-demo-toggle");

    toggle.addEventListener("click", () => {
      terms.hidden = !terms.hidden;
      toggle.textContent = terms.hidden ? "Ver condiciones y privacidad" : "Ocultar condiciones";
    });

    return new Promise((resolve) => {
      button.addEventListener("click", async () => {
        const instagram = String(input.value || "").trim();
        const handle = instagram.replace(/^@+/, "");
        if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) {
          message.textContent = "Introduce un usuario de Instagram válido.";
          message.classList.add("ml3d-demo-error");
          return;
        }
        if (!accepted.checked) {
          message.textContent = "Debes aceptar las condiciones para continuar.";
          message.classList.add("ml3d-demo-error");
          return;
        }

        button.disabled = true;
        message.textContent = "Comprobando acceso…";
        message.classList.remove("ml3d-demo-error");
        try {
          const result = await api(cfg, "/v1/demo/register", {
            token,
            clientId,
            sessionId,
            instagram: "@" + handle,
            userAgent: navigator.userAgent,
            termsAccepted: true
          });
          overlay.remove();
          startTracking(cfg, token, clientId, sessionId, result);
          resolve(true);
        } catch (error) {
          button.disabled = false;
          if (error.status === 403 || error.status === 404) {
            blocked(error.data && error.data.state || "unavailable", error.data && error.data.expiresAt || current.expiresAt, error.message);
            resolve(false);
            return;
          }
          message.textContent = error.message;
          message.classList.add("ml3d-demo-error");
        }
      });
    });
  }

  window.ml3dDemoGate = { ensureAccess };
})();