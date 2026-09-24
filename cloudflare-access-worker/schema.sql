CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  public_key_jwk TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','revoked')),
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT,
  game_mode TEXT NOT NULL DEFAULT 'all' CHECK(game_mode IN ('all','base','manual')),
  allowed_games TEXT NOT NULL DEFAULT '[]',
  allow_local_roms INTEGER NOT NULL DEFAULT 1,
  allow_sp_skins INTEGER NOT NULL DEFAULT 1,
  usage_limit INTEGER,
  usage_used INTEGER NOT NULL DEFAULT 0,
  usage_reset_at TEXT,
  policy_updated_at TEXT,
  total_active_seconds INTEGER NOT NULL DEFAULT 0,
  session_count INTEGER NOT NULL DEFAULT 0,
  last_active_at TEXT
);

CREATE TABLE IF NOT EXISTS access_requests (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  requested_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  cart_context TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  FOREIGN KEY(device_id) REFERENCES devices(id)
);

CREATE INDEX IF NOT EXISTS idx_access_requests_status_created
  ON access_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_requests_device
  ON access_requests(device_id, created_at DESC);

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

CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(device_id) REFERENCES devices(id)
);
CREATE INDEX IF NOT EXISTS idx_challenges_expires
  ON challenges(expires_at);

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


CREATE TABLE IF NOT EXISTS emulator_messages (
  kind TEXT PRIMARY KEY CHECK(kind IN ('work','update','announcement')),
  enabled INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS emulator_reports (
  id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  image_data TEXT,
  media_type TEXT,
  page_url TEXT,
  user_agent TEXT,
  game TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_emulator_reports_created
  ON emulator_reports(created_at DESC);


CREATE TABLE IF NOT EXISTS emulator_clients (
  client_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS emulator_report_clients (
  report_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_emulator_report_clients_client
  ON emulator_report_clients(client_id);

CREATE TABLE IF NOT EXISTS emulator_chat_messages (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  sender TEXT NOT NULL CHECK(sender IN ('user','admin')),
  body TEXT NOT NULL,
  media_data TEXT,
  media_type TEXT,
  created_at TEXT NOT NULL,
  read_user INTEGER NOT NULL DEFAULT 0,
  read_admin INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_emulator_chat_client_created
  ON emulator_chat_messages(client_id, created_at);


CREATE TABLE IF NOT EXISTS usage_heartbeats (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  game_key TEXT,
  last_heartbeat_ms INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(device_id) REFERENCES devices(id)
);

CREATE TABLE IF NOT EXISTS device_game_usage (
  device_id TEXT NOT NULL,
  game_key TEXT NOT NULL,
  active_seconds INTEGER NOT NULL DEFAULT 0,
  launches INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  PRIMARY KEY(device_id, game_key),
  FOREIGN KEY(device_id) REFERENCES devices(id)
);

CREATE INDEX IF NOT EXISTS idx_game_usage_device
  ON device_game_usage(device_id, active_seconds DESC);
