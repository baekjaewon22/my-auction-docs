CREATE TABLE IF NOT EXISTS video_production_requests (
  id TEXT PRIMARY KEY,
  assignee_user_id TEXT NOT NULL,
  video_type TEXT NOT NULL DEFAULT 'short_form',
  status TEXT NOT NULL DEFAULT 'requested',
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_amount INTEGER NOT NULL DEFAULT 30000,
  amount INTEGER NOT NULL DEFAULT 30000,
  request_date TEXT NOT NULL,
  provided_date TEXT NOT NULL DEFAULT '',
  submit_due_date TEXT NOT NULL DEFAULT '',
  result_received_date TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  CHECK (video_type IN ('short_form', 'long_form')),
  CHECK (status IN ('requested', 'confirmed')),
  FOREIGN KEY (assignee_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_video_production_assignee_result
  ON video_production_requests(assignee_user_id, status, result_received_date);

CREATE INDEX IF NOT EXISTS idx_video_production_calendar_dates
  ON video_production_requests(request_date, provided_date, submit_due_date, result_received_date);
