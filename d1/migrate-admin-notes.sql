-- 관리자 노트 (게시판)
CREATE TABLE IF NOT EXISTS admin_notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  pinned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (author_id) REFERENCES users(id)
);

-- 댓글
CREATE TABLE IF NOT EXISTS admin_note_comments (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (note_id) REFERENCES admin_notes(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id)
);
