export const ACTIVE_EXACT_LEAVE_INDEX = 'uq_leave_requests_active_exact';
export const ACTIVE_SUMMER_LEAVE_INDEX = 'uq_leave_requests_active_summer_year';
export const LEAVE_CANCEL_SCHEMA_ERROR_CODE = 'LEAVE_CANCEL_SCHEMA_OUTDATED';
export const LEAVE_CANCEL_SCHEMA_ERROR_MESSAGE =
  `휴가 취소 신청을 처리할 수 없습니다. 관리자에게 문의해 주세요. (오류코드: ${LEAVE_CANCEL_SCHEMA_ERROR_CODE})`;

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

export function isLegacyLeaveCancelConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /CHECK constraint failed/i.test(message)
    && (/\bstatus\b/i.test(message)
      || /pending.*approved.*rejected.*cancelled/i.test(message)
      || /leave_requests/i.test(message)
      || /SQLITE_CONSTRAINT_CHECK/i.test(message));
}

export function leaveRequestSchemaSupportsCancelRequested(tableSql: unknown): boolean {
  return /CHECK\s*\([^)]*status\s+IN\s*\([^)]*['"]cancel_requested['"]/i.test(String(tableSql || ''));
}

export async function markApprovedLeaveCancelRequested(
  db: D1Database,
  requestId: string,
): Promise<{ success: true } | { success: false; status: 503; body: { error: string; code: string } }> {
  const schema = await db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'leave_requests'",
  ).first<{ sql: string }>();
  if (!leaveRequestSchemaSupportsCancelRequested(schema?.sql)) {
    return {
      success: false,
      status: 503,
      body: { error: LEAVE_CANCEL_SCHEMA_ERROR_MESSAGE, code: LEAVE_CANCEL_SCHEMA_ERROR_CODE },
    };
  }

  try {
    await db.prepare("UPDATE leave_requests SET status = 'cancel_requested', updated_at = datetime('now') WHERE id = ?")
      .bind(requestId).run();
    return { success: true };
  } catch (error) {
    if (isLegacyLeaveCancelConstraintError(error)) {
      return {
        success: false,
        status: 503,
        body: { error: LEAVE_CANCEL_SCHEMA_ERROR_MESSAGE, code: LEAVE_CANCEL_SCHEMA_ERROR_CODE },
      };
    }
    throw error;
  }
}
