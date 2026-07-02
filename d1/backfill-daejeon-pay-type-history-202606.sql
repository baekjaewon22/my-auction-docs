INSERT OR IGNORE INTO user_pay_type_history (
  id, user_id, effective_month, pay_type, commission_rate, salary, standard_sales,
  grade, position_allowance, source, changed_by
)
SELECT
  'daejeon-before-202606-' || u.id,
  u.id,
  '1900-01',
  'commission',
  50,
  0,
  0,
  '',
  0,
  'daejeon_202606_backfill_before',
  'system-backfill'
FROM users u
WHERE u.id IN (
  '78970f43-2638-4aab-b6b4-46b4afaa47ea',
  '77790f10-79d9-44b4-8e3d-ba475b388f16',
  '48122e54-23a3-430d-8735-63517d107825',
  '53a6db3e-3ea3-43c4-94d9-bbb88a4344d1',
  'a6c0c9cd-cbb4-4d6d-b9f9-918f4367e8b6'
);

INSERT OR IGNORE INTO user_pay_type_history (
  id, user_id, effective_month, pay_type, commission_rate, salary, standard_sales,
  grade, position_allowance, source, changed_by
)
SELECT
  'daejeon-salary-202606-' || u.id,
  u.id,
  '2026-06',
  'salary',
  0,
  COALESCE(ua.salary, 0),
  COALESCE(ua.standard_sales, 0),
  COALESCE(ua.grade, ''),
  COALESCE(ua.position_allowance, 0),
  'daejeon_202606_backfill_salary',
  'system-backfill'
FROM users u
JOIN user_accounting ua ON ua.user_id = u.id
WHERE u.id IN (
  '78970f43-2638-4aab-b6b4-46b4afaa47ea',
  '77790f10-79d9-44b4-8e3d-ba475b388f16',
  '48122e54-23a3-430d-8735-63517d107825',
  '53a6db3e-3ea3-43c4-94d9-bbb88a4344d1',
  'a6c0c9cd-cbb4-4d6d-b9f9-918f4367e8b6'
);
