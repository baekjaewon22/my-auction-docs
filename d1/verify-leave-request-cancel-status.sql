-- Read-only checks to run immediately after the leave_requests rebuild.
SELECT sql AS leave_requests_schema
FROM sqlite_master
WHERE type = 'table' AND name = 'leave_requests';

SELECT COUNT(*) AS row_count,
       SUM(hours) AS total_hours,
       SUM(days) AS total_days,
       MIN(created_at) AS first_created_at,
       MAX(created_at) AS last_created_at
FROM leave_requests;

SELECT status, COUNT(*) AS row_count
FROM leave_requests
GROUP BY status
ORDER BY status;

SELECT name, sql
FROM sqlite_master
WHERE type = 'index' AND tbl_name = 'leave_requests'
ORDER BY name;

SELECT user_id, leave_type, start_date, end_date,
       COALESCE(half_day_period, '') AS half_day_period,
       COUNT(*) AS duplicate_count
FROM leave_requests
WHERE status IN ('pending', 'approved', 'cancel_requested')
GROUP BY user_id, leave_type, start_date, end_date, COALESCE(half_day_period, '')
HAVING COUNT(*) > 1;

SELECT user_id, summer_request_year, COUNT(*) AS duplicate_count
FROM leave_requests
WHERE summer_request_year IS NOT NULL
  AND status IN ('pending', 'approved', 'cancel_requested')
GROUP BY user_id, summer_request_year
HAVING COUNT(*) > 1;

-- Both orphan checks must return zero rows.
SELECT lr.id, lr.user_id
FROM leave_requests lr
LEFT JOIN users u ON u.id = lr.user_id
WHERE u.id IS NULL;

SELECT lr.id, lr.approved_by
FROM leave_requests lr
LEFT JOIN users u ON u.id = lr.approved_by
WHERE lr.approved_by IS NOT NULL AND lr.approved_by <> '' AND u.id IS NULL;
