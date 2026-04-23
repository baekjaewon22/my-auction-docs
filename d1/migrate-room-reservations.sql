-- 회의실 예약 테이블
CREATE TABLE IF NOT EXISTS room_reservations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  branch TEXT NOT NULL,
  room_name TEXT NOT NULL,
  reservation_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_room_res_lookup ON room_reservations(branch, room_name, reservation_date, status);
CREATE INDEX IF NOT EXISTS idx_room_res_user ON room_reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_room_res_date_branch ON room_reservations(branch, reservation_date, status);
