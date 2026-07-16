-- Users table (5-level roles + branch + department)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('master', 'ceo', 'cc_ref', 'admin', 'director', 'accountant', 'accountant_asst', 'manager', 'member', 'support', 'resigned')),
  team_id TEXT,
  branch TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  position_title TEXT NOT NULL DEFAULT '',
  myauction_id TEXT NOT NULL DEFAULT '',
  myauction_pw TEXT NOT NULL DEFAULT '',
  report_permission TEXT NOT NULL DEFAULT 'basic',
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
);

-- Teams table
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Templates table
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  content TEXT NOT NULL DEFAULT '{}',
  category TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Documents table (with branch/department)
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '{}',
  template_id TEXT,
  author_id TEXT NOT NULL,
  team_id TEXT,
  branch TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  reject_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (template_id) REFERENCES templates(id),
  FOREIGN KEY (author_id) REFERENCES users(id),
  FOREIGN KEY (team_id) REFERENCES teams(id)
);

-- Signatures table
CREATE TABLE IF NOT EXISTS signatures (
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

-- Document history / audit log
CREATE TABLE IF NOT EXISTS document_logs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Departments (dynamic)
CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  branch TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Annual leave management
CREATE TABLE IF NOT EXISTS annual_leave (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  total_days REAL NOT NULL DEFAULT 15,
  used_days REAL NOT NULL DEFAULT 0,
  monthly_days REAL NOT NULL DEFAULT 0,
  monthly_used REAL NOT NULL DEFAULT 0,
  manual_total_adjust_days REAL NOT NULL DEFAULT 0,
  manual_used_adjust_days REAL NOT NULL DEFAULT 0,
  leave_type TEXT NOT NULL DEFAULT 'annual' CHECK (leave_type IN ('monthly', 'annual')),
  year INTEGER NOT NULL DEFAULT 2026,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Leave requests (연차/월차/반차/시간차 신청)
CREATE TABLE IF NOT EXISTS leave_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  leave_type TEXT NOT NULL CHECK (leave_type IN ('연차', '월차', '반차', '시간차', '특별휴가')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  hours REAL NOT NULL DEFAULT 8,
  days REAL NOT NULL DEFAULT 1,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'cancel_requested')),
  approved_by TEXT,
  approved_at TEXT,
  reject_reason TEXT,
  branch TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  half_day_period TEXT NOT NULL DEFAULT '',
  first_approved_by TEXT NOT NULL DEFAULT '',
  first_approved_at TEXT NOT NULL DEFAULT '',
  request_group_id TEXT,
  summer_request_year TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
);

-- Browser Web Push subscriptions (per user and device)
CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  endpoint_hash TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  device_label TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  last_success_at TEXT,
  last_failure_at TEXT,
  last_failure_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_web_push_subscriptions_user_active ON web_push_subscriptions(user_id, active, updated_at DESC);

CREATE TABLE IF NOT EXISTS web_push_delivery_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  subscription_id TEXT,
  attempt_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT 'self_test',
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  status_code INTEGER,
  error_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (subscription_id) REFERENCES web_push_subscriptions(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_web_push_delivery_logs_user_created ON web_push_delivery_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_push_delivery_logs_user_attempt ON web_push_delivery_logs(user_id, event_type, attempt_id, created_at DESC);

CREATE TABLE IF NOT EXISTS web_push_subscription_audit (
  id TEXT PRIMARY KEY,
  endpoint_hash TEXT NOT NULL,
  previous_user_id TEXT,
  new_user_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('created', 'refreshed', 'transferred', 'unsubscribed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_web_push_subscription_audit_created ON web_push_subscription_audit(created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_requests_active_exact
ON leave_requests (
  user_id,
  leave_type,
  start_date,
  end_date,
  COALESCE(half_day_period, '')
)
WHERE status IN ('pending', 'approved', 'cancel_requested');

CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_requests_active_summer_year
ON leave_requests (user_id, summer_request_year)
WHERE summer_request_year IS NOT NULL
  AND status IN ('pending', 'approved', 'cancel_requested');

-- Leave promotion alerts (연차촉진 알림)
CREATE TABLE IF NOT EXISTS leave_promotion_alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('6month_promotion', 'expiry_warning')),
  alert_date TEXT NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_branch ON users(branch);
CREATE INDEX IF NOT EXISTS idx_documents_author ON documents(author_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_branch ON documents(branch);
CREATE INDEX IF NOT EXISTS idx_signatures_document ON signatures(document_id);
CREATE INDEX IF NOT EXISTS idx_document_logs_document ON document_logs(document_id);
CREATE INDEX IF NOT EXISTS idx_annual_leave_user ON annual_leave(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_user ON leave_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_date ON leave_requests(start_date);
