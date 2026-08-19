-- 서정수 이사는 부산지사를 관리하지만, 모든 매출은 의정부지사에 귀속한다.
UPDATE sales_records
SET attribution_branch = '의정부본사',
    updated_at = datetime('now', '+9 hours')
WHERE user_id IN (
  SELECT id
  FROM users
  WHERE name = '서정수'
);
