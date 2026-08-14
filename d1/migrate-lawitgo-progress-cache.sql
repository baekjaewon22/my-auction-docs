CREATE TABLE IF NOT EXISTS lawitgo_progress_cache (
  consultant_id TEXT NOT NULL,
  progress_id TEXT NOT NULL,
  item_json TEXT NOT NULL,
  ui_html TEXT NOT NULL DEFAULT '',
  ui_css TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (consultant_id, progress_id)
);

CREATE INDEX IF NOT EXISTS idx_lawitgo_progress_cache_active
ON lawitgo_progress_cache(active, progress_id);

CREATE TABLE IF NOT EXISTS lawitgo_progress_cache_runs (
  consultant_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  item_count INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  last_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  error_message TEXT NOT NULL DEFAULT ''
);
