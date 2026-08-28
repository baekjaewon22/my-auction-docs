-- 급여정산 이월(carryover): 실지급이 음수인 달의 미회수분을 익월로 이월한다.
CREATE TABLE IF NOT EXISTS payroll_carryovers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  origin_month TEXT NOT NULL,   -- 발생 정산월 (YYYY-MM)
  target_month TEXT NOT NULL,   -- 청구 정산월 = 익월 (YYYY-MM)
  amount INTEGER NOT NULL,      -- 이월(미회수) 금액
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | resolved
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  UNIQUE(user_id, origin_month)
);
CREATE INDEX IF NOT EXISTS idx_payroll_carryovers_target ON payroll_carryovers(user_id, target_month, status);
