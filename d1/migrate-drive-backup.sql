-- Drive 백업 설정 및 로그
CREATE TABLE IF NOT EXISTS drive_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  root_folder_id TEXT NOT NULL DEFAULT '',
  root_folder_name TEXT NOT NULL DEFAULT '',
  folder_pattern TEXT NOT NULL DEFAULT '{yyyy-mm}/{branch}',
  filename_pattern TEXT NOT NULL DEFAULT '[{yyyy-mm-dd}] {client_name} {title}',
  connected_email TEXT NOT NULL DEFAULT '',
  connected_by TEXT,
  connected_at TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO drive_settings (id) VALUES ('default');

CREATE TABLE IF NOT EXISTS drive_backup_logs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  run_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  drive_file_id TEXT,
  drive_folder_path TEXT,
  file_size INTEGER,
  triggered_by TEXT,
  error_message TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_drive_backup_doc ON drive_backup_logs(document_id, status);
CREATE INDEX IF NOT EXISTS idx_drive_backup_run ON drive_backup_logs(run_at DESC);
