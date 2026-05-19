CREATE TABLE IF NOT EXISTS article_pdf_uploads (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  source_name TEXT NOT NULL DEFAULT '',
  article_date TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  uploaded_by TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now', '+9 hours')),
  deleted_at TEXT,
  FOREIGN KEY (note_id) REFERENCES admin_notes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_article_pdf_note ON article_pdf_uploads(note_id);
CREATE INDEX IF NOT EXISTS idx_article_pdf_expires ON article_pdf_uploads(expires_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_article_pdf_sha ON article_pdf_uploads(sha256);
