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
  login_type TEXT NOT NULL DEFAULT 'employee'
    CHECK (login_type IN ('employee', 'freelancer')),
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
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  cancel_reason TEXT DEFAULT '',
  cancelled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (template_id) REFERENCES templates(id),
  FOREIGN KEY (author_id) REFERENCES users(id),
  FOREIGN KEY (team_id) REFERENCES teams(id)
);

-- Ordered document approval chain. This belongs in the canonical base schema
-- because receipt-approval invariants attach triggers to this table.
CREATE TABLE IF NOT EXISTS approval_steps (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  approver_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  comment TEXT,
  signed_at TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (approver_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_approval_steps_document ON approval_steps(document_id);
CREATE INDEX IF NOT EXISTS idx_approval_steps_approver ON approval_steps(approver_id);

-- Persistent approval queue. Receipt approval updates this table atomically,
-- so it is part of the canonical schema as well as the legacy migration.
CREATE TABLE IF NOT EXISTS alert_approval_pending (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  approver_id TEXT NOT NULL,
  cycle_no INTEGER NOT NULL DEFAULT 1,
  step_order INTEGER NOT NULL,
  my_status TEXT NOT NULL,
  document_title TEXT,
  document_template_id TEXT,
  document_author_id TEXT,
  document_author_name TEXT,
  document_branch TEXT,
  document_department TEXT,
  document_submitted_at TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  acted_at TEXT,
  acted_action TEXT,
  notification_sent INTEGER NOT NULL DEFAULT 0,
  notification_sent_at TEXT,
  notification_error TEXT,
  metadata TEXT,
  UNIQUE(document_id, approver_id, cycle_no),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_aap_approver_status
  ON alert_approval_pending(approver_id, status);
CREATE INDEX IF NOT EXISTS idx_aap_doc_status
  ON alert_approval_pending(document_id, status);
CREATE INDEX IF NOT EXISTS idx_aap_status_detected
  ON alert_approval_pending(status, detected_at);
CREATE INDEX IF NOT EXISTS idx_aap_notify
  ON alert_approval_pending(notification_sent, status, my_status);

-- Google Drive document backup settings and immutable run history.
CREATE TABLE IF NOT EXISTS drive_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  root_folder_id TEXT NOT NULL DEFAULT '',
  root_folder_name TEXT NOT NULL DEFAULT '',
  folder_pattern TEXT NOT NULL DEFAULT '{yyyy-mm}/{branch}',
  filename_pattern TEXT NOT NULL DEFAULT '[{yyyy-mm-dd}] {client_name} {title}',
  connected_email TEXT NOT NULL DEFAULT '',
  connected_by TEXT,
  connected_at TEXT,
  refresh_token_encrypted TEXT DEFAULT '',
  token_iv TEXT DEFAULT '',
  auto_enabled INTEGER NOT NULL DEFAULT 0,
  last_cron_run_at TEXT,
  last_cron_status TEXT,
  last_cron_summary TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO drive_settings (id) VALUES ('default');

CREATE TABLE IF NOT EXISTS drive_backup_logs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  run_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  drive_file_id TEXT,
  drive_folder_path TEXT,
  file_size INTEGER,
  triggered_by TEXT,
  error_message TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_drive_backup_doc
  ON drive_backup_logs(document_id, status);
CREATE INDEX IF NOT EXISTS idx_drive_backup_run
  ON drive_backup_logs(run_at DESC);

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

-- Permanent, master-reviewed case-information repair snapshot. Financial
-- values are deliberately not duplicated here.
CREATE TABLE IF NOT EXISTS lawitgo_winning_overrides (
  sales_record_id TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  court TEXT NOT NULL,
  case_number TEXT NOT NULL,
  property_type TEXT NOT NULL,
  winning_date TEXT NOT NULL,
  assignee_user_id TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  FOREIGN KEY (sales_record_id) REFERENCES sales_records(id) ON DELETE CASCADE,
  FOREIGN KEY (assignee_user_id) REFERENCES users(id),
  FOREIGN KEY (updated_by) REFERENCES users(id)
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
-- sales_records is installed by d1/migrate-sales.sql rather than this base
-- schema. Install the audit-preservation trigger afterwards with
-- d1/migrate-lawitgo-winning-audit-delete-guard.sql so a fresh base-schema
-- bootstrap never tries to create a trigger on a table that does not exist.

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

-- lawitgo 신정산 담당컨설턴트 지급 원장
-- 내부 배분액(mau/명승)은 저장하지 않고 담당컨설턴트 노출액만 보관한다.
CREATE TABLE IF NOT EXISTS lawitgo_new_settlements (
  id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  progress_id TEXT,
  case_id TEXT NOT NULL,
  consultant_user_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  settlement_date TEXT NOT NULL,
  payroll_month TEXT NOT NULL,
  consultant_share INTEGER NOT NULL CHECK(consultant_share >= 0),
  statement_title TEXT,
  statement_format TEXT,
  statement_content TEXT,
  source_registered_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT,
  delete_reason TEXT NOT NULL DEFAULT '',
  manual_override_at TEXT,
  manual_override_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lawitgo_new_settlements_payroll
ON lawitgo_new_settlements(consultant_user_id, payroll_month);
CREATE INDEX IF NOT EXISTS idx_lawitgo_new_settlements_case
ON lawitgo_new_settlements(case_id);
CREATE INDEX IF NOT EXISTS idx_lawitgo_new_settlements_progress
ON lawitgo_new_settlements(progress_id);

CREATE TABLE IF NOT EXISTS lawitgo_new_settlement_audit (
  id TEXT PRIMARY KEY,
  settlement_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('update', 'delete')),
  before_json TEXT NOT NULL,
  after_json TEXT,
  reason TEXT NOT NULL DEFAULT '',
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lawitgo_new_settlement_audit_settlement
ON lawitgo_new_settlement_audit(settlement_id, changed_at DESC);

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

CREATE TABLE IF NOT EXISTS auction_schedule_mutation_claims (
  schedule_id TEXT PRIMARY KEY,
  claim_token TEXT NOT NULL UNIQUE,
  operation TEXT NOT NULL,
  actor_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);

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

-- 영수증 첨부 지출결의서 원본, Drive 합본 PDF, 1회용 인쇄 세션
CREATE TABLE IF NOT EXISTS expense_receipt_submission_claims (
  document_id TEXT PRIMARY KEY,
  claim_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS expense_receipt_document_revisions (
  document_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS expense_receipt_attachments (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  object_key TEXT UNIQUE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  image_width INTEGER NOT NULL DEFAULT 0,
  image_height INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  purged_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_expense_receipt_attachments_document
  ON expense_receipt_attachments(document_id, deleted_at, sort_order);
CREATE INDEX IF NOT EXISTS idx_expense_receipt_attachments_sha
  ON expense_receipt_attachments(document_id, sha256, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_receipt_attachments_active_sha
  ON expense_receipt_attachments(document_id, sha256)
  WHERE deleted_at IS NULL AND purged_at IS NULL AND sha256 != '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_receipt_attachments_active_order
  ON expense_receipt_attachments(document_id, sort_order)
  WHERE deleted_at IS NULL AND purged_at IS NULL;
DROP TRIGGER IF EXISTS trg_expense_receipt_attachment_insert_editable;
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_insert_editable
  BEFORE INSERT ON expense_receipt_attachments
  WHEN NOT EXISTS (
    SELECT 1 FROM documents
    WHERE id=NEW.document_id
      AND template_id='tpl-exp-receipt-001'
      AND status IN ('draft','rejected')
  )
  OR EXISTS (
    SELECT 1 FROM expense_receipt_submission_claims
    WHERE document_id=NEW.document_id
      AND claim_token NOT LIKE 'attachment:%'
  )
  BEGIN SELECT RAISE(ABORT, 'expense receipt document is not editable'); END;
DROP TRIGGER IF EXISTS trg_expense_receipt_attachment_order_editable;
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_order_editable
  BEFORE UPDATE OF sort_order ON expense_receipt_attachments
  WHEN NOT EXISTS (
    SELECT 1 FROM documents
    WHERE id=NEW.document_id
      AND template_id='tpl-exp-receipt-001'
      AND status IN ('draft','rejected')
  )
  OR EXISTS (
    SELECT 1 FROM expense_receipt_submission_claims
    WHERE document_id=NEW.document_id
      AND claim_token NOT LIKE 'attachment:%'
  )
  BEGIN SELECT RAISE(ABORT, 'expense receipt document is not editable'); END;
DROP TRIGGER IF EXISTS trg_expense_receipt_attachment_delete_editable;
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_delete_editable
  BEFORE UPDATE OF deleted_at ON expense_receipt_attachments
  WHEN NOT EXISTS (
    SELECT 1 FROM documents
    WHERE id=NEW.document_id
      AND template_id='tpl-exp-receipt-001'
      AND status IN ('draft','rejected')
  )
  OR EXISTS (
    SELECT 1 FROM expense_receipt_submission_claims
    WHERE document_id=NEW.document_id
      AND claim_token NOT LIKE 'attachment:%'
  )
  BEGIN SELECT RAISE(ABORT, 'expense receipt document is not editable'); END;
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_revision_insert
  AFTER INSERT ON expense_receipt_attachments
  BEGIN
    INSERT INTO expense_receipt_document_revisions (document_id, revision, updated_at)
    VALUES (NEW.document_id, 1, datetime('now'))
    ON CONFLICT(document_id) DO UPDATE SET revision=revision+1, updated_at=datetime('now');
  END;
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_revision_update
  AFTER UPDATE OF object_key, file_name, file_type, file_size, sha256, sort_order, deleted_at, purged_at
  ON expense_receipt_attachments
  BEGIN
    INSERT INTO expense_receipt_document_revisions (document_id, revision, updated_at)
    VALUES (NEW.document_id, 1, datetime('now'))
    ON CONFLICT(document_id) DO UPDATE SET revision=revision+1, updated_at=datetime('now');
  END;
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_revision_delete
  AFTER DELETE ON expense_receipt_attachments
  BEGIN
    INSERT INTO expense_receipt_document_revisions (document_id, revision, updated_at)
    VALUES (OLD.document_id, 1, datetime('now'))
    ON CONFLICT(document_id) DO UPDATE SET revision=revision+1, updated_at=datetime('now');
  END;
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_limit
  BEFORE INSERT ON expense_receipt_attachments
  WHEN (SELECT COUNT(*) FROM expense_receipt_attachments
    WHERE document_id=NEW.document_id AND deleted_at IS NULL AND purged_at IS NULL) >= 10
  BEGIN SELECT RAISE(ABORT, 'expense receipt attachment count limit exceeded'); END;
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_total_bytes
  BEFORE INSERT ON expense_receipt_attachments
  WHEN COALESCE((SELECT SUM(file_size) FROM expense_receipt_attachments
    WHERE document_id=NEW.document_id AND deleted_at IS NULL AND purged_at IS NULL), 0) + NEW.file_size > 41943040
  BEGIN SELECT RAISE(ABORT, 'expense receipt attachment byte limit exceeded'); END;
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_total_pixels
  BEFORE INSERT ON expense_receipt_attachments
  WHEN COALESCE((SELECT SUM(image_width * image_height) FROM expense_receipt_attachments
    WHERE document_id=NEW.document_id AND deleted_at IS NULL AND purged_at IS NULL), 0)
    + (NEW.image_width * NEW.image_height) > 60000000
  BEGIN SELECT RAISE(ABORT, 'expense receipt attachment pixel limit exceeded'); END;
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_reactivate_limit
  BEFORE UPDATE OF deleted_at, purged_at ON expense_receipt_attachments
  WHEN NEW.deleted_at IS NULL AND NEW.purged_at IS NULL
    AND (OLD.deleted_at IS NOT NULL OR OLD.purged_at IS NOT NULL)
    AND (SELECT COUNT(*) FROM expense_receipt_attachments
      WHERE document_id=NEW.document_id AND id!=NEW.id
        AND deleted_at IS NULL AND purged_at IS NULL) >= 10
  BEGIN SELECT RAISE(ABORT, 'expense receipt attachment count limit exceeded'); END;
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_update_total_bytes
  BEFORE UPDATE OF deleted_at, purged_at, file_size ON expense_receipt_attachments
  WHEN NEW.deleted_at IS NULL AND NEW.purged_at IS NULL
    AND (OLD.deleted_at IS NOT NULL OR OLD.purged_at IS NOT NULL OR NEW.file_size != OLD.file_size)
    AND COALESCE((SELECT SUM(file_size) FROM expense_receipt_attachments
      WHERE document_id=NEW.document_id AND id!=NEW.id
        AND deleted_at IS NULL AND purged_at IS NULL), 0) + NEW.file_size > 41943040
  BEGIN SELECT RAISE(ABORT, 'expense receipt attachment byte limit exceeded'); END;
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_update_total_pixels
  BEFORE UPDATE OF deleted_at, purged_at, image_width, image_height ON expense_receipt_attachments
  WHEN NEW.deleted_at IS NULL AND NEW.purged_at IS NULL
    AND (OLD.deleted_at IS NOT NULL OR OLD.purged_at IS NOT NULL
      OR NEW.image_width != OLD.image_width OR NEW.image_height != OLD.image_height)
    AND COALESCE((SELECT SUM(image_width * image_height) FROM expense_receipt_attachments
      WHERE document_id=NEW.document_id AND id!=NEW.id
        AND deleted_at IS NULL AND purged_at IS NULL), 0)
      + (NEW.image_width * NEW.image_height) > 60000000
  BEGIN SELECT RAISE(ABORT, 'expense receipt attachment pixel limit exceeded'); END;

CREATE TABLE IF NOT EXISTS expense_receipt_pdf_artifacts (
  document_id TEXT PRIMARY KEY,
  object_key TEXT UNIQUE,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  drive_file_id TEXT NOT NULL DEFAULT '',
  drive_md5_checksum TEXT NOT NULL DEFAULT '',
  drive_folder_path TEXT NOT NULL DEFAULT '',
  drive_backed_up_at TEXT,
  purged_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_expense_receipt_pdf_artifacts_retention
  ON expense_receipt_pdf_artifacts(drive_backed_up_at, purged_at);

CREATE TABLE IF NOT EXISTS expense_receipt_retention_attempts (
  document_id TEXT PRIMARY KEY,
  last_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_result TEXT NOT NULL DEFAULT 'checking',
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_expense_receipt_retention_attempts_time
  ON expense_receipt_retention_attempts(last_attempt_at, document_id);

CREATE TABLE IF NOT EXISTS expense_receipt_r2_cleanup_queue (
  object_key TEXT PRIMARY KEY,
  document_id TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expense_receipt_r2_cleanup_queue_attempt
  ON expense_receipt_r2_cleanup_queue(last_attempt_at, created_at, object_key);

CREATE TABLE IF NOT EXISTS print_render_sessions (
  jti TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_print_render_sessions_expiry
  ON print_render_sessions(expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS expense_receipt_drive_claims (
  document_id TEXT PRIMARY KEY,
  claim_token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_expense_receipt_drive_claims_expiry
  ON expense_receipt_drive_claims(expires_at);

-- 대리 결재 감사 및 제출 시점 총무 담당자 스냅샷
CREATE TABLE IF NOT EXISTS expense_receipt_approval_actions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  approval_step_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approved', 'rejected')),
  actual_actor_id TEXT NOT NULL,
  actual_actor_name TEXT NOT NULL,
  actual_actor_role TEXT NOT NULL,
  representative_user_id TEXT,
  used_representative_stamp INTEGER NOT NULL DEFAULT 0 CHECK (used_representative_stamp IN (0, 1)),
  comment TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (approval_step_id),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (actual_actor_id) REFERENCES users(id),
  FOREIGN KEY (representative_user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_expense_receipt_approval_actions_document
  ON expense_receipt_approval_actions(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expense_receipt_approval_actions_actor
  ON expense_receipt_approval_actions(actual_actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS expense_receipt_approval_delegates (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  approval_step_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role_snapshot TEXT NOT NULL CHECK (role_snapshot IN ('accountant', 'accountant_asst')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (approval_step_id, user_id),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS expense_receipt_submission_claims (
  document_id TEXT PRIMARY KEY,
  claim_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS expense_receipt_signature_attestations (
  document_id TEXT PRIMARY KEY,
  signature_id TEXT NOT NULL UNIQUE,
  author_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (signature_id) REFERENCES signatures(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_expense_receipt_approval_delegates_document
  ON expense_receipt_approval_delegates(document_id, approval_step_id);
CREATE INDEX IF NOT EXISTS idx_expense_receipt_approval_delegates_user
  ON expense_receipt_approval_delegates(user_id, document_id);
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_submit_requirements_v2
BEFORE UPDATE OF status ON documents
WHEN OLD.status IN ('draft', 'rejected')
  AND NEW.status = 'submitted'
  AND NEW.template_id = 'tpl-exp-receipt-001'
  AND (
    NEW.content != OLD.content
    OR NOT EXISTS (
      SELECT 1 FROM signatures s
      JOIN expense_receipt_signature_attestations sa
        ON sa.signature_id = s.id AND sa.document_id = s.document_id
      JOIN expense_receipt_document_revisions r ON r.document_id = s.document_id
      WHERE s.document_id = NEW.id AND s.user_id = NEW.author_id
        AND s.signature_data != '/LNCstemp.png'
        AND sa.author_id = NEW.author_id AND sa.revision = r.revision
    )
    OR NOT EXISTS (
      SELECT 1 FROM expense_receipt_attachments a
      WHERE a.document_id = NEW.id
        AND a.deleted_at IS NULL AND a.purged_at IS NULL
        AND a.object_key IS NOT NULL
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'expense receipt submission requirements missing');
END;
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_content_lock
BEFORE UPDATE OF title, content ON documents
WHEN OLD.template_id = 'tpl-exp-receipt-001'
  AND OLD.status NOT IN ('draft', 'rejected')
BEGIN
  SELECT RAISE(ABORT, 'submitted expense receipt content is immutable');
END;
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_delete_lock
BEFORE DELETE ON documents
WHEN OLD.template_id = 'tpl-exp-receipt-001'
  AND OLD.status NOT IN ('draft', 'rejected')
BEGIN
  SELECT RAISE(ABORT, 'submitted expense receipt cannot be deleted');
END;
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_approval_step_guard
BEFORE UPDATE OF status ON approval_steps
WHEN OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected')
  AND EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = OLD.document_id AND d.template_id = 'tpl-exp-receipt-001'
      AND (d.status != 'submitted' OR COALESCE(d.cancelled, 0) != 0
        OR COALESCE(d.cancel_requested, 0) != 0)
  )
  AND NOT (
    NEW.status = 'rejected' AND COALESCE(NEW.comment, '') = 'cancelled'
    AND EXISTS (SELECT 1 FROM documents d
      WHERE d.id = OLD.document_id AND d.template_id = 'tpl-exp-receipt-001'
        AND COALESCE(d.cancelled, 0) = 1)
  )
BEGIN
  SELECT RAISE(ABORT, 'cancelled expense receipt cannot be acted on');
END;
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_approval_action_guard
BEFORE INSERT ON expense_receipt_approval_actions
WHEN NOT EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = NEW.document_id AND d.template_id = 'tpl-exp-receipt-001'
      AND d.status = 'submitted' AND COALESCE(d.cancelled, 0) = 0
      AND COALESCE(d.cancel_requested, 0) = 0
      AND d.author_id != NEW.actual_actor_id
  )
  OR NOT EXISTS (
    SELECT 1 FROM approval_steps s
    JOIN users u ON u.id = s.approver_id
    WHERE s.id = NEW.approval_step_id AND s.document_id = NEW.document_id
      AND ((NEW.action = 'approved' AND s.status = 'approved')
        OR (NEW.action = 'rejected' AND s.status = 'rejected'))
      AND u.role = 'ceo' AND u.approved = 1
      AND COALESCE(u.login_type, 'employee') != 'freelancer'
      AND (NEW.used_representative_stamp = 0 OR NEW.representative_user_id = s.approver_id)
  )
  OR NOT EXISTS (
    SELECT 1 FROM users actor
    WHERE actor.id = NEW.actual_actor_id
      AND actor.role = NEW.actual_actor_role
      AND actor.approved = 1
      AND COALESCE(actor.login_type, 'employee') != 'freelancer'
      AND (
        actor.role = 'master'
        OR (
          actor.role = 'ceo'
          AND EXISTS (
            SELECT 1 FROM approval_steps representative_step
            WHERE representative_step.id = NEW.approval_step_id
              AND representative_step.document_id = NEW.document_id
              AND representative_step.approver_id = actor.id
          )
        )
        OR EXISTS (
          SELECT 1 FROM expense_receipt_approval_delegates delegate
          WHERE delegate.document_id = NEW.document_id
            AND delegate.approval_step_id = NEW.approval_step_id
            AND delegate.user_id = actor.id
            AND delegate.role_snapshot = actor.role
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'cancelled expense receipt cannot be acted on');
END;
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_document_revision
AFTER UPDATE OF title, content ON documents
WHEN NEW.template_id = 'tpl-exp-receipt-001'
  AND NEW.status IN ('draft', 'rejected')
BEGIN
  INSERT INTO expense_receipt_document_revisions (document_id, revision, updated_at)
  VALUES (NEW.id, 1, datetime('now'))
  ON CONFLICT(document_id) DO UPDATE SET
    revision = revision + 1, updated_at = datetime('now');
END;
-- Notice PDF R2 metadata and durable cleanup queue. Legacy notice attachments
-- remain in admin_note_attachments and are not migrated automatically.
CREATE TABLE IF NOT EXISTS notice_pdf_attachments (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  uploaded_by TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now', '+9 hours')),
  FOREIGN KEY (note_id) REFERENCES admin_notes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notice_pdf_cleanup_queue (
  object_key TEXT PRIMARY KEY,
  attachment_id TEXT,
  note_id TEXT,
  reason TEXT NOT NULL DEFAULT 'cleanup',
  not_before TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT DEFAULT (datetime('now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_notice_pdf_note
  ON notice_pdf_attachments(note_id);

CREATE INDEX IF NOT EXISTS idx_notice_pdf_cleanup_due
  ON notice_pdf_cleanup_queue(not_before, created_at);

-- Private payroll memo, intentionally isolated from payroll_saves snapshots/exports.
CREATE TABLE IF NOT EXISTS payroll_internal_memos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  period TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, period)
);
