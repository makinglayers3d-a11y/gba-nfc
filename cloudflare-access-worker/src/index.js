const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
const encoder = new TextEncoder();
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_EMULATOR_MEDIA_DATA = 1500000;
const MAX_GAME_ROM_BASE64 = 60 * 1024 * 1024;
const MAX_GAME_COVER_BASE64 = 8 * 1024 * 1024;
const DEFAULT_GITHUB_REPO = "makinglayers3d-a11y/gba-nfc";

function cors(env, request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.ALLOWED_ORIGIN || "https://makinglayers3d-a11y.github.io";
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
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


async function ensureUsageAnalyticsSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS usage_heartbeats (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      game_key TEXT,
      last_heartbeat_ms INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS device_game_usage (
      device_id TEXT NOT NULL,
      game_key TEXT NOT NULL,
      active_seconds INTEGER NOT NULL DEFAULT 0,
      launches INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT,
      PRIMARY KEY(device_id, game_key)
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_game_usage_device ON device_game_usage(device_id, active_seconds DESC)")
  ]);

  const columns = await env.DB.prepare("PRAGMA table_info(devices)").all();
  const names = new Set((columns.results || []).map((row) => row.name));
  if (!names.has("total_active_seconds")) {
    await env.DB.prepare("ALTER TABLE devices ADD COLUMN total_active_seconds INTEGER NOT NULL DEFAULT 0").run();
  }
  if (!names.has("session_count")) {
    await env.DB.prepare("ALTER TABLE devices ADD COLUMN session_count INTEGER NOT NULL DEFAULT 0").run();
  }
  if (!names.has("last_active_at")) {
    await env.DB.prepare("ALTER TABLE devices ADD COLUMN last_active_at TEXT").run();
  }
}

function githubConfig(env) {
  const full = cleanText(env.GITHUB_REPO || DEFAULT_GITHUB_REPO, 220);
  const parts = full.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("GITHUB_REPO no válido");
  return {
    owner: parts[0],
    repo: parts[1],
    branch: cleanText(env.GITHUB_BRANCH || "main", 120) || "main"
  };
}

async function githubApi(env, apiPath, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  if (method !== "GET" && !env.GITHUB_TOKEN) {
    const error = new Error("Falta configurar GITHUB_TOKEN en el Worker para modificar juegos");
    error.status = 503;
    throw error;
  }
  const response = await fetch("https://api.github.com" + apiPath, {
    ...options,
    headers: {
      "Accept": "application/vnd.github+json",
      ...(env.GITHUB_TOKEN ? { "Authorization": `Bearer ${env.GITHUB_TOKEN}` } : {}),
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ML3Demu-tools-worker",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(data.message || `GitHub HTTP ${response.status}`);
    error.status = response.status;
    error.github = data;
    throw error;
  }
  return data;
}

function repoContentsPath(env, repoPath) {
  const cfg = githubConfig(env);
  const encoded = String(repoPath || "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${encoded}`;
}

async function repoContents(env, repoPath) {
  const cfg = githubConfig(env);
  return githubApi(env, repoContentsPath(env, repoPath) + `?ref=${encodeURIComponent(cfg.branch)}`);
}

function utf8ToBase64(value) {
  const bytes = encoder.encode(String(value));
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToUtf8(value) {
  const binary = atob(String(value || "").replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function readRepoJson(env, repoPath, fallback) {
  try {
    const file = await repoContents(env, repoPath);
    return JSON.parse(base64ToUtf8(file.content || ""));
  } catch (error) {
    if (error.status === 404) return fallback;
    throw error;
  }
}

async function putRepoFile(env, repoPath, contentBase64, message) {
  const cfg = githubConfig(env);
  let sha = null;
  try {
    const current = await repoContents(env, repoPath);
    sha = current.sha || null;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  const payload = {
    message,
    content: String(contentBase64 || "").replace(/\s/g, ""),
    branch: cfg.branch
  };
  if (sha) payload.sha = sha;
  return githubApi(env, repoContentsPath(env, repoPath), {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

async function deleteRepoFile(env, repoPath, message) {
  const cfg = githubConfig(env);
  let current;
  try {
    current = await repoContents(env, repoPath);
  } catch (error) {
    if (error.status === 404) return false;
    throw error;
  }
  await githubApi(env, repoContentsPath(env, repoPath), {
    method: "DELETE",
    body: JSON.stringify({ message, sha: current.sha, branch: cfg.branch })
  });
  return true;
}

async function listRepoDir(env, repoPath) {
  try {
    const result = await repoContents(env, repoPath);
    return Array.isArray(result) ? result : [];
  } catch (error) {
    if (error.status === 404) return [];
    throw error;
  }
}

function normalizedRomFilename(value) {
  const filename = cleanText(value, 240).replace(/^.*[\\/]/, "");
  if (!filename || !/\.(gba|gbc|gb)$/i.test(filename)) throw new Error("Nombre de ROM no válido");
  if (filename === "." || filename === "..") throw new Error("Nombre de ROM no válido");
  return filename;
}

function romBaseName(filename) {
  return filename.replace(/\.(gba|gbc|gb)$/i, "");
}

function normalizedCoverExtension(value) {
  const ext = cleanText(value, 12).toLowerCase().replace(/^\./, "");
  if (ext === "jpeg") return "jpg";
  if (!["jpg", "png", "webp"].includes(ext)) throw new Error("La carátula debe ser JPG, PNG o WebP");
  return ext;
}

async function gameManagement(env) {
  const root = await readRepoJson(env, "game-management.json", { schemaVersion: 1, updatedAt: "", games: {} });
  if (!root.games || typeof root.games !== "object" || Array.isArray(root.games)) root.games = {};
  root.schemaVersion = 1;
  return root;
}

async function saveGameManagement(env, management, message) {
  management.schemaVersion = 1;
  management.updatedAt = nowIso();
  await putRepoFile(env, "game-management.json", utf8ToBase64(JSON.stringify(management, null, 2) + "\n"), message);
}

async function syncGamesCatalog(env) {
  const files = (await listRepoDir(env, "games"))
    .filter((item) => item.type === "file" && /\.(gba|gbc|gb)$/i.test(item.name || ""))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .map((item) => ({ name: item.name, type: "file" }));
  await putRepoFile(
    env,
    "games-catalog.json",
    utf8ToBase64(JSON.stringify(files, null, 2) + "\n"),
    "Sync fallback games catalog"
  );
}

async function listManagedGames(env, request) {
  const [files, covers, management] = await Promise.all([
    listRepoDir(env, "games"),
    listRepoDir(env, "covers"),
    gameManagement(env)
  ]);
  const coverNames = new Set(covers.filter((item) => item.type === "file").map((item) => item.name));
  const games = files
    .filter((item) => item.type === "file" && /\.(gba|gbc|gb)$/i.test(item.name || ""))
    .map((item) => {
      const meta = management.games[item.name] || {};
      const base = romBaseName(item.name);
      const conventional = ["jpg", "png", "webp"].map((ext) => `${base}.${ext}`).find((name) => coverNames.has(name));
      const cover = cleanText(meta.cover, 500) || (conventional ? `covers/${conventional}` : "");
      return {
        id: item.name,
        filename: item.name,
        displayName: cleanText(meta.displayName, 160) || base,
        system: item.name.toLowerCase().endsWith(".gba") ? "gba" : (item.name.toLowerCase().endsWith(".gbc") ? "gbc" : "gb"),
        suspended: Boolean(meta.suspended),
        cover,
        hasCover: Boolean(cover),
        size: Number(item.size || 0)
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
  return response(env, request, { games, updatedAt: management.updatedAt || null });
}

async function addManagedGame(env, request) {
  const body = await bodyJson(request);
  const filename = normalizedRomFilename(body.filename);
  const romBase64 = String(body.romBase64 || "").replace(/\s/g, "");
  if (!romBase64 || romBase64.length > MAX_GAME_ROM_BASE64) return bad(env, request, "ROM vacía o demasiado grande", 413);
  try {
    await repoContents(env, `games/${filename}`);
    return bad(env, request, "Ya existe un juego con ese archivo", 409);
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  await putRepoFile(env, `games/${filename}`, romBase64, `Add game ${filename}`);

  const management = await gameManagement(env);
  const base = romBaseName(filename);
  const entry = {
    displayName: cleanText(body.displayName, 160) || base,
    suspended: false
  };

  const coverBase64 = String(body.coverBase64 || "").replace(/\s/g, "");
  if (coverBase64) {
    if (coverBase64.length > MAX_GAME_COVER_BASE64) return bad(env, request, "Carátula demasiado grande", 413);
    const extension = normalizedCoverExtension(body.coverExtension);
    const coverPath = `covers/${base}.${extension}`;
    await putRepoFile(env, coverPath, coverBase64, `Add cover for ${filename}`);
    entry.cover = coverPath;
  }

  management.games[filename] = entry;
  await saveGameManagement(env, management, `Manage game ${filename}`);
  await syncGamesCatalog(env);
  return response(env, request, { ok: true, filename, game: entry }, 201);
}

async function updateManagedGame(env, request, filenameValue) {
  const filename = normalizedRomFilename(decodeURIComponent(filenameValue));
  await repoContents(env, `games/${filename}`);
  const body = await bodyJson(request);
  const management = await gameManagement(env);
  const current = management.games[filename] || {};
  const entry = {
    ...current,
    displayName: cleanText(body.displayName, 160) || romBaseName(filename),
    suspended: Boolean(current.suspended)
  };

  const coverBase64 = String(body.coverBase64 || "").replace(/\s/g, "");
  if (coverBase64) {
    if (coverBase64.length > MAX_GAME_COVER_BASE64) return bad(env, request, "Carátula demasiado grande", 413);
    const extension = normalizedCoverExtension(body.coverExtension);
    const coverPath = `covers/${romBaseName(filename)}.${extension}`;
    await putRepoFile(env, coverPath, coverBase64, `Update cover for ${filename}`);
    entry.cover = coverPath;
  }

  management.games[filename] = entry;
  await saveGameManagement(env, management, `Update game ${filename}`);
  return response(env, request, { ok: true, filename, game: entry });
}

async function suspendManagedGame(env, request, filenameValue) {
  const filename = normalizedRomFilename(decodeURIComponent(filenameValue));
  await repoContents(env, `games/${filename}`);
  const body = await bodyJson(request);
  const management = await gameManagement(env);
  const current = management.games[filename] || {};
  management.games[filename] = {
    ...current,
    displayName: cleanText(current.displayName, 160) || romBaseName(filename),
    suspended: Boolean(body.suspended)
  };
  await saveGameManagement(env, management, `${body.suspended ? "Suspend" : "Resume"} game ${filename}`);
  return response(env, request, { ok: true, filename, suspended: Boolean(body.suspended) });
}

async function deleteManagedGame(env, request, filenameValue) {
  const filename = normalizedRomFilename(decodeURIComponent(filenameValue));
  const url = new URL(request.url);
  const deleteCover = url.searchParams.get("deleteCover") === "1";
  const base = romBaseName(filename);
  const management = await gameManagement(env);
  const current = management.games[filename] || {};
  const deleted = [];

  if (await deleteRepoFile(env, `games/${filename}`, `Delete game ${filename}`)) {
    deleted.push(`games/${filename}`);
  } else {
    return bad(env, request, "Juego no encontrado", 404);
  }

  const previews = await listRepoDir(env, "previews");
  for (const item of previews) {
    if (item.type !== "file") continue;
    const previewBase = String(item.name || "").replace(/\.[^.]+$/, "");
    if (previewBase === base) {
      const previewPath = `previews/${item.name}`;
      if (await deleteRepoFile(env, previewPath, `Delete preview for ${filename}`)) deleted.push(previewPath);
    }
  }

  if (deleteCover) {
    const coverPaths = new Set([
      cleanText(current.cover, 500),
      `covers/${base}.jpg`,
      `covers/${base}.png`,
      `covers/${base}.webp`
    ].filter((value) => value && value !== "covers/coverml3d.png"));
    for (const coverPath of coverPaths) {
      if (await deleteRepoFile(env, coverPath, `Delete cover for ${filename}`)) deleted.push(coverPath);
    }
  }

  delete management.games[filename];
  await saveGameManagement(env, management, `Remove game metadata ${filename}`);
  await syncGamesCatalog(env);
  return response(env, request, { ok: true, filename, deleteCover, deleted });
}

async function heartbeat(env, request) {
  await ensureUsageAnalyticsSchema(env);
  const body = await bodyJson(request);
  const deviceId = cleanText(body.deviceId, 160);
  const sessionId = cleanText(body.sessionId, 160);
  const game = cleanText(body.game, 240);
  if (!deviceId || !sessionId) return bad(env, request, "Faltan datos de sesión");

  const nowMs = Date.now();
  const now = nowIso();
  const sessionKey = `${deviceId}:${sessionId}`;
  const session = await env.DB.prepare(
    "SELECT id FROM usage_sessions WHERE id = ? AND device_id = ? AND expires_at >= ?"
  ).bind(sessionKey, deviceId, nowMs).first();
  if (!session) return bad(env, request, "Sesión de acceso caducada", 403);

  const device = await env.DB.prepare("SELECT status, paused FROM devices WHERE id = ?").bind(deviceId).first();
  if (!device || device.status !== "approved" || Number(device.paused || 0) !== 0) {
    return bad(env, request, "Acceso no disponible", 403);
  }

  const previous = await env.DB.prepare(
    "SELECT game_key AS gameKey, last_heartbeat_ms AS lastHeartbeatMs FROM usage_heartbeats WHERE id = ?"
  ).bind(sessionKey).first();
  const elapsedMs = previous ? Math.max(0, Math.min(45000, nowMs - Number(previous.lastHeartbeatMs || nowMs))) : 0;
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const launchIncrement = game && (!previous || String(previous.gameKey || "") !== game) ? 1 : 0;

  const statements = [
    env.DB.prepare(`INSERT INTO usage_heartbeats (id, device_id, session_id, game_key, last_heartbeat_ms, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET game_key = excluded.game_key, last_heartbeat_ms = excluded.last_heartbeat_ms, updated_at = excluded.updated_at`)
      .bind(sessionKey, deviceId, sessionId, game || null, nowMs, now),
    env.DB.prepare(`UPDATE devices SET total_active_seconds = COALESCE(total_active_seconds,0) + ?,
      last_active_at = ?, last_seen_at = ?, updated_at = ? WHERE id = ?`)
      .bind(elapsedSeconds, now, now, now, deviceId),
    env.DB.prepare("UPDATE usage_sessions SET expires_at = ? WHERE id = ?")
      .bind(nowMs + SESSION_TTL_MS, sessionKey)
  ];
  if (game) {
    statements.push(
      env.DB.prepare(`INSERT INTO device_game_usage (device_id, game_key, active_seconds, launches, last_seen_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(device_id, game_key) DO UPDATE SET
          active_seconds = active_seconds + excluded.active_seconds,
          launches = launches + excluded.launches,
          last_seen_at = excluded.last_seen_at`)
        .bind(deviceId, game, elapsedSeconds, launchIncrement, now)
    );
  }
  await env.DB.batch(statements);
  return response(env, request, { ok: true, activeSecondsAdded: elapsedSeconds });
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
  if (existing?.status === "approved" && Number(existing.paused || 0) === 0) return response(env, request, { status: "approved" });
  if (existing?.status === "approved" && Number(existing.paused || 0) !== 0) return response(env, request, { status: "paused" });

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
  const device = await env.DB.prepare("SELECT status, paused FROM devices WHERE id = ?").bind(deviceId).first();
  if (!device) return response(env, request, { status: "unknown" });
  if (device.status === "approved" && Number(device.paused || 0) !== 0) return response(env, request, { status: "paused" });
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
  if (Number(device.paused || 0) !== 0) return { ok: false, reason: "paused" };
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
  await ensureUsageAnalyticsSchema(env);
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
      env.DB.prepare(`UPDATE devices SET usage_used = usage_used + 1,
        session_count = COALESCE(session_count,0) + 1,
        last_seen_at = ?, last_active_at = ?, updated_at = ? WHERE id = ?`)
        .bind(now, now, now, deviceId)
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
  await ensureUsageAnalyticsSchema(env);
  const result = await env.DB.prepare(`SELECT id, display_name AS displayName, status, paused, user_agent AS userAgent,
      created_at AS createdAt, updated_at AS updatedAt, last_seen_at AS lastSeenAt,
      game_mode AS gameMode, allowed_games AS allowedGames, allow_local_roms AS allowLocalRoms,
      allow_sp_skins AS allowSpSkins, usage_limit AS usageLimit, usage_used AS usageUsed,
      policy_updated_at AS policyUpdatedAt, COALESCE(total_active_seconds,0) AS totalActiveSeconds,
      COALESCE(session_count,0) AS sessionCount, last_active_at AS lastActiveAt
      FROM devices ORDER BY updated_at DESC LIMIT 300`).all();
  const gameUsage = await env.DB.prepare(`SELECT device_id AS deviceId, game_key AS gameKey,
      active_seconds AS activeSeconds, launches, last_seen_at AS lastSeenAt
      FROM device_game_usage ORDER BY device_id, active_seconds DESC`).all();
  const topByDevice = new Map();
  for (const row of gameUsage.results || []) {
    const list = topByDevice.get(row.deviceId) || [];
    if (list.length < 5) {
      list.push({
        game: row.gameKey || "",
        activeSeconds: Number(row.activeSeconds || 0),
        launches: Number(row.launches || 0),
        lastSeenAt: row.lastSeenAt || null
      });
      topByDevice.set(row.deviceId, list);
    }
  }
  const devices = (result.results || []).map((d) => ({
    ...d,
    paused: Number(d.paused || 0) !== 0,
    allowedGames: parseGames(d.allowedGames),
    allowLocalRoms: Number(d.allowLocalRoms) !== 0,
    allowSpSkins: Number(d.allowSpSkins) !== 0,
    usageLimit: d.usageLimit === null || d.usageLimit === undefined ? null : Number(d.usageLimit),
    usageUsed: Number(d.usageUsed || 0),
    totalActiveSeconds: Number(d.totalActiveSeconds || 0),
    sessionCount: Number(d.sessionCount || 0),
    topGames: topByDevice.get(d.id) || []
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
      env.DB.prepare(`UPDATE devices SET status = 'approved', paused = 0, game_mode = ?, allowed_games = ?, allow_local_roms = ?,
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

async function setDevicePaused(env, request, deviceId, paused) {
  const row = await env.DB.prepare("SELECT id, status FROM devices WHERE id = ?").bind(deviceId).first();
  if (!row) return bad(env, request, "Dispositivo no encontrado", 404);
  if (row.status !== "approved") return bad(env, request, "Solo se puede pausar un dispositivo aprobado", 409);
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE devices SET paused = ?, updated_at = ? WHERE id = ?").bind(paused ? 1 : 0, now, deviceId),
    env.DB.prepare("DELETE FROM challenges WHERE device_id = ?").bind(deviceId),
    env.DB.prepare("DELETE FROM usage_sessions WHERE device_id = ?").bind(deviceId)
  ]);
  return response(env, request, { ok: true, status: paused ? "paused" : "approved", paused: Boolean(paused) });
}

async function revokeDevice(env, request, deviceId) {
  const row = await env.DB.prepare("SELECT id FROM devices WHERE id = ?").bind(deviceId).first();
  if (!row) return bad(env, request, "Dispositivo no encontrado", 404);
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE devices SET status = 'revoked', paused = 0, updated_at = ? WHERE id = ?").bind(now, deviceId),
    env.DB.prepare("DELETE FROM challenges WHERE device_id = ?").bind(deviceId),
    env.DB.prepare("DELETE FROM usage_sessions WHERE device_id = ?").bind(deviceId)
  ]);
  return response(env, request, { ok: true, status: "revoked" });
}


const EMULATOR_MESSAGE_TITLES = {
  work: "MENSAJE DE TRABAJO",
  update: "MENSAJE DE ACTUALIZACIÓN",
  announcement: "MENSAJE DE COMUNICADO"
};

async function ensureEmulatorToolsSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS emulator_messages (
      kind TEXT PRIMARY KEY,
      title TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      body TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS emulator_reports (
      id TEXT PRIMARY KEY,
      message TEXT NOT NULL,
      image_data TEXT,
      media_type TEXT,
      page_url TEXT,
      user_agent TEXT,
      game TEXT,
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS emulator_clients (
      client_id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      chat_deleted_at TEXT
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS emulator_report_clients (
      report_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS emulator_chat_messages (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      sender TEXT NOT NULL CHECK(sender IN ('user','admin')),
      body TEXT NOT NULL,
      media_data TEXT,
      media_type TEXT,
      created_at TEXT NOT NULL,
      read_user INTEGER NOT NULL DEFAULT 0,
      read_admin INTEGER NOT NULL DEFAULT 0
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_emulator_reports_created ON emulator_reports(created_at DESC)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_emulator_report_clients_client ON emulator_report_clients(client_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_emulator_chat_client_created ON emulator_chat_messages(client_id, created_at)")
  ]);
  const messageColumns = await env.DB.prepare("PRAGMA table_info(emulator_messages)").all();
  const messageNames = new Set((messageColumns.results || []).map((row) => row.name));
  if (!messageNames.has("title")) {
    await env.DB.prepare("ALTER TABLE emulator_messages ADD COLUMN title TEXT").run();
  }

  const clientColumns = await env.DB.prepare("PRAGMA table_info(emulator_clients)").all();
  const clientNames = new Set((clientColumns.results || []).map((row) => row.name));
  if (!clientNames.has("chat_deleted_at")) {
    await env.DB.prepare("ALTER TABLE emulator_clients ADD COLUMN chat_deleted_at TEXT").run();
  }

  const reportColumns = await env.DB.prepare("PRAGMA table_info(emulator_reports)").all();
  const reportNames = new Set((reportColumns.results || []).map((row) => row.name));
  if (!reportNames.has("media_type")) {
    await env.DB.prepare("ALTER TABLE emulator_reports ADD COLUMN media_type TEXT").run();
  }

  const chatColumns = await env.DB.prepare("PRAGMA table_info(emulator_chat_messages)").all();
  const chatNames = new Set((chatColumns.results || []).map((row) => row.name));
  if (!chatNames.has("media_data")) {
    await env.DB.prepare("ALTER TABLE emulator_chat_messages ADD COLUMN media_data TEXT").run();
  }
  if (!chatNames.has("media_type")) {
    await env.DB.prepare("ALTER TABLE emulator_chat_messages ADD COLUMN media_type TEXT").run();
  }

  const now = nowIso();
  await env.DB.batch(Object.keys(EMULATOR_MESSAGE_TITLES).map((kind) =>
    env.DB.prepare("INSERT OR IGNORE INTO emulator_messages (kind, enabled, body, updated_at) VALUES (?, 0, '', ?)")
      .bind(kind, now)
  ));
}

function normalizeMessageKind(kind) {
  return Object.prototype.hasOwnProperty.call(EMULATOR_MESSAGE_TITLES, kind) ? kind : null;
}

async function listEmulatorMessages(env, request) {
  await ensureEmulatorToolsSchema(env);
  const result = await env.DB.prepare(
    "SELECT kind, title, enabled, body, updated_at AS updatedAt FROM emulator_messages"
  ).all();
  const rows = new Map((result.results || []).map((row) => [row.kind, row]));
  const messages = Object.keys(EMULATOR_MESSAGE_TITLES).map((kind) => {
    const row = rows.get(kind) || {};
    return {
      kind,
      title: cleanText(row.title, 120) || EMULATOR_MESSAGE_TITLES[kind],
      enabled: Number(row.enabled || 0) !== 0,
      body: row.body || "",
      updatedAt: row.updatedAt || null
    };
  });
  return response(env, request, { messages });
}

async function updateEmulatorMessage(env, request, kindValue) {
  await ensureEmulatorToolsSchema(env);
  const kind = normalizeMessageKind(kindValue);
  if (!kind) return bad(env, request, "Tipo de mensaje no válido", 404);
  const body = await bodyJson(request);
  const enabled = Boolean(body.enabled);
  const title = cleanText(body.title, 120) || EMULATOR_MESSAGE_TITLES[kind];
  const message = cleanText(body.body, 6000);
  const now = nowIso();
  await env.DB.prepare(
    "INSERT INTO emulator_messages (kind, title, enabled, body, updated_at) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT(kind) DO UPDATE SET title = excluded.title, enabled = excluded.enabled, body = excluded.body, updated_at = excluded.updated_at"
  ).bind(kind, title, enabled ? 1 : 0, message, now).run();
  return response(env, request, {
    ok: true,
    message: { kind, title, enabled, body: message, updatedAt: now }
  });
}

function emulatorMedia(body) {
  const raw = body.mediaData == null
    ? (body.imageData == null ? "" : String(body.imageData))
    : String(body.mediaData);
  if (!raw) return { data: null, type: "" };
  if (raw.length > MAX_EMULATOR_MEDIA_DATA) {
    return { error: "El archivo adjunto es demasiado grande" };
  }
  const match = raw.match(/^data:(image\/(?:jpeg|png|webp|gif)|video\/(?:mp4|webm|quicktime));base64,/i);
  if (!match) return { error: "Formato de archivo no válido" };
  return {
    data: raw,
    type: match[1].toLowerCase()
  };
}

async function verifyEmulatorClient(env, clientIdValue, tokenValue, createIfMissing = false) {
  const clientId = cleanText(clientIdValue, 120);
  const token = cleanText(tokenValue, 240);
  if (!clientId || !token) return { ok: false, clientId: "", status: 400, error: "Identidad de chat no válida" };
  const row = await env.DB.prepare(
    "SELECT access_token AS accessToken FROM emulator_clients WHERE client_id = ?"
  ).bind(clientId).first();
  const now = nowIso();
  if (!row) {
    if (!createIfMissing) return { ok: false, clientId, status: 403, error: "Chat no autorizado" };
    await env.DB.prepare(
      "INSERT INTO emulator_clients (client_id, access_token, created_at, updated_at) VALUES (?, ?, ?, ?)"
    ).bind(clientId, token, now, now).run();
    return { ok: true, clientId };
  }
  if (String(row.accessToken || "") !== token) {
    return { ok: false, clientId, status: 403, error: "Chat no autorizado" };
  }
  await env.DB.prepare("UPDATE emulator_clients SET updated_at = ? WHERE client_id = ?")
    .bind(now, clientId).run();
  return { ok: true, clientId };
}

async function submitEmulatorReport(env, request) {
  await ensureEmulatorToolsSchema(env);
  const body = await bodyJson(request);
  const message = cleanText(body.message, 4000);
  const media = emulatorMedia(body);
  if (media.error) return bad(env, request, media.error, 413);
  if (!message && !media.data) return bad(env, request, "El reporte necesita un mensaje o archivo");

  const client = await verifyEmulatorClient(env, body.clientId, body.clientToken, true);
  if (!client.ok) return bad(env, request, client.error, client.status);

  const id = crypto.randomUUID();
  const now = nowIso();
  const pageUrl = cleanText(body.pageUrl, 1500);
  const userAgent = cleanText(body.userAgent, 500);
  const game = cleanText(body.game, 240);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO emulator_reports
      (id, message, image_data, media_type, page_url, user_agent, game, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, message, media.data, media.type || null, pageUrl, userAgent, game, now),
    env.DB.prepare("INSERT INTO emulator_report_clients (report_id, client_id) VALUES (?, ?)")
      .bind(id, client.clientId)
  ]);
  return response(env, request, { ok: true, id, clientId: client.clientId, createdAt: now });
}

async function listEmulatorReports(env, request) {
  await ensureEmulatorToolsSchema(env);
  const result = await env.DB.prepare(`SELECT r.id, r.message, r.image_data AS mediaData,
      COALESCE(r.media_type, '') AS mediaType, r.page_url AS pageUrl,
      r.user_agent AS userAgent, r.game, r.created_at AS createdAt,
      COALESCE(rc.client_id, '') AS clientId
      FROM emulator_reports r
      LEFT JOIN emulator_report_clients rc ON rc.report_id = r.id
      ORDER BY r.created_at DESC LIMIT 80`).all();
  return response(env, request, { reports: result.results || [] });
}

async function deleteEmulatorReport(env, request, reportIdValue) {
  await ensureEmulatorToolsSchema(env);
  const reportId = cleanText(reportIdValue, 120);
  if (!reportId) return bad(env, request, "Reporte no válido", 404);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM emulator_report_clients WHERE report_id = ?").bind(reportId),
    env.DB.prepare("DELETE FROM emulator_reports WHERE id = ?").bind(reportId)
  ]);
  return response(env, request, { ok: true, id: reportId });
}

async function publicChatStatus(env, request) {
  await ensureEmulatorToolsSchema(env);
  const body = await bodyJson(request);
  const client = await verifyEmulatorClient(env, body.clientId, body.clientToken, false);
  if (!client.ok) return bad(env, request, client.error, client.status);
  const unread = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM emulator_chat_messages WHERE client_id = ? AND sender = 'admin' AND read_user = 0"
  ).bind(client.clientId).first();
  const last = await env.DB.prepare(
    "SELECT body, sender, created_at AS createdAt FROM emulator_chat_messages WHERE client_id = ? ORDER BY created_at DESC LIMIT 1"
  ).bind(client.clientId).first();
  const latestAdmin = await env.DB.prepare(
    "SELECT id, created_at AS createdAt FROM emulator_chat_messages WHERE client_id = ? AND sender = 'admin' ORDER BY created_at DESC LIMIT 1"
  ).bind(client.clientId).first();
  return response(env, request, {
    clientId: client.clientId,
    unreadCount: Number(unread?.count || 0),
    lastMessage: last?.body || "",
    lastSender: last?.sender || "",
    lastAt: last?.createdAt || null,
    latestAdminId: latestAdmin?.id || "",
    latestAdminAt: latestAdmin?.createdAt || null
  });
}

async function publicChatHistory(env, request) {
  await ensureEmulatorToolsSchema(env);
  const body = await bodyJson(request);
  const client = await verifyEmulatorClient(env, body.clientId, body.clientToken, false);
  if (!client.ok) return bad(env, request, client.error, client.status);
  const result = await env.DB.prepare(
    "SELECT id, sender, body, media_data AS mediaData, COALESCE(media_type, '') AS mediaType, created_at AS createdAt FROM emulator_chat_messages WHERE client_id = ? ORDER BY created_at ASC LIMIT 200"
  ).bind(client.clientId).all();
  await env.DB.prepare(
    "UPDATE emulator_chat_messages SET read_user = 1 WHERE client_id = ? AND sender = 'admin'"
  ).bind(client.clientId).run();
  return response(env, request, { clientId: client.clientId, messages: result.results || [] });
}

async function publicChatSend(env, request) {
  await ensureEmulatorToolsSchema(env);
  const body = await bodyJson(request);
  const client = await verifyEmulatorClient(env, body.clientId, body.clientToken, false);
  if (!client.ok) return bad(env, request, client.error, client.status);
  const message = cleanText(body.message, 3000);
  const media = emulatorMedia(body);
  if (media.error) return bad(env, request, media.error, 413);
  if (!message && !media.data) return bad(env, request, "Escribe un mensaje o adjunta un archivo");
  const id = crypto.randomUUID();
  const now = nowIso();
  await env.DB.prepare(`INSERT INTO emulator_chat_messages
    (id, client_id, sender, body, media_data, media_type, created_at, read_user, read_admin)
    VALUES (?, ?, 'user', ?, ?, ?, ?, 1, 0)`)
    .bind(id, client.clientId, message, media.data, media.type || null, now).run();
  return response(env, request, {
    ok: true,
    message: { id, sender: "user", body: message, mediaData: media.data, mediaType: media.type, createdAt: now }
  });
}

async function publicChatRead(env, request) {
  await ensureEmulatorToolsSchema(env);
  const body = await bodyJson(request);
  const client = await verifyEmulatorClient(env, body.clientId, body.clientToken, false);
  if (!client.ok) return bad(env, request, client.error, client.status);
  await env.DB.prepare(
    "UPDATE emulator_chat_messages SET read_user = 1 WHERE client_id = ? AND sender = 'admin'"
  ).bind(client.clientId).run();
  return response(env, request, { ok: true });
}

async function listAdminChats(env, request) {
  await ensureEmulatorToolsSchema(env);
  const result = await env.DB.prepare(`SELECT
      c.client_id AS clientId,
      (SELECT COUNT(*) FROM emulator_chat_messages m
        WHERE m.client_id = c.client_id AND m.sender = 'user' AND m.read_admin = 0) AS unreadCount,
      COALESCE((SELECT m.body FROM emulator_chat_messages m
        WHERE m.client_id = c.client_id ORDER BY m.created_at DESC LIMIT 1), '') AS lastMessage,
      (SELECT m.created_at FROM emulator_chat_messages m
        WHERE m.client_id = c.client_id ORDER BY m.created_at DESC LIMIT 1) AS lastAt,
      COALESCE((SELECT r.message FROM emulator_reports r
        JOIN emulator_report_clients rc ON rc.report_id = r.id
        WHERE rc.client_id = c.client_id
          AND (c.chat_deleted_at IS NULL OR r.created_at > c.chat_deleted_at)
        ORDER BY r.created_at DESC LIMIT 1), '') AS reportPreview,
      (SELECT COUNT(*) FROM emulator_reports r
        JOIN emulator_report_clients rc ON rc.report_id = r.id
        WHERE rc.client_id = c.client_id
          AND (c.chat_deleted_at IS NULL OR r.created_at > c.chat_deleted_at)) AS reportCount
    FROM emulator_clients c
    WHERE EXISTS (SELECT 1 FROM emulator_chat_messages m WHERE m.client_id = c.client_id)
       OR EXISTS (
         SELECT 1 FROM emulator_reports r
         JOIN emulator_report_clients rc ON rc.report_id = r.id
         WHERE rc.client_id = c.client_id
           AND (c.chat_deleted_at IS NULL OR r.created_at > c.chat_deleted_at)
       )
    ORDER BY COALESCE(lastAt, c.updated_at) DESC
    LIMIT 100`).all();
  return response(env, request, { chats: result.results || [] });
}

async function adminChatHistory(env, request, clientIdValue) {
  await ensureEmulatorToolsSchema(env);
  const clientId = cleanText(clientIdValue, 120);
  const client = await env.DB.prepare("SELECT client_id FROM emulator_clients WHERE client_id = ?").bind(clientId).first();
  if (!client) return bad(env, request, "Chat no encontrado", 404);
  const result = await env.DB.prepare(
    "SELECT id, sender, body, media_data AS mediaData, COALESCE(media_type, '') AS mediaType, created_at AS createdAt FROM emulator_chat_messages WHERE client_id = ? ORDER BY created_at ASC LIMIT 200"
  ).bind(clientId).all();
  await env.DB.prepare(
    "UPDATE emulator_chat_messages SET read_admin = 1 WHERE client_id = ? AND sender = 'user'"
  ).bind(clientId).run();
  return response(env, request, { clientId, messages: result.results || [] });
}

async function adminDeleteChat(env, request, clientIdValue) {
  await ensureEmulatorToolsSchema(env);
  const clientId = cleanText(clientIdValue, 120);
  const client = await env.DB.prepare("SELECT client_id FROM emulator_clients WHERE client_id = ?").bind(clientId).first();
  if (!client) return bad(env, request, "Chat no encontrado", 404);
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM emulator_chat_messages WHERE client_id = ?").bind(clientId),
    env.DB.prepare("UPDATE emulator_clients SET chat_deleted_at = ?, updated_at = ? WHERE client_id = ?").bind(now, now, clientId)
  ]);
  return response(env, request, { ok: true, clientId, deletedAt: now });
}

async function adminChatSend(env, request, clientIdValue) {
  await ensureEmulatorToolsSchema(env);
  const clientId = cleanText(clientIdValue, 120);
  const client = await env.DB.prepare("SELECT client_id FROM emulator_clients WHERE client_id = ?").bind(clientId).first();
  if (!client) return bad(env, request, "Chat no encontrado", 404);
  const body = await bodyJson(request);
  const message = cleanText(body.message, 3000);
  const media = emulatorMedia(body);
  if (media.error) return bad(env, request, media.error, 413);
  if (!message && !media.data) return bad(env, request, "Escribe un mensaje o adjunta un archivo");
  const id = crypto.randomUUID();
  const now = nowIso();
  await env.DB.prepare(`INSERT INTO emulator_chat_messages
    (id, client_id, sender, body, media_data, media_type, created_at, read_user, read_admin)
    VALUES (?, ?, 'admin', ?, ?, ?, ?, 0, 1)`)
    .bind(id, clientId, message, media.data, media.type || null, now).run();
  return response(env, request, {
    ok: true,
    message: { id, sender: "admin", body: message, mediaData: media.data, mediaType: media.type, createdAt: now }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env, request) });
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/v1/health") return response(env, request, { ok: true, service: "ml3d-dev-access", apiVersion: 3 });
      if (request.method === "POST" && url.pathname === "/v1/access/request") return requestAccess(env, request);
      if (request.method === "POST" && url.pathname === "/v1/access/challenge") return challenge(env, request);
      if (request.method === "POST" && url.pathname === "/v1/access/verify") return verify(env, request);
      if (request.method === "POST" && url.pathname === "/v1/access/request-more-uses") return requestMoreUses(env, request);
      if (request.method === "POST" && url.pathname === "/v1/access/heartbeat") return heartbeat(env, request);
      if (request.method === "GET" && url.pathname === "/v1/emulator/messages") return listEmulatorMessages(env, request);
      if (request.method === "POST" && url.pathname === "/v1/emulator/reports") return submitEmulatorReport(env, request);
      if (request.method === "POST" && url.pathname === "/v1/emulator/chat/status") return publicChatStatus(env, request);
      if (request.method === "POST" && url.pathname === "/v1/emulator/chat/history") return publicChatHistory(env, request);
      if (request.method === "POST" && url.pathname === "/v1/emulator/chat/messages") return publicChatSend(env, request);
      if (request.method === "POST" && url.pathname === "/v1/emulator/chat/read") return publicChatRead(env, request);

      if (url.pathname.startsWith("/v1/admin/")) {
        if (!adminAuthorized(env, request)) return bad(env, request, "No autorizado", 401);
        if (request.method === "GET" && url.pathname === "/v1/admin/requests") return listRequests(env, request);
        if (request.method === "GET" && url.pathname === "/v1/admin/use-requests") return listUseRequests(env, request);
        if (request.method === "GET" && url.pathname === "/v1/admin/devices") return listDevices(env, request);
        if (request.method === "GET" && url.pathname === "/v1/admin/emulator/messages") return listEmulatorMessages(env, request);
        if (request.method === "GET" && url.pathname === "/v1/admin/emulator/reports") return listEmulatorReports(env, request);
        if (request.method === "GET" && url.pathname === "/v1/admin/emulator/chats") return listAdminChats(env, request);
        if (request.method === "GET" && url.pathname === "/v1/admin/games") return listManagedGames(env, request);
        if (request.method === "POST" && url.pathname === "/v1/admin/games") return addManagedGame(env, request);

        const gameUpdateMatch = url.pathname.match(/^\/v1\/admin\/games\/([^/]+)\/update$/);
        if (request.method === "POST" && gameUpdateMatch) return updateManagedGame(env, request, gameUpdateMatch[1]);
        const gameSuspendMatch = url.pathname.match(/^\/v1\/admin\/games\/([^/]+)\/suspend$/);
        if (request.method === "POST" && gameSuspendMatch) return suspendManagedGame(env, request, gameSuspendMatch[1]);
        const gameDeleteMatch = url.pathname.match(/^\/v1\/admin\/games\/([^/]+)$/);
        if (request.method === "DELETE" && gameDeleteMatch) return deleteManagedGame(env, request, gameDeleteMatch[1]);

        const messageMatch = url.pathname.match(/^\/v1\/admin\/emulator\/messages\/([^/]+)$/);
        if (request.method === "POST" && messageMatch) return updateEmulatorMessage(env, request, messageMatch[1]);

        const reportMatch = url.pathname.match(/^\/v1\/admin\/emulator\/reports\/([^/]+)$/);
        if (request.method === "DELETE" && reportMatch) return deleteEmulatorReport(env, request, reportMatch[1]);

        const chatMatch = url.pathname.match(/^\/v1\/admin\/emulator\/chats\/([^/]+)$/);
        if (request.method === "GET" && chatMatch) return adminChatHistory(env, request, chatMatch[1]);
        if (request.method === "DELETE" && chatMatch) return adminDeleteChat(env, request, chatMatch[1]);
        const chatMessageMatch = url.pathname.match(/^\/v1\/admin\/emulator\/chats\/([^/]+)\/messages$/);
        if (request.method === "POST" && chatMessageMatch) return adminChatSend(env, request, chatMessageMatch[1]);

        const requestMatch = url.pathname.match(/^\/v1\/admin\/requests\/([^/]+)\/(approve|reject)$/);
        if (request.method === "POST" && requestMatch) return decideRequest(env, request, requestMatch[1], requestMatch[2]);
        const useMatch = url.pathname.match(/^\/v1\/admin\/use-requests\/([^/]+)\/(approve|reject)$/);
        if (request.method === "POST" && useMatch) return decideUseRequest(env, request, useMatch[1], useMatch[2]);
        const policyMatch = url.pathname.match(/^\/v1\/admin\/devices\/([^/]+)\/policy$/);
        if (request.method === "POST" && policyMatch) return updatePolicy(env, request, policyMatch[1]);
        const resetMatch = url.pathname.match(/^\/v1\/admin\/devices\/([^/]+)\/reset-uses$/);
        if (request.method === "POST" && resetMatch) return resetUses(env, request, resetMatch[1]);
        const pauseMatch = url.pathname.match(/^\/v1\/admin\/devices\/([^/]+)\/(pause|resume)$/);
        if (request.method === "POST" && pauseMatch) return setDevicePaused(env, request, pauseMatch[1], pauseMatch[2] === "pause");
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
