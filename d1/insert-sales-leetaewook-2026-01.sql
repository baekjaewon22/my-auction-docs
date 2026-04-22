-- 이태욱(부산지사) 2026년 1월 매출 2건 추가
-- 실행: npx wrangler d1 execute auction-docs-db --remote --file=d1/insert-sales-leetaewook-2026-01.sql

-- 1) 2026-01-06 변해용 계약 220,000원 (VAT 포함) / 현금영수증 1/7발행
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
  '변해용', '', 0,
  220000, '2026-01-06',
  'confirmed', datetime('now'), u.id,
  '2026-01-06', 'income',
  '1/7 현금영수증 발행 (010-7272-7969)',
  COALESCE(u.branch, ''), COALESCE(u.department, ''),
  50, 50, '010-7272-7969',
  '이체', '현금영수증', '010-7272-7969'
FROM users u
WHERE u.name = '이태욱' AND u.branch = '부산'
LIMIT 1;

-- 2) 2026-01-23 이소연 계약 500,000원 (VAT 포함)
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
  '이소연', '', 0,
  500000, '2026-01-23',
  'confirmed', datetime('now'), u.id,
  '2026-01-23', 'income',
  '',
  COALESCE(u.branch, ''), COALESCE(u.department, ''),
  50, 50, '',
  '이체', '', ''
FROM users u
WHERE u.name = '이태욱' AND u.branch = '부산'
LIMIT 1;

-- 확인
SELECT contract_date, client_name, amount, type, type_detail, status, payment_type, receipt_type, memo
FROM sales_records
WHERE user_id = (SELECT id FROM users WHERE name = '이태욱' AND branch = '부산' LIMIT 1)
  AND contract_date >= '2026-01-01' AND contract_date < '2026-02-01'
ORDER BY contract_date;
