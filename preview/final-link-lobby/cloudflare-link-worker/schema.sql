CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  game TEXT NOT NULL DEFAULT '',
  host_token_hash TEXT NOT NULL,
  password_salt TEXT,
  password_hash TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  max_players INTEGER NOT NULL DEFAULT 2,
  lat_q REAL NOT NULL,
  lon_q REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS room_joins (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  join_token_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT 'Jugador',
  status TEXT NOT NULL DEFAULT 'requested',
  offer TEXT,
  answer TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rooms_expiry ON rooms(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_rooms_geo ON rooms(lat_q, lon_q);
CREATE INDEX IF NOT EXISTS idx_joins_room ON room_joins(room_id, status, expires_at);
