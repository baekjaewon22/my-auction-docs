CREATE TABLE IF NOT EXISTS admin_note_view_logs (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  viewer_id TEXT NOT NULL,
  viewed_date TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now', '+9 hours')),
  FOREIGN KEY (note_id) REFERENCES admin_notes(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_note_view_logs_daily
  ON admin_note_view_logs(note_id, viewer_id, viewed_date);

CREATE INDEX IF NOT EXISTS idx_admin_note_view_logs_note
  ON admin_note_view_logs(note_id);
