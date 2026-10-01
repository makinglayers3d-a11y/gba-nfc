/* Entrega del contenido protegido: ROMs, carátulas y carcasas SP.
 *
 * Por qué existe este fichero
 * ---------------------------
 * Hasta ahora los juegos, las carátulas y las carcasas vivían en una carpeta
 * pública del repositorio. El sistema de accesos decidía qué botones se veían,
 * pero cualquiera que supiera la dirección de un archivo lo descargaba igual:
 * la decisión se tomaba en la pantalla, no en el servidor.
 *
 * Aquí se toma en el servidor. El contenido vive en un bucket privado de R2,
 * que no tiene direcciones públicas, y lo único que puede sacarlo es este
 * worker, después de comprobar quién pide qué.
 *
 * Cómo se comprueba quién eres
 * ----------------------------
 * No se inventa nada nuevo: se reutiliza el sistema que ya existe. Cada
 * dispositivo tiene un par de claves y firma un desafío del servidor para
 * verificarse (/v1/access/verify). Lo que se añade es que esa verificación
 * ahora devuelve además un "pase de contenido": un texto firmado por el worker
 * con HMAC que dice a qué dispositivo pertenece y cuándo caduca.
 *
 * El pase se manda en cada petición de archivo. Así no hay que firmar un
 * desafío por cada carátula (una biblioteca son decenas de peticiones) y, como
 * lo firma el worker con un secreto que solo él conoce, no se puede fabricar
 * desde el navegador.
 *
 * El pase dice QUIÉN eres, no QUÉ puedes ver: los permisos se releen de la
 * base de datos en cada petición. Así, si revocas un acceso desde tu app de
 * gestión, deja de funcionar al momento y no hay que esperar a que caduque
 * nada.
 */

const PASE_TTL_MS = 30 * 60 * 1000;   /* media hora, como las sesiones */
const encoder = new TextEncoder();

/* La carcasa de ML3D es diseño propio y se queda pública: es la que ve
   cualquiera que abra el emulador sin acceso, para que no se quede con una
   pantalla desnuda. */
export const CARCASA_PUBLICA = "ml3d";

/* ------------------------------------------------------------------ pases */

function base64UrlFromBytes(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesFromBase64Url(text) {
  const s = String(text || "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function claveHmac(env) {
  /* El secreto es el mismo que ya protege el panel de administración; si
     falta, no se emiten pases y el contenido queda cerrado en vez de abierto:
     ante un fallo de configuración, mejor no servir nada. */
  const secreto = env.CONTENT_TOKEN_SECRET || env.ADMIN_TOKEN;
  if (!secreto) return null;
  return crypto.subtle.importKey(
    "raw", encoder.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
}

/** Crea el pase que el emulador usará para pedir archivos. */
export async function emitePase(env, deviceId) {
  const key = await claveHmac(env);
  if (!key || !deviceId) return null;
  const cuerpo = base64UrlFromBytes(encoder.encode(JSON.stringify({
    d: deviceId,
    exp: Date.now() + PASE_TTL_MS
  })));
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(cuerpo)));
  return `${cuerpo}.${base64UrlFromBytes(firma)}`;
}

/** Devuelve el deviceId del pase, o null si no vale. */
async function leePase(env, pase) {
  const key = await claveHmac(env);
  if (!key || !pase) return null;
  const partes = String(pase).split(".");
  if (partes.length !== 2) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", key, bytesFromBase64Url(partes[1]), encoder.encode(partes[0]));
  } catch (_) { return null; }
  if (!ok) return null;
  let datos = null;
  try {
    datos = JSON.parse(new TextDecoder().decode(bytesFromBase64Url(partes[0])));
  } catch (_) { return null; }
  if (!datos || typeof datos.d !== "string") return null;
  if (!Number.isFinite(datos.exp) || datos.exp < Date.now()) return null;
  return datos.d;
}

/* ------------------------------------------------------------- permisos */

function juegosPermitidos(device) {
  try {
    const lista = JSON.parse(device.allowed_games || "[]");
    return Array.isArray(lista) ? lista.map((x) => String(x)) : [];
  } catch (_) { return []; }
}

/** Misma normalización que usa la app para comparar títulos con ficheros. */
export function claveDeJuego(valor) {
  return String(valor || "")
    .replace(/\.(gba|gbc|gb)$/i, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

/**
 * Quién pide esto y qué puede ver.
 *
 * Se relee de la base de datos en cada petición a propósito: un acceso
 * revocado tiene que dejar de funcionar al momento.
 */
export async function quienPide(env, request) {
  const url = new URL(request.url);
  const pase = request.headers.get("X-ML3D-Content-Pass") || url.searchParams.get("pase") || "";
  const deviceId = await leePase(env, pase);
  if (!deviceId) return { ok: false, motivo: "sin_pase" };

  const device = await env.DB.prepare("SELECT * FROM devices WHERE id = ?").bind(deviceId).first();
  if (!device) return { ok: false, motivo: "desconocido" };
  if (device.status !== "approved") return { ok: false, motivo: "sin_acceso" };
  /* Pausar NO cambia el status: deja 'approved' y pone paused = 1. Mirar solo
     el status dejaria entrar a un dispositivo pausado, que es justo lo que se
     quiso evitar al pausarlo. El resto del worker lo comprueba igual. */
  if (Number(device.paused || 0) !== 0) return { ok: false, motivo: "en_pausa" };

  return {
    ok: true,
    deviceId,
    device,
    modo: ["all", "base", "manual"].includes(device.game_mode) ? device.game_mode : "all",
    juegos: juegosPermitidos(device),
    carcasas: Number(device.allow_sp_skins) !== 0
  };
}

/** ¿Puede este dispositivo abrir este juego concreto? */
export function puedeVerJuego(quien, nombreFichero) {
  if (!quien.ok) return false;
  if (quien.modo === "all") return true;
  const buscado = claveDeJuego(nombreFichero);
  return quien.juegos.some((j) => claveDeJuego(j) === buscado);
}

/* --------------------------------------------------------------- entrega */

const TIPOS = {
  gba: "application/octet-stream",
  gbc: "application/octet-stream",
  gb: "application/octet-stream",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};

function tipoDe(nombre) {
  const ext = String(nombre).split(".").pop().toLowerCase();
  return TIPOS[ext] || "application/octet-stream";
}

/**
 * Saca un objeto del bucket privado y lo entrega.
 *
 * Va por el worker en vez de dar un enlace firmado de R2 a propósito: así el
 * archivo no tiene nunca una dirección que alguien pueda copiar y repartir, ni
 * siquiera una temporal.
 */
export async function entrega(env, request, clave, cors) {
  if (!env.CONTENIDO) {
    return new Response(JSON.stringify({ error: "El almacén de contenido no está configurado" }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8", ...cors }
    });
  }
  const objeto = await env.CONTENIDO.get(clave);
  if (!objeto) {
    return new Response(JSON.stringify({ error: "No encontrado" }), {
      status: 404,
      headers: { "content-type": "application/json; charset=utf-8", ...cors }
    });
  }
  return new Response(objeto.body, {
    headers: {
      "content-type": tipoDe(clave),
      /* Privado: que no se quede en caches compartidas por el camino. */
      "cache-control": "private, max-age=300",
      "content-length": String(objeto.size),
      ...cors
    }
  });
}
