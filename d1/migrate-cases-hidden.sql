-- Hide external lawitgo cases inside my-docs without deleting the external source.
-- Hidden cases are excluded from lists and bonus calculations even if re-ingested.

CREATE TABLE IF NOT EXISTS case_hidden (
  external_id TEXT PRIMARY KEY,
  case_id TEXT,
  hidden_by TEXT NOT NULL,
  hidden_reason TEXT DEFAULT '',
  hidden_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_case_hidden_case_id ON case_hidden(case_id);
