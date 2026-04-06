-- 회의록 테이블
CREATE TABLE IF NOT EXISTS meeting_minutes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  file_name TEXT NOT NULL,
  file_data TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);
