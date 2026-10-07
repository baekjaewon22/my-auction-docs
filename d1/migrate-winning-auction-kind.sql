-- Existing databases only. Runtime also checks PRAGMA table_info before adding this column.
ALTER TABLE lawitgo_winning_overrides ADD COLUMN auction_kind TEXT NOT NULL DEFAULT 'court';

UPDATE lawitgo_winning_overrides
SET auction_kind = 'public', court = ''
WHERE sales_record_id IN (
  SELECT id FROM sales_records WHERE type_detail LIKE '[공매]%'
);
