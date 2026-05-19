-- 2026-05-18 카드사용내역 금액 부호 오류 복구
-- 원인: 2026-05 업로드 파서가 일반 사용액을 음수로 저장하면서
--       2026-04 중복 음수 배치가 기존 양수 배치를 상쇄함.

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
  CASE
    WHEN upload_batch IN ('9c085fcf-1c71-4142-931f-db51aa8f0970', 'fbd37464-a8a1-4b8d-9f7b-6cd33120e934')
      THEN 'delete duplicated negative April upload'
    WHEN upload_batch = 'e5694cfc-4a70-4caf-8602-e28304560c25'
      THEN 'flip negative May upload to positive usage'
    ELSE 'unknown'
  END
FROM card_transactions
WHERE upload_batch IN (
  '9c085fcf-1c71-4142-931f-db51aa8f0970',
  'fbd37464-a8a1-4b8d-9f7b-6cd33120e934',
  'e5694cfc-4a70-4caf-8602-e28304560c25'
);

DELETE FROM card_transactions
WHERE upload_batch IN (
  '9c085fcf-1c71-4142-931f-db51aa8f0970',
  'fbd37464-a8a1-4b8d-9f7b-6cd33120e934'
);

UPDATE card_transactions
SET amount = ABS(amount)
WHERE upload_batch = 'e5694cfc-4a70-4caf-8602-e28304560c25'
  AND amount < 0;
