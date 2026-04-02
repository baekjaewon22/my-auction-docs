-- 알림톡 발송 이력
CREATE TABLE IF NOT EXISTS alimtalk_logs (
  id TEXT PRIMARY KEY,
  template_code TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  recipient_user_id TEXT,
  content TEXT NOT NULL,
  request_id TEXT,
  message_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  related_type TEXT,
  related_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 알림톡 수신자 관리 (관리자가 카테고리별 수신자 오버라이드)
CREATE TABLE IF NOT EXISTS alimtalk_recipients (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  user_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- 회원가입 인증코드 (카카오 알림톡용)
CREATE TABLE IF NOT EXISTS signup_verifications (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  code TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_alimtalk_logs_template ON alimtalk_logs(template_code);
CREATE INDEX IF NOT EXISTS idx_alimtalk_logs_related ON alimtalk_logs(related_type, related_id);
CREATE INDEX IF NOT EXISTS idx_alimtalk_recipients_category ON alimtalk_recipients(category);
CREATE INDEX IF NOT EXISTS idx_signup_verifications_phone ON signup_verifications(phone);
