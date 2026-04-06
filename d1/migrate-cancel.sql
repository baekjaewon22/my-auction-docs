-- 문서 취소 기능: cancel_requested (취소신청 여부), cancel_reason (사유), cancelled (취소완료 여부)
ALTER TABLE documents ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN cancel_reason TEXT DEFAULT '';
ALTER TABLE documents ADD COLUMN cancelled INTEGER NOT NULL DEFAULT 0;
