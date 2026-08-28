-- 부분환불(partial refund) 지원
-- refund_amount = 이 매출에서 환불된 총액(원). 프리랜서 공제(clawback)는 이 금액에 비례해 산정한다.
-- 전액환불(status='refunded')은 refund_amount = amount 로 백필하여 기존 동작(전액 기준 공제)을 그대로 보존한다.
-- 부분환불은 status를 'confirmed'로 유지(집계는 원금 그대로)하고 refund_amount / refund_approved_at 만 기록한다.
ALTER TABLE sales_records ADD COLUMN refund_amount INTEGER NOT NULL DEFAULT 0;
UPDATE sales_records SET refund_amount = amount WHERE status = 'refunded' AND COALESCE(refund_amount, 0) = 0;
