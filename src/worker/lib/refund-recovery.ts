import {
  calculateRefundRecoveryAmount,
  payrollPeriodLabelFromMonth,
  refundApprovalMonth,
} from '../../shared/refund-recovery.ts';

export const REFUND_RECOVERY_NOT_LOCKED = 'REFUND_RECOVERY_PAYROLL_NOT_LOCKED';
export const REFUND_RECOVERY_DEDUCTION_MISSING = 'REFUND_RECOVERY_DEDUCTION_MISSING';

type ResolveResult =
  | { success: true; alreadyResolved: boolean; recoveryAmount: number; payrollPeriod: string }
  | { success: false; status: 400 | 404 | 409; code: string; error: string };

export async function resolveRefundRecovery(
  db: D1Database,
  input: { salesRecordId: string; payrollMonth: string; resolvedBy: string },
): Promise<ResolveResult> {
  if (!/^\d{4}-\d{2}$/.test(input.payrollMonth)) {
    return { success: false, status: 400, code: 'INVALID_PAYROLL_MONTH', error: '정산월 형식이 올바르지 않습니다.' };
  }

  const record = await db.prepare(`
    SELECT sr.id, sr.user_id, sr.status, sr.amount, sr.refund_approved_at,
           ua.pay_type, ua.commission_rate
    FROM sales_records sr
    LEFT JOIN user_accounting ua ON ua.user_id = sr.user_id
    WHERE sr.id = ?
  `).bind(input.salesRecordId).first<{
    id: string;
    user_id: string;
    status: string;
    amount: number;
    refund_approved_at: string | null;
    pay_type: string | null;
    commission_rate: number | null;
  }>();
  if (!record) {
    return { success: false, status: 404, code: 'REFUND_NOT_FOUND', error: '환불 내역을 찾을 수 없습니다.' };
  }
  if (record.status !== 'refunded') {
    return { success: false, status: 409, code: 'REFUND_NOT_APPROVED', error: '환불 승인된 내역만 회수 완료 처리할 수 있습니다.' };
  }
  if (refundApprovalMonth(record.refund_approved_at) !== input.payrollMonth) {
    return { success: false, status: 400, code: 'REFUND_MONTH_MISMATCH', error: '환불 승인월과 급여 정산월이 일치하지 않습니다.' };
  }

  const payrollPeriod = payrollPeriodLabelFromMonth(input.payrollMonth);
  const existing = await db.prepare(`
    SELECT recovery_amount, payroll_month FROM refund_recovery_resolutions WHERE sales_record_id = ?
  `).bind(record.id).first<{ recovery_amount: number; payroll_month: string }>();
  if (existing) {
    return {
      success: true,
      alreadyResolved: true,
      recoveryAmount: Number(existing.recovery_amount) || 0,
      payrollPeriod: payrollPeriodLabelFromMonth(existing.payroll_month) || payrollPeriod,
    };
  }

  const recoveryAmount = calculateRefundRecoveryAmount({
    amount: record.amount,
    payType: record.pay_type,
    commissionRate: record.commission_rate,
  });
  const payrollSave = await db.prepare(`
    SELECT locked, data FROM payroll_saves WHERE user_id = ? AND period = ?
  `).bind(record.user_id, payrollPeriod).first<{ locked: number; data: string }>();
  if (!payrollSave || Number(payrollSave.locked) !== 1) {
    return {
      success: false,
      status: 409,
      code: REFUND_RECOVERY_NOT_LOCKED,
      error: '해당 직원의 환불 승인월 급여정산을 먼저 저장하고 확정해 주세요.',
    };
  }
  if (record.pay_type === 'commission' && recoveryAmount > 0) {
    let savedData: { commDeductions?: Array<{ sourceId?: string; amount?: string | number }> } = {};
    try {
      savedData = JSON.parse(payrollSave.data || '{}');
    } catch {
      savedData = {};
    }
    const savedDeduction = Array.isArray(savedData.commDeductions)
      ? savedData.commDeductions.find(item => item.sourceId === record.id)
      : undefined;
    const savedAmount = Number(String(savedDeduction?.amount ?? '').replace(/[^0-9.-]/g, '')) || 0;
    if (savedAmount !== recoveryAmount) {
      return {
        success: false,
        status: 409,
        code: REFUND_RECOVERY_DEDUCTION_MISSING,
        error: `세후 공제에 환불 회수금액 ${recoveryAmount.toLocaleString('ko-KR')}원을 반영하고 정산을 다시 저장·확정해 주세요.`,
      };
    }
  }

  await db.prepare(`
    INSERT INTO refund_recovery_resolutions
      (sales_record_id, user_id, payroll_month, recovery_amount, resolved_by, resolved_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', '+9 hours'))
  `).bind(record.id, record.user_id, input.payrollMonth, recoveryAmount, input.resolvedBy).run();

  return { success: true, alreadyResolved: false, recoveryAmount, payrollPeriod };
}
