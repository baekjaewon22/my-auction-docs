-- 회계장부: 직원별 급여/직급 관리
CREATE TABLE IF NOT EXISTS user_accounting (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  salary INTEGER NOT NULL DEFAULT 0,
  standard_sales INTEGER NOT NULL DEFAULT 0,
  grade TEXT NOT NULL DEFAULT '' CHECK (grade IN ('', 'M1', 'M2', 'M3', 'M4')),
  position_allowance INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 2개월 단위 매출 평가 기록
-- period_start/period_end: 평가 구간 (예: 2026-03-01 ~ 2026-04-30)
-- total_sales: 해당 기간 실제 매출 합계 (commissions 기반)
-- met_target: 기준매출 달성 여부 (0/1)
CREATE TABLE IF NOT EXISTS sales_evaluations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  standard_sales INTEGER NOT NULL DEFAULT 0,
  total_sales INTEGER NOT NULL DEFAULT 0,
  met_target INTEGER NOT NULL DEFAULT 0,
  consecutive_misses INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_user_accounting_user ON user_accounting(user_id);
CREATE INDEX IF NOT EXISTS idx_sales_evaluations_user ON sales_evaluations(user_id);
CREATE INDEX IF NOT EXISTS idx_sales_evaluations_period ON sales_evaluations(period_start, period_end);
