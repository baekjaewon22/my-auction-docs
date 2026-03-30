CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  target_date TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  activity_subtype TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  completed INTEGER NOT NULL DEFAULT 0,
  fail_reason TEXT DEFAULT '',
  branch TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_journal_user ON journal_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries(target_date);
CREATE INDEX IF NOT EXISTS idx_journal_branch ON journal_entries(branch);
