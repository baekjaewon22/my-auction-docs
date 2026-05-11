-- 사내 커뮤니티 카테고리/명도견적/법률지원 확장

ALTER TABLE admin_notes ADD COLUMN category TEXT DEFAULT 'community';
ALTER TABLE admin_notes ADD COLUMN court TEXT;
ALTER TABLE admin_notes ADD COLUMN case_number TEXT;

CREATE TABLE IF NOT EXISTS admin_note_attachments (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT DEFAULT '',
  file_size INTEGER DEFAULT 0,
  file_data TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (note_id) REFERENCES admin_notes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_notes_category ON admin_notes(category);
CREATE INDEX IF NOT EXISTS idx_admin_note_attachments_note ON admin_note_attachments(note_id);
