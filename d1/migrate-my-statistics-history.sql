CREATE TABLE IF NOT EXISTS historical_bid_statistics (
  id TEXT PRIMARY KEY,
  source_file TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  assignee_name TEXT NOT NULL,
  property_type TEXT NOT NULL DEFAULT '',
  bid_result TEXT NOT NULL DEFAULT '',
  bid_date TEXT NOT NULL,
  registered_at TEXT NOT NULL DEFAULT '',
  case_number TEXT NOT NULL DEFAULT '',
  item_number TEXT NOT NULL DEFAULT '',
  court TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  UNIQUE(source_file, source_row)
);

CREATE INDEX IF NOT EXISTS idx_historical_bid_statistics_assignee_date
  ON historical_bid_statistics(assignee_name, bid_date);

CREATE INDEX IF NOT EXISTS idx_historical_bid_statistics_identity
  ON historical_bid_statistics(assignee_name, bid_date, court, case_number, item_number);
