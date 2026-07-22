CREATE TABLE IF NOT EXISTS web_push_setup_reminder_runs (
  id TEXT PRIMARY KEY,
  alert_date TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  recipient_role TEXT NOT NULL,
  scope_label TEXT NOT NULL DEFAULT '',
  missing_count INTEGER NOT NULL DEFAULT 0,
  missing_users_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'no_subscription')),
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  UNIQUE(alert_date, recipient_id),
  FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_web_push_setup_reminder_runs_date
ON web_push_setup_reminder_runs(alert_date, status);
