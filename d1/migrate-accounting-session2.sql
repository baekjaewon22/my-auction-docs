CREATE TABLE IF NOT EXISTS accounting_import_batches (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  file_name TEXT NOT NULL DEFAULT '',
  file_hash TEXT NOT NULL DEFAULT '',
  row_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  uploaded_by TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  confirmed_at TEXT,
  confirmed_by TEXT,
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE(source_type, file_hash)
);

CREATE TABLE IF NOT EXISTS accounting_source_rows (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  source_key TEXT NOT NULL,
  transaction_at TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0,
  direction TEXT NOT NULL DEFAULT '',
  merchant_name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  card_last4 TEXT NOT NULL DEFAULT '',
  balance INTEGER,
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  FOREIGN KEY (batch_id) REFERENCES accounting_import_batches(id) ON DELETE CASCADE,
  UNIQUE(source_type, source_key)
);

CREATE TABLE IF NOT EXISTS accounting_reconciliation_items (
  id TEXT PRIMARY KEY,
  source_row_id TEXT NOT NULL,
  linked_source_row_id TEXT,
  linked_sales_record_id TEXT,
  branch TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  item TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  duplicate_group_key TEXT NOT NULL DEFAULT '',
  duplicate_status TEXT NOT NULL DEFAULT 'unique',
  ledger_policy TEXT NOT NULL DEFAULT 'pending',
  status TEXT NOT NULL DEFAULT 'draft',
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  FOREIGN KEY (source_row_id) REFERENCES accounting_source_rows(id) ON DELETE CASCADE,
  FOREIGN KEY (linked_source_row_id) REFERENCES accounting_source_rows(id) ON DELETE SET NULL,
  UNIQUE(source_row_id)
);

CREATE TABLE IF NOT EXISTS accounting_ledger_entries (
  id TEXT PRIMARY KEY,
  reconciliation_id TEXT NOT NULL,
  source_row_id TEXT NOT NULL,
  ledger_type TEXT NOT NULL,
  entry_date TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  item TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0,
  direction TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'confirmed',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  FOREIGN KEY (reconciliation_id) REFERENCES accounting_reconciliation_items(id) ON DELETE CASCADE,
  FOREIGN KEY (source_row_id) REFERENCES accounting_source_rows(id) ON DELETE CASCADE,
  UNIQUE(source_row_id, ledger_type)
);

CREATE TABLE IF NOT EXISTS accounting_report_exports (
  id TEXT PRIMARY KEY,
  report_type TEXT NOT NULL,
  period_month TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  row_count INTEGER NOT NULL DEFAULT 0,
  source_ledger_hash TEXT NOT NULL DEFAULT '',
  exported_by TEXT,
  exported_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  notes TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_accounting_source_rows_batch ON accounting_source_rows(batch_id);
CREATE INDEX IF NOT EXISTS idx_accounting_source_rows_source_key ON accounting_source_rows(source_type, source_key);
CREATE INDEX IF NOT EXISTS idx_accounting_reconciliation_duplicate ON accounting_reconciliation_items(duplicate_group_key, duplicate_status);
CREATE INDEX IF NOT EXISTS idx_accounting_reconciliation_sales ON accounting_reconciliation_items(linked_sales_record_id);
CREATE INDEX IF NOT EXISTS idx_accounting_ledger_period ON accounting_ledger_entries(entry_date, branch, category);
