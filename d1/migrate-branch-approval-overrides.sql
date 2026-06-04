CREATE TABLE IF NOT EXISTS branch_approval_overrides (
  id TEXT PRIMARY KEY,
  branch TEXT NOT NULL UNIQUE,
  approver_id TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  FOREIGN KEY (approver_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_branch_approval_overrides_branch
  ON branch_approval_overrides(branch);
