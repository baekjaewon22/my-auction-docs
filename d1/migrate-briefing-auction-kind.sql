-- Existing submissions remain court auctions. Runtime schema setup also adds
-- this column for installations that have not applied this migration.
ALTER TABLE admin_notes ADD COLUMN auction_kind TEXT NOT NULL DEFAULT 'court';
