ALTER TABLE card_transactions ADD COLUMN usage_category TEXT NOT NULL DEFAULT '';
ALTER TABLE card_transactions ADD COLUMN usage_item TEXT NOT NULL DEFAULT '';
ALTER TABLE card_transactions ADD COLUMN updated_at TEXT;
