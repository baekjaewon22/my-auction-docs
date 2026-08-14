CREATE TABLE IF NOT EXISTS lawitgo_consultant_mappings (
  user_id TEXT PRIMARY KEY,
  consultant_id TEXT NOT NULL UNIQUE,
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO lawitgo_consultant_mappings (user_id, consultant_id, updated_by)
SELECT id, id, 'system-migration'
FROM users
WHERE approved = 1 AND role != 'resigned';
