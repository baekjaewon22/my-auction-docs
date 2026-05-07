-- accounting_activity_logs CHECK 제약 완화 (action 종류 자유롭게 추가 가능)
-- 메모 추가/수정/삭제 등 신규 액션 로깅 위해 기존 CHECK 제약 제거
-- SQLite는 ALTER로 CHECK 제거 불가 → 새 테이블 생성 후 데이터 복사 + 교체

CREATE TABLE IF NOT EXISTS accounting_activity_logs_new (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL DEFAULT '',
  actor_role TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,                              -- CHECK 제약 제거
  target_type TEXT NOT NULL DEFAULT 'sales_record',
  target_id TEXT NOT NULL,
  target_label TEXT NOT NULL DEFAULT '',
  diff_summary TEXT NOT NULL DEFAULT '',
  before_snapshot TEXT,
  after_snapshot TEXT,
  source_page TEXT NOT NULL DEFAULT 'sales',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (actor_id) REFERENCES users(id)
);

INSERT INTO accounting_activity_logs_new
  (id, actor_id, actor_name, actor_role, action, target_type, target_id, target_label,
   diff_summary, before_snapshot, after_snapshot, source_page, created_at)
SELECT id, actor_id, actor_name, actor_role, action, target_type, target_id, target_label,
       diff_summary, before_snapshot, after_snapshot,
       COALESCE(source_page, 'sales'),
       created_at
FROM accounting_activity_logs;

DROP TABLE accounting_activity_logs;
ALTER TABLE accounting_activity_logs_new RENAME TO accounting_activity_logs;

CREATE INDEX IF NOT EXISTS idx_acc_logs_created ON accounting_activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_acc_logs_actor ON accounting_activity_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_acc_logs_target ON accounting_activity_logs(target_id);
CREATE INDEX IF NOT EXISTS idx_acc_logs_action ON accounting_activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_acc_logs_source_page ON accounting_activity_logs(source_page);
