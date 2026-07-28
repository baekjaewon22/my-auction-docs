CREATE TABLE IF NOT EXISTS user_employment_type_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  from_login_type TEXT NOT NULL CHECK (from_login_type IN ('employee', 'freelancer')),
  to_login_type TEXT NOT NULL CHECK (to_login_type IN ('employee', 'freelancer')),
  effective_month TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  impact_snapshot TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_employment_type_history_user
ON user_employment_type_history(user_id, created_at DESC);
