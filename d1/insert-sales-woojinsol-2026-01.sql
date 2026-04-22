-- 우진솔(대전) 1월 매출: 최시연 추가 + 김홍진 날짜 수정 + 전 레코드 전화번호 입력

-- 1) 최시연 낙찰수수료 2,827,000원 추가 (2026-01-06)
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
  '최시연', '', 0,
  2827000, '2026-01-06',
  'confirmed', datetime('now'), u.id,
  '2026-01-06', 'income',
  '1/6 현금영수증 발행 (010-3739-0964)',
  COALESCE(u.branch, ''), COALESCE(u.department, ''),
  50, 50, '010-3739-0964',
  '이체', '현금영수증', '010-3739-0964'
FROM users u
WHERE u.name = '우진솔' AND u.branch = '대전'
LIMIT 1;

-- 2) 김홍진 날짜 수정: contract_date 2026-01-02 → 2026-01-09
UPDATE sales_records
SET contract_date = '2026-01-09', updated_at = datetime('now')
WHERE id = '51aca831-fee4-4512-bb53-c31c7b4a7eba';

-- 3) 전화번호 일괄 입력
UPDATE sales_records SET client_phone = '010-8272-5185', updated_at = datetime('now')
  WHERE id = '51aca831-fee4-4512-bb53-c31c7b4a7eba'; -- 김홍진
UPDATE sales_records SET client_phone = '010-9673-3388', receipt_phone = '010-9673-3388', updated_at = datetime('now')
  WHERE id = 'ee5183c2-ecf8-4d81-9305-7ae47906b25e'; -- 강행원
UPDATE sales_records SET client_phone = '010-9894-8100', receipt_phone = '010-9894-8100', updated_at = datetime('now')
  WHERE id = '36c1dd61-0ffb-4e2a-b5ca-752f1f04dbea'; -- 박상용 1/19
UPDATE sales_records SET client_phone = '010-4456-8424', receipt_phone = '010-4456-8424', updated_at = datetime('now')
  WHERE id = '4db0d218-8fc1-4fb9-aad4-e9e8afeac01e'; -- 박영주
UPDATE sales_records SET client_phone = '010-4126-3005', receipt_phone = '010-4126-3005', updated_at = datetime('now')
  WHERE id = 'da804e8e-43a1-4cec-b6c1-5ddd589d18c3'; -- 박지혜
UPDATE sales_records SET client_phone = '010-9894-8100', receipt_phone = '010-9894-8100', updated_at = datetime('now')
  WHERE id = '431adee2-c5ef-4d65-8775-df128a042e8c'; -- 박상용 1/28

-- 확인
SELECT contract_date, client_name, amount, type, payment_type, receipt_type, client_phone, card_deposit_date, memo
FROM sales_records
WHERE user_id = '53a6db3e-3ea3-43c4-94d9-bbb88a4344d1'
  AND contract_date >= '2026-01-01' AND contract_date < '2026-02-01'
ORDER BY contract_date, client_name;
