-- 검증형 알림 영속화 (Phase 1 — 4종)
-- 1. alert_personal_doc_missing      — 개인 신청서 (연차/반차/시간차/병가)
-- 2. alert_bid_field_missing         — 입찰 필드 (작성입찰가/제시입찰가/낙찰가)
-- 3. alert_business_trip_missing    — 출장 신청서/보고서
-- 4. alert_schedule_gap              — 일정 공백
-- 공통 컬럼: status / detected_at / last_checked_at / resolved_at / dismissed_by / dismissed_at / metadata

-- ───────────────────────────────────────────────────────
-- 1. 개인 신청서 미제출
-- ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_personal_doc_missing (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  journal_entry_id TEXT NOT NULL,
  target_date TEXT NOT NULL,
  doc_type TEXT NOT NULL,                          -- '연차' / '반차' / '시간차' / '병가'
  reason_text TEXT,                                 -- 일지 reason 원문 (디버깅)

  status TEXT NOT NULL DEFAULT 'open',              -- open / resolved / dismissed / cancelled
  matched_doc_id TEXT,                               -- 매칭된 신청서 문서 id
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT, dismissed_by TEXT, dismissed_at TEXT, snoozed_until TEXT,
  metadata TEXT,

  UNIQUE(journal_entry_id, doc_type),
  FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_apdm_user_status ON alert_personal_doc_missing(user_id, status);
CREATE INDEX IF NOT EXISTS idx_apdm_date ON alert_personal_doc_missing(target_date);

-- ───────────────────────────────────────────────────────
-- 2. 입찰 필드 미작성
-- ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_bid_field_missing (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  journal_entry_id TEXT NOT NULL UNIQUE,            -- 1 entry = 1 row
  target_date TEXT NOT NULL,
  case_no TEXT,
  missing_fields TEXT NOT NULL,                      -- JSON: ["작성입찰가","제시입찰가","낙찰가"]
  bid_cancelled INTEGER NOT NULL DEFAULT 0,
  bid_won INTEGER NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'open',
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT, dismissed_by TEXT, dismissed_at TEXT, snoozed_until TEXT,
  metadata TEXT,

  FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_abfm_user_status ON alert_bid_field_missing(user_id, status);
CREATE INDEX IF NOT EXISTS idx_abfm_date ON alert_bid_field_missing(target_date);

-- ───────────────────────────────────────────────────────
-- 3. 출장 신청서/보고서 미제출
-- ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_business_trip_missing (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  journal_entry_id TEXT NOT NULL,
  target_date TEXT NOT NULL,
  doc_type TEXT NOT NULL,                            -- '신청서' / '보고서'

  status TEXT NOT NULL DEFAULT 'open',
  matched_doc_id TEXT,
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT, dismissed_by TEXT, dismissed_at TEXT, snoozed_until TEXT,
  metadata TEXT,

  UNIQUE(journal_entry_id, doc_type),
  FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_abtm_user_status ON alert_business_trip_missing(user_id, status);
CREATE INDEX IF NOT EXISTS idx_abtm_date ON alert_business_trip_missing(target_date);

-- ───────────────────────────────────────────────────────
-- 4. 일정 공백
-- ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_schedule_gap (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  target_date TEXT NOT NULL,
  gap_count INTEGER NOT NULL,
  gap_details TEXT NOT NULL,                         -- JSON: [{from:"09:00",to:"11:00"},...]
  total_gap_minutes INTEGER NOT NULL,

  status TEXT NOT NULL DEFAULT 'open',
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT, dismissed_by TEXT, dismissed_at TEXT, snoozed_until TEXT,
  metadata TEXT,

  UNIQUE(user_id, target_date)
);
CREATE INDEX IF NOT EXISTS idx_asg_user_status ON alert_schedule_gap(user_id, status);
CREATE INDEX IF NOT EXISTS idx_asg_date ON alert_schedule_gap(target_date);
