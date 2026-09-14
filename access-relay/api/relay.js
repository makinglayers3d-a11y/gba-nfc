const DEFAULT_UPSTREAM = "https://ml3d-dev-access.makinglayers3d.workers.dev";
const DEFAULT_ALLOWED_ORIGIN = "https://makinglayers3d-a11y.github.io";

function normalizeBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function applyCors(req, res) {
  const allowedOrigin = normalizeBase(process.env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN);
  const origin = String(req.headers.origin || "");

  if (origin && origin === allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "600");
}

function safePath(value) {
  const path = String(value || "").replace(/^\/+/, "");
  if (!path || path.includes("..") || path.includes("\\")) return null;
  if (!/^[A-Za-z0-9._~!$&'()*+,;=:@%\/-]+$/.test(path)) return null;
  return path;
}

function buildQuery(req) {
  const params = new URLSearchParams();

  for (const [key, rawValue] of Object.entries(req.query || {})) {
    if (key === "path") continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (value !== undefined && value !== null) params.append(key, String(value));
    }
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

function requestBody(req) {
  if (req.body === undefined || req.body === null || req.body === "") return undefined;
  if (typeof req.body === "string" || Buffer.isBuffer(req.body)) return req.body;
  return JSON.stringify(req.body);
}

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    res.status(405).json({ error: "Método no permitido" });
    return;
  }

  const path = safePath(req.query?.path);
  if (!path) {
    res.status(400).json({ error: "Ruta de API no válida" });
    return;
  }

  const upstreamBase = normalizeBase(process.env.UPSTREAM_BASE || DEFAULT_UPSTREAM);
  if (!upstreamBase.startsWith("https://")) {
    res.status(500).json({ error: "Relay mal configurado" });
    return;
  }

  const upstreamUrl = `${upstreamBase}/v1/${path}${buildQuery(req)}`;
  const headers = {
    Accept: "application/json"
  };

  if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"];
  if (req.headers.authorization) headers.Authorization = req.headers.authorization;
  if (req.headers.origin) headers.Origin = req.headers.origin;
  if (req.headers["user-agent"]) headers["User-Agent"] = req.headers["user-agent"];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: req.method === "POST" ? requestBody(req) : undefined,
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal
    });

    const text = await upstreamResponse.text();
    const contentType = upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8";

    res.status(upstreamResponse.status);
    res.setHeader("Content-Type", contentType);
    res.setHeader("X-ML3D-Relay", "1");
    res.send(text);
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    res.status(502).json({
      error: timedOut ? "Tiempo de espera agotado al contactar con el servicio de acceso" : "No se pudo contactar con el servicio de acceso"
    });
  } finally {
    clearTimeout(timeout);
  }
}
