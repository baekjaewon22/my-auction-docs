-- 법인카드 거래내역 (엑셀에서 파싱하여 저장)
CREATE TABLE IF NOT EXISTS card_transactions (
  id TEXT PRIMARY KEY,
  card_number TEXT NOT NULL DEFAULT '',
  user_id TEXT,
  branch TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '기타',
  merchant_name TEXT NOT NULL DEFAULT '',
  transaction_date TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  upload_batch TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_card_tx_card ON card_transactions(card_number);
CREATE INDEX IF NOT EXISTS idx_card_tx_user ON card_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_card_tx_date ON card_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_card_tx_branch ON card_transactions(branch);
CREATE INDEX IF NOT EXISTS idx_card_tx_batch ON card_transactions(upload_batch);
