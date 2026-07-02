CREATE TABLE IF NOT EXISTS bid_analysis_entries (
  id TEXT PRIMARY KEY,
  bid_datetime TEXT NOT NULL,
  assignee_name TEXT NOT NULL DEFAULT '',
  branch_name TEXT NOT NULL DEFAULT '',
  case_number TEXT NOT NULL DEFAULT '',
  property_type TEXT NOT NULL DEFAULT '',
  suggested_bid_price INTEGER,
  actual_bid_price INTEGER,
  winning_price INTEGER,
  is_won INTEGER NOT NULL DEFAULT 0,
  bid_result TEXT NOT NULL DEFAULT '실패',
  client_name TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'excel',
  source_id TEXT,
  dedupe_key TEXT,
  source_file_name TEXT,
  upload_batch TEXT,
  uploaded_by TEXT,
  created_at TEXT DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT DEFAULT (datetime('now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_bid_analysis_bid_datetime ON bid_analysis_entries(bid_datetime);
CREATE INDEX IF NOT EXISTS idx_bid_analysis_case_number ON bid_analysis_entries(case_number);
CREATE INDEX IF NOT EXISTS idx_bid_analysis_branch ON bid_analysis_entries(branch_name);
CREATE INDEX IF NOT EXISTS idx_bid_analysis_assignee ON bid_analysis_entries(assignee_name);
CREATE INDEX IF NOT EXISTS idx_bid_analysis_upload_batch ON bid_analysis_entries(upload_batch);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bid_analysis_dedupe_key ON bid_analysis_entries(dedupe_key);
