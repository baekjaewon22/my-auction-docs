CREATE TABLE IF NOT EXISTS codex_conversations (
  id TEXT PRIMARY KEY,
  source_session_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'codex',
  working_directory TEXT NOT NULL DEFAULT '',
  client_version TEXT NOT NULL DEFAULT '',
  transcript_json TEXT NOT NULL DEFAULT '[]',
  message_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  last_message_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_codex_conversations_updated
  ON codex_conversations(last_message_at DESC);

CREATE TABLE IF NOT EXISTS codex_sync_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
