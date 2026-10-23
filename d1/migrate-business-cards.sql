CREATE TABLE IF NOT EXISTS business_cards (
  user_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  draft TEXT NOT NULL,
  published TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS business_card_events (
  slug TEXT NOT NULL,
  visitor TEXT NOT NULL,
  kind TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (slug, visitor, kind, bucket)
);
CREATE TABLE IF NOT EXISTS business_card_short_links (
  code TEXT PRIMARY KEY,
  card_slug TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS business_card_messages (
  user_id TEXT PRIMARY KEY,
  template TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
