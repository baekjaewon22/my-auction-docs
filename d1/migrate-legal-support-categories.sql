ALTER TABLE admin_notes ADD COLUMN lawsuit_cost_requested INTEGER NOT NULL DEFAULT 0;

UPDATE admin_notes
SET legal_subcategory = 'lawsuit'
WHERE COALESCE(category, 'community') = 'legal_support'
  AND COALESCE(legal_subcategory, 'consultation') = 'consultation';

UPDATE admin_notes
SET legal_subcategory = 'legal_terms'
WHERE COALESCE(category, 'community') = 'legal_support'
  AND legal_subcategory = 'law_reference';

UPDATE admin_notes
SET legal_subcategory = 'lawsuit'
WHERE COALESCE(category, 'community') = 'legal_support'
  AND (legal_subcategory IS NULL OR legal_subcategory = '');
