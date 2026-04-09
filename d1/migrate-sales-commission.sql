-- [6-1] 계약 수수료 계산 필드
ALTER TABLE sales_records ADD COLUMN appraisal_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_records ADD COLUMN winning_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_records ADD COLUMN appraisal_rate REAL NOT NULL DEFAULT 0;
ALTER TABLE sales_records ADD COLUMN winning_rate REAL NOT NULL DEFAULT 0;
ALTER TABLE sales_records ADD COLUMN commission_amount INTEGER NOT NULL DEFAULT 0;

-- [6-2] 계약서 제출/미제출 체크
ALTER TABLE sales_records ADD COLUMN contract_submitted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_records ADD COLUMN contract_not_submitted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_records ADD COLUMN contract_not_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE sales_records ADD COLUMN contract_not_approved INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_records ADD COLUMN contract_not_approved_by TEXT DEFAULT NULL;
