CREATE TABLE IF NOT EXISTS slack_accounting_logs (
  id TEXT PRIMARY KEY,
  run_key TEXT NOT NULL,
  run_label TEXT NOT NULL DEFAULT '',
  group_label TEXT NOT NULL DEFAULT '',
  branches_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  total_count INTEGER NOT NULL DEFAULT 0,
  message_index INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT '',
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_slack_accounting_logs_run
  ON slack_accounting_logs(run_key, status);

CREATE INDEX IF NOT EXISTS idx_slack_accounting_logs_created
  ON slack_accounting_logs(created_at);
