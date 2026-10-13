CREATE TABLE IF NOT EXISTS briefings (
  id TEXT PRIMARY KEY,
  report_key TEXT NOT NULL UNIQUE,
  site TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('weekly', 'monthly')),
  report_date TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  kpis TEXT NOT NULL DEFAULT '{}',
  highlights TEXT NOT NULL DEFAULT '[]',
  warnings TEXT NOT NULL DEFAULT '[]',
  checks TEXT NOT NULL DEFAULT '[]',
  todos TEXT NOT NULL DEFAULT '[]',
  reels TEXT NOT NULL DEFAULT '[]',
  channels TEXT NOT NULL DEFAULT '[]',
  devices TEXT NOT NULL DEFAULT '[]',
  landing TEXT NOT NULL DEFAULT '{}',
  audience TEXT NOT NULL DEFAULT '[]',
  corrections TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '[]',
  compare_period TEXT,
  generator TEXT,
  extra TEXT NOT NULL DEFAULT '{}',
  content_md TEXT NOT NULL,
  html TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_briefings_site_type_date
  ON briefings(site, type, report_date DESC);

CREATE TABLE IF NOT EXISTS briefing_api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  site TEXT,
  scope TEXT NOT NULL DEFAULT 'briefings:write' CHECK (scope = 'briefings:write'),
  token_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  last_used_at TEXT,
  revoked_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_briefing_api_keys_hash ON briefing_api_keys(token_hash);

CREATE TABLE IF NOT EXISTS briefing_api_rate_limits (
  api_key_id TEXT NOT NULL,
  minute_bucket TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_id, minute_bucket),
  FOREIGN KEY (api_key_id) REFERENCES briefing_api_keys(id) ON DELETE CASCADE
);
