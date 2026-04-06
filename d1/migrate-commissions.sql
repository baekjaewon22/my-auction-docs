-- 수수료 관리 테이블
CREATE TABLE IF NOT EXISTS commissions (
  id TEXT PRIMARY KEY,
  journal_entry_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL DEFAULT '',
  client_name TEXT NOT NULL DEFAULT '',
  case_no TEXT NOT NULL DEFAULT '',
  win_price TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  completed_by TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
