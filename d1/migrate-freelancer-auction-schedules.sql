-- 프리랜서용 일정 공유. 정규직 컨설턴트 일지/근태/통계와 분리한다.
CREATE TABLE IF NOT EXISTS freelancer_auction_schedules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  target_date TEXT NOT NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('입찰', '임장', '미팅')),
  activity_subtype TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  branch TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  -- User rows are retained as resigned archives. Keep the default RESTRICT
  -- behavior as an additional guard against accidental history deletion.
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_freelancer_schedule_user_date
  ON freelancer_auction_schedules(user_id, target_date);
CREATE INDEX IF NOT EXISTS idx_freelancer_schedule_scope_date
  ON freelancer_auction_schedules(branch, department, target_date);
