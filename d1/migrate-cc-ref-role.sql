-- cc_ref 역할 추가: D1/SQLite에서는 CHECK 제약을 ALTER로 변경 불가
-- 새 role 값 'cc_ref'가 INSERT/UPDATE 시 거부되지 않도록 테이블 재생성
-- 기존 데이터 보존

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS users_new (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('master', 'ceo', 'cc_ref', 'admin', 'manager', 'member')),
  team_id TEXT,
  branch TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  position_title TEXT NOT NULL DEFAULT '',
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
);

INSERT INTO users_new SELECT * FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_branch ON users(branch);

PRAGMA foreign_keys = ON;
