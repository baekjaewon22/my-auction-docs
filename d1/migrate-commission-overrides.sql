-- 월별 수수료율 예외 관리 (특정 유저의 특정 월에 다른 비율 적용)
CREATE TABLE IF NOT EXISTS commission_rate_overrides (
  user_id TEXT NOT NULL,
  year_month TEXT NOT NULL,
  commission_rate REAL NOT NULL,
  memo TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, year_month),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_comm_override_month ON commission_rate_overrides(year_month);
