CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  branch TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO departments (id, name, branch, sort_order) VALUES
('dept-001', '경매사업부1팀', '', 1),
('dept-002', '경매사업부2팀', '', 2),
('dept-003', '경매사업부3팀', '', 3);
