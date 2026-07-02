CREATE TABLE IF NOT EXISTS system_holidays (
  id TEXT PRIMARY KEY,
  holiday_date TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  holiday_type TEXT NOT NULL DEFAULT 'legal',
  applies_to TEXT NOT NULL DEFAULT 'all',
  enabled INTEGER NOT NULL DEFAULT 1,
  memo TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_system_holidays_date ON system_holidays(holiday_date);
CREATE INDEX IF NOT EXISTS idx_system_holidays_enabled ON system_holidays(enabled, applies_to);
