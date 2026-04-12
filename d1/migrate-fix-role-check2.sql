PRAGMA foreign_keys=OFF;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst', 'manager', 'member')),
  team_id TEXT,
  branch TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  position_title TEXT NOT NULL DEFAULT '',
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  saved_signature TEXT DEFAULT '',
  hire_date TEXT NOT NULL DEFAULT '',
  card_number TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
);

INSERT INTO users_new SELECT id, email, password_hash, name, phone, role, team_id, branch, department, position_title, approved, created_at, updated_at, saved_signature, hire_date, card_number FROM users;

DROP TABLE users;

ALTER TABLE users_new RENAME TO users;

PRAGMA foreign_keys=ON;
