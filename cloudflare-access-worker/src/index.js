const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

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

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value, max) {
  const text = String(value || "").trim();
  return text.slice(0, max);
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
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalPublicJwk(jwk)));
  return bytesToBase64Url(new Uint8Array(digest));
}

function validatePublicJwk(jwk) {
  return jwk && jwk.kty === "EC" && jwk.crv === "P-256" && typeof jwk.x === "string" && typeof jwk.y === "string";
}

function adminAuthorized(env, request) {
  const expected = env.ADMIN_TOKEN;
  if (!expected) return false;
  return request.headers.get("Authorization") === `Bearer ${expected}`;
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
  const calculated = await deviceIdForJwk(publicKeyJwk);
  if (calculated !== deviceId) return bad(env, request, "La identidad del dispositivo no coincide", 403);

  const existing = await env.DB.prepare("SELECT * FROM devices WHERE id = ?").bind(deviceId).first();
  if (existing?.status === "approved") {
    return response(env, request, { status: "approved" });
  }

  const now = nowIso();
  const keyJson = JSON.stringify({ kty: publicKeyJwk.kty, crv: publicKeyJwk.crv, x: publicKeyJwk.x, y: publicKeyJwk.y, ext: true });
  if (!existing) {
    await env.DB.prepare(`INSERT INTO devices
      (id, public_key_jwk, display_name, status, user_agent, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?, ?)`)
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

async function verify(env, request) {
  const body = await bodyJson(request);
  const deviceId = cleanText(body.deviceId, 160);
  const challengeId = cleanText(body.challengeId, 120);
  const signature = cleanText(body.signature, 512);
  if (!deviceId || !challengeId || !signature) return bad(env, request, "Faltan datos de verificación");

  const challengeRow = await env.DB.prepare("SELECT * FROM challenges WHERE id = ? AND device_id = ?")
    .bind(challengeId, deviceId).first();
  if (!challengeRow || Number(challengeRow.expires_at) < Date.now()) {
    if (challengeRow) await env.DB.prepare("DELETE FROM challenges WHERE id = ?").bind(challengeId).run();
    return response(env, request, { approved: false, reason: "challenge_expired" }, 403);
  }

  const device = await env.DB.prepare("SELECT * FROM devices WHERE id = ?").bind(deviceId).first();
  if (!device || device.status !== "approved") return response(env, request, { approved: false }, 403);

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(device.public_key_jwk),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    base64UrlToBytes(signature),
    new TextEncoder().encode(challengeRow.nonce)
  );
  await env.DB.prepare("DELETE FROM challenges WHERE id = ?").bind(challengeId).run();
  if (!ok) return response(env, request, { approved: false }, 403);

  const now = nowIso();
  await env.DB.prepare("UPDATE devices SET last_seen_at = ?, updated_at = ? WHERE id = ?")
    .bind(now, now, deviceId).run();
  return response(env, request, { approved: true });
}

async function listRequests(env, request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "pending";
  const allowed = ["pending", "approved", "rejected"];
  if (!allowed.includes(status)) return bad(env, request, "Estado no válido");
  const result = await env.DB.prepare(`SELECT r.id, r.device_id AS deviceId, r.requested_name AS requestedName,
      r.status, r.cart_context AS cartContext, r.created_at AS createdAt, r.decided_at AS decidedAt,
      d.user_agent AS userAgent, d.last_seen_at AS lastSeenAt
      FROM access_requests r JOIN devices d ON d.id = r.device_id
      WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 200`).bind(status).all();
  return response(env, request, { requests: result.results || [] });
}

async function listDevices(env, request) {
  const result = await env.DB.prepare(`SELECT id, display_name AS displayName, status, user_agent AS userAgent,
      created_at AS createdAt, updated_at AS updatedAt, last_seen_at AS lastSeenAt
      FROM devices ORDER BY updated_at DESC LIMIT 300`).all();
  return response(env, request, { devices: result.results || [] });
}

async function decideRequest(env, request, requestId, decision) {
  const row = await env.DB.prepare("SELECT * FROM access_requests WHERE id = ?").bind(requestId).first();
  if (!row) return bad(env, request, "Solicitud no encontrada", 404);
  if (row.status !== "pending") return bad(env, request, "La solicitud ya fue resuelta", 409);
  const now = nowIso();
  const deviceStatus = decision === "approve" ? "approved" : "rejected";
  const requestStatus = decision === "approve" ? "approved" : "rejected";
  await env.DB.batch([
    env.DB.prepare("UPDATE access_requests SET status = ?, decided_at = ? WHERE id = ?").bind(requestStatus, now, requestId),
    env.DB.prepare("UPDATE devices SET status = ?, updated_at = ? WHERE id = ?").bind(deviceStatus, now, row.device_id)
  ]);
  return response(env, request, { ok: true, status: requestStatus });
}

async function revokeDevice(env, request, deviceId) {
  const row = await env.DB.prepare("SELECT id FROM devices WHERE id = ?").bind(deviceId).first();
  if (!row) return bad(env, request, "Dispositivo no encontrado", 404);
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE devices SET status = 'revoked', updated_at = ? WHERE id = ?").bind(now, deviceId),
    env.DB.prepare("DELETE FROM challenges WHERE device_id = ?").bind(deviceId)
  ]);
  return response(env, request, { ok: true, status: "revoked" });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env, request) });

    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/v1/health") {
        return response(env, request, { ok: true, service: "ml3d-dev-access" });
      }
      if (request.method === "POST" && url.pathname === "/v1/access/request") return requestAccess(env, request);
      if (request.method === "POST" && url.pathname === "/v1/access/challenge") return challenge(env, request);
      if (request.method === "POST" && url.pathname === "/v1/access/verify") return verify(env, request);

      if (url.pathname.startsWith("/v1/admin/")) {
        if (!adminAuthorized(env, request)) return bad(env, request, "No autorizado", 401);
        if (request.method === "GET" && url.pathname === "/v1/admin/requests") return listRequests(env, request);
        if (request.method === "GET" && url.pathname === "/v1/admin/devices") return listDevices(env, request);

        const requestMatch = url.pathname.match(/^\/v1\/admin\/requests\/([^/]+)\/(approve|reject)$/);
        if (request.method === "POST" && requestMatch) {
          return decideRequest(env, request, requestMatch[1], requestMatch[2]);
        }
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
