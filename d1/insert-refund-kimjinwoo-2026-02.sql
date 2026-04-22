-- 김진우(의정부) 2월 환불 건 추가: 최성권 1,100,000원 (2026-01-02 계약 → 2026-02-25 환불)

INSERT INTO sales_records (
  id, user_id, type, type_detail, client_name, depositor_name, depositor_different,
  amount, contract_date, status, confirmed_at, confirmed_by,
  refund_requested_at, refund_approved_at, refund_approved_by,
  deposit_date, direction, memo, branch, department,
  appraisal_rate, winning_rate, client_phone,
  payment_type, receipt_type, receipt_phone
)
SELECT
  lower(hex(randomblob(16))),
  u.id,
  '계약', '컨설팅계약',
  '최성권', '', 0,
  1100000, '2026-01-02',
  'refunded', datetime('2026-01-02'), u.id,
  datetime('2026-02-25'), datetime('2026-02-25'), u.id,
  '2026-01-02', 'income',
  '1/2 현금영수증 발행 (010-6203-0309) / 2/25 취소',
  COALESCE(u.branch, ''), COALESCE(u.department, ''),
  50, 50, '010-6203-0309',
  '이체', '현금영수증', '010-6203-0309'
FROM users u
WHERE u.id = 'unreg-kimjinwoo'
LIMIT 1;

-- 확인
SELECT contract_date, client_name, amount, type, status, refund_approved_at, payment_type, memo
FROM sales_records
WHERE user_id = 'unreg-kimjinwoo' AND client_name LIKE '%최성권%'
ORDER BY contract_date, amount;
