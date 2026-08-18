-- 신정산 결산내역서를 명도 진행사항 사건과 연결한다.
ALTER TABLE lawitgo_new_settlements ADD COLUMN progress_id TEXT;

-- 기존 수신분은 external_id를 호환 연결키로 사용한다.
UPDATE lawitgo_new_settlements
SET progress_id = external_id
WHERE progress_id IS NULL OR progress_id = '';

CREATE INDEX IF NOT EXISTS idx_lawitgo_new_settlements_progress
ON lawitgo_new_settlements(progress_id);
