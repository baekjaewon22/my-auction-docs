CREATE TABLE IF NOT EXISTS resource_library_files (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  file_type TEXT DEFAULT '',
  file_size INTEGER DEFAULT 0,
  uploaded_by TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now', '+9 hours')),
  FOREIGN KEY (note_id) REFERENCES admin_notes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_resource_library_files_note ON resource_library_files(note_id);
