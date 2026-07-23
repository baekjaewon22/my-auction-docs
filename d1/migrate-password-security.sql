-- 비밀번호 변경 시 기존 JWT 무효화 + Worker 인스턴스에 의존하지 않는 1회용 재설정 흐름
ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS password_reset_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  verified_at INTEGER,
  reset_token_hash TEXT UNIQUE,
  reset_expires_at INTEGER,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_password_reset_user_created
  ON password_reset_challenges(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_reset_token
  ON password_reset_challenges(reset_token_hash);
