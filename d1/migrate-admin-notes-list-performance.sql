UPDATE admin_notes
SET category = 'community'
WHERE category IS NULL OR TRIM(category) = '';

CREATE INDEX IF NOT EXISTS idx_admin_notes_list_order
ON admin_notes(category, legal_subcategory, pinned DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_notes_category_order
ON admin_notes(category, pinned DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notice_posts_created
ON notice_posts(pinned DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_resource_library_posts_created
ON resource_library_posts(created_at DESC);
