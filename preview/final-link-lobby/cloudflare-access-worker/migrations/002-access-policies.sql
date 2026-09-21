-- Ejecutar una sola vez sobre la D1 existente antes de desplegar el Worker API v2.
ALTER TABLE devices ADD COLUMN game_mode TEXT NOT NULL DEFAULT 'all';
ALTER TABLE devices ADD COLUMN allowed_games TEXT NOT NULL DEFAULT '[]';
ALTER TABLE devices ADD COLUMN allow_local_roms INTEGER NOT NULL DEFAULT 1;
ALTER TABLE devices ADD COLUMN allow_sp_skins INTEGER NOT NULL DEFAULT 1;
ALTER TABLE devices ADD COLUMN usage_limit INTEGER;
ALTER TABLE devices ADD COLUMN usage_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN usage_reset_at TEXT;
ALTER TABLE devices ADD COLUMN policy_updated_at TEXT;

CREATE TABLE IF NOT EXISTS use_requests (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  cart_context TEXT,
  current_limit INTEGER,
  current_used INTEGER NOT NULL DEFAULT 0,
  granted_uses INTEGER,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  FOREIGN KEY(device_id) REFERENCES devices(id)
);
CREATE INDEX IF NOT EXISTS idx_use_requests_status_created
  ON use_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_use_requests_device
  ON use_requests(device_id, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_sessions (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(device_id) REFERENCES devices(id)
);
CREATE INDEX IF NOT EXISTS idx_usage_sessions_device
  ON usage_sessions(device_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_sessions_expires
  ON usage_sessions(expires_at);
