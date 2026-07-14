-- 여름 특별휴가/연결 연차 동시 제출의 TOCTOU 방어.
-- 적용 전 아래 두 진단 쿼리 결과가 0건인지 확인해야 한다.
-- 1) 동일 사용자·유형·기간·반차구분 활성 중복
-- 과거에 승인된 2일+1일 분할 여름휴가는 유지하고, 새 원자적 신청부터 연도 키를 기록한다.

ALTER TABLE leave_requests ADD COLUMN request_group_id TEXT;
ALTER TABLE leave_requests ADD COLUMN summer_request_year TEXT;

SELECT user_id, leave_type, start_date, end_date, COALESCE(half_day_period, '') AS half_day_period, COUNT(*) AS duplicate_count
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_requests_active_exact
ON leave_requests (
  user_id,
  leave_type,
  start_date,
  end_date,
  COALESCE(half_day_period, '')
)
WHERE status IN ('pending', 'approved', 'cancel_requested');

CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_requests_active_summer_year
ON leave_requests (user_id, summer_request_year)
WHERE summer_request_year IS NOT NULL
  AND status IN ('pending', 'approved', 'cancel_requested');
