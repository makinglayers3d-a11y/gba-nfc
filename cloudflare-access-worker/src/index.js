const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
const encoder = new TextEncoder();
const SESSION_TTL_MS = 30 * 60 * 1000;

function cors(env, request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.ALLOWED_ORIGIN || "https://makinglayers3d-a11y.github.io";
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400"
  };
  if (origin === allowed) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function response(env, request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...jsonHeaders, ...cors(env, request) }
  });
}

function bad(env, request, message, status = 400) {
  return response(env, request, { error: message }, status);
}

async function bodyJson(request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") throw new Error("JSON no válido");
  return body;
}

function nowIso() { return new Date().toISOString(); }
function cleanText(value, max) { return String(value || "").trim().slice(0, max); }
function intOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}
function safeGames(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((x) => cleanText(x, 240)).filter(Boolean))].slice(0, 500);
}
function parseGames(raw) {
  try { return safeGames(JSON.parse(raw || "[]")); } catch { return []; }
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function canonicalPublicJwk(jwk) {
  return JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y });
}
async function deviceIdForJwk(jwk) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(canonicalPublicJwk(jwk)));
  return bytesToBase64Url(new Uint8Array(digest));
}
function validatePublicJwk(jwk) {
  return jwk && jwk.kty === "EC" && jwk.crv === "P-256" && typeof jwk.x === "string" && typeof jwk.y === "string";
}
function adminAuthorized(env, request) {
  return Boolean(env.ADMIN_TOKEN) && request.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}

function policyForDevice(device) {
  return {
    gameMode: ["all", "base", "manual"].includes(device.game_mode) ? device.game_mode : "all",
    allowedGames: parseGames(device.allowed_games),
    allowLocalRoms: Number(device.allow_local_roms) !== 0,
    allowSpSkins: Number(device.allow_sp_skins) !== 0,
    usageLimit: device.usage_limit === null || device.usage_limit === undefined ? null : Number(device.usage_limit),
    usageUsed: Number(device.usage_used || 0),
    usageRemaining: device.usage_limit === null || device.usage_limit === undefined
      ? null
      : Math.max(0, Number(device.usage_limit) - Number(device.usage_used || 0))
  };
}

function normalizedPolicy(body = {}, existing = null) {
  const mode = ["all", "base", "manual"].includes(body.gameMode)
    ? body.gameMode
    : (existing?.game_mode || "all");
  const allowedGames = body.allowedGames === undefined
    ? parseGames(existing?.allowed_games)
    : safeGames(body.allowedGames);
  const usageLimit = body.usageLimit === undefined
    ? (existing?.usage_limit === undefined ? null : existing.usage_limit)
    : intOrNull(body.usageLimit);
  return {
    gameMode: mode,
    allowedGames,
    allowLocalRoms: body.allowLocalRoms === undefined ? Number(existing?.allow_local_roms ?? 1) !== 0 : Boolean(body.allowLocalRoms),
    allowSpSkins: body.allowSpSkins === undefined ? Number(existing?.allow_sp_skins ?? 1) !== 0 : Boolean(body.allowSpSkins),
    usageLimit
  };
}

async function savePolicy(env, deviceId, policy) {
  const now = nowIso();
  await env.DB.prepare(`UPDATE devices SET
      game_mode = ?, allowed_games = ?, allow_local_roms = ?, allow_sp_skins = ?, usage_limit = ?, policy_updated_at = ?, updated_at = ?
      WHERE id = ?`)
    .bind(policy.gameMode, JSON.stringify(policy.allowedGames), policy.allowLocalRoms ? 1 : 0,
      policy.allowSpSkins ? 1 : 0, policy.usageLimit, now, now, deviceId).run();
}

async function requestAccess(env, request) {
  const body = await bodyJson(request);
  const deviceId = cleanText(body.deviceId, 160);
  const displayName = cleanText(body.displayName, 80);
  const userAgent = cleanText(body.userAgent, 500);
  const publicKeyJwk = body.publicKeyJwk;
  const cart = body.cart && typeof body.cart === "object" ? body.cart : {};
  if (!deviceId || !displayName) return bad(env, request, "Faltan deviceId o nombre");
  if (!validatePublicJwk(publicKeyJwk)) return bad(env, request, "Clave pública no válida");
  if (await deviceIdForJwk(publicKeyJwk) !== deviceId) return bad(env, request, "La identidad del dispositivo no coincide", 403);

  const existing = await env.DB.prepare("SELECT * FROM devices WHERE id = ?").bind(deviceId).first();
  if (existing?.status === "approved") return response(env, request, { status: "approved" });

  const now = nowIso();
  const keyJson = JSON.stringify({ kty: publicKeyJwk.kty, crv: publicKeyJwk.crv, x: publicKeyJwk.x, y: publicKeyJwk.y, ext: true });
  if (!existing) {
    await env.DB.prepare(`INSERT INTO devices
      (id, public_key_jwk, display_name, status, user_agent, created_at, updated_at,
       game_mode, allowed_games, allow_local_roms, allow_sp_skins, usage_limit, usage_used)
      VALUES (?, ?, ?, 'pending', ?, ?, ?, 'all', '[]', 1, 1, NULL, 0)`)
      .bind(deviceId, keyJson, displayName, userAgent, now, now).run();
  } else {
    if (existing.public_key_jwk !== keyJson) return bad(env, request, "La clave pública registrada no coincide", 403);
    await env.DB.prepare(`UPDATE devices SET display_name = ?, status = 'pending', user_agent = ?, updated_at = ? WHERE id = ?`)
      .bind(displayName, userAgent, now, deviceId).run();
  }

  const pending = await env.DB.prepare(`SELECT id FROM access_requests WHERE device_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`)
    .bind(deviceId).first();
  if (pending) return response(env, request, { status: "pending", requestId: pending.id });

  const requestId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO access_requests
    (id, device_id, requested_name, status, cart_context, created_at)
    VALUES (?, ?, ?, 'pending', ?, ?)`)
    .bind(requestId, deviceId, displayName, JSON.stringify(cart).slice(0, 3000), now).run();
  return response(env, request, { status: "pending", requestId });
}

async function challenge(env, request) {
  const body = await bodyJson(request);
  const deviceId = cleanText(body.deviceId, 160);
  if (!deviceId) return bad(env, request, "Falta deviceId");
  const device = await env.DB.prepare("SELECT status FROM devices WHERE id = ?").bind(deviceId).first();
  if (!device) return response(env, request, { status: "unknown" });
  if (device.status !== "approved") return response(env, request, { status: device.status });

  await env.DB.prepare("DELETE FROM challenges WHERE expires_at < ?").bind(Date.now()).run();
  const challengeId = crypto.randomUUID();
  const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = Date.now() + 2 * 60 * 1000;
  await env.DB.prepare("INSERT INTO challenges (id, device_id, nonce, expires_at) VALUES (?, ?, ?, ?)")
    .bind(challengeId, deviceId, nonce, expiresAt).run();
  return response(env, request, { status: "approved", challengeId, nonce });
}

async function verifySignedChallenge(env, deviceId, challengeId, signature) {
  const challengeRow = await env.DB.prepare("SELECT * FROM challenges WHERE id = ? AND device_id = ?")
    .bind(challengeId, deviceId).first();
  if (!challengeRow || Number(challengeRow.expires_at) < Date.now()) {
    if (challengeRow) await env.DB.prepare("DELETE FROM challenges WHERE id = ?").bind(challengeId).run();
    return { ok: false, reason: "challenge_expired" };
  }
  const device = await env.DB.prepare("SELECT * FROM devices WHERE id = ?").bind(deviceId).first();
  if (!device || device.status !== "approved") return { ok: false, reason: "not_approved" };
  const publicKey = await crypto.subtle.importKey(
    "jwk", JSON.parse(device.public_key_jwk), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
  );
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, publicKey, base64UrlToBytes(signature), encoder.encode(challengeRow.nonce)
  );
  await env.DB.prepare("DELETE FROM challenges WHERE id = ?").bind(challengeId).run();
  return ok ? { ok: true, device } : { ok: false, reason: "bad_signature" };
}

async function verify(env, request) {
  const body = await bodyJson(request);
  const deviceId = cleanText(body.deviceId, 160);
  const challengeId = cleanText(body.challengeId, 120);
  const signature = cleanText(body.signature, 512);
  const sessionId = cleanText(body.sessionId, 160);
  if (!deviceId || !challengeId || !signature || !sessionId) return bad(env, request, "Faltan datos de verificación");

  const signed = await verifySignedChallenge(env, deviceId, challengeId, signature);
  if (!signed.ok) return response(env, request, { approved: false, reason: signed.reason }, 403);
  let device = signed.device;
  const nowMs = Date.now();
  const now = nowIso();
  await env.DB.prepare("DELETE FROM usage_sessions WHERE expires_at < ?").bind(nowMs).run();
  const sessionKey = `${deviceId}:${sessionId}`;
  const existingSession = await env.DB.prepare("SELECT id FROM usage_sessions WHERE id = ?").bind(sessionKey).first();

  if (!existingSession) {
    const limit = device.usage_limit === null || device.usage_limit === undefined ? null : Number(device.usage_limit);
    const used = Number(device.usage_used || 0);
    if (limit !== null && used >= limit) {
      return response(env, request, {
        approved: false,
        reason: "uses_exhausted",
        policy: policyForDevice(device)
      }, 403);
    }
    await env.DB.batch([
      env.DB.prepare("INSERT INTO usage_sessions (id, device_id, session_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
        .bind(sessionKey, deviceId, sessionId, now, nowMs + SESSION_TTL_MS),
      env.DB.prepare("UPDATE devices SET usage_used = usage_used + 1, last_seen_at = ?, updated_at = ? WHERE id = ?")
        .bind(now, now, deviceId)
    ]);
  } else {
    await env.DB.batch([
      env.DB.prepare("UPDATE usage_sessions SET expires_at = ? WHERE id = ?").bind(nowMs + SESSION_TTL_MS, sessionKey),
      env.DB.prepare("UPDATE devices SET last_seen_at = ?, updated_at = ? WHERE id = ?").bind(now, now, deviceId)
    ]);
  }
  device = await env.DB.prepare("SELECT * FROM devices WHERE id = ?").bind(deviceId).first();
  return response(env, request, { approved: true, policy: policyForDevice(device) });
}

async function requestMoreUses(env, request) {
  const body = await bodyJson(request);
  const deviceId = cleanText(body.deviceId, 160);
  const challengeId = cleanText(body.challengeId, 120);
  const signature = cleanText(body.signature, 512);
  const cart = body.cart && typeof body.cart === "object" ? body.cart : {};
  if (!deviceId || !challengeId || !signature) return bad(env, request, "Faltan datos de verificación");
  const signed = await verifySignedChallenge(env, deviceId, challengeId, signature);
  if (!signed.ok) return response(env, request, { ok: false, reason: signed.reason }, 403);

  const pending = await env.DB.prepare("SELECT id FROM use_requests WHERE device_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1")
    .bind(deviceId).first();
  if (pending) return response(env, request, { status: "pending", requestId: pending.id });

  const id = crypto.randomUUID();
  const now = nowIso();
  await env.DB.prepare(`INSERT INTO use_requests
    (id, device_id, status, cart_context, current_limit, current_used, created_at)
    VALUES (?, ?, 'pending', ?, ?, ?, ?)`)
    .bind(id, deviceId, JSON.stringify(cart).slice(0, 3000), signed.device.usage_limit,
      Number(signed.device.usage_used || 0), now).run();
  return response(env, request, { status: "pending", requestId: id });
}

async function listRequests(env, request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "pending";
  if (!["pending", "approved", "rejected"].includes(status)) return bad(env, request, "Estado no válido");
  const result = await env.DB.prepare(`SELECT r.id, r.device_id AS deviceId, r.requested_name AS requestedName,
      r.status, r.cart_context AS cartContext, r.created_at AS createdAt, r.decided_at AS decidedAt,
      d.user_agent AS userAgent, d.last_seen_at AS lastSeenAt
      FROM access_requests r JOIN devices d ON d.id = r.device_id
      WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 200`).bind(status).all();
  return response(env, request, { requests: result.results || [] });
}

async function listUseRequests(env, request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "pending";
  if (!["pending", "approved", "rejected"].includes(status)) return bad(env, request, "Estado no válido");
  const result = await env.DB.prepare(`SELECT u.id, u.device_id AS deviceId, u.status, u.cart_context AS cartContext,
      u.current_limit AS currentLimit, u.current_used AS currentUsed, u.created_at AS createdAt,
      u.decided_at AS decidedAt, u.granted_uses AS grantedUses, d.display_name AS displayName
      FROM use_requests u JOIN devices d ON d.id = u.device_id
      WHERE u.status = ? ORDER BY u.created_at DESC LIMIT 200`).bind(status).all();
  return response(env, request, { requests: result.results || [] });
}

async function listDevices(env, request) {
  const result = await env.DB.prepare(`SELECT id, display_name AS displayName, status, user_agent AS userAgent,
      created_at AS createdAt, updated_at AS updatedAt, last_seen_at AS lastSeenAt,
      game_mode AS gameMode, allowed_games AS allowedGames, allow_local_roms AS allowLocalRoms,
      allow_sp_skins AS allowSpSkins, usage_limit AS usageLimit, usage_used AS usageUsed,
      policy_updated_at AS policyUpdatedAt
      FROM devices ORDER BY updated_at DESC LIMIT 300`).all();
  const devices = (result.results || []).map((d) => ({
    ...d,
    allowedGames: parseGames(d.allowedGames),
    allowLocalRoms: Number(d.allowLocalRoms) !== 0,
    allowSpSkins: Number(d.allowSpSkins) !== 0,
    usageLimit: d.usageLimit === null || d.usageLimit === undefined ? null : Number(d.usageLimit),
    usageUsed: Number(d.usageUsed || 0)
  }));
  return response(env, request, { devices });
}

async function decideRequest(env, request, requestId, decision) {
  const row = await env.DB.prepare("SELECT * FROM access_requests WHERE id = ?").bind(requestId).first();
  if (!row) return bad(env, request, "Solicitud no encontrada", 404);
  if (row.status !== "pending") return bad(env, request, "La solicitud ya fue resuelta", 409);
  const body = await request.json().catch(() => ({}));
  const device = await env.DB.prepare("SELECT * FROM devices WHERE id = ?").bind(row.device_id).first();
  const now = nowIso();
  if (decision === "approve") {
    const policy = normalizedPolicy(body, device);
    await env.DB.batch([
      env.DB.prepare("UPDATE access_requests SET status = 'approved', decided_at = ? WHERE id = ?").bind(now, requestId),
      env.DB.prepare(`UPDATE devices SET status = 'approved', game_mode = ?, allowed_games = ?, allow_local_roms = ?,
        allow_sp_skins = ?, usage_limit = ?, policy_updated_at = ?, updated_at = ? WHERE id = ?`)
        .bind(policy.gameMode, JSON.stringify(policy.allowedGames), policy.allowLocalRoms ? 1 : 0,
          policy.allowSpSkins ? 1 : 0, policy.usageLimit, now, now, row.device_id)
    ]);
    return response(env, request, { ok: true, status: "approved" });
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE access_requests SET status = 'rejected', decided_at = ? WHERE id = ?").bind(now, requestId),
    env.DB.prepare("UPDATE devices SET status = 'rejected', updated_at = ? WHERE id = ?").bind(now, row.device_id)
  ]);
  return response(env, request, { ok: true, status: "rejected" });
}

async function updatePolicy(env, request, deviceId) {
  const device = await env.DB.prepare("SELECT * FROM devices WHERE id = ?").bind(deviceId).first();
  if (!device) return bad(env, request, "Dispositivo no encontrado", 404);
  const body = await bodyJson(request);
  const policy = normalizedPolicy(body, device);
  await savePolicy(env, deviceId, policy);
  const updated = await env.DB.prepare("SELECT * FROM devices WHERE id = ?").bind(deviceId).first();
  return response(env, request, { ok: true, policy: policyForDevice(updated) });
}

async function resetUses(env, request, deviceId) {
  const device = await env.DB.prepare("SELECT id FROM devices WHERE id = ?").bind(deviceId).first();
  if (!device) return bad(env, request, "Dispositivo no encontrado", 404);
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE devices SET usage_used = 0, usage_reset_at = ?, updated_at = ? WHERE id = ?").bind(now, now, deviceId),
    env.DB.prepare("DELETE FROM usage_sessions WHERE device_id = ?").bind(deviceId)
  ]);
  return response(env, request, { ok: true, usageUsed: 0 });
}

async function decideUseRequest(env, request, requestId, decision) {
  const row = await env.DB.prepare("SELECT * FROM use_requests WHERE id = ?").bind(requestId).first();
  if (!row) return bad(env, request, "Solicitud de usos no encontrada", 404);
  if (row.status !== "pending") return bad(env, request, "La solicitud ya fue resuelta", 409);
  const now = nowIso();
  if (decision === "reject") {
    await env.DB.prepare("UPDATE use_requests SET status = 'rejected', decided_at = ? WHERE id = ?").bind(now, requestId).run();
    return response(env, request, { ok: true, status: "rejected" });
  }
  const body = await bodyJson(request);
  const additionalUses = Number(body.additionalUses);
  if (!Number.isInteger(additionalUses) || additionalUses <= 0 || additionalUses > 100000) {
    return bad(env, request, "Indica un número válido de usos adicionales");
  }
  const device = await env.DB.prepare("SELECT * FROM devices WHERE id = ?").bind(row.device_id).first();
  if (!device) return bad(env, request, "Dispositivo no encontrado", 404);
  const currentLimit = device.usage_limit === null || device.usage_limit === undefined
    ? Number(device.usage_used || 0)
    : Number(device.usage_limit);
  const newLimit = currentLimit + additionalUses;
  await env.DB.batch([
    env.DB.prepare("UPDATE use_requests SET status = 'approved', decided_at = ?, granted_uses = ? WHERE id = ?")
      .bind(now, additionalUses, requestId),
    env.DB.prepare("UPDATE devices SET usage_limit = ?, updated_at = ? WHERE id = ?").bind(newLimit, now, row.device_id)
  ]);
  return response(env, request, { ok: true, status: "approved", usageLimit: newLimit });
}

async function revokeDevice(env, request, deviceId) {
  const row = await env.DB.prepare("SELECT id FROM devices WHERE id = ?").bind(deviceId).first();
  if (!row) return bad(env, request, "Dispositivo no encontrado", 404);
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE devices SET status = 'revoked', updated_at = ? WHERE id = ?").bind(now, deviceId),
    env.DB.prepare("DELETE FROM challenges WHERE device_id = ?").bind(deviceId),
    env.DB.prepare("DELETE FROM usage_sessions WHERE device_id = ?").bind(deviceId)
  ]);
  return response(env, request, { ok: true, status: "revoked" });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env, request) });
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/v1/health") return response(env, request, { ok: true, service: "ml3d-dev-access", apiVersion: 2 });
      if (request.method === "POST" && url.pathname === "/v1/access/request") return requestAccess(env, request);
      if (request.method === "POST" && url.pathname === "/v1/access/challenge") return challenge(env, request);
      if (request.method === "POST" && url.pathname === "/v1/access/verify") return verify(env, request);
      if (request.method === "POST" && url.pathname === "/v1/access/request-more-uses") return requestMoreUses(env, request);

      if (url.pathname.startsWith("/v1/admin/")) {
        if (!adminAuthorized(env, request)) return bad(env, request, "No autorizado", 401);
        if (request.method === "GET" && url.pathname === "/v1/admin/requests") return listRequests(env, request);
        if (request.method === "GET" && url.pathname === "/v1/admin/use-requests") return listUseRequests(env, request);
        if (request.method === "GET" && url.pathname === "/v1/admin/devices") return listDevices(env, request);

        const requestMatch = url.pathname.match(/^\/v1\/admin\/requests\/([^/]+)\/(approve|reject)$/);
        if (request.method === "POST" && requestMatch) return decideRequest(env, request, requestMatch[1], requestMatch[2]);
        const useMatch = url.pathname.match(/^\/v1\/admin\/use-requests\/([^/]+)\/(approve|reject)$/);
        if (request.method === "POST" && useMatch) return decideUseRequest(env, request, useMatch[1], useMatch[2]);
        const policyMatch = url.pathname.match(/^\/v1\/admin\/devices\/([^/]+)\/policy$/);
        if (request.method === "POST" && policyMatch) return updatePolicy(env, request, policyMatch[1]);
        const resetMatch = url.pathname.match(/^\/v1\/admin\/devices\/([^/]+)\/reset-uses$/);
        if (request.method === "POST" && resetMatch) return resetUses(env, request, resetMatch[1]);
        const revokeMatch = url.pathname.match(/^\/v1\/admin\/devices\/([^/]+)\/revoke$/);
        if (request.method === "POST" && revokeMatch) return revokeDevice(env, request, revokeMatch[1]);
      }
      return bad(env, request, "Ruta no encontrada", 404);
    } catch (error) {
      console.error(error);
      return bad(env, request, error?.message || "Error interno", 500);
    }
  }
};
