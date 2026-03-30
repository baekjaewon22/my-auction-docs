PRAGMA foreign_keys=OFF;

-- Drop dependent tables temporarily
DROP TABLE IF EXISTS document_logs;
DROP TABLE IF EXISTS signatures;

-- Recreate users
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('master', 'ceo', 'admin', 'manager', 'member')),
  team_id TEXT,
  branch TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users_new (id, email, password_hash, name, role, team_id, branch, department, created_at, updated_at)
SELECT id, email, password_hash, name,
  CASE role WHEN 'admin' THEN 'master' WHEN 'manager' THEN 'manager' ELSE 'member' END,
  team_id, '', '', created_at, updated_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_branch ON users(branch);

-- Recreate dependent tables
CREATE TABLE signatures (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  signature_data TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  signed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_signatures_document ON signatures(document_id);

CREATE TABLE document_logs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_document_logs_document ON document_logs(document_id);

PRAGMA foreign_keys=ON;
