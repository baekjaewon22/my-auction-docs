-- 외부 사건 수신 (법률사무소 명승 → my-docs)
-- 매출 시스템과 완전 격리. 급여정산의 명도성과금에만 사용.
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,                     -- 자체 ID (case-xxxxxxxx)
  external_id TEXT NOT NULL UNIQUE,        -- 명승 측 client.id (멱등성 키)
  registered_at TEXT NOT NULL,             -- ISO 8601 (KST)
  consultant_name TEXT,
  consultant_position TEXT,
  manager_username TEXT NOT NULL,          -- 외부 시스템 로그인 ID
  manager_name TEXT NOT NULL,
  manager_user_id TEXT,                    -- 매칭된 우리 시스템 user.id (없으면 NULL)
  manager_branch TEXT,                     -- snapshot
  manager_department TEXT,
  client_name TEXT NOT NULL,               -- 위임인 (PII)
  fee_type TEXT NOT NULL CHECK(fee_type IN ('fixed', 'actual')),
  fee_amount INTEGER NOT NULL,
  bimonthly_period TEXT NOT NULL,          -- '2026-03_04' 등 성과금 구간
  raw_payload TEXT,                        -- 원본 JSON (감사용)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cases_external ON cases(external_id);
CREATE INDEX IF NOT EXISTS idx_cases_registered ON cases(registered_at);
CREATE INDEX IF NOT EXISTS idx_cases_manager_user ON cases(manager_user_id);
CREATE INDEX IF NOT EXISTS idx_cases_period ON cases(bimonthly_period);
CREATE INDEX IF NOT EXISTS idx_cases_manager_username ON cases(manager_username);
