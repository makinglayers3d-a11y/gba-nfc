const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const encoder = new TextEncoder();
const ROOM_TTL_MS = 120_000;
const JOIN_TTL_MS = 120_000;
const PASSWORD_ITERATIONS = 50_000;

function cors(env, request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.ALLOWED_ORIGIN || "https://makinglayers3d-a11y.github.io";
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400"
  };
  if (!origin || origin === allowed) headers["Access-Control-Allow-Origin"] = origin || allowed;
  return headers;
}

function response(env, request, body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...cors(env, request) } });
}
function bad(env, request, message, status = 400) { return response(env, request, { ok: false, error: message }, status); }
async function bodyJson(request) {
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON no válido");
  return value;
}
function cleanText(value, max = 120) { return String(value || "").trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max); }
function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
function randomToken(bytes = 24) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: PASSWORD_ITERATIONS }, key, 256);
  const bytes = new Uint8Array(bits);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function bearerToken(request) {
  const value = request.headers.get("Authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}
function validLatLon(lat, lon) { return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180; }
function quantize(value) { return Math.round(value * 1000) / 1000; }
function haversineMeters(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function publicRoom(room) {
  return {
    id: room.id,
    name: room.name,
    game: room.game || "",
    locked: Number(room.locked) !== 0,
    maxPlayers: Number(room.max_players)
  };
}
async function cleanup(env) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM room_joins WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM rooms WHERE expires_at < ? OR status = 'closed'").bind(now)
  ]);
}
async function roomById(env, id) { return env.DB.prepare("SELECT * FROM rooms WHERE id = ?").bind(id).first(); }
async function requireHost(env, request, room) {
  const token = bearerToken(request);
  return Boolean(token) && (await sha256(token)) === room.host_token_hash;
}
async function joinById(env, roomId, joinId) { return env.DB.prepare("SELECT * FROM room_joins WHERE id = ? AND room_id = ?").bind(joinId, roomId).first(); }
async function requireJoin(env, request, join) {
  const token = bearerToken(request);
  return Boolean(token) && (await sha256(token)) === join.join_token_hash;
}

async function createRoom(env, request) {
  await cleanup(env);
  const body = await bodyJson(request);
  const name = cleanText(body.name, 48);
  const game = cleanText(body.game, 80);
  const password = String(body.password || "").slice(0, 64);
  const maxPlayers = Math.round(clampNumber(body.maxPlayers, 2, 4, 2));
  const lat = Number(body.lat), lon = Number(body.lon);
  if (!name) return bad(env, request, "Pon un nombre a la sala");
  if (!validLatLon(lat, lon)) return bad(env, request, "Ubicación no válida");

  const id = randomToken(6).slice(0, 8).toUpperCase();
  const hostToken = randomToken(24);
  const hostTokenHash = await sha256(hostToken);
  const salt = password ? randomToken(12) : null;
  const passHash = password ? await passwordHash(password, salt) : null;
  const now = Date.now();

  await env.DB.prepare(`INSERT INTO rooms
    (id, name, game, host_token_hash, password_salt, password_hash, locked, max_players, lat_q, lon_q, status, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`)
    .bind(id, name, game, hostTokenHash, salt, passHash, password ? 1 : 0, maxPlayers, quantize(lat), quantize(lon), now, now, now + ROOM_TTL_MS).run();
  return response(env, request, { ok: true, room: { id, name, game, locked: Boolean(password), maxPlayers }, hostToken }, 201);
}

async function nearbyRooms(env, request) {
  await cleanup(env);
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat")), lon = Number(url.searchParams.get("lon"));
  const radiusKm = clampNumber(url.searchParams.get("radiusKm"), 0.2, 20, 1);
  if (!validLatLon(lat, lon)) return bad(env, request, "Ubicación no válida");
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.max(0.15, Math.cos(lat * Math.PI / 180)));
  const now = Date.now();
  const result = await env.DB.prepare(`SELECT r.id, r.name, r.game, r.locked, r.max_players, r.lat_q, r.lon_q,
      (SELECT COUNT(*) FROM room_joins j WHERE j.room_id = r.id AND j.expires_at >= ? AND j.status != 'left') AS join_count
    FROM rooms r WHERE r.status = 'open' AND r.expires_at >= ?
      AND r.lat_q BETWEEN ? AND ? AND r.lon_q BETWEEN ? AND ? LIMIT 100`)
    .bind(now, now, lat - latDelta, lat + latDelta, lon - lonDelta, lon + lonDelta).all();
  const rooms = (result.results || []).map((room) => ({
    id: room.id,
    name: room.name,
    game: room.game || "",
    locked: Number(room.locked) !== 0,
    maxPlayers: Number(room.max_players),
    players: 1 + Number(room.join_count || 0),
    distanceMeters: Math.round(haversineMeters(lat, lon, Number(room.lat_q), Number(room.lon_q)))
  })).filter((room) => room.distanceMeters <= radiusKm * 1000).sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 30);
  return response(env, request, { ok: true, radiusKm, rooms });
}

async function joinRoom(env, request, roomId) {
  await cleanup(env);
  const room = await roomById(env, roomId);
  if (!room || room.status !== "open" || Number(room.expires_at) < Date.now()) return bad(env, request, "La sala ya no está disponible", 404);
  const body = await bodyJson(request);
  const password = String(body.password || "").slice(0, 64);
  const displayName = cleanText(body.displayName, 32) || "Jugador";
  if (Number(room.locked) !== 0) {
    if (!password) return bad(env, request, "Esta sala requiere contraseña", 401);
    if ((await passwordHash(password, room.password_salt)) !== room.password_hash) return bad(env, request, "Contraseña incorrecta", 403);
  }
  const now = Date.now();
  const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM room_joins WHERE room_id = ? AND expires_at >= ? AND status != 'left'").bind(roomId, now).first();
  if (1 + Number(count?.c || 0) >= Number(room.max_players)) return bad(env, request, "La sala está completa", 409);
  const joinId = crypto.randomUUID();
  const joinToken = randomToken(24);
  await env.DB.prepare(`INSERT INTO room_joins
    (id, room_id, join_token_hash, display_name, status, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, 'requested', ?, ?, ?)`)
    .bind(joinId, roomId, await sha256(joinToken), displayName, now, now, now + JOIN_TTL_MS).run();
  return response(env, request, { ok: true, join: { id: joinId, roomId, status: "requested", displayName }, joinToken }, 201);
}

async function listJoins(env, request, roomId) {
  await cleanup(env);
  const room = await roomById(env, roomId);
  if (!room) return bad(env, request, "Sala no encontrada", 404);
  if (!(await requireHost(env, request, room))) return bad(env, request, "No autorizado", 401);
  const now = Date.now();
  const result = await env.DB.prepare(`SELECT id, display_name, status, answer, created_at, updated_at
    FROM room_joins WHERE room_id = ? AND expires_at >= ? AND status != 'left' ORDER BY created_at ASC`).bind(roomId, now).all();
  return response(env, request, { ok: true, joins: (result.results || []).map((row) => ({
    id: row.id, displayName: row.display_name, status: row.status,
    answer: row.status === "answer_ready" || row.status === "connected" ? row.answer : null,
    createdAt: row.created_at, updatedAt: row.updated_at
  })) });
}

async function setOffer(env, request, roomId, joinId) {
  const room = await roomById(env, roomId);
  if (!room) return bad(env, request, "Sala no encontrada", 404);
  if (!(await requireHost(env, request, room))) return bad(env, request, "No autorizado", 401);
  if (!(await joinById(env, roomId, joinId))) return bad(env, request, "Jugador no encontrado", 404);
  const body = await bodyJson(request);
  const offer = cleanText(body.offer, 40000);
  if (!offer || offer.length < 20) return bad(env, request, "Oferta WebRTC no válida");
  const now = Date.now();
  await env.DB.prepare("UPDATE room_joins SET offer = ?, answer = NULL, status = 'offer_ready', updated_at = ?, expires_at = ? WHERE id = ? AND room_id = ?")
    .bind(offer, now, now + JOIN_TTL_MS, joinId, roomId).run();
  return response(env, request, { ok: true, status: "offer_ready" });
}

async function getJoinState(env, request, roomId, joinId) {
  await cleanup(env);
  const join = await joinById(env, roomId, joinId);
  if (!join) return bad(env, request, "La solicitud de unión ya no existe", 404);
  if (!(await requireJoin(env, request, join))) return bad(env, request, "No autorizado", 401);
  const now = Date.now();
  await env.DB.prepare("UPDATE room_joins SET expires_at = ?, updated_at = ? WHERE id = ?").bind(now + JOIN_TTL_MS, now, joinId).run();
  return response(env, request, { ok: true, join: {
    id: join.id, roomId: join.room_id, displayName: join.display_name, status: join.status,
    offer: ["offer_ready", "answer_ready", "connected"].includes(join.status) ? join.offer : null
  } });
}

async function setAnswer(env, request, roomId, joinId) {
  const join = await joinById(env, roomId, joinId);
  if (!join) return bad(env, request, "Jugador no encontrado", 404);
  if (!(await requireJoin(env, request, join))) return bad(env, request, "No autorizado", 401);
  if (!["offer_ready", "answer_ready"].includes(join.status)) return bad(env, request, "El host todavía no ha preparado el enlace", 409);
  const body = await bodyJson(request);
  const answer = cleanText(body.answer, 40000);
  if (!answer || answer.length < 20) return bad(env, request, "Respuesta WebRTC no válida");
  const now = Date.now();
  await env.DB.prepare("UPDATE room_joins SET answer = ?, status = 'answer_ready', updated_at = ?, expires_at = ? WHERE id = ? AND room_id = ?")
    .bind(answer, now, now + JOIN_TTL_MS, joinId, roomId).run();
  return response(env, request, { ok: true, status: "answer_ready" });
}

async function markConnected(env, request, roomId, joinId) {
  const room = await roomById(env, roomId), join = await joinById(env, roomId, joinId);
  if (!room || !join) return bad(env, request, "Enlace no encontrado", 404);
  const token = bearerToken(request);
  if (!token) return bad(env, request, "No autorizado", 401);
  const tokenHash = await sha256(token);
  if (tokenHash !== room.host_token_hash && tokenHash !== join.join_token_hash) return bad(env, request, "No autorizado", 401);
  const now = Date.now();
  await env.DB.prepare("UPDATE room_joins SET status = 'connected', updated_at = ?, expires_at = ? WHERE id = ? AND room_id = ?")
    .bind(now, now + JOIN_TTL_MS, joinId, roomId).run();
  return response(env, request, { ok: true, status: "connected" });
}

async function hostHeartbeat(env, request, roomId) {
  const room = await roomById(env, roomId);
  if (!room) return bad(env, request, "Sala no encontrada", 404);
  if (!(await requireHost(env, request, room))) return bad(env, request, "No autorizado", 401);
  const now = Date.now();
  await env.DB.prepare("UPDATE rooms SET updated_at = ?, expires_at = ? WHERE id = ? AND status = 'open'").bind(now, now + ROOM_TTL_MS, roomId).run();
  return response(env, request, { ok: true, expiresAt: now + ROOM_TTL_MS });
}

async function joinHeartbeat(env, request, roomId, joinId) {
  const join = await joinById(env, roomId, joinId);
  if (!join) return bad(env, request, "Jugador no encontrado", 404);
  if (!(await requireJoin(env, request, join))) return bad(env, request, "No autorizado", 401);
  const now = Date.now();
  await env.DB.prepare("UPDATE room_joins SET updated_at = ?, expires_at = ? WHERE id = ? AND room_id = ?").bind(now, now + JOIN_TTL_MS, joinId).run();
  return response(env, request, { ok: true, expiresAt: now + JOIN_TTL_MS });
}

async function updateRoomSettings(env, request, roomId) {
  const room = await roomById(env, roomId);
  if (!room) return bad(env, request, "Sala no encontrada", 404);
  if (!(await requireHost(env, request, room))) return bad(env, request, "No autorizado", 401);
  const body = await bodyJson(request);
  const name = body.name === undefined ? room.name : cleanText(body.name, 48);
  const game = body.game === undefined ? room.game : cleanText(body.game, 80);
  const maxPlayers = body.maxPlayers === undefined
    ? Number(room.max_players)
    : Math.round(clampNumber(body.maxPlayers, 2, 4, Number(room.max_players)));
  if (!name) return bad(env, request, "El nombre de la sala no puede quedar vacío");
  const active = await env.DB.prepare("SELECT COUNT(*) AS c FROM room_joins WHERE room_id = ? AND expires_at >= ? AND status != 'left'")
    .bind(roomId, Date.now()).first();
  if (1 + Number(active?.c || 0) > maxPlayers) return bad(env, request, "Hay más jugadores conectados que el nuevo límite", 409);

  let salt = room.password_salt;
  let passHash = room.password_hash;
  let locked = Number(room.locked) !== 0 ? 1 : 0;
  if (body.clearPassword === true) {
    salt = null;
    passHash = null;
    locked = 0;
  } else if (body.password !== undefined) {
    const password = String(body.password || "").slice(0, 64);
    if (password) {
      salt = randomToken(12);
      passHash = await passwordHash(password, salt);
      locked = 1;
    }
  }

  const now = Date.now();
  await env.DB.prepare(`UPDATE rooms SET name = ?, game = ?, max_players = ?, password_salt = ?, password_hash = ?, locked = ?, updated_at = ?, expires_at = ? WHERE id = ?`)
    .bind(name, game, maxPlayers, salt, passHash, locked, now, now + ROOM_TTL_MS, roomId).run();
  const updated = await roomById(env, roomId);
  return response(env, request, { ok: true, room: publicRoom(updated) });
}

async function kickJoin(env, request, roomId, joinId) {
  const room = await roomById(env, roomId);
  if (!room) return bad(env, request, "Sala no encontrada", 404);
  if (!(await requireHost(env, request, room))) return bad(env, request, "No autorizado", 401);
  const join = await joinById(env, roomId, joinId);
  if (!join) return response(env, request, { ok: true });
  const now = Date.now();
  await env.DB.prepare("UPDATE room_joins SET status = 'left', updated_at = ?, expires_at = ? WHERE id = ? AND room_id = ?")
    .bind(now, now, joinId, roomId).run();
  return response(env, request, { ok: true });
}

async function closeRoom(env, request, roomId) {
  const room = await roomById(env, roomId);
  if (!room) return response(env, request, { ok: true });
  if (!(await requireHost(env, request, room))) return bad(env, request, "No autorizado", 401);
  await env.DB.prepare("UPDATE rooms SET status = 'closed', expires_at = ? WHERE id = ?").bind(Date.now(), roomId).run();
  return response(env, request, { ok: true });
}

async function leaveJoin(env, request, roomId, joinId) {
  const join = await joinById(env, roomId, joinId);
  if (!join) return response(env, request, { ok: true });
  if (!(await requireJoin(env, request, join))) return bad(env, request, "No autorizado", 401);
  await env.DB.prepare("UPDATE room_joins SET status = 'left', expires_at = ? WHERE id = ? AND room_id = ?").bind(Date.now(), joinId, roomId).run();
  return response(env, request, { ok: true });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env, request) });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (request.method === "GET" && path === "/v1/health") return response(env, request, { ok: true, service: "ml3d-link-lab", apiVersion: 2 });
      if (request.method === "POST" && path === "/v1/rooms") return createRoom(env, request);
      if (request.method === "GET" && path === "/v1/rooms/nearby") return nearbyRooms(env, request);

      let match = path.match(/^\/v1\/rooms\/([^/]+)\/join$/);
      if (request.method === "POST" && match) return joinRoom(env, request, decodeURIComponent(match[1]));
      match = path.match(/^\/v1\/rooms\/([^/]+)\/settings$/);
      if (request.method === "POST" && match) return updateRoomSettings(env, request, decodeURIComponent(match[1]));
      match = path.match(/^\/v1\/rooms\/([^/]+)\/joins$/);
      if (request.method === "GET" && match) return listJoins(env, request, decodeURIComponent(match[1]));
      match = path.match(/^\/v1\/rooms\/([^/]+)\/joins\/([^/]+)\/offer$/);
      if (request.method === "POST" && match) return setOffer(env, request, decodeURIComponent(match[1]), decodeURIComponent(match[2]));
      match = path.match(/^\/v1\/rooms\/([^/]+)\/joins\/([^/]+)\/answer$/);
      if (request.method === "POST" && match) return setAnswer(env, request, decodeURIComponent(match[1]), decodeURIComponent(match[2]));
      match = path.match(/^\/v1\/rooms\/([^/]+)\/joins\/([^/]+)\/connected$/);
      if (request.method === "POST" && match) return markConnected(env, request, decodeURIComponent(match[1]), decodeURIComponent(match[2]));
      match = path.match(/^\/v1\/rooms\/([^/]+)\/joins\/([^/]+)\/heartbeat$/);
      if (request.method === "POST" && match) return joinHeartbeat(env, request, decodeURIComponent(match[1]), decodeURIComponent(match[2]));
      match = path.match(/^\/v1\/rooms\/([^/]+)\/joins\/([^/]+)\/leave$/);
      if (request.method === "POST" && match) return leaveJoin(env, request, decodeURIComponent(match[1]), decodeURIComponent(match[2]));
      match = path.match(/^\/v1\/rooms\/([^/]+)\/joins\/([^/]+)\/kick$/);
      if (request.method === "POST" && match) return kickJoin(env, request, decodeURIComponent(match[1]), decodeURIComponent(match[2]));
      match = path.match(/^\/v1\/rooms\/([^/]+)\/joins\/([^/]+)$/);
      if (request.method === "GET" && match) return getJoinState(env, request, decodeURIComponent(match[1]), decodeURIComponent(match[2]));
      match = path.match(/^\/v1\/rooms\/([^/]+)\/heartbeat$/);
      if (request.method === "POST" && match) return hostHeartbeat(env, request, decodeURIComponent(match[1]));
      match = path.match(/^\/v1\/rooms\/([^/]+)\/close$/);
      if (request.method === "POST" && match) return closeRoom(env, request, decodeURIComponent(match[1]));
      return bad(env, request, "Ruta no encontrada", 404);
    } catch (error) {
      console.error(error);
      return bad(env, request, error?.message || "Error interno", 500);
    }
  }
};
