-- Tracks completed refund recovery payroll settlements.
-- Applying this file is additive and does not change existing sales/payroll rows.
CREATE TABLE IF NOT EXISTS refund_recovery_resolutions (
  sales_record_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  payroll_month TEXT NOT NULL,
  recovery_amount INTEGER NOT NULL DEFAULT 0,
  resolved_by TEXT NOT NULL,
  resolved_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  FOREIGN KEY (sales_record_id) REFERENCES sales_records(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_refund_recovery_resolutions_user_month
ON refund_recovery_resolutions(user_id, payroll_month);
