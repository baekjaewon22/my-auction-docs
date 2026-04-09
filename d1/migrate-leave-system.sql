-- 연차/시간차 시스템 마이그레이션
-- users 테이블에 입사일 추가
ALTER TABLE users ADD COLUMN hire_date TEXT NOT NULL DEFAULT '';

-- annual_leave 테이블 확장 (월차/연차 구분)
ALTER TABLE annual_leave ADD COLUMN leave_type TEXT NOT NULL DEFAULT 'annual' CHECK (leave_type IN ('monthly', 'annual'));
ALTER TABLE annual_leave ADD COLUMN monthly_days REAL NOT NULL DEFAULT 0;
ALTER TABLE annual_leave ADD COLUMN monthly_used REAL NOT NULL DEFAULT 0;

-- 휴가 신청 테이블
CREATE TABLE IF NOT EXISTS leave_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  leave_type TEXT NOT NULL CHECK (leave_type IN ('연차', '월차', '반차', '시간차', '특별휴가')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  hours REAL NOT NULL DEFAULT 8,       -- 시간차일 경우 시간 수
  days REAL NOT NULL DEFAULT 1,        -- 실제 차감일수 (반차=0.5, 시간차=hours/8)
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by TEXT,
  approved_at TEXT,
  reject_reason TEXT,
  branch TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_user ON leave_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_date ON leave_requests(start_date);

-- 연차촉진 알림 테이블
CREATE TABLE IF NOT EXISTS leave_promotion_alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('6month_promotion', 'expiry_warning')),
  alert_date TEXT NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
