-- 2026-05-18 card upload cleanup
-- Backup and remove malformed duplicate April upload created during retest.

CREATE TABLE IF NOT EXISTS card_transactions_repair_backup_20260518 (
  id TEXT PRIMARY KEY,
  card_number TEXT,
  user_id TEXT,
  branch TEXT,
  category TEXT,
  merchant_name TEXT,
  transaction_date TEXT,
  amount INTEGER,
  description TEXT,
  upload_batch TEXT,
  created_at TEXT,
  repair_note TEXT
);

INSERT OR IGNORE INTO card_transactions_repair_backup_20260518 (
  id, card_number, user_id, branch, category, merchant_name, transaction_date,
  amount, description, upload_batch, created_at, repair_note
)
SELECT
  id, card_number, user_id, branch, category, merchant_name, transaction_date,
  amount, description, upload_batch, created_at,
  'delete malformed two-digit-date duplicate April upload'
FROM card_transactions
WHERE upload_batch = 'bade0324-5b42-4613-bf8a-c9b97e58a8f5';

DELETE FROM card_transactions
WHERE upload_batch = 'bade0324-5b42-4613-bf8a-c9b97e58a8f5';
