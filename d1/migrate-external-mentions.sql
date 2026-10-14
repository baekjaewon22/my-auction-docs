CREATE TABLE IF NOT EXISTS mention_api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'mentions:write' CHECK (scope = 'mentions:write'),
  token_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  last_used_at TEXT,
  revoked_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_mention_api_keys_hash ON mention_api_keys(token_hash);

CREATE TABLE IF NOT EXISTS mention_api_rate_limits (
  api_key_id TEXT NOT NULL,
  minute_bucket TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_id, minute_bucket),
  FOREIGN KEY (api_key_id) REFERENCES mention_api_keys(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mention_collection_runs (
  run_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed')),
  sources TEXT NOT NULL DEFAULT '[]',
  received_count INTEGER NOT NULL DEFAULT 0,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS external_mentions (
  id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('news', 'blog', 'cafe', 'community', 'youtube', 'instagram', 'x', 'facebook', 'other')),
  source_name TEXT NOT NULL,
  author TEXT,
  published_at TEXT,
  collected_at TEXT NOT NULL,
  title TEXT NOT NULL,
  snippet TEXT NOT NULL,
  thumbnail_url TEXT,
  language TEXT NOT NULL DEFAULT 'ko',
  matched_keywords TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT NOT NULL,
  relevance TEXT NOT NULL DEFAULT '{}',
  sentiment TEXT NOT NULL DEFAULT '{}',
  risk TEXT NOT NULL DEFAULT '{}',
  topics TEXT NOT NULL DEFAULT '[]',
  entities TEXT NOT NULL DEFAULT '[]',
  engagement TEXT NOT NULL DEFAULT '{}',
  duplicate_info TEXT NOT NULL DEFAULT '{}',
  evidence TEXT NOT NULL DEFAULT '[]',
  extra TEXT NOT NULL DEFAULT '{}',
  workflow_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (workflow_status IN ('unreviewed', 'reviewed', 'action_required', 'in_progress', 'resolved', 'excluded')),
  assigned_to TEXT,
  internal_note TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  reviewed_by TEXT,
  excluded INTEGER NOT NULL DEFAULT 0,
  exclusion_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_external_mentions_date ON external_mentions(COALESCE(published_at, collected_at) DESC);
CREATE INDEX IF NOT EXISTS idx_external_mentions_source ON external_mentions(source_type, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_external_mentions_workflow ON external_mentions(workflow_status, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_external_mentions_hash ON external_mentions(content_hash);

CREATE TABLE IF NOT EXISTS mention_digests (
  id TEXT PRIMARY KEY,
  report_key TEXT NOT NULL UNIQUE,
  report_date TEXT NOT NULL UNIQUE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '{}',
  stats TEXT NOT NULL DEFAULT '{}',
  urgent_mentions TEXT NOT NULL DEFAULT '[]',
  top_topics TEXT NOT NULL DEFAULT '[]',
  emerging_issues TEXT NOT NULL DEFAULT '[]',
  repeated_issues TEXT NOT NULL DEFAULT '[]',
  positive_mentions TEXT NOT NULL DEFAULT '[]',
  source_breakdown TEXT NOT NULL DEFAULT '[]',
  keyword_breakdown TEXT NOT NULL DEFAULT '[]',
  discovered_keywords TEXT NOT NULL DEFAULT '[]',
  data_quality TEXT NOT NULL DEFAULT '[]',
  extra TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mention_digests_date ON mention_digests(report_date DESC);
