-- Preserve cancellation/refund evidence from card upload source rows.

ALTER TABLE card_transactions ADD COLUMN is_cancellation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE card_transactions ADD COLUMN source_text TEXT NOT NULL DEFAULT '';
