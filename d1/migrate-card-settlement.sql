-- Card settlement queue support.
-- Allows sales_records.status='card_pending' and stores the card company net deposit.

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS deposit_notices_card_settlement_backup;

CREATE TABLE IF NOT EXISTS deposit_notices_card_settlement_backup AS
SELECT * FROM deposit_notices;

DROP TABLE IF EXISTS deposit_notices;

CREATE TABLE IF NOT EXISTS sales_records_card_settlement_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  type_detail TEXT NOT NULL DEFAULT '',
  client_name TEXT NOT NULL DEFAULT '',
  depositor_name TEXT NOT NULL DEFAULT '',
  depositor_different INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL DEFAULT 0,
  contract_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'card_pending', 'confirmed', 'refund_requested', 'refunded')),
  journal_entry_id TEXT,
  confirmed_at TEXT,
  confirmed_by TEXT,
  refund_requested_at TEXT,
  refund_approved_at TEXT,
  refund_approved_by TEXT,
  memo TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deposit_date TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT 'income',
  appraisal_price INTEGER NOT NULL DEFAULT 0,
  winning_price INTEGER NOT NULL DEFAULT 0,
  appraisal_rate REAL NOT NULL DEFAULT 0,
  winning_rate REAL NOT NULL DEFAULT 0,
  commission_amount INTEGER NOT NULL DEFAULT 0,
  contract_submitted INTEGER NOT NULL DEFAULT 0,
  contract_not_submitted INTEGER NOT NULL DEFAULT 0,
  contract_not_reason TEXT NOT NULL DEFAULT '',
  contract_not_approved INTEGER NOT NULL DEFAULT 0,
  contract_not_approved_by TEXT DEFAULT NULL,
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
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (confirmed_by) REFERENCES users(id),
  FOREIGN KEY (refund_approved_by) REFERENCES users(id)
);

INSERT INTO sales_records_card_settlement_new (
  id, user_id, type, type_detail, client_name, depositor_name, depositor_different,
  amount, contract_date, status, journal_entry_id, confirmed_at, confirmed_by,
  refund_requested_at, refund_approved_at, refund_approved_by, memo, branch, department,
  created_at, updated_at, deposit_date, payment_method, direction, appraisal_price,
  winning_price, appraisal_rate, winning_rate, commission_amount, contract_submitted,
  contract_not_submitted, contract_not_reason, contract_not_approved, contract_not_approved_by,
  client_phone, payment_type, receipt_type, receipt_phone, card_deposit_date, proxy_cost,
  exclude_from_count, card_settlement_amount, card_fee_amount, card_settlement_staging_id,
  card_settlement_note
)
SELECT
  id, user_id, type, type_detail, client_name, depositor_name, depositor_different,
  amount, contract_date, status, journal_entry_id, confirmed_at, confirmed_by,
  refund_requested_at, refund_approved_at, refund_approved_by, memo, branch, department,
  created_at, updated_at, deposit_date, payment_method, direction, appraisal_price,
  winning_price, appraisal_rate, winning_rate, commission_amount, contract_submitted,
  contract_not_submitted, contract_not_reason, contract_not_approved, contract_not_approved_by,
  client_phone, payment_type, receipt_type, receipt_phone, card_deposit_date, proxy_cost,
  exclude_from_count,
  0,
  0,
  '',
  ''
FROM sales_records;

DROP TABLE sales_records;
ALTER TABLE sales_records_card_settlement_new RENAME TO sales_records;

CREATE INDEX IF NOT EXISTS idx_sales_records_user ON sales_records(user_id);
CREATE INDEX IF NOT EXISTS idx_sales_records_status ON sales_records(status);
CREATE INDEX IF NOT EXISTS idx_sales_records_branch ON sales_records(branch);
CREATE INDEX IF NOT EXISTS idx_sales_records_contract_date ON sales_records(contract_date);

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
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'approved')),
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (claimed_by) REFERENCES users(id),
  FOREIGN KEY (sales_record_id) REFERENCES sales_records(id)
);

INSERT INTO deposit_notices (
  id, depositor, amount, deposit_date, d_day_date, created_by, claimed_by,
  claimed_at, sales_record_id, status, approved_by, approved_at, created_at, updated_at
)
SELECT
  id, depositor, amount, deposit_date, d_day_date, created_by, claimed_by,
  claimed_at, sales_record_id, status, approved_by, approved_at, created_at, updated_at
FROM deposit_notices_card_settlement_backup;

DROP TABLE IF EXISTS deposit_notices_card_settlement_backup;

CREATE INDEX IF NOT EXISTS idx_deposit_notices_status ON deposit_notices(status);

PRAGMA foreign_keys = ON;
