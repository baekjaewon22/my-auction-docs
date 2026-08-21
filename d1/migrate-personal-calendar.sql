-- 마이페이지 개인 캘린더 일정 저장소
CREATE TABLE IF NOT EXISTS personal_calendar_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_date TEXT NOT NULL,
  end_date TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#4f6bed',
  all_day INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_personal_calendar_events_user_date
  ON personal_calendar_events(user_id, event_date);

CREATE INDEX IF NOT EXISTS idx_personal_calendar_events_user_end_date
  ON personal_calendar_events(user_id, end_date);
