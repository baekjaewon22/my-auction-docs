-- 회계 활동 내역 로그 테이블
-- 총무(accountant) / 총무보조(accountant_asst)가 매출 관련 수정·삭제·상태변경을 할 때 강제 기록
CREATE TABLE IF NOT EXISTS accounting_activity_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL DEFAULT '',
  actor_role TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL CHECK (action IN ('update', 'delete', 'status_change', 'refund_approve', 'deposit_claim_approve', 'deposit_delete', 'payment_method_change')),
  target_type TEXT NOT NULL DEFAULT 'sales_record',
  target_id TEXT NOT NULL,
  target_label TEXT NOT NULL DEFAULT '',
  diff_summary TEXT NOT NULL DEFAULT '',
  before_snapshot TEXT,
  after_snapshot TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (actor_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_acc_logs_created ON accounting_activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_acc_logs_actor ON accounting_activity_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_acc_logs_target ON accounting_activity_logs(target_id);
CREATE INDEX IF NOT EXISTS idx_acc_logs_action ON accounting_activity_logs(action);
