-- 계약 미포함 플래그 (중복 계약 시 갯수 카운트에서 제외)
ALTER TABLE sales_records ADD COLUMN exclude_from_count INTEGER NOT NULL DEFAULT 0;
