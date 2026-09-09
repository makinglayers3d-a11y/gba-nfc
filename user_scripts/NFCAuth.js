"use strict";

(function () {
  const NFC_KEY_PREFIX = "GBA-NFC-KEY:";

  const params =
    new URLSearchParams(window.location.search);

  const DEV_MODE =
    params.get("dev") === "1";

  /*
   * TODAS las etiquetas NFC deben usar esta misma clave.
   * Cambia solamente este texto por tu clave real.
   */
 const SHARED_KEY =
  "Ml3D-f22";

/*
 * Token usado por las URLs NFC en iPhone/iPad.
 * NO es la clave NDEF de la etiqueta.
 */
const IOS_NFC_TOKEN =
  "ML3D-IOS-NFC-7f42c91a";

const NFC_SESSION_KEY =
  "gba-nfc-authenticated";
  
const IOS_NFC_TOKEN_FROM_URL =
  params.get("nfc");

let authenticated =
  DEV_MODE ||
  sessionStorage.getItem(
    NFC_SESSION_KEY
  ) === "1" ||
  IOS_NFC_TOKEN_FROM_URL === IOS_NFC_TOKEN;

let scanStarted = false;

  let overlay = null;

  let authPromise = null;
  let authPromiseResolve = null;

  function createOverlay() {
    if (overlay) {
      return overlay;
    }

    overlay =
      document.createElement("div");

    overlay.id =
      "gba-nfc-lock";

    Object.assign(
      overlay.style,
      {
        position: "fixed",
        inset: "0",
        zIndex: "99999",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        boxSizing: "border-box",
        background: "rgba(0,0,0,0.96)",
        color: "#fff",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        textAlign: "center",
        userSelect: "none",
        WebkitUserSelect: "none"
      }
    );

    const card =
      document.createElement("div");

    Object.assign(
      card.style,
      {
        width: "min(92vw, 520px)",
        padding: "28px 22px",
        border:
          "1px solid rgba(255,255,255,0.2)",
        borderRadius: "18px",
        background:
          "rgba(255,255,255,0.05)",
        boxShadow:
          "0 14px 40px rgba(0,0,0,0.45)"
      }
    );

    const title =
      document.createElement("div");

    title.textContent =
      "NFC REQUIRED";

    Object.assign(
      title.style,
      {
        fontSize:
          "clamp(18px, 5vw, 28px)",
        fontWeight: "900",
        marginBottom: "14px"
      }
    );

    const message =
      document.createElement("div");

    message.id =
      "gba-nfc-message";

    message.textContent =
      "Acerca la etiqueta NFC para desbloquear el juego.";

    Object.assign(
      message.style,
      {
        fontSize:
          "clamp(13px, 3.8vw, 18px)",
        lineHeight: "1.5",
        opacity: "0.86",
        marginBottom: "20px"
      }
    );

    const button =
      document.createElement("button");

    button.type = "button";
    button.textContent = "Activar NFC";

    Object.assign(
      button.style,
      {
        width: "100%",
        minHeight: "52px",
        border: "0",
        borderRadius: "12px",
        background: "#fff",
        color: "#111",
        font: "inherit",
        fontWeight: "900",
        fontSize: "16px"
      }
    );

    button.addEventListener(
      "click",
      () => {
        startNfcScan(true);
      }
    );

    card.appendChild(title);
    card.appendChild(message);
    card.appendChild(button);

    overlay.appendChild(card);

    document.body.appendChild(overlay);

    return overlay;
  }

  function setMessage(text) {
    const message =
      document.getElementById(
        "gba-nfc-message"
      );

    if (message) {
      message.textContent = text;
    }
  }

  function closeOverlay() {
    if (!overlay) {
      return;
    }

    overlay.remove();
    overlay = null;
  }

 function decodeRecord(record) {
  try {
    if (!record || !record.data) {
      return "";
    }

    if (
      typeof record.data === "string"
    ) {
      return record.data.trim();
    }

    const encoding =
      record.encoding || "utf-8";

    return new TextDecoder(
      encoding
    )
      .decode(record.data)
      .trim();
  } catch (error) {
    return "";
  }
}

function hasValidKey(message) {
  const records =
    message &&
    Array.isArray(message.records)
      ? message.records
      : [];

  for (const record of records) {
    if (
      record.recordType !==
      "text"
    ) {
      continue;
    }

    const text =
      decodeRecord(record);

    /*
     * Aceptamos ambas formas:
     *
     * GBA-NFC-KEY:Ml3D-f22
     *
     * o simplemente:
     *
     * Ml3D-f22
     */
    const normalized =
      text
        .replace(
          /^GBA-NFC-KEY:/i,
          ""
        )
        .trim();

    console.log(
      "NFC registro de texto detectado:",
      {
        length: normalized.length,
        valid:
          normalized === SHARED_KEY
      }
    );

    if (
      normalized === SHARED_KEY
    ) {
      return true;
    }
  }

  return false;
} 
function authenticate() {
  authenticated = true;

  sessionStorage.setItem(
    NFC_SESSION_KEY,
    "1"
  );

  closeOverlay();  

    if (authPromiseResolve) {
      authPromiseResolve(true);
      authPromiseResolve = null;
    }
  }

  async function startNfcScan(
    userGesture = false
  ) {
    if (authenticated) {
      return true;
    }

    createOverlay();

    if (!("NDEFReader" in window)) {
      setMessage(
        "Este navegador no admite lectura NFC desde la web."
      );

      return false;
    }

    if (scanStarted) {
      return true;
    }

    scanStarted = true;

    try {
      const reader =
        new NDEFReader();

      reader.addEventListener(
  "reading",
  (event) => {
    console.log(
      "NFC detectada:",
      event.message.records
    );

    if (
      hasValidKey(
        event.message
      )
    ) {
      setMessage(
        "NFC verificada. Iniciando juego…"
      );

      window.setTimeout(
        () => {
          authenticate();
        },
        120
      );

      return;
    }

    setMessage(
      "Etiqueta detectada, pero la clave no es válida."
    );
  }
);

      reader.addEventListener(
        "readingerror",
        () => {
          setMessage(
            "No se pudo leer la etiqueta NFC."
          );
        }
      );

      await reader.scan();

      setMessage(
        "NFC activada. Acerca la etiqueta."
      );

      return true;
    } catch (error) {
      console.warn(
        "No se pudo iniciar Web NFC:",
        error
      );

      scanStarted = false;

      if (userGesture) {
        setMessage(
          "No se pudo activar NFC en este dispositivo o navegador."
        );
      } else {
        setMessage(
          "Toca «Activar NFC» y después acerca la etiqueta."
        );
      }

      return false;
    }
  }

  window.gbaNfcAuth = {
    isAuthenticated() {
      return authenticated;
    },

    requireAuthentication() {
      if (authenticated) {
        return Promise.resolve(true);
      }

      if (!authPromise) {
        authPromise =
          new Promise(
            (resolve) => {
              authPromiseResolve =
                resolve;
            }
          );
      }

      createOverlay();

      startNfcScan(false);

      return authPromise;
    }
  };

  /*
   * Bloqueamos la carga de cualquier ROM
   * hasta que la NFC haya sido validada.
   */
  const originalFetch =
    window.fetch.bind(window);

  window.fetch =
    async function (...args) {
      const request = args[0];

      const url =
        typeof request === "string"
          ? request
          : request &&
              typeof request.url ===
                "string"
            ? request.url
            : "";

      const isRomRequest =
        /\/games\/[^/?]+\.gba(?:\?|$)/i.test(
          url
        );

      if (
        isRomRequest &&
        !authenticated
      ) {
        await window.gbaNfcAuth
          .requireAuthentication();

        if (!authenticated) {
          throw new Error(
            "NFC no autenticada"
          );
        }
      }

      return originalFetch(
        ...args
      );
    };

  /*
   * Intentamos activar Web NFC nada más
   * abrir la página. Algunos navegadores
   * exigirán interacción del usuario.
   */
  if (!authenticated) {
    window.setTimeout(
      () => {
        createOverlay();
        startNfcScan(false);
      },
      100
    );
  }
})();
