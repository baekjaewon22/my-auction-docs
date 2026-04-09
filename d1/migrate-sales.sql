-- 매출 내역 테이블
CREATE TABLE IF NOT EXISTS sales_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('계약', '낙찰', '중개', '기타')),
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
  direction TEXT NOT NULL DEFAULT 'income' CHECK (direction IN ('income', 'expense')),
  payment_method TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (confirmed_by) REFERENCES users(id),
  FOREIGN KEY (refund_approved_by) REFERENCES users(id)
);

-- 회계 입금 등록 (역방향: 회계가 먼저 입금내역 등록 → 담당자가 클레임)
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

CREATE INDEX IF NOT EXISTS idx_sales_records_user ON sales_records(user_id);
CREATE INDEX IF NOT EXISTS idx_sales_records_status ON sales_records(status);
CREATE INDEX IF NOT EXISTS idx_sales_records_branch ON sales_records(branch);
CREATE INDEX IF NOT EXISTS idx_sales_records_contract_date ON sales_records(contract_date);
CREATE INDEX IF NOT EXISTS idx_deposit_notices_status ON deposit_notices(status);
