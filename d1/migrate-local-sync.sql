-- sales_records 새 컬럼
ALTER TABLE sales_records ADD COLUMN payment_type TEXT NOT NULL DEFAULT '';
ALTER TABLE sales_records ADD COLUMN receipt_type TEXT NOT NULL DEFAULT '';
ALTER TABLE sales_records ADD COLUMN receipt_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE sales_records ADD COLUMN card_deposit_date TEXT NOT NULL DEFAULT '';

-- alimtalk_logs 테이블 (로컬에 없을 수 있음)
CREATE TABLE IF NOT EXISTS alimtalk_logs (
  id TEXT PRIMARY KEY,
  template_code TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  recipient_user_id TEXT,
  content TEXT NOT NULL,
  request_id TEXT,
  message_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  related_type TEXT,
  related_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
