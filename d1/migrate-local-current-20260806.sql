-- Additive local-development bootstrap for current sales, payroll, and
-- employee/freelancer flows. Existing rows and tables are not replaced.

CREATE TABLE IF NOT EXISTS sales_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  type_detail TEXT NOT NULL DEFAULT '',
  client_name TEXT NOT NULL DEFAULT '',
  depositor_name TEXT NOT NULL DEFAULT '',
  depositor_different INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL DEFAULT 0,
  contract_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  journal_entry_id TEXT,
  confirmed_at TEXT,
  confirmed_by TEXT,
  refund_requested_at TEXT,
  refund_approved_at TEXT,
  refund_approved_by TEXT,
  deposit_date TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT 'income',
  payment_method TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  attribution_branch TEXT NOT NULL DEFAULT '',
  appraisal_price INTEGER NOT NULL DEFAULT 0,
  winning_price INTEGER NOT NULL DEFAULT 0,
  appraisal_rate REAL NOT NULL DEFAULT 0,
  winning_rate REAL NOT NULL DEFAULT 0,
  commission_amount INTEGER NOT NULL DEFAULT 0,
  contract_submitted INTEGER NOT NULL DEFAULT 0,
  contract_not_submitted INTEGER NOT NULL DEFAULT 0,
  contract_not_reason TEXT NOT NULL DEFAULT '',
  contract_not_approved INTEGER NOT NULL DEFAULT 0,
  contract_not_approved_by TEXT,
  client_phone TEXT NOT NULL DEFAULT '',
  payment_type TEXT NOT NULL DEFAULT '',
  receipt_type TEXT NOT NULL DEFAULT '',
  receipt_phone TEXT NOT NULL DEFAULT '',
  card_deposit_date TEXT NOT NULL DEFAULT '',
  proxy_cost INTEGER NOT NULL DEFAULT 0,
  exclude_from_count INTEGER NOT NULL DEFAULT 0,
  card_settlement_amount INTEGER NOT NULL DEFAULT 0,
  card_fee_amount INTEGER NOT NULL DEFAULT 0,
  card_settlement_staging_id TEXT NOT NULL DEFAULT '',
  card_settlement_note TEXT NOT NULL DEFAULT '',
  tax_invoice_date TEXT,
  tax_invoice_type TEXT,
  external_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sales_records_user ON sales_records(user_id);
CREATE INDEX IF NOT EXISTS idx_sales_records_status ON sales_records(status);
CREATE INDEX IF NOT EXISTS idx_sales_records_branch ON sales_records(branch);
CREATE INDEX IF NOT EXISTS idx_sales_records_contract_date ON sales_records(contract_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_records_external_id
  ON sales_records(external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS deposit_notices (
  id TEXT PRIMARY KEY,
  depositor TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0,
  deposit_date TEXT NOT NULL DEFAULT '',
  d_day_date TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  claimed_by TEXT,
  claimed_at TEXT,
  sales_record_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (sales_record_id) REFERENCES sales_records(id)
);
CREATE INDEX IF NOT EXISTS idx_deposit_notices_status ON deposit_notices(status);

CREATE TABLE IF NOT EXISTS user_accounting (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  salary INTEGER NOT NULL DEFAULT 0,
  standard_sales INTEGER NOT NULL DEFAULT 0,
  grade TEXT NOT NULL DEFAULT '',
  position_allowance INTEGER NOT NULL DEFAULT 0,
  pay_type TEXT NOT NULL DEFAULT 'salary',
  commission_rate REAL NOT NULL DEFAULT 0,
  ssn TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sales_evaluations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  standard_sales INTEGER NOT NULL DEFAULT 0,
  total_sales INTEGER NOT NULL DEFAULT 0,
  met_target INTEGER NOT NULL DEFAULT 0,
  consecutive_misses INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, period_start)
);

CREATE TABLE IF NOT EXISTS payroll_saves (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  period TEXT NOT NULL,
  pay_type TEXT NOT NULL DEFAULT 'salary',
  data TEXT NOT NULL DEFAULT '{}',
  locked INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, period)
);

CREATE TABLE IF NOT EXISTS commission_rate_overrides (
  user_id TEXT NOT NULL,
  year_month TEXT NOT NULL,
  commission_rate REAL NOT NULL,
  memo TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, year_month)
);

CREATE TABLE IF NOT EXISTS user_pay_type_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  effective_month TEXT NOT NULL,
  pay_type TEXT NOT NULL,
  commission_rate REAL NOT NULL DEFAULT 0,
  salary INTEGER NOT NULL DEFAULT 0,
  standard_sales INTEGER NOT NULL DEFAULT 0,
  grade TEXT NOT NULL DEFAULT '',
  position_allowance INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT '',
  changed_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, effective_month, source)
);
CREATE INDEX IF NOT EXISTS idx_user_pay_type_history_user_month
  ON user_pay_type_history(user_id, effective_month);

CREATE TABLE IF NOT EXISTS user_employment_type_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  from_login_type TEXT NOT NULL,
  to_login_type TEXT NOT NULL,
  effective_month TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  impact_snapshot TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_employment_type_history_user
  ON user_employment_type_history(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_employment_conversion_claims (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  from_login_type TEXT NOT NULL,
  to_login_type TEXT NOT NULL,
  effective_month TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS freelancer_bid_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bid_date TEXT NOT NULL,
  court TEXT NOT NULL DEFAULT '',
  case_number TEXT NOT NULL DEFAULT '',
  item_no TEXT NOT NULL DEFAULT '',
  client_name TEXT NOT NULL DEFAULT '',
  bidder_name TEXT NOT NULL DEFAULT '',
  property_type TEXT NOT NULL DEFAULT '',
  suggested_price INTEGER,
  actual_bid_price INTEGER,
  winning_price INTEGER,
  bid_result TEXT NOT NULL DEFAULT '패찰',
  deviation_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT DEFAULT (datetime('now', '+9 hours')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_freelancer_bid_user ON freelancer_bid_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_freelancer_bid_date ON freelancer_bid_entries(bid_date);

CREATE TABLE IF NOT EXISTS refund_recovery_resolutions (
  sales_record_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  payroll_month TEXT NOT NULL,
  recovery_amount INTEGER NOT NULL DEFAULT 0,
  resolved_by TEXT NOT NULL,
  resolved_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  FOREIGN KEY (sales_record_id) REFERENCES sales_records(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_refund_recovery_resolutions_user_month
  ON refund_recovery_resolutions(user_id, payroll_month);

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
