CREATE TABLE IF NOT EXISTS approval_cc (id TEXT PRIMARY KEY, document_id TEXT, cc_user_id TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS approval_steps (id TEXT PRIMARY KEY, document_id TEXT, step_order INTEGER, approver_id TEXT, status TEXT DEFAULT 'pending', comment TEXT, signed_at TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS org_nodes (id TEXT PRIMARY KEY, name TEXT, parent_id TEXT, type TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS alimtalk_logs (id TEXT PRIMARY KEY, template_code TEXT, to_number TEXT, status TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS alimtalk_recipients (id TEXT PRIMARY KEY, log_id TEXT, phone TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS commissions (id TEXT PRIMARY KEY, user_id TEXT, amount INTEGER, month TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS meeting_minutes (id TEXT PRIMARY KEY, title TEXT, content TEXT, created_by TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS signup_verifications (id TEXT PRIMARY KEY, email TEXT, code TEXT, created_at TEXT DEFAULT (datetime('now')));
