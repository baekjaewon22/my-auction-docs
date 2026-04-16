PRAGMA foreign_keys = OFF;

CREATE TABLE sales_records_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('계약', '낙찰', '중개', '권리분석보증서', '매수신청대리', '기타')),
  type_detail TEXT NOT NULL DEFAULT '',
  client_name TEXT NOT NULL DEFAULT '',
  depositor_name TEXT NOT NULL DEFAULT '',
  depositor_different INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL DEFAULT 0,
  contract_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'refund_requested', 'refunded')),
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO sales_records_new SELECT
  id, user_id, type, type_detail, client_name, depositor_name, depositor_different,
  amount, contract_date, status, journal_entry_id, confirmed_at, confirmed_by,
  refund_requested_at, refund_approved_at, refund_approved_by,
  deposit_date, direction, payment_method, memo, branch, department,
  appraisal_price, winning_price, appraisal_rate, winning_rate, commission_amount,
  contract_submitted, contract_not_submitted, contract_not_reason,
  contract_not_approved, contract_not_approved_by, client_phone,
  payment_type, receipt_type, receipt_phone, card_deposit_date,
  0, created_at, updated_at
FROM sales_records;

DROP TABLE sales_records;
ALTER TABLE sales_records_new RENAME TO sales_records;

PRAGMA foreign_keys = ON;
