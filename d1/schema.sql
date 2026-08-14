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
  auth_version INTEGER NOT NULL DEFAULT 0,
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
  is_myauction INTEGER NOT NULL DEFAULT 0 CHECK (is_myauction IN (0, 1)),
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
  is_myauction INTEGER NOT NULL DEFAULT 0 CHECK (is_myauction IN (0, 1)),
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

-- Server-side mapping between a my-docs account and its lawitgo consultant identity.
CREATE TABLE IF NOT EXISTS lawitgo_consultant_mappings (
  user_id TEXT PRIMARY KEY,
  consultant_id TEXT NOT NULL UNIQUE,
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lawitgo_progress_cache (
  consultant_id TEXT NOT NULL,
  progress_id TEXT NOT NULL,
  item_json TEXT NOT NULL,
  ui_html TEXT NOT NULL DEFAULT '',
  ui_css TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (consultant_id, progress_id)
);

CREATE INDEX IF NOT EXISTS idx_lawitgo_progress_cache_active
ON lawitgo_progress_cache(active, progress_id);

CREATE TABLE IF NOT EXISTS lawitgo_progress_cache_runs (
  consultant_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  item_count INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  last_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  error_message TEXT NOT NULL DEFAULT ''
);

-- Outbound winning-case delivery queue. Financial values are eligibility-only and are not stored in the payload.
CREATE TABLE IF NOT EXISTS lawitgo_winning_outbox (
  id TEXT PRIMARY KEY,
  sales_record_id TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL DEFAULT '{}',
  missing_fields TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  claim_token TEXT,
  last_attempt_at TEXT,
  sent_at TEXT,
  response_status INTEGER,
  remote_request_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  FOREIGN KEY (sales_record_id) REFERENCES sales_records(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_lawitgo_winning_outbox_due
ON lawitgo_winning_outbox(status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS lawitgo_winning_delivery_runs (
  id TEXT PRIMARY KEY,
  scheduled_slot TEXT NOT NULL,
  status TEXT NOT NULL,
  staged_count INTEGER NOT NULL DEFAULT 0,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  claimed_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  finished_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lawitgo_winning_runs_slot
ON lawitgo_winning_delivery_runs(scheduled_slot);

-- Durable central queue for the single office automation runner.
CREATE TABLE IF NOT EXISTS automation_jobs (
  id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, output_type TEXT NOT NULL,
  is_batch INTEGER NOT NULL DEFAULT 0, request_object_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 100, agent_id TEXT NOT NULL DEFAULT '',
  lease_token TEXT NOT NULL DEFAULT '', lease_expires_at TEXT, heartbeat_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 2,
  progress_percent REAL NOT NULL DEFAULT 0, current_step INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 1, status_title TEXT NOT NULL DEFAULT '접수 완료',
  status_message TEXT NOT NULL DEFAULT '서버 실행 순서를 기다리고 있습니다.',
  cancel_requested INTEGER NOT NULL DEFAULT 0, error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '', diagnostics_json TEXT NOT NULL DEFAULT '[]',
  available_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), started_at TEXT, completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner_user_id, idempotency_key),
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_queue ON automation_jobs(status, available_at, priority, created_at, id);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_owner ON automation_jobs(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_lease ON automation_jobs(status, lease_expires_at);

CREATE TABLE IF NOT EXISTS automation_job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL,
  step INTEGER NOT NULL DEFAULT 0, total_steps INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running', percent REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES automation_jobs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_automation_job_events_job ON automation_job_events(job_id, id);

CREATE TABLE IF NOT EXISTS automation_job_artifacts (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL, format TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE, file_name TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream', file_size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (job_id, format),
  FOREIGN KEY (job_id) REFERENCES automation_jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS automation_agents (
  id TEXT PRIMARY KEY, display_name TEXT NOT NULL DEFAULT '', version TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'offline', current_job_id TEXT NOT NULL DEFAULT '',
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')), created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS briefing_materials (
  id TEXT PRIMARY KEY, uploaded_by TEXT NOT NULL, uploader_name TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT '', assignee_user_id TEXT, assignee_name TEXT NOT NULL DEFAULT '',
  case_number TEXT NOT NULL DEFAULT '', material_month TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL, file_type TEXT NOT NULL DEFAULT 'application/octet-stream', file_size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '', drive_status TEXT NOT NULL DEFAULT 'pending', drive_file_id TEXT NOT NULL DEFAULT '',
  drive_folder_path TEXT NOT NULL DEFAULT '', drive_backed_up_at TEXT, drive_attempt_count INTEGER NOT NULL DEFAULT 0,
  drive_error TEXT NOT NULL DEFAULT '', archived_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (uploaded_by) REFERENCES users(id),
  FOREIGN KEY (assignee_user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_briefing_materials_active ON briefing_materials(archived_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_briefing_materials_drive ON briefing_materials(drive_status, drive_attempt_count, created_at);
CREATE INDEX IF NOT EXISTS idx_briefing_materials_scope ON briefing_materials(branch, assignee_user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS briefing_material_drive_logs (
  id TEXT PRIMARY KEY, material_id TEXT NOT NULL, status TEXT NOT NULL,
  drive_file_id TEXT NOT NULL DEFAULT '', drive_folder_path TEXT NOT NULL DEFAULT '', file_size INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT '', triggered_by TEXT NOT NULL DEFAULT 'cron', run_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (material_id) REFERENCES briefing_materials(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_briefing_material_drive_logs_material ON briefing_material_drive_logs(material_id, run_at DESC);

CREATE TABLE IF NOT EXISTS user_employment_type_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  from_login_type TEXT NOT NULL CHECK (from_login_type IN ('employee', 'freelancer')),
  to_login_type TEXT NOT NULL CHECK (to_login_type IN ('employee', 'freelancer')),
  effective_month TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  impact_snapshot TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_employment_type_history_user
ON user_employment_type_history(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS password_reset_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  verified_at INTEGER,
  reset_token_hash TEXT UNIQUE,
  reset_expires_at INTEGER,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_password_reset_user_created
  ON password_reset_challenges(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_reset_token
  ON password_reset_challenges(reset_token_hash);

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

CREATE TABLE IF NOT EXISTS web_push_setup_reminder_runs (
  id TEXT PRIMARY KEY,
  alert_date TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  recipient_role TEXT NOT NULL,
  scope_label TEXT NOT NULL DEFAULT '',
  missing_count INTEGER NOT NULL DEFAULT 0,
  missing_users_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'no_subscription')),
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  UNIQUE(alert_date, recipient_id),
  FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_web_push_setup_reminder_runs_date
ON web_push_setup_reminder_runs(alert_date, status);

CREATE TABLE IF NOT EXISTS auction_bid_result_reminder_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  target_date TEXT NOT NULL,
  missing_fields_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'no_subscription')),
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  UNIQUE(schedule_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_auction_bid_result_reminder_target
ON auction_bid_result_reminder_runs(target_date, status);

CREATE TABLE IF NOT EXISTS freelancer_auction_schedules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  target_date TEXT NOT NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('입찰', '임장', '미팅')),
  activity_subtype TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  branch TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_freelancer_schedule_user_date
  ON freelancer_auction_schedules(user_id, target_date);
CREATE INDEX IF NOT EXISTS idx_freelancer_schedule_scope_date
  ON freelancer_auction_schedules(branch, department, target_date);

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
-- 담당자별 고객 마스터 (업무성과 계약·낙찰의 권위 고객 식별자)
CREATE TABLE IF NOT EXISTS sales_customers (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  primary_phone TEXT NOT NULL DEFAULT '',
  primary_phone_digits TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  UNIQUE (owner_user_id, normalized_name, primary_phone_digits)
);
CREATE TABLE IF NOT EXISTS sales_customer_contacts (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, phone TEXT NOT NULL, phone_digits TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '본인', is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  UNIQUE (customer_id, phone_digits)
);
CREATE TABLE IF NOT EXISTS sales_customer_addresses (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, address TEXT NOT NULL, address_detail TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '기본', is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);
CREATE TABLE IF NOT EXISTS sales_customer_cases (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, court TEXT NOT NULL DEFAULT '', case_number TEXT NOT NULL,
  item_number TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '진행',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  UNIQUE (customer_id, court, case_number, item_number)
);
