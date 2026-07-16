-- Read-only preflight for the leave_requests rebuild.
-- Stop and investigate unless the column list is the exact expected 21-column
-- layout and every problem query below returns zero rows.

SELECT COUNT(*) AS column_count
FROM pragma_table_info('leave_requests');

SELECT cid, name, type, "notnull" AS is_not_null, dflt_value, pk
FROM pragma_table_info('leave_requests')
ORDER BY cid;

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

-- Must return zero rows: requests whose owner no longer exists.
SELECT lr.id, lr.user_id
FROM leave_requests lr
LEFT JOIN users u ON u.id = lr.user_id
WHERE u.id IS NULL;

-- Must return zero rows: approver references whose user no longer exists.
SELECT lr.id, lr.approved_by
FROM leave_requests lr
LEFT JOIN users u ON u.id = lr.approved_by
WHERE lr.approved_by IS NOT NULL AND lr.approved_by <> '' AND u.id IS NULL;

-- Must return zero rows: duplicates that would prevent unique index creation.
SELECT user_id, leave_type, start_date, end_date,
       COALESCE(half_day_period, '') AS half_day_period,
       COUNT(*) AS duplicate_count
FROM leave_requests
WHERE status IN ('pending', 'approved', 'cancel_requested')
GROUP BY user_id, leave_type, start_date, end_date, COALESCE(half_day_period, '')
HAVING COUNT(*) > 1;

-- Must return zero rows.
SELECT user_id, summer_request_year, COUNT(*) AS duplicate_count
FROM leave_requests
WHERE summer_request_year IS NOT NULL
  AND status IN ('pending', 'approved', 'cancel_requested')
GROUP BY user_id, summer_request_year
HAVING COUNT(*) > 1;

SELECT type, name, sql
FROM sqlite_master
WHERE (type = 'index' AND tbl_name = 'leave_requests')
   OR (type = 'trigger' AND tbl_name = 'leave_requests')
ORDER BY type, name;

-- Review any inbound foreign-key references before rebuilding the table.
SELECT m.name AS referencing_table
FROM sqlite_master m
WHERE m.type = 'table'
  AND m.name <> 'leave_requests'
  AND lower(m.sql) LIKE '%references leave_requests%';
