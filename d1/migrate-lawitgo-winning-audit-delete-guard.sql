-- Preserve Lawitgo delivery audit snapshots even when a sales record is deleted.
-- Unsent rows remain deletable so incomplete data can still be corrected.
CREATE TABLE IF NOT EXISTS lawitgo_winning_outbox (
  id TEXT PRIMARY KEY,
  sales_record_id TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL DEFAULT '{}',
  missing_fields TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  claim_token TEXT,
  last_attempt_at TEXT,
  sent_at TEXT,
  response_status INTEGER,
  remote_request_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  FOREIGN KEY (sales_record_id) REFERENCES sales_records(id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS trg_sales_records_preserve_lawitgo_audit
BEFORE DELETE ON sales_records
WHEN EXISTS (
  SELECT 1 FROM lawitgo_winning_outbox
  WHERE sales_record_id = OLD.id AND status IN ('sending', 'sent')
)
BEGIN
  SELECT RAISE(ABORT, 'LAWITGO_WINNING_AUDIT_LOCKED');
END;
