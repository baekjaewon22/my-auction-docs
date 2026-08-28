-- Master-reviewed repair snapshot for incomplete Lawitgo winning deliveries.
-- This data remains separate from accounting records and is merged only into
-- the outbound case-information payload.
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
