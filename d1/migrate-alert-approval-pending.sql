-- 승인 대기 영속 알림 테이블
-- 목적: 대시보드 N+1 제거 후 추가 최적화 + 알림 dismiss/감사/알림톡 발송 트리거 활용
-- - cycle_no: 반려 재제출 시 +1 (이력 보존)
-- - notification_sent: cron이 미발송 알림 순차 발송 (backfill 행은 1로 마킹하여 발송 X)

CREATE TABLE IF NOT EXISTS alert_approval_pending (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  approver_id TEXT NOT NULL,
  cycle_no INTEGER NOT NULL DEFAULT 1,        -- 결재 사이클 (반려 재제출마다 +1)
  step_order INTEGER NOT NULL,
  my_status TEXT NOT NULL,                     -- 'need_approve' | 'waiting_final'

  -- 비정규화된 문서 메타 (대시보드 조회 시 JOIN 절약)
  document_title TEXT,
  document_template_id TEXT,
  document_author_id TEXT,
  document_author_name TEXT,
  document_branch TEXT,
  document_department TEXT,
  document_submitted_at TEXT,

  -- 라이프사이클
  status TEXT NOT NULL DEFAULT 'open',         -- open / acted / cancelled / expired
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  acted_at TEXT,
  acted_action TEXT,                           -- approved / rejected / cancelled

  -- 알림톡 발송 추적
  notification_sent INTEGER NOT NULL DEFAULT 0,    -- 0: 미발송, 1: 발송됨, 2: 발송 시도 후 실패 (재시도 안 함)
  notification_sent_at TEXT,
  notification_error TEXT,

  metadata TEXT,

  UNIQUE(document_id, approver_id, cycle_no),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

-- 핵심 인덱스 (대시보드 read path)
CREATE INDEX IF NOT EXISTS idx_aap_approver_status ON alert_approval_pending(approver_id, status);
-- 트리거 처리 + 정합성 검증
CREATE INDEX IF NOT EXISTS idx_aap_doc_status ON alert_approval_pending(document_id, status);
-- 통계/cron
CREATE INDEX IF NOT EXISTS idx_aap_status_detected ON alert_approval_pending(status, detected_at);
-- 알림 발송 cron (미발송 + open + need_approve)
CREATE INDEX IF NOT EXISTS idx_aap_notify ON alert_approval_pending(notification_sent, status, my_status);
