-- One-time correction before the feature deployment.
CREATE TABLE refund_recovery_resolutions_fk_fixed (
  sales_record_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  payroll_month TEXT NOT NULL,
  recovery_amount INTEGER NOT NULL DEFAULT 0,
  resolved_by TEXT NOT NULL,
  resolved_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  FOREIGN KEY (sales_record_id) REFERENCES sales_records(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Copy first so an unexpected concurrent row is preserved safely.
INSERT INTO refund_recovery_resolutions_fk_fixed
SELECT * FROM refund_recovery_resolutions;

DROP TABLE refund_recovery_resolutions;
ALTER TABLE refund_recovery_resolutions_fk_fixed RENAME TO refund_recovery_resolutions;

CREATE INDEX idx_refund_recovery_resolutions_user_month
ON refund_recovery_resolutions(user_id, payroll_month);
