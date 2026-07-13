CREATE TABLE IF NOT EXISTS notice_posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  pinned INTEGER DEFAULT 0,
  is_anonymous INTEGER DEFAULT 0,
  visibility TEXT DEFAULT 'all',
  author_branch TEXT DEFAULT '',
  author_department TEXT DEFAULT '',
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT DEFAULT (datetime('now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_notice_posts_created
  ON notice_posts(pinned DESC, created_at DESC);

INSERT OR IGNORE INTO notice_posts (
  id, title, content, author_id, author_name, pinned, is_anonymous,
  visibility, author_branch, author_department, view_count, created_at, updated_at
)
SELECT id, title, content, author_id, author_name, COALESCE(pinned, 0), COALESCE(is_anonymous, 0),
  COALESCE(visibility, 'all'), COALESCE(author_branch, ''), COALESCE(author_department, ''),
  COALESCE(view_count, 0), created_at, updated_at
FROM admin_notes
WHERE COALESCE(category, 'community') = 'notice';
