-- Leave hours normalization migration
-- Purpose:
-- 1. Backfill leave_requests.hours from existing day-based records.
-- 2. Normalize legacy "월차" request rows to "연차".
-- 3. Recalculate annual_leave usage from approved leave_requests.

-- Historical non-hour leave rows often kept the default hours value (8),
-- even when days represented the correct value (반차=0.5, multi-day leave, etc.).
UPDATE leave_requests
SET hours = ROUND(COALESCE(days, 0) * 8, 3)
WHERE leave_type IN ('연차', '월차', '반차', '특별휴가')
  AND ABS(COALESCE(hours, 0) - (COALESCE(days, 0) * 8)) > 0.0001;

-- For hourly leave, hours is the source of truth. Keep days as the compatibility
-- value used by older screens/reports.
UPDATE leave_requests
SET days = ROUND(COALESCE(hours, 0) / 8, 3)
WHERE leave_type = '시간차'
  AND ABS(COALESCE(days, 0) - (COALESCE(hours, 0) / 8)) > 0.0001;

-- 연차 and 월차 are the same spend concept. One-year-under employees differ only
-- in accrual, which is represented by annual_leave.leave_type = 'monthly'.
UPDATE leave_requests
SET leave_type = '연차'
WHERE leave_type = '월차';

-- Recalculate stored usage from approved request history. Keep annual_leave's
-- compatibility columns as day equivalents, while deriving from hours.
UPDATE annual_leave
SET
  used_days = CASE
    WHEN leave_type = 'annual' THEN (
      SELECT ROUND(COALESCE(SUM(COALESCE(lr.hours, lr.days * 8)), 0) / 8, 3)
      FROM leave_requests lr
      WHERE lr.user_id = annual_leave.user_id
        AND lr.status = 'approved'
        AND lr.leave_type != '특별휴가'
    )
    ELSE 0
  END,
  monthly_used = CASE
    WHEN leave_type = 'monthly' THEN (
      SELECT ROUND(COALESCE(SUM(COALESCE(lr.hours, lr.days * 8)), 0) / 8, 3)
      FROM leave_requests lr
      WHERE lr.user_id = annual_leave.user_id
        AND lr.status = 'approved'
        AND lr.leave_type != '특별휴가'
    )
    ELSE 0
  END,
  updated_at = datetime('now');
