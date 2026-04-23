-- 사업소득신고 기능: user_accounting에 ssn/address 추가 + 월별 오버라이드 테이블
ALTER TABLE user_accounting ADD COLUMN ssn TEXT NOT NULL DEFAULT '';
ALTER TABLE user_accounting ADD COLUMN address TEXT NOT NULL DEFAULT '';

-- 월별 사업소득 항목 — 자동 산정값 오버라이드 + 임시추가 인원
CREATE TABLE IF NOT EXISTS business_income_entries (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,              -- 'YYYY-MM'
  user_id TEXT,                     -- NULL = ad-hoc (임시추가)
  name TEXT NOT NULL,
  ssn TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0,
  tax INTEGER NOT NULL DEFAULT 0,
  net_amount INTEGER NOT NULL DEFAULT 0,
  is_ad_hoc INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_bi_month ON business_income_entries(month);
CREATE INDEX IF NOT EXISTS idx_bi_user ON business_income_entries(user_id, month);
