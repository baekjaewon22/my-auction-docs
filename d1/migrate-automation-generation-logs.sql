CREATE TABLE IF NOT EXISTS automation_generation_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  output_type TEXT NOT NULL DEFAULT 'auction_report',
  file_name TEXT NOT NULL DEFAULT '',
  success INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  agent_version TEXT NOT NULL DEFAULT '',
  diagnostics_json TEXT NOT NULL DEFAULT '[]',
  issue_count INTEGER NOT NULL DEFAULT 0,
  review_status TEXT NOT NULL DEFAULT 'open',
  review_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, task_id)
);
CREATE INDEX IF NOT EXISTS idx_automation_logs_user_created ON automation_generation_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_logs_review_created ON automation_generation_logs(review_status, created_at DESC);
