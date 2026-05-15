ALTER TABLE admin_notes ADD COLUMN legal_subcategory TEXT DEFAULT 'consultation';

CREATE INDEX IF NOT EXISTS idx_admin_notes_legal_subcategory
  ON admin_notes(legal_subcategory);

UPDATE admin_notes
SET legal_subcategory = 'consultation'
WHERE COALESCE(category, 'community') = 'legal_support'
  AND COALESCE(legal_subcategory, '') = '';
