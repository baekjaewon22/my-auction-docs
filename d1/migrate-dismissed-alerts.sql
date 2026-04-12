CREATE TABLE IF NOT EXISTS dismissed_alerts (
  id TEXT PRIMARY KEY,
  alert_type TEXT NOT NULL,
  alert_key TEXT NOT NULL UNIQUE,
  dismissed_by TEXT NOT NULL,
  dismissed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
