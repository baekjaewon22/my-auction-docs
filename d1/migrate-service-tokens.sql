-- Service tokens for All For One API integration.
-- Raw tokens are never stored; only SHA-256 hashes are persisted.

CREATE TABLE IF NOT EXISTS service_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('read', 'write', 'admin')),
  token_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT,
  last_used_ip TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_service_tokens_hash ON service_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_service_tokens_scope ON service_tokens(scope);
CREATE INDEX IF NOT EXISTS idx_service_tokens_revoked ON service_tokens(revoked_at);
CREATE INDEX IF NOT EXISTS idx_service_tokens_created ON service_tokens(created_at);
