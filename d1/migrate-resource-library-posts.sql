CREATE TABLE IF NOT EXISTS resource_library_posts (
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

CREATE TABLE IF NOT EXISTS resource_library_post_files (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  file_type TEXT DEFAULT '',
  file_size INTEGER DEFAULT 0,
  uploaded_by TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now', '+9 hours')),
  FOREIGN KEY (post_id) REFERENCES resource_library_posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_resource_library_posts_visibility
  ON resource_library_posts(visibility, author_branch, author_department);
CREATE INDEX IF NOT EXISTS idx_resource_library_posts_created
  ON resource_library_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resource_library_post_files_post
  ON resource_library_post_files(post_id);

INSERT OR IGNORE INTO resource_library_posts (
  id, title, content, author_id, author_name, pinned, is_anonymous,
  visibility, author_branch, author_department, view_count, created_at, updated_at
)
SELECT id, title, content, author_id, author_name, COALESCE(pinned, 0), COALESCE(is_anonymous, 0),
  COALESCE(visibility, 'all'), COALESCE(author_branch, ''), COALESCE(author_department, ''),
  COALESCE(view_count, 0), created_at, updated_at
FROM admin_notes
WHERE COALESCE(category, 'community') = 'resource_library';

INSERT OR IGNORE INTO resource_library_post_files (
  id, post_id, object_key, file_name, file_type, file_size, uploaded_by, created_at
)
SELECT id, note_id, object_key, file_name, file_type, file_size, uploaded_by, created_at
FROM resource_library_files;
