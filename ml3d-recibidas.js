(() => {
  "use strict";

  /* Juegos recibidos de otro jugador por ML3D Link.

     - Se guardan solo en este dispositivo, en la carpeta interna del emulador
       (ML3Demuler), la misma donde viven las partidas .sav. No se suben a
       ningún servidor.
     - Cada uno queda apuntado con su huella completa. Un juego cuya huella
       está en esa lista no se vuelve a enviar a nadie, se abra desde donde se
       abra. Borrar el juego no borra la huella de la lista. */

  const CARPETA = "ML3Demuler";
  const CLAVE = "ml3d-juegos-recibidos";
  const EXTENSION = /\.(gba|gbc|gb)$/i;

  const clave = (value) => String(value || "")
    .replace(EXTENSION, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();

  function registro() {
    try {
      const value = JSON.parse(localStorage.getItem(CLAVE) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function guardaRegistro(lista) {
    localStorage.setItem(CLAVE, JSON.stringify(lista));
  }

  async function carpeta(crear) {
    if (!navigator.storage?.getDirectory) return null;
    const raiz = await navigator.storage.getDirectory();
    try {
      return await raiz.getDirectoryHandle(CARPETA, { create: crear });
    } catch {
      return null;
    }
  }

  async function huella(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function nombreSeguro(filename) {
    const limpio = String(filename || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 120);
    return EXTENSION.test(limpio) ? limpio : (limpio || "juego") + ".gba";
  }

  window.ML3DRecibidas = {
    huella,

    /** Juegos recibidos que siguen guardados. */
    lista() {
      return registro().filter((item) => !item.borrado);
    },

    /** true si esta huella es de un juego recibido, aunque ya se haya borrado. */
    esRecibida(hash) {
      return Boolean(hash) && registro().some((item) => item.hash === hash);
    },

    /** Guarda un juego recibido. Devuelve su ficha. */
    async guarda({ bytes, filename, de }) {
      const dir = await carpeta(true);
      if (!dir) throw new Error("Este navegador no tiene almacenamiento interno para guardar el juego.");
      const nombre = nombreSeguro(filename);
      const handle = await dir.getFileHandle(nombre, { create: true });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();

      const ficha = {
        nombre,
        hash: await huella(bytes),
        size: bytes.byteLength,
        de: String(de || "").slice(0, 32),
        fecha: new Date().toISOString()
      };
      guardaRegistro([...registro().filter((item) => item.nombre !== nombre || item.borrado), ficha]);
      return ficha;
    },

    /** Lee un juego recibido por su nombre, con o sin extensión. */
    async lee(nombre) {
      const buscada = clave(nombre);
      const ficha = this.lista().find((item) => clave(item.nombre) === buscada);
      if (!ficha) return null;
      const dir = await carpeta(false);
      if (!dir) return null;
      try {
        const file = await (await dir.getFileHandle(ficha.nombre, { create: false })).getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());
        return bytes.byteLength ? { bytes, filename: ficha.nombre, ficha } : null;
      } catch {
        return null;
      }
    },

    /** Borra el archivo. La huella sigue apuntada: no se podrá reenviar. */
    async borra(nombre) {
      const buscada = clave(nombre);
      const lista = registro();
      const ficha = lista.find((item) => !item.borrado && clave(item.nombre) === buscada);
      if (!ficha) return false;
      const dir = await carpeta(false);
      try { await dir?.removeEntry(ficha.nombre); } catch {}
      ficha.borrado = true;
      guardaRegistro(lista);
      return true;
    }
  };
})();
