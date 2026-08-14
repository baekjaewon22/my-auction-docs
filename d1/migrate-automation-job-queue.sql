CREATE TABLE IF NOT EXISTS automation_jobs (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  output_type TEXT NOT NULL CHECK (output_type IN ('auction_report', 'rights_certificate')),
  is_batch INTEGER NOT NULL DEFAULT 0,
  request_object_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'leased', 'running', 'uploading', 'completed', 'failed', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 100,
  agent_id TEXT NOT NULL DEFAULT '',
  lease_token TEXT NOT NULL DEFAULT '',
  lease_expires_at TEXT,
  heartbeat_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 2,
  progress_percent REAL NOT NULL DEFAULT 0,
  current_step INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 1,
  status_title TEXT NOT NULL DEFAULT '접수 완료',
  status_message TEXT NOT NULL DEFAULT '서버 실행 순서를 기다리고 있습니다.',
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  diagnostics_json TEXT NOT NULL DEFAULT '[]',
  available_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner_user_id, idempotency_key),
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_automation_jobs_queue
ON automation_jobs(status, available_at, priority, created_at, id);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_owner
ON automation_jobs(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_lease
ON automation_jobs(status, lease_expires_at);

CREATE TABLE IF NOT EXISTS automation_job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  step INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running',
  percent REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES automation_jobs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_automation_job_events_job
ON automation_job_events(job_id, id);

CREATE TABLE IF NOT EXISTS automation_job_artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('pptx', 'pdf', 'zip')),
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  file_size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (job_id, format),
  FOREIGN KEY (job_id) REFERENCES automation_jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS automation_agents (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'offline',
  current_job_id TEXT NOT NULL DEFAULT '',
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
