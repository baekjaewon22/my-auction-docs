-- 외근보고서 ↔ 일지 entry 연결 시스템
-- 목적: 본문 텍스트 regex 매칭 → 정형 link 테이블 기반으로 전환
-- Cutoff: 2026-05-01 (이 날짜부터 link 강제, 이전 데이터는 backfill 대상)

-- 1. 메인 link 테이블 (외근보고서 ↔ 일지 entry, entry 1:1)
CREATE TABLE IF NOT EXISTS document_journal_links (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  journal_entry_id TEXT NOT NULL,
  link_type TEXT NOT NULL DEFAULT 'outdoor',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL DEFAULT 'manual',
  UNIQUE(journal_entry_id, link_type),
  UNIQUE(document_id, journal_entry_id),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_djl_doc ON document_journal_links(document_id);
CREATE INDEX IF NOT EXISTS idx_djl_entry ON document_journal_links(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_djl_type ON document_journal_links(link_type);

-- 2. Backfill 검수 큐 (Tier 3/4 모호한 케이스)
CREATE TABLE IF NOT EXISTS document_journal_link_candidates (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  candidate_journal_entry_ids TEXT NOT NULL,
  match_tier INTEGER NOT NULL,
  document_outing_date_text TEXT,
  document_outing_date_parsed TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_link_id TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_djlc_status ON document_journal_link_candidates(status);
CREATE INDEX IF NOT EXISTS idx_djlc_doc ON document_journal_link_candidates(document_id);

-- 3. Backfill 실행 로그 (감사·롤백)
CREATE TABLE IF NOT EXISTS document_journal_link_backfill_log (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  document_id TEXT,
  journal_entry_id TEXT,
  action TEXT NOT NULL,
  reason TEXT,
  match_tier INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_djlbl_run ON document_journal_link_backfill_log(run_id);
CREATE INDEX IF NOT EXISTS idx_djlbl_action ON document_journal_link_backfill_log(action);
