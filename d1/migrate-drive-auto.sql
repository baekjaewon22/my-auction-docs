-- Drive 전자동 백업 마이그레이션
-- refresh_token 암호화 저장 + 자동 실행 상태 추적

-- 1. 기존 백업 로그 전체 삭제 (OAuth scope 변경으로 기존 파일은 사용자가 수동 삭제)
DELETE FROM drive_backup_logs;

-- 2. drive_settings에 OAuth 토큰 및 자동화 관련 컬럼 추가
ALTER TABLE drive_settings ADD COLUMN refresh_token_encrypted TEXT DEFAULT '';
ALTER TABLE drive_settings ADD COLUMN token_iv TEXT DEFAULT '';
ALTER TABLE drive_settings ADD COLUMN auto_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE drive_settings ADD COLUMN last_cron_run_at TEXT;
ALTER TABLE drive_settings ADD COLUMN last_cron_status TEXT;
ALTER TABLE drive_settings ADD COLUMN last_cron_summary TEXT;

-- 3. 연결 정보 초기화 (기존 access_token만 쓰던 반자동 설정 제거)
UPDATE drive_settings SET
  root_folder_id = '',
  root_folder_name = '',
  connected_email = '',
  connected_by = NULL,
  connected_at = NULL,
  updated_at = datetime('now')
WHERE id = 'default';
