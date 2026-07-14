export const ACTIVE_EXACT_LEAVE_INDEX = 'uq_leave_requests_active_exact';
export const ACTIVE_SUMMER_LEAVE_INDEX = 'uq_leave_requests_active_summer_year';

export const CREATE_ACTIVE_EXACT_LEAVE_INDEX_SQL = `
  CREATE UNIQUE INDEX IF NOT EXISTS ${ACTIVE_EXACT_LEAVE_INDEX}
  ON leave_requests (user_id, leave_type, start_date, end_date, COALESCE(half_day_period, ''))
  WHERE status IN ('pending', 'approved', 'cancel_requested')
`;

export const CREATE_ACTIVE_SUMMER_LEAVE_INDEX_SQL = `
  CREATE UNIQUE INDEX IF NOT EXISTS ${ACTIVE_SUMMER_LEAVE_INDEX}
  ON leave_requests (user_id, summer_request_year)
  WHERE summer_request_year IS NOT NULL
    AND status IN ('pending', 'approved', 'cancel_requested')
`;

export function businessDayLeaveValidationError(leaveType: string, deductHours: number): string {
  if ((leaveType === '연차' || leaveType === '특별휴가') && deductHours <= 0) {
    return '선택한 기간에 사용할 수 있는 근무일이 없습니다.';
  }
  return '';
}
