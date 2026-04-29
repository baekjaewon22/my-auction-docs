-- 컨설턴트(consultant) 기반 명도성과금 매핑을 위해 컬럼 추가
ALTER TABLE cases ADD COLUMN consultant_user_id TEXT;
ALTER TABLE cases ADD COLUMN consultant_branch TEXT;
ALTER TABLE cases ADD COLUMN consultant_department TEXT;

CREATE INDEX IF NOT EXISTS idx_cases_consultant_user ON cases(consultant_user_id);
