-- 명도성과금 매출 자동 INSERT를 위한 멱등성 키 추가
-- external_id가 같으면 INSERT OR IGNORE로 한 번만 들어감

ALTER TABLE sales_records ADD COLUMN external_id TEXT;

-- NULL은 중복 허용, 값이 있을 때만 UNIQUE
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_records_external_id
  ON sales_records(external_id) WHERE external_id IS NOT NULL;
