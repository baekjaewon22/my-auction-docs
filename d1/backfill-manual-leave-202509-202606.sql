-- Manual leave backfill requested on 2026-06-22.
-- ASCII-only SQL: Korean leave types are expressed with SQLite char().
-- yeoncha = char(50672,52264), bancha = char(48152,52264), teukbyeolhyuga = char(53945,48324,55092,44032)

-- Correct typo: Park Junggyu 2026-06-01 annual -> 2026-06-06 annual.
UPDATE leave_requests
SET start_date = '2026-06-06',
    end_date = '2026-06-06',
    updated_at = datetime('now')
WHERE user_id = '1e5767a7-67d7-4dc3-aac1-e3d756b50279'
  AND leave_type = char(50672,52264)
  AND start_date = '2026-06-01'
  AND end_date = '2026-06-01'
  AND status = 'approved';

WITH manual(id, user_id, leave_type, target_date, hours, days) AS (
  VALUES
    ('manual-leave-hjt-20250929-annual', '7877b6db-cbc7-4684-b63b-29bd7eafe648', char(50672,52264), '2025-09-29', 8, 1),
    ('manual-leave-chj-20251002-half', '7c94e38c-1fd2-402e-8f3f-be1bcbe8728f', char(48152,52264), '2025-10-02', 4, 0.5),
    ('manual-leave-chj-20251028-annual', '7c94e38c-1fd2-402e-8f3f-be1bcbe8728f', char(50672,52264), '2025-10-28', 8, 1),
    ('manual-leave-kyh-20251031-annual', 'b49dcd3d-0303-432d-a2b7-ceab3e69ebbd', char(50672,52264), '2025-10-31', 8, 1),
    ('manual-leave-kyh-20251106-annual', 'b49dcd3d-0303-432d-a2b7-ceab3e69ebbd', char(50672,52264), '2025-11-06', 8, 1),
    ('manual-leave-hjt-20251113-half', '7877b6db-cbc7-4684-b63b-29bd7eafe648', char(48152,52264), '2025-11-13', 4, 0.5),
    ('manual-leave-chj-20251117-annual', '7c94e38c-1fd2-402e-8f3f-be1bcbe8728f', char(50672,52264), '2025-11-17', 8, 1),
    ('manual-leave-chj-20251118-annual', '7c94e38c-1fd2-402e-8f3f-be1bcbe8728f', char(50672,52264), '2025-11-18', 8, 1),
    ('manual-leave-kyh-20251124-annual', 'b49dcd3d-0303-432d-a2b7-ceab3e69ebbd', char(50672,52264), '2025-11-24', 8, 1),
    ('manual-leave-hjt-20251126-half', '7877b6db-cbc7-4684-b63b-29bd7eafe648', char(48152,52264), '2025-11-26', 4, 0.5),
    ('manual-leave-hjt-20251216-half', '7877b6db-cbc7-4684-b63b-29bd7eafe648', char(48152,52264), '2025-12-16', 4, 0.5),
    ('manual-leave-chj-20251224-annual', '7c94e38c-1fd2-402e-8f3f-be1bcbe8728f', char(50672,52264), '2025-12-24', 8, 1),
    ('manual-leave-kyh-20251226-annual', 'b49dcd3d-0303-432d-a2b7-ceab3e69ebbd', char(50672,52264), '2025-12-26', 8, 1),
    ('manual-leave-hjt-20251226-annual', '7877b6db-cbc7-4684-b63b-29bd7eafe648', char(50672,52264), '2025-12-26', 8, 1),
    ('manual-leave-hjt-20260106-annual', '7877b6db-cbc7-4684-b63b-29bd7eafe648', char(50672,52264), '2026-01-06', 8, 1),
    ('manual-leave-kyh-20260119-annual', 'b49dcd3d-0303-432d-a2b7-ceab3e69ebbd', char(50672,52264), '2026-01-19', 8, 1),
    ('manual-leave-kyh-20260123-annual', 'b49dcd3d-0303-432d-a2b7-ceab3e69ebbd', char(50672,52264), '2026-01-23', 8, 1),
    ('manual-leave-hjt-20260126-half', '7877b6db-cbc7-4684-b63b-29bd7eafe648', char(48152,52264), '2026-01-26', 4, 0.5),
    ('manual-leave-kyh-20260205-half', 'b49dcd3d-0303-432d-a2b7-ceab3e69ebbd', char(48152,52264), '2026-02-05', 4, 0.5),
    ('manual-leave-hjt-20260224-half', '7877b6db-cbc7-4684-b63b-29bd7eafe648', char(48152,52264), '2026-02-24', 4, 0.5),
    ('manual-leave-hjt-20260226-half', '7877b6db-cbc7-4684-b63b-29bd7eafe648', char(48152,52264), '2026-02-26', 4, 0.5),
    ('manual-leave-kyh-20260310-half', 'b49dcd3d-0303-432d-a2b7-ceab3e69ebbd', char(48152,52264), '2026-03-10', 4, 0.5),
    ('manual-leave-kyh-20260318-half', 'b49dcd3d-0303-432d-a2b7-ceab3e69ebbd', char(48152,52264), '2026-03-18', 4, 0.5),
    ('manual-leave-hjt-20260324-annual', '7877b6db-cbc7-4684-b63b-29bd7eafe648', char(50672,52264), '2026-03-24', 8, 1),
    ('manual-leave-hjt-20260327-half', '7877b6db-cbc7-4684-b63b-29bd7eafe648', char(48152,52264), '2026-03-27', 4, 0.5),
    ('manual-leave-kyh-20260330-half', 'b49dcd3d-0303-432d-a2b7-ceab3e69ebbd', char(48152,52264), '2026-03-30', 4, 0.5),
    ('manual-leave-syj-20260410-annual', '0ccaee57-e9f4-4c90-847a-d04965b8d390', char(50672,52264), '2026-04-10', 8, 1),
    ('manual-leave-kyh-20260420-half', 'b49dcd3d-0303-432d-a2b7-ceab3e69ebbd', char(48152,52264), '2026-04-20', 4, 0.5),
    ('manual-leave-chj-20260424-annual', '7c94e38c-1fd2-402e-8f3f-be1bcbe8728f', char(50672,52264), '2026-04-24', 8, 1),
    ('manual-leave-kyh-20260430-half', 'b49dcd3d-0303-432d-a2b7-ceab3e69ebbd', char(48152,52264), '2026-04-30', 4, 0.5),
    ('manual-leave-ytg-20260504-annual', '082a851c-2979-48c8-a202-d5028723a39d', char(50672,52264), '2026-05-04', 8, 1)
)
INSERT INTO leave_requests (
  id, user_id, leave_type, start_date, end_date, hours, days, reason,
  status, approved_by, approved_at, branch, department, half_day_period
)
SELECT
  m.id, m.user_id, m.leave_type, m.target_date, m.target_date, m.hours, m.days,
  'manual backfill', 'approved', 'admin-001', datetime('now'), '', '', ''
FROM manual m
WHERE NOT EXISTS (
  SELECT 1
  FROM leave_requests lr
  WHERE lr.user_id = m.user_id
    AND lr.leave_type = m.leave_type
    AND lr.start_date = m.target_date
    AND lr.end_date = m.target_date
    AND lr.status IN ('pending', 'approved', 'cancel_requested')
);

-- Recalculate stored usage from approved request history for affected users.
UPDATE annual_leave
SET
  used_days = CASE
    WHEN leave_type = 'annual' THEN (
      SELECT ROUND(COALESCE(SUM(COALESCE(lr.hours, lr.days * 8)), 0) / 8, 3)
      FROM leave_requests lr
      WHERE lr.user_id = annual_leave.user_id
        AND lr.status = 'approved'
        AND lr.leave_type != char(53945,48324,55092,44032)
    )
    ELSE 0
  END,
  monthly_used = CASE
    WHEN leave_type = 'monthly' THEN (
      SELECT ROUND(COALESCE(SUM(COALESCE(lr.hours, lr.days * 8)), 0) / 8, 3)
      FROM leave_requests lr
      WHERE lr.user_id = annual_leave.user_id
        AND lr.status = 'approved'
        AND lr.leave_type != char(53945,48324,55092,44032)
    )
    ELSE 0
  END,
  updated_at = datetime('now')
WHERE user_id IN (
  '7877b6db-cbc7-4684-b63b-29bd7eafe648',
  '7c94e38c-1fd2-402e-8f3f-be1bcbe8728f',
  'b49dcd3d-0303-432d-a2b7-ceab3e69ebbd',
  '0ccaee57-e9f4-4c90-847a-d04965b8d390',
  '082a851c-2979-48c8-a202-d5028723a39d',
  '1e5767a7-67d7-4dc3-aac1-e3d756b50279'
);
