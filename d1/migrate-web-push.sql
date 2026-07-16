-- Web Push subscriptions and delivery diagnostics (2026-07-16)
-- Apply before enabling VAPID secrets in production.
CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  endpoint_hash TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  device_label TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  last_success_at TEXT,
  last_failure_at TEXT,
  last_failure_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_web_push_subscriptions_user_active
  ON web_push_subscriptions(user_id, active, updated_at DESC);

CREATE TABLE IF NOT EXISTS web_push_delivery_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  subscription_id TEXT,
  attempt_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT 'self_test',
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  status_code INTEGER,
  error_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (subscription_id) REFERENCES web_push_subscriptions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_web_push_delivery_logs_user_created
  ON web_push_delivery_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_push_delivery_logs_user_attempt
  ON web_push_delivery_logs(user_id, event_type, attempt_id, created_at DESC);

CREATE TABLE IF NOT EXISTS web_push_subscription_audit (
  id TEXT PRIMARY KEY,
  endpoint_hash TEXT NOT NULL,
  previous_user_id TEXT,
  new_user_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('created', 'refreshed', 'transferred', 'unsubscribed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_web_push_subscription_audit_created
  ON web_push_subscription_audit(created_at DESC);
