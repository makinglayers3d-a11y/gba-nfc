CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  public_key_jwk TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','revoked')),
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT
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

CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(device_id) REFERENCES devices(id)
);

CREATE INDEX IF NOT EXISTS idx_challenges_expires
  ON challenges(expires_at);
