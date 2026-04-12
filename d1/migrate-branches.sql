CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 기존 지사 시드
INSERT OR IGNORE INTO branches (id, name, sort_order) VALUES ('branch-01', '의정부', 1);
INSERT OR IGNORE INTO branches (id, name, sort_order) VALUES ('branch-02', '서초', 2);
