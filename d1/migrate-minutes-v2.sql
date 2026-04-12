-- [7-1] 회의록 원본 텍스트 + 변환 결과 저장
ALTER TABLE meeting_minutes ADD COLUMN raw_text TEXT NOT NULL DEFAULT '';
ALTER TABLE meeting_minutes ADD COLUMN converted_content TEXT NOT NULL DEFAULT '';
ALTER TABLE meeting_minutes ADD COLUMN source_type TEXT NOT NULL DEFAULT 'pdf' CHECK (source_type IN ('pdf', 'txt', 'manual'));

-- [7-3] 회의록 공유 대상
CREATE TABLE IF NOT EXISTS minutes_shares (
  id TEXT PRIMARY KEY,
  minutes_id TEXT NOT NULL,
  shared_with TEXT NOT NULL,
  shared_by TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (minutes_id) REFERENCES meeting_minutes(id) ON DELETE CASCADE,
  FOREIGN KEY (shared_with) REFERENCES users(id),
  FOREIGN KEY (shared_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_minutes_shares_user ON minutes_shares(shared_with);
CREATE INDEX IF NOT EXISTS idx_minutes_shares_minutes ON minutes_shares(minutes_id);

-- [7-1] API 키 저장 (대표 계정용)
ALTER TABLE users ADD COLUMN api_key TEXT NOT NULL DEFAULT '';
