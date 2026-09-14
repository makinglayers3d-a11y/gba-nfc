(() => {
  "use strict";

  const CONFIG_URL = "dev-access-config.json";
  const DB_NAME = "ml3d-dev-access";
  const STORE_NAME = "identity";
  const KEY_ID = "device-key";
  const SESSION_KEY = "ml3d-dev-access-session";
  const encoder = new TextEncoder();

  function bytesToBase64Url(bytes) {
    let binary = "";
    bytes.forEach((value) => { binary += String.fromCharCode(value); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  async function sha256Base64Url(value) {
    return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
  }

  function canonicalPublicJwk(jwk) {
    return JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y });
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function readIdentity() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(KEY_ID);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function writeIdentity(value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(value, KEY_ID);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getIdentity() {
    let stored = await readIdentity();
    if (!stored) {
      const pair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"]
      );
      const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
      const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
      stored = { privateJwk, publicJwk };
      await writeIdentity(stored);
    }

    const privateKey = await crypto.subtle.importKey(
      "jwk",
      stored.privateJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"]
    );
    const deviceId = await sha256Base64Url(canonicalPublicJwk(stored.publicJwk));
    return { privateKey, publicJwk: stored.publicJwk, deviceId };
  }

  function getSessionId() {
    let value = sessionStorage.getItem(SESSION_KEY);
    if (!value) {
      value = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, value);
    }
    return value;
  }

  function publishPolicy(policy) {
    window.ml3dAccessPolicy = policy || null;
    window.dispatchEvent(new CustomEvent("ml3d-access-policy", { detail: window.ml3dAccessPolicy }));
  }

  async function loadConfig() {
    const response = await fetch(`${CONFIG_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`No se pudo cargar la configuración de acceso (${response.status})`);
    return response.json();
  }

  async function api(config, path, options = {}) {
    const response = await fetch(config.apiBase.replace(/\/$/, "") + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || data.reason || `Error del servidor (${response.status})`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async function sign(privateKey, nonce) {
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      encoder.encode(nonce)
    );
    return bytesToBase64Url(new Uint8Array(signature));
  }

  function cartContext(params) {
    const names = ["rom", "menu", "cartType", "cartColor", "cartLabel"];
    const result = {};
    names.forEach((name) => {
      const value = params.get(name);
      if (value !== null) result[name] = value;
    });
    return result;
  }

  function ensureStyles() {
    if (document.getElementById("ml3d-dev-access-style")) return;
    const style = document.createElement("style");
    style.id = "ml3d-dev-access-style";
    style.textContent = `
      .ml3d-access-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(5,8,12,.96);display:flex;align-items:center;justify-content:center;padding:20px;font-family:system-ui,sans-serif;color:#fff}
      .ml3d-access-card{width:min(440px,100%);background:#111923;border:1px solid #2c4054;border-radius:18px;padding:22px;box-shadow:0 24px 70px #000a}
      .ml3d-access-card h2{margin:0 0 10px}.ml3d-access-card p{color:#c7d3df;line-height:1.45}
      .ml3d-access-card input{box-sizing:border-box;width:100%;padding:12px 14px;border-radius:10px;border:1px solid #42566a;background:#090d13;color:#fff;font-size:16px}
      .ml3d-access-actions{display:flex;gap:10px;margin-top:14px}.ml3d-access-actions button{flex:1;padding:12px;border:0;border-radius:10px;font-weight:800;cursor:pointer}
      .ml3d-access-primary{background:#8fe3ff;color:#071019}.ml3d-access-secondary{background:#253444;color:#fff}.ml3d-access-error{color:#ff9b9b!important}
      .ml3d-access-device{font-size:12px;color:#8fa5b8!important;word-break:break-all}
    `;
    document.head.appendChild(style);
  }

  function createOverlay(deviceId) {
    ensureStyles();
    const overlay = document.createElement("div");
    overlay.className = "ml3d-access-overlay";
    overlay.innerHTML = `
      <div class="ml3d-access-card" role="dialog" aria-modal="true" aria-labelledby="ml3d-access-title">
        <h2 id="ml3d-access-title">Acceso de desarrollo</h2>
        <p class="ml3d-access-message">Esto es un cartucho promocional y requiere una autorización para su uso. Introduzca nombre para solicitar autorización de uso.</p>
        <div class="ml3d-access-form">
          <input class="ml3d-access-name" maxlength="80" autocomplete="name" placeholder="Tu nombre" aria-label="Nombre">
          <div class="ml3d-access-actions"><button class="ml3d-access-primary" type="button">Solicitar acceso</button></div>
        </div>
        <div class="ml3d-access-pending" hidden>
          <p>Solicitud enviada. Déjala abierta mientras se aprueba desde ML3D NFC Writer.</p>
          <div class="ml3d-access-actions"><button class="ml3d-access-secondary ml3d-access-check" type="button">Comprobar ahora</button></div>
        </div>
        <div class="ml3d-access-more-uses" hidden>
          <div class="ml3d-access-actions"><button class="ml3d-access-primary ml3d-access-more" type="button">Solicitar más usos</button></div>
        </div>
        <p class="ml3d-access-device">Dispositivo: ${deviceId.slice(0, 18)}…</p>
      </div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  async function verify(config, identity) {
    const challenge = await api(config, "/v1/access/challenge", {
      method: "POST",
      body: JSON.stringify({ deviceId: identity.deviceId })
    });
    if (challenge.status !== "approved" || !challenge.challengeId || !challenge.nonce) {
      return { approved: false, status: challenge.status || "unknown" };
    }
    const signature = await sign(identity.privateKey, challenge.nonce);
    try {
      const result = await api(config, "/v1/access/verify", {
        method: "POST",
        body: JSON.stringify({
          deviceId: identity.deviceId,
          challengeId: challenge.challengeId,
          signature,
          sessionId: getSessionId()
        })
      });
      if (result.approved === true) publishPolicy(result.policy || null);
      return {
        approved: result.approved === true,
        status: result.approved ? "approved" : (result.reason || "denied"),
        policy: result.policy || null
      };
    } catch (error) {
      if (error.data?.reason === "uses_exhausted") {
        publishPolicy(error.data.policy || null);
        return { approved: false, status: "uses_exhausted", policy: error.data.policy || null };
      }
      throw error;
    }
  }

  async function requestMoreUses(config, identity, params) {
    const challenge = await api(config, "/v1/access/challenge", {
      method: "POST",
      body: JSON.stringify({ deviceId: identity.deviceId })
    });
    if (challenge.status !== "approved" || !challenge.challengeId || !challenge.nonce) {
      throw new Error("No se pudo verificar el dispositivo para solicitar más usos.");
    }
    const signature = await sign(identity.privateKey, challenge.nonce);
    return api(config, "/v1/access/request-more-uses", {
      method: "POST",
      body: JSON.stringify({
        deviceId: identity.deviceId,
        challengeId: challenge.challengeId,
        signature,
        cart: cartContext(params)
      })
    });
  }

  async function waitForApproval(config, identity, params) {
    const overlay = createOverlay(identity.deviceId);
    const message = overlay.querySelector(".ml3d-access-message");
    const form = overlay.querySelector(".ml3d-access-form");
    const pending = overlay.querySelector(".ml3d-access-pending");
    const moreUses = overlay.querySelector(".ml3d-access-more-uses");
    const nameInput = overlay.querySelector(".ml3d-access-name");
    const requestButton = overlay.querySelector(".ml3d-access-primary");
    const checkButton = overlay.querySelector(".ml3d-access-check");
    const moreButton = overlay.querySelector(".ml3d-access-more");
    let timer = null;

    const showDefaultForm = () => {
      form.hidden = false;
      pending.hidden = true;
      moreUses.hidden = true;
      message.classList.remove("ml3d-access-error");
      message.textContent = "Esto es un cartucho promocional y requiere una autorización para su uso. Introduzca nombre para solicitar autorización de uso.";
    };

    const check = async () => {
      try {
        const result = await verify(config, identity);
        if (result.approved) {
          if (timer) clearInterval(timer);
          overlay.remove();
          return true;
        }
        message.classList.remove("ml3d-access-error");
        if (result.status === "pending") {
          form.hidden = true;
          pending.hidden = false;
          moreUses.hidden = true;
          message.textContent = "Solicitud pendiente de aprobación.";
        } else if (result.status === "uses_exhausted") {
          form.hidden = true;
          pending.hidden = true;
          moreUses.hidden = false;
          message.textContent = "Usos permitidos agotados";
        } else if (result.status === "paused") {
          form.hidden = true;
          pending.hidden = true;
          moreUses.hidden = true;
          message.textContent = "Acceso pausado por el administrador.";
        } else if (["unknown", "rejected", "revoked"].includes(result.status)) {
          showDefaultForm();
        }
      } catch (error) {
        message.textContent = error.message;
        message.classList.add("ml3d-access-error");
      }
      return false;
    };

    requestButton.addEventListener("click", async () => {
      const displayName = nameInput.value.trim();
      if (!displayName) {
        message.textContent = "Introduce un nombre para solicitar acceso.";
        message.classList.add("ml3d-access-error");
        return;
      }
      requestButton.disabled = true;
      try {
        await api(config, "/v1/access/request", {
          method: "POST",
          body: JSON.stringify({
            deviceId: identity.deviceId,
            publicKeyJwk: identity.publicJwk,
            displayName,
            userAgent: navigator.userAgent,
            cart: cartContext(params)
          })
        });
        message.classList.remove("ml3d-access-error");
        message.textContent = "Solicitud pendiente de aprobación.";
        form.hidden = true;
        pending.hidden = false;
        moreUses.hidden = true;
      } catch (error) {
        requestButton.disabled = false;
        message.textContent = error.message;
        message.classList.add("ml3d-access-error");
      }
    });

    checkButton.addEventListener("click", check);
    moreButton.addEventListener("click", async () => {
      moreButton.disabled = true;
      try {
        await requestMoreUses(config, identity, params);
        message.classList.remove("ml3d-access-error");
        message.textContent = "Solicitud de más usos enviada.";
        moreButton.textContent = "Solicitud enviada";
      } catch (error) {
        moreButton.disabled = false;
        message.textContent = error.message;
        message.classList.add("ml3d-access-error");
      }
    });

    const initialApproved = await check();
    if (initialApproved) return true;
    timer = setInterval(check, 5000);

    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (!document.body.contains(overlay)) {
          observer.disconnect();
          resolve(true);
        }
      });
      observer.observe(document.body, { childList: true });
    });
  }

  async function ensureAccess(params) {
    if (params.get("dev") !== "1") return true;

    let config;
    try {
      config = await loadConfig();
    } catch (error) {
      console.error(error);
      const identity = await getIdentity().catch(() => null);
      if (identity) {
        const overlay = createOverlay(identity.deviceId);
        const message = overlay.querySelector(".ml3d-access-message");
        message.textContent = "No se pudo comprobar la configuración de acceso. El emulador permanece bloqueado por seguridad.";
        message.classList.add("ml3d-access-error");
        overlay.querySelector(".ml3d-access-form").hidden = true;
      }
      return false;
    }

    if (!config.enabled) return true;
    if (!config.apiBase) {
      const identity = await getIdentity();
      const overlay = createOverlay(identity.deviceId);
      overlay.querySelector(".ml3d-access-message").textContent = "El servidor de acceso todavía no está configurado.";
      overlay.querySelector(".ml3d-access-message").classList.add("ml3d-access-error");
      overlay.querySelector(".ml3d-access-form").hidden = true;
      return false;
    }

    const identity = await getIdentity();
    try {
      const current = await verify(config, identity);
      if (current.approved) return true;
    } catch (error) {
      console.warn("No se pudo comprobar el acceso existente:", error);
    }

    return waitForApproval(config, identity, params);
  }

  window.ml3dDevAccess = { ensureAccess };
})();
