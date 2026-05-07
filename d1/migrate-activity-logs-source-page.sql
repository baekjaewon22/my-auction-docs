-- 활동이력에 발생 페이지 구분 컬럼 추가
-- 업무성과 vs 회계장부 분리 (메모 작성자 포함 페이지별 식별)
-- 기존 행은 모두 sales 페이지에서 발생한 것으로 간주 (대부분 매출 관련)

ALTER TABLE accounting_activity_logs ADD COLUMN source_page TEXT NOT NULL DEFAULT 'sales';
CREATE INDEX IF NOT EXISTS idx_acc_logs_source_page ON accounting_activity_logs(source_page);
