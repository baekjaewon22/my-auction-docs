CREATE TABLE IF NOT EXISTS briefing_materials (
  id TEXT PRIMARY KEY,
  uploaded_by TEXT NOT NULL,
  uploader_name TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT '',
  assignee_user_id TEXT,
  assignee_name TEXT NOT NULL DEFAULT '',
  case_number TEXT NOT NULL DEFAULT '',
  material_month TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  file_size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  drive_status TEXT NOT NULL DEFAULT 'pending' CHECK (drive_status IN ('pending', 'success', 'failed')),
  drive_file_id TEXT NOT NULL DEFAULT '',
  drive_folder_path TEXT NOT NULL DEFAULT '',
  drive_backed_up_at TEXT,
  drive_attempt_count INTEGER NOT NULL DEFAULT 0,
  drive_error TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (uploaded_by) REFERENCES users(id),
  FOREIGN KEY (assignee_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_briefing_materials_active
ON briefing_materials(archived_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_briefing_materials_drive
ON briefing_materials(drive_status, drive_attempt_count, created_at);
CREATE INDEX IF NOT EXISTS idx_briefing_materials_scope
ON briefing_materials(branch, assignee_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS briefing_material_drive_logs (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  drive_file_id TEXT NOT NULL DEFAULT '',
  drive_folder_path TEXT NOT NULL DEFAULT '',
  file_size INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT '',
  triggered_by TEXT NOT NULL DEFAULT 'cron',
  run_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (material_id) REFERENCES briefing_materials(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_briefing_material_drive_logs_material
ON briefing_material_drive_logs(material_id, run_at DESC);
