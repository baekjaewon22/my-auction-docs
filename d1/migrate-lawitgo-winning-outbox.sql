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

CREATE INDEX IF NOT EXISTS idx_lawitgo_winning_outbox_due
ON lawitgo_winning_outbox(status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS lawitgo_winning_delivery_runs (
  id TEXT PRIMARY KEY,
  scheduled_slot TEXT NOT NULL,
  status TEXT NOT NULL,
  staged_count INTEGER NOT NULL DEFAULT 0,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  claimed_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  finished_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lawitgo_winning_runs_slot
ON lawitgo_winning_delivery_runs(scheduled_slot);

CREATE TABLE IF NOT EXISTS lawitgo_winning_manual_runs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_count INTEGER NOT NULL DEFAULT 0,
  claimed_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  remote_request_id TEXT,
  error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  finished_at TEXT,
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_lawitgo_winning_manual_runs_started
ON lawitgo_winning_manual_runs(started_at DESC);
