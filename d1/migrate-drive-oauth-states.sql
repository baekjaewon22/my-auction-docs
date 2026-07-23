CREATE TABLE IF NOT EXISTS drive_oauth_states (
  nonce TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_drive_oauth_states_expiry ON drive_oauth_states(expires_at);
