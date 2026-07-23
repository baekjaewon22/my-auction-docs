-- One-time data repair. Review/backup production D1 before running this file.
-- Card recognition is based only on card_deposit_date, never product type.
UPDATE sales_records
SET status = 'card_pending', updated_at = datetime('now', '+9 hours')
WHERE payment_type = '카드'
  AND COALESCE(direction, 'income') != 'expense'
  AND status = 'confirmed'
  AND TRIM(COALESCE(card_deposit_date, '')) = '';

UPDATE sales_records
SET status = 'confirmed', updated_at = datetime('now', '+9 hours')
WHERE payment_type = '카드'
  AND status = 'card_pending'
  AND TRIM(COALESCE(card_deposit_date, '')) != '';

-- card_pending is a card-only workflow state. Preserve the existing non-card
-- confirmation behavior if a payment method was changed after confirmation.
UPDATE sales_records
SET status = 'confirmed', updated_at = datetime('now', '+9 hours')
WHERE COALESCE(payment_type, '') != '카드'
  AND status = 'card_pending';
