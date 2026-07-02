CREATE TABLE IF NOT EXISTS user_pay_type_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  effective_month TEXT NOT NULL,
  pay_type TEXT NOT NULL CHECK (pay_type IN ('salary', 'commission')),
  commission_rate REAL NOT NULL DEFAULT 0,
  salary INTEGER NOT NULL DEFAULT 0,
  standard_sales INTEGER NOT NULL DEFAULT 0,
  grade TEXT NOT NULL DEFAULT '',
  position_allowance INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT '',
  changed_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, effective_month, source)
);

CREATE INDEX IF NOT EXISTS idx_user_pay_type_history_user_month
ON user_pay_type_history(user_id, effective_month);
