-- Preserve every replaced briefing/digest and store month-level mention summaries.
CREATE TABLE IF NOT EXISTS briefing_revisions (
  id TEXT PRIMARY KEY,
  briefing_id TEXT NOT NULL,
  report_key TEXT NOT NULL,
  revision INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (briefing_id, revision),
  FOREIGN KEY (briefing_id) REFERENCES briefings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_briefing_revisions_parent
  ON briefing_revisions(briefing_id, revision DESC);

CREATE TABLE IF NOT EXISTS mention_digest_revisions (
  id TEXT PRIMARY KEY,
  digest_id TEXT NOT NULL,
  report_key TEXT NOT NULL,
  revision INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (digest_id, revision),
  FOREIGN KEY (digest_id) REFERENCES mention_digests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mention_digest_revisions_parent
  ON mention_digest_revisions(digest_id, revision DESC);

CREATE TABLE IF NOT EXISTS mention_monthly_summaries (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL UNIQUE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  stats TEXT NOT NULL DEFAULT '{}',
  source_breakdown TEXT NOT NULL DEFAULT '[]',
  daily_trend TEXT NOT NULL DEFAULT '[]',
  sentiment_breakdown TEXT NOT NULL DEFAULT '[]',
  risk_breakdown TEXT NOT NULL DEFAULT '[]',
  top_topics TEXT NOT NULL DEFAULT '[]',
  repeated_issues TEXT NOT NULL DEFAULT '[]',
  discovered_keywords TEXT NOT NULL DEFAULT '[]',
  workflow_breakdown TEXT NOT NULL DEFAULT '[]',
  extra TEXT NOT NULL DEFAULT '{}',
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mention_monthly_summaries_month
  ON mention_monthly_summaries(month DESC);
