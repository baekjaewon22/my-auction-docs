-- 'support' 역할 추가 (지원)
PRAGMA foreign_keys=OFF;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('master', 'ceo', 'cc_ref', 'admin', 'director', 'accountant', 'accountant_asst', 'manager', 'member', 'freelancer', 'resigned', 'support')),
  team_id TEXT,
  branch TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  position_title TEXT NOT NULL DEFAULT '',
  approved INTEGER NOT NULL DEFAULT 0,
  saved_signature TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  card_number TEXT NOT NULL DEFAULT '',
  hire_date TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL DEFAULT '',
  login_type TEXT NOT NULL DEFAULT 'employee' CHECK (login_type IN ('employee', 'freelancer')),
  alimtalk_branches TEXT DEFAULT '',
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
);

INSERT INTO users_new SELECT
  id, email, password_hash, name, phone, role, team_id, branch, department,
  position_title, approved, saved_signature, created_at, updated_at,
  card_number, hire_date, api_key, login_type, alimtalk_branches
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

PRAGMA foreign_keys=ON;
