(() => {
  "use strict";

  const MODE_KEY = "ml3d-save-file-mode";
  const INTRO_KEY = "ml3d-save-file-intro-v1";
  const DB_NAME = "ml3d-local-save";
  const STORE = "handles";
  const ROOT_HANDLE_KEY = "root-directory";
  const FOLDER_NAME = "ML3Demuler";
  const AUTO_INTERVAL_MS = 15000;

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

  async function getInternalMl3dDirectory(create = true) {
    if (!navigator.storage?.getDirectory) return null;
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(FOLDER_NAME, { create });
  }

  async function writeInternalSave(bytes, filename) {
    const dir = await getInternalMl3dDirectory(true);
    if (!dir) throw new Error("El almacenamiento interno del emulador no está disponible.");
    const handle = await dir.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
    return true;
  }

  async function readInternalSave(filename) {
    const dir = await getInternalMl3dDirectory(false);
    if (!dir) return null;
    const handle = await dir.getFileHandle(filename, { create: false });
    const file = await handle.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    return bytes.length ? bytes : null;
  }

  async function listInternalSaves() {
    const dir = await getInternalMl3dDirectory(true);
    const rows = [];
    if (!dir) return rows;
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== "file" || !/\.sav$/i.test(name)) continue;
      const file = await handle.getFile();
      rows.push({ name, size: file.size, modified: file.lastModified, source: "internal" });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return rows;
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
      #ml3d-local-save-actions button[data-secondary="1"]{background:#fff;color:#111}
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
        if (button.secondary) el.dataset.secondary = "1";
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

  async function readExternalSave(filename, requestPermission = false) {
    const dir = await getMl3dDirectory(requestPermission);
    if (!dir) return null;
    try {
      const handle = await dir.getFileHandle(filename, { create: false });
      const file = await handle.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      return bytes.length ? bytes : null;
    } catch (_) {
      return null;
    }
  }

  async function listExternalSaves(requestPermission = false) {
    const dir = await getMl3dDirectory(requestPermission);
    if (!dir) return [];
    const rows = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== "file" || !/\.sav$/i.test(name)) continue;
      const file = await handle.getFile();
      rows.push({ name, size: file.size, modified: file.lastModified, source: "external" });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return rows;
  }

  async function migrateInternalToExternal() {
    const files = await listInternalSaves();
    for (const file of files) {
      try {
        const bytes = await readInternalSave(file.name);
        if (bytes?.length) await writeToDirectory(bytes, file.name, false);
      } catch (_) {}
    }
  }

  async function exportIOS(bytes, filename) {
    const file = new File([bytes], filename, { type: "application/octet-stream" });

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      const open = await promptDialog(
        "Guardar en Archivos",
        "Pulsa el botón y en la hoja de iOS elige Guardar en Archivos. Selecciona o crea la carpeta ML3Demuler.",
        [
          { label: "Cancelar", value: false },
          { label: "Abrir Archivos", value: true, primary: true }
        ]
      );
      if (!open) throw new DOMException("Guardado cancelado", "AbortError");

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
    const platformText = supportsDirectoryAccess()
      ? "Después de aceptar, el sistema te pedirá elegir una ubicación del almacenamiento. Elige el almacenamiento principal o una carpeta padre; ML3Demuler creará dentro una carpeta física llamada ML3Demuler."
      : "En iPhone/iPad, Safari abrirá Archivos al exportar cada .sav para que lo guardes en una carpeta ML3Demuler.";

    const answer = await promptDialog(
      "Crear respaldo de partidas",
      "ML3Demuler puede guardar archivos .sav fuera de los datos del navegador para que sobrevivan aunque borres los datos del sitio y puedas usarlos en otro navegador, emulador o futura app. " + platformText,
      [
        { label: "No", value: false, secondary: true },
        { label: "Sí", value: true, primary: true }
      ]
    );
    if (!answer) return false;

    await getInternalMl3dDirectory(true);

    if (supportsDirectoryAccess()) {
      try {
        await chooseRootDirectory();
        await getMl3dDirectory(false);
        await migrateInternalToExternal();
      } catch (error) {
        if (error?.name !== "AbortError") {
          console.warn("ML3D: no se pudo crear la carpeta física:", error);
        }
        return false;
      }
    }

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
      "La carpeta física ML3Demuler ya está vinculada. Puedes mantener el autosave principal en el navegador y actualizar el .sav físico solo al pulsar Guardar, o usar el .sav físico como guardado principal y actualizarlo automáticamente. En ambos casos se mantiene una copia interna de seguridad.",
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

        // Internal mirror remains as a safety copy.
        await writeInternalSave(bytes, filename);

        if (supportsDirectoryAccess()) {
          let root = await getRootDirectory(true);
          if (!root) {
            root = await chooseRootDirectory();
          }
          await writeToDirectory(bytes, filename, false);
        } else {
          await exportIOS(bytes, filename);
        }
      } finally {
        if (progress.open) progress.close();
      }

      await showDone(
        supportsDirectoryAccess()
          ? "Se ha guardado " + filename + " en la carpeta física ML3Demuler del dispositivo. También se conserva una copia interna de seguridad."
          : "Se ha preparado " + filename + " para guardarlo en Archivos. Conserva una copia dentro de tu carpeta ML3Demuler."
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
    const ctx = currentContext();
    if (!ctx?.running || busy) return;

    try {
      let bytes = null;
      if (ctx.core === "mgba") {
        bytes = await readMgbaBrowserSram(ctx.mgbaNamespace);
      } else if (typeof ctx.exportLegacySave === "function") {
        const value = await ctx.exportLegacySave();
        bytes = value instanceof Uint8Array ? value : value ? new Uint8Array(value) : null;
      }
      if (!bytes?.length) return;

      const filename = sanitizeFilename(ctx.displayName || ctx.filename || "partida");
      await writeInternalSave(bytes, filename);

      if (localStorage.getItem(MODE_KEY) === "external" && supportsDirectoryAccess()) {
        const root = await getRootDirectory(false);
        if (root) await writeToDirectory(bytes, filename, false);
      }
    } catch (_) {}
  }

  async function prepareMgbaNamespace(namespace, displayName) {
    const filename = sanitizeFilename(displayName || "partida");

    if (localStorage.getItem(MODE_KEY) === "external" && supportsDirectoryAccess()) {
      try {
        const external = await readExternalSave(filename, false);
        if (external?.length) {
          await writeInternalSave(external, filename);
          return writeMgbaBrowserSram(namespace, external);
        }
      } catch (_) {}
    }

    try {
      const internal = await readInternalSave(filename);
      if (internal?.length) {
        return writeMgbaBrowserSram(namespace, internal);
      }
    } catch (_) {}

    return false;
  }

  function restartAutoTimer() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
    autoTimer = setInterval(autoExternalSave, AUTO_INTERVAL_MS);
  }


  function humanSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  async function exportInternalFile(name) {
    const bytes = await readInternalSave(name);
    if (!bytes?.length) return;

    if (isIOS()) {
      await exportIOS(bytes, name);
      return;
    }

    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function importInternalFile() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".sav,application/octet-stream";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return resolve(false);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const filename = sanitizeFilename(file.name);
        await writeInternalSave(bytes, filename);
        if (supportsDirectoryAccess()) {
          try {
            const root = await getRootDirectory(false);
            if (root) await writeToDirectory(bytes, filename, false);
          } catch (_) {}
        }
        resolve(true);
      }, { once: true });
      input.click();
    });
  }

  async function deleteInternalFile(name) {
    const dir = await getInternalMl3dDirectory(false);
    if (!dir) return;
    await dir.removeEntry(name);
  }

  async function openDataFolder() {
    let dialog = document.getElementById("ml3d-save-data-dialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "ml3d-save-data-dialog";
      dialog.innerHTML = `
        <section class="ml3d-save-data-card">
          <header>
            <div><strong>ML3Demuler</strong><small>Datos de guardado</small></div>
            <button type="button" data-close>×</button>
          </header>
          <div class="ml3d-save-data-list"></div>
          <footer>
            <button type="button" data-import>Importar .sav</button>
            <button type="button" data-link>Vincular carpeta externa</button>
          </footer>
        </section>
      `;
      document.body.appendChild(dialog);
      const style = document.createElement("style");
      style.textContent = `
        #ml3d-save-data-dialog{border:0;padding:0;background:transparent;color:#fff;width:min(94vw,520px)}
        #ml3d-save-data-dialog::backdrop{background:#000c;backdrop-filter:blur(5px)}
        .ml3d-save-data-card{background:#0e1118;border:1px solid #ffffff26;border-radius:18px;padding:16px;box-shadow:0 24px 70px #000b;font-family:inherit}
        .ml3d-save-data-card header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
        .ml3d-save-data-card header div{display:flex;flex-direction:column}.ml3d-save-data-card header small{color:#aeb8c8}
        .ml3d-save-data-card header button{border:0;background:#fff;color:#111;border-radius:999px;width:32px;height:32px;font-size:22px}
        .ml3d-save-data-list{display:grid;gap:8px;max-height:50vh;overflow:auto}
        .ml3d-save-data-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:center;background:#171c26;border:1px solid #ffffff16;border-radius:12px;padding:10px}
        .ml3d-save-data-row strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ml3d-save-data-row small{display:block;color:#9ca8ba;margin-top:3px}
        .ml3d-save-data-row button,.ml3d-save-data-card footer button{border:0;border-radius:10px;padding:8px 10px;font:inherit;font-weight:800;background:#fff;color:#111}
        .ml3d-save-data-card footer{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
      `;
      document.head.appendChild(style);
      dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
      dialog.querySelector("[data-import]").addEventListener("click", async () => {
        if (await importInternalFile()) await renderDataFolder(dialog);
      });
      dialog.querySelector("[data-link]").addEventListener("click", async () => {
        if (!supportsDirectoryAccess()) {
          await promptDialog("Carpeta externa", "Este navegador no permite vincular una carpeta física de forma persistente.", [{ label: "Cerrar", value: false, primary: true }]);
          return;
        }
        try {
          await chooseRootDirectory();
          await getMl3dDirectory(false);
          await migrateInternalToExternal();
          localStorage.setItem(MODE_KEY, localStorage.getItem(MODE_KEY) || "backup");
          restartAutoTimer();
          await renderDataFolder(dialog);
          await promptDialog("Carpeta vinculada", "ML3Demuler ya está vinculada. Los .sav internos existentes se han copiado a la carpeta física.", [{ label: "Aceptar", value: true, primary: true }]);
        } catch (_) {}
      });
    }
    await renderDataFolder(dialog);
    if (!dialog.open) dialog.showModal();
  }

  async function renderDataFolder(dialog) {
    const host = dialog.querySelector(".ml3d-save-data-list");
    let files = [];
    let usingExternal = false;

    if (supportsDirectoryAccess()) {
      try {
        const root = await getRootDirectory(false);
        if (root) {
          files = await listExternalSaves(false);
          usingExternal = true;
        }
      } catch (_) {}
    }

    if (!usingExternal) {
      files = await listInternalSaves();
    }

    host.innerHTML = "";

    const source = document.createElement("div");
    source.style.cssText = "padding:0 2px 8px;color:#9ca8ba;font-size:.78rem";
    source.textContent = usingExternal
      ? "Carpeta física: ML3Demuler"
      : "Copia interna del emulador";
    host.appendChild(source);

    if (!files.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:18px;text-align:center;color:#aeb8c8";
      empty.textContent = "Todavía no hay archivos .sav.";
      host.appendChild(empty);
      return;
    }

    files.forEach((file) => {
      const row = document.createElement("div");
      row.className = "ml3d-save-data-row";
      row.innerHTML = `
        <div><strong></strong><small></small></div>
        <button type="button" data-export>Exportar</button>
        <button type="button" data-delete>Eliminar</button>
      `;
      row.querySelector("strong").textContent = file.name;
      row.querySelector("small").textContent = humanSize(file.size) + " · " + new Date(file.modified).toLocaleString("es-ES");

      row.querySelector("[data-export]").addEventListener("click", async () => {
        let bytes = null;
        if (usingExternal) bytes = await readExternalSave(file.name, true);
        else bytes = await readInternalSave(file.name);
        if (!bytes?.length) return;

        if (isIOS()) {
          await exportIOS(bytes, file.name);
          return;
        }

        const blob = new Blob([bytes], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      });

      row.querySelector("[data-delete]").addEventListener("click", async () => {
        const ok = await promptDialog("Eliminar guardado", "¿Quieres eliminar " + file.name + " de ML3Demuler?", [
          { label: "No", value: false, secondary: true },
          { label: "Sí", value: true, primary: true }
        ]);
        if (!ok) return;

        if (usingExternal) {
          const dir = await getMl3dDirectory(true);
          await dir?.removeEntry(file.name);
        } else {
          await deleteInternalFile(file.name);
        }
        await renderDataFolder(dialog);
      });

      host.appendChild(row);
    });
  }

  function setContextProvider(provider) {
    contextProvider = provider;
    restartAutoTimer();
  }


  const dataButton = document.getElementById("save-data-folder");
  if (dataButton) {
    dataButton.addEventListener("click", () => {
      openDataFolder().catch((error) => {
        console.error("ML3D save data:", error);
      });
    });
  }

  window.ML3DLocalSave = {
    manualSave,
    autoExternalSave,
    prepareMgbaNamespace,
    setContextProvider,
    openDataFolder,
    listInternalSaves,
    getMode: () => localStorage.getItem(MODE_KEY) || "browser",
    resetChoice() {
      localStorage.removeItem(MODE_KEY);
      localStorage.removeItem(INTRO_KEY);
      restartAutoTimer();
    }
  };
})();
