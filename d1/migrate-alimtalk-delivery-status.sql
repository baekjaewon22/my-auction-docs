-- 알림톡 접수/최종전달 상태 추적 컬럼
-- SQLite는 ADD COLUMN IF NOT EXISTS를 지원하지 않으므로 운영 적용 전 PRAGMA로 존재 여부를 확인한다.

ALTER TABLE alimtalk_logs ADD COLUMN request_status_code TEXT;
ALTER TABLE alimtalk_logs ADD COLUMN request_status_name TEXT;
ALTER TABLE alimtalk_logs ADD COLUMN request_status_desc TEXT;
ALTER TABLE alimtalk_logs ADD COLUMN message_status_code TEXT;
ALTER TABLE alimtalk_logs ADD COLUMN message_status_name TEXT;
ALTER TABLE alimtalk_logs ADD COLUMN message_status_desc TEXT;
ALTER TABLE alimtalk_logs ADD COLUMN complete_time TEXT;
ALTER TABLE alimtalk_logs ADD COLUMN delivery_checked_at TEXT;
ALTER TABLE alimtalk_logs ADD COLUMN updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_alimtalk_logs_message_id ON alimtalk_logs(message_id);
CREATE INDEX IF NOT EXISTS idx_alimtalk_logs_status ON alimtalk_logs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_alimtalk_logs_dedupe ON alimtalk_logs(template_code, related_type, related_id, recipient_phone);
