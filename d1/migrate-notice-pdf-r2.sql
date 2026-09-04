-- New notice PDFs are stored in R2. Existing admin_note_attachments rows stay
-- in place and remain readable through the legacy fallback endpoints.
CREATE TABLE IF NOT EXISTS notice_pdf_attachments (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  uploaded_by TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now', '+9 hours')),
  FOREIGN KEY (note_id) REFERENCES admin_notes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notice_pdf_cleanup_queue (
  object_key TEXT PRIMARY KEY,
  attachment_id TEXT,
  note_id TEXT,
  reason TEXT NOT NULL DEFAULT 'cleanup',
  not_before TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT DEFAULT (datetime('now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_notice_pdf_note
  ON notice_pdf_attachments(note_id);

CREATE INDEX IF NOT EXISTS idx_notice_pdf_cleanup_due
  ON notice_pdf_cleanup_queue(not_before, created_at);
