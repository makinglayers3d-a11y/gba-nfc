(() => {
  "use strict";

  const MODE_KEY = "ml3d-save-file-mode";
  const INTRO_KEY = "ml3d-save-file-intro-v1";
  const DB_NAME = "ml3d-local-save";
  const STORE = "handles";
  const ROOT_HANDLE_KEY = "root-directory";
  const FOLDER_NAME = "ML3Demuler";
  const AUTO_INTERVAL_MS = 10000;

  let contextProvider = null;
  let autoTimer = null;
  let busy = false;

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function supportsDirectoryAccess() {
    return typeof window.showDirectoryPicker === "function";
  }

  function sanitizeFilename(name) {
    const clean = String(name || "partida")
      .replace(/\.(gba|gb|gbc)$/i, "")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .trim();
    return (clean || "partida") + ".sav";
  }

  function currentContext() {
    const ctx = typeof contextProvider === "function" ? contextProvider() : null;
    return ctx && typeof ctx === "object" ? ctx : {};
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  }

  async function idbSet(key, value) {
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  async function ensurePermission(handle, request = false) {
    if (!handle) return false;
    const opts = { mode: "readwrite" };
    if (await handle.queryPermission?.(opts) === "granted") return true;
    if (request && await handle.requestPermission?.(opts) === "granted") return true;
    return false;
  }

  async function chooseRootDirectory() {
    const root = await window.showDirectoryPicker({ mode: "readwrite" });
    if (!(await ensurePermission(root, true))) {
      throw new Error("No se concedió permiso para guardar en la carpeta.");
    }
    await idbSet(ROOT_HANDLE_KEY, root);
    return root;
  }

  async function getRootDirectory(requestPermission = false) {
    let root = await idbGet(ROOT_HANDLE_KEY).catch(() => null);
    if (root && await ensurePermission(root, requestPermission)) return root;
    if (!requestPermission) return null;
    return chooseRootDirectory();
  }

  async function getMl3dDirectory(requestPermission = false) {
    const root = await getRootDirectory(requestPermission);
    if (!root) return null;
    return root.getDirectoryHandle(FOLDER_NAME, { create: true });
  }

  function makeDialog() {
    let dialog = document.getElementById("ml3d-local-save-dialog");
    if (dialog) return dialog;

    dialog = document.createElement("dialog");
    dialog.id = "ml3d-local-save-dialog";
    dialog.innerHTML = `
      <form method="dialog" class="ml3d-local-save-card">
        <h3 id="ml3d-local-save-title">Guardado local</h3>
        <p id="ml3d-local-save-text"></p>
        <div id="ml3d-local-save-progress" hidden>
          <div><span></span></div>
          <small>Guardando…</small>
        </div>
        <div id="ml3d-local-save-actions"></div>
      </form>
    `;
    document.body.appendChild(dialog);

    const style = document.createElement("style");
    style.textContent = `
      #ml3d-local-save-dialog{border:0;padding:0;background:transparent;color:#fff;max-width:min(92vw,420px)}
      #ml3d-local-save-dialog::backdrop{background:#000b;backdrop-filter:blur(5px)}
      .ml3d-local-save-card{background:#10131a;border:1px solid #ffffff2b;border-radius:18px;padding:22px;box-shadow:0 20px 70px #000a;font-family:inherit}
      .ml3d-local-save-card h3{margin:0 0 12px;font-size:1.25rem}
      .ml3d-local-save-card p{margin:0 0 18px;line-height:1.45;color:#eef}
      #ml3d-local-save-actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}
      #ml3d-local-save-actions button{border:0;border-radius:12px;padding:10px 16px;font:inherit;font-weight:800;cursor:pointer}
      #ml3d-local-save-actions button[data-primary="1"]{background:#fff;color:#111}
      #ml3d-local-save-progress{margin:8px 0 18px}
      #ml3d-local-save-progress>div{height:8px;border-radius:999px;background:#ffffff1f;overflow:hidden}
      #ml3d-local-save-progress span{display:block;height:100%;width:45%;background:#fff;animation:ml3dSaveProgress 1s ease-in-out infinite alternate}
      #ml3d-local-save-progress small{display:block;margin-top:7px;color:#ccd}
      @keyframes ml3dSaveProgress{from{transform:translateX(-40%)}to{transform:translateX(160%)}}
    `;
    document.head.appendChild(style);
    return dialog;
  }

  function promptDialog(title, text, buttons) {
    return new Promise((resolve) => {
      const dialog = makeDialog();
      dialog.querySelector("#ml3d-local-save-title").textContent = title;
      dialog.querySelector("#ml3d-local-save-text").textContent = text;
      dialog.querySelector("#ml3d-local-save-progress").hidden = true;
      const actions = dialog.querySelector("#ml3d-local-save-actions");
      actions.innerHTML = "";
      buttons.forEach((button) => {
        const el = document.createElement("button");
        el.type = "button";
        el.textContent = button.label;
        if (button.primary) el.dataset.primary = "1";
        el.addEventListener("click", () => {
          dialog.close();
          resolve(button.value);
        }, { once: true });
        actions.appendChild(el);
      });
      dialog.showModal();
    });
  }

  function showProgress(title, text) {
    const dialog = makeDialog();
    dialog.querySelector("#ml3d-local-save-title").textContent = title;
    dialog.querySelector("#ml3d-local-save-text").textContent = text;
    dialog.querySelector("#ml3d-local-save-progress").hidden = false;
    dialog.querySelector("#ml3d-local-save-actions").innerHTML = "";
    if (!dialog.open) dialog.showModal();
    return dialog;
  }

  async function showDone(text) {
    return promptDialog("Guardado creado", text, [
      { label: "Aceptar", value: true, primary: true }
    ]);
  }

  async function readMgbaBrowserSram(namespace) {
    if (!namespace || !navigator.storage?.getDirectory) return null;
    try {
      const root = await navigator.storage.getDirectory();
      const engineDir = await root.getDirectoryHandle("mgba", { create: false });
      const dir = await engineDir.getDirectoryHandle(namespace, { create: false });
      const handle = await dir.getFileHandle("sram.bin", { create: false });
      const file = await handle.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      return bytes.length ? bytes : null;
    } catch (_) {
      return null;
    }
  }

  async function writeMgbaBrowserSram(namespace, bytes) {
    if (!namespace || !bytes?.length || !navigator.storage?.getDirectory) return false;
    try {
      const root = await navigator.storage.getDirectory();
      const engineDir = await root.getDirectoryHandle("mgba", { create: true });
      const dir = await engineDir.getDirectoryHandle(namespace, { create: true });
      const handle = await dir.getFileHandle("sram.bin", { create: true });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return true;
    } catch (_) {
      return false;
    }
  }

  async function getCurrentSaveBytes() {
    const ctx = currentContext();
    if (ctx.core === "mgba") {
      await window.ML3DMgbaCompat?.flushSave?.();
      await new Promise((resolve) => setTimeout(resolve, 120));
      return readMgbaBrowserSram(ctx.mgbaNamespace);
    }

    if (typeof ctx.exportLegacySave === "function") {
      const value = await ctx.exportLegacySave();
      return value instanceof Uint8Array ? value : value ? new Uint8Array(value) : null;
    }

    return null;
  }

  async function writeToDirectory(bytes, filename, requestPermission) {
    const dir = await getMl3dDirectory(requestPermission);
    if (!dir) throw new Error("No hay una carpeta de guardado autorizada.");
    const fileHandle = await dir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(bytes);
    await writable.close();
  }

  async function exportIOS(bytes, filename) {
    const file = new File([bytes], filename, { type: "application/octet-stream" });

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: "Guardar partida de ML3Demuler",
        text: "Guarda este archivo dentro de la carpeta ML3Demuler en Archivos."
      });
      return;
    }

    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function saveExternal(bytes, filename, interactive) {
    if (supportsDirectoryAccess()) {
      return writeToDirectory(bytes, filename, interactive);
    }
    if (!interactive) {
      throw new Error("Este navegador necesita una acción manual para guardar el archivo.");
    }
    return exportIOS(bytes, filename);
  }

  async function firstTimeFlow() {
    const platformText = isIOS()
      ? "En iPhone/iPad se abrirá Archivos para que guardes el .sav. Crea o elige una carpeta llamada ML3Demuler."
      : "Se creará una carpeta ML3Demuler dentro de la ubicación que elijas y ahí se guardarán los archivos .sav.";

    const answer = await promptDialog(
      "Crear respaldo de partidas",
      "ML3Demuler puede crear un archivo .sav en tu dispositivo como respaldo por si se borra el navegador o quieres usar la partida en otro emulador. " + platformText,
      [
        { label: "No", value: false },
        { label: "Sí", value: true, primary: true }
      ]
    );
    if (!answer) return false;

    localStorage.setItem(INTRO_KEY, "1");
    return true;
  }

  async function chooseMode() {
    if (!supportsDirectoryAccess()) {
      await promptDialog(
        "Respaldo en iPhone/iPad",
        "Safari no permite que una web vuelva a abrir y sobrescribir automáticamente un archivo de la app Archivos. En iOS se mantendrá el guardado automático en el navegador y el .sav será un respaldo manual en la carpeta ML3Demuler.",
        [
          { label: "Entendido", value: "backup", primary: true }
        ]
      );
      localStorage.setItem(MODE_KEY, "backup");
      restartAutoTimer();
      return "backup";
    }

    const choice = await promptDialog(
      "¿Cómo quieres usar este archivo?",
      "Puedes mantener el guardado automático en el navegador y usar el .sav como respaldo manual, o usar el archivo externo como guardado principal. Incluso en modo archivo principal se mantendrá una copia interna de seguridad.",
      [
        { label: "Respaldo manual", value: "backup", primary: true },
        { label: "Archivo principal", value: "external" }
      ]
    );
    localStorage.setItem(MODE_KEY, choice);
    restartAutoTimer();
    return choice;
  }

  async function manualSave() {
    if (busy) return false;
    busy = true;
    try {
      if (!localStorage.getItem(INTRO_KEY)) {
        const accepted = await firstTimeFlow();
        if (!accepted) return false;
      }

      const ctx = currentContext();
      const filename = sanitizeFilename(ctx.displayName || ctx.filename || "partida");
      const progress = showProgress("Guardando partida", "Preparando " + filename + "…");
      let bytes = null;
      try {
        bytes = await getCurrentSaveBytes();
        if (!bytes?.length) throw new Error("Todavía no hay datos de guardado disponibles.");
        await saveExternal(bytes, filename, true);
      } finally {
        if (progress.open) progress.close();
      }

      await showDone(
        supportsDirectoryAccess()
          ? "Se ha guardado " + filename + " dentro de ML3Demuler."
          : "Se ha preparado " + filename + ". En iOS guárdalo dentro de la carpeta ML3Demuler en Archivos."
      );

      if (!localStorage.getItem(MODE_KEY)) {
        await chooseMode();
      }
      return true;
    } catch (error) {
      console.error("ML3D local save:", error);
      await promptDialog("No se pudo guardar", String(error?.message || error), [
        { label: "Cerrar", value: false, primary: true }
      ]);
      return false;
    } finally {
      busy = false;
    }
  }

  async function autoExternalSave() {
    if (localStorage.getItem(MODE_KEY) !== "external") return;
    if (!supportsDirectoryAccess()) return;
    if (busy) return;

    const ctx = currentContext();
    if (!ctx?.running) return;

    try {
      const bytes = await getCurrentSaveBytes();
      if (!bytes?.length) return;
      const filename = sanitizeFilename(ctx.displayName || ctx.filename || "partida");
      await saveExternal(bytes, filename, false);
    } catch (_) {
      // Permission may have been revoked. Browser autosave remains the fallback.
    }
  }

  async function prepareMgbaNamespace(namespace, displayName) {
    if (localStorage.getItem(MODE_KEY) !== "external") return false;
    if (!supportsDirectoryAccess()) return false;

    try {
      const dir = await getMl3dDirectory(false);
      if (!dir) return false;
      const filename = sanitizeFilename(displayName || "partida");
      const handle = await dir.getFileHandle(filename, { create: false });
      const file = await handle.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!bytes.length) return false;
      return writeMgbaBrowserSram(namespace, bytes);
    } catch (_) {
      return false;
    }
  }

  function restartAutoTimer() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
    if (localStorage.getItem(MODE_KEY) === "external") {
      autoTimer = setInterval(autoExternalSave, AUTO_INTERVAL_MS);
    }
  }

  function setContextProvider(provider) {
    contextProvider = provider;
    restartAutoTimer();
  }

  window.ML3DLocalSave = {
    manualSave,
    autoExternalSave,
    prepareMgbaNamespace,
    setContextProvider,
    getMode: () => localStorage.getItem(MODE_KEY) || "browser",
    resetChoice() {
      localStorage.removeItem(MODE_KEY);
      localStorage.removeItem(INTRO_KEY);
      restartAutoTimer();
    }
  };
})();
