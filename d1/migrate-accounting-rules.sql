CREATE TABLE IF NOT EXISTS accounting_card_rules (
  id TEXT PRIMARY KEY,
  card_last4 TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  UNIQUE(card_last4)
);

CREATE TABLE IF NOT EXISTS accounting_merchant_keyword_rules (
  id TEXT PRIMARY KEY,
  keyword TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  item TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  UNIQUE(keyword)
);

CREATE INDEX IF NOT EXISTS idx_accounting_card_rules_branch
  ON accounting_card_rules(branch, owner_name);

CREATE INDEX IF NOT EXISTS idx_accounting_keyword_rules_category
  ON accounting_merchant_keyword_rules(category, item);
