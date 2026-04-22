-- 윤현석(대전) 2026년 1월 매출(카드정산 기준) 1건 추가
-- 계약일 2025-12-30 / 카드정산일 2026-01-07 / 헥토 / 현금영수증 미발행

INSERT INTO sales_records (
  id, user_id, type, type_detail, client_name, depositor_name, depositor_different,
  amount, contract_date, status, confirmed_at, confirmed_by,
  deposit_date, card_deposit_date, direction, memo, branch, department,
  appraisal_rate, winning_rate, client_phone,
  payment_type, receipt_type, receipt_phone
)
SELECT
  lower(hex(randomblob(16))),
  u.id,
  '계약', '컨설팅계약',
  '박정수', '', 0,
  550000, '2025-12-30',
  'confirmed', datetime('now'), u.id,
  '2025-12-30', '2026-01-07', 'income',
  '헥토',
  COALESCE(u.branch, ''), COALESCE(u.department, ''),
  50, 50, '010-7942-2893',
  '카드', '', ''
FROM users u
WHERE u.name = '윤현석' AND u.branch = '대전'
LIMIT 1;

-- 확인
SELECT contract_date, client_name, amount, type, type_detail, status, payment_type, receipt_type, card_deposit_date, memo
FROM sales_records
WHERE user_id = 'a6c0c9cd-cbb4-4d6d-b9f9-918f4367e8b6'
  AND (contract_date >= '2026-01-01' AND contract_date < '2026-02-01'
       OR card_deposit_date >= '2026-01-01' AND card_deposit_date < '2026-02-01')
ORDER BY COALESCE(card_deposit_date, contract_date);
