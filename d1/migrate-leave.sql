CREATE TABLE IF NOT EXISTS annual_leave (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  total_days REAL NOT NULL DEFAULT 15,
  used_days REAL NOT NULL DEFAULT 0,
  year INTEGER NOT NULL DEFAULT 2026,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_annual_leave_user ON annual_leave(user_id);
