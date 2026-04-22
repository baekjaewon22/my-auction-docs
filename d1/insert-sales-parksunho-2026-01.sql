-- 박선호(부산) 2026년 1월 매출 2건 추가

-- 1) 2026-01-06 남미혜 컨설팅계약 550,000원
INSERT INTO sales_records (
  id, user_id, type, type_detail, client_name, depositor_name, depositor_different,
  amount, contract_date, status, confirmed_at, confirmed_by,
  deposit_date, direction, memo, branch, department,
  appraisal_rate, winning_rate, client_phone,
  payment_type, receipt_type, receipt_phone
)
SELECT
  lower(hex(randomblob(16))),
  u.id,
  '계약', '컨설팅계약',
  '남미혜', '', 0,
  550000, '2026-01-06',
  'confirmed', datetime('now'), u.id,
  '2026-01-06', 'income',
  '1/7 현금영수증 발행 (010-5052-1611)',
  COALESCE(u.branch, ''), COALESCE(u.department, ''),
  50, 50, '010-5052-1611',
  '이체', '현금영수증', '010-5052-1611'
FROM users u
WHERE u.name = '박선호' AND u.branch = '부산'
LIMIT 1;

-- 2) 2026-01-07 김종만 낙찰수수료 2,882,000원
INSERT INTO sales_records (
  id, user_id, type, type_detail, client_name, depositor_name, depositor_different,
  amount, contract_date, status, confirmed_at, confirmed_by,
  deposit_date, direction, memo, branch, department,
  appraisal_rate, winning_rate, client_phone,
  payment_type, receipt_type, receipt_phone
)
SELECT
  lower(hex(randomblob(16))),
  u.id,
  '낙찰', '낙찰수수료',
  '김종만', '', 0,
  2882000, '2026-01-07',
  'confirmed', datetime('now'), u.id,
  '2026-01-07', 'income',
  '1/7 현금영수증 발행 (010-3588-3575)',
  COALESCE(u.branch, ''), COALESCE(u.department, ''),
  50, 50, '010-3588-3575',
  '이체', '현금영수증', '010-3588-3575'
FROM users u
WHERE u.name = '박선호' AND u.branch = '부산'
LIMIT 1;

-- 확인
SELECT contract_date, client_name, amount, type, type_detail, status, payment_type, receipt_type, memo
FROM sales_records
WHERE user_id = '42561610-aa0e-4248-8f55-5eba2e430b4b'
  AND contract_date >= '2026-01-01' AND contract_date < '2026-02-01'
ORDER BY contract_date;
