-- 급여정산 저장 테이블
CREATE TABLE IF NOT EXISTS payroll_saves (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  period TEXT NOT NULL,
  pay_type TEXT NOT NULL DEFAULT 'salary',
  data TEXT NOT NULL DEFAULT '{}',
  locked INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, period)
);
