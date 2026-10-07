import {
  calculateRefundRecoveryAmount,
  payrollLockPrecedesRefund,
  payrollPeriodLabelFromMonth,
  refundApprovalMonth,
  refundRecoveryOriginDate,
  salesConfirmationPrecedesPayrollLock,
} from '../../shared/refund-recovery.ts';
import { isCanonicalRequiredPayrollDeduction } from '../../shared/payroll-deductions.ts';
import { getPayTypeSnapshotForMonth } from './pay-type-history.ts';

export interface PayrollRefundRecoveryRow {
  id: string;
  type: string;
  client_name: string;
  status: string;
  amount: number;
  refund_amount: number;
  proxy_cost: number;
  contract_date: string;
  deposit_date: string;
  card_deposit_date: string;
  payment_type: string;
  confirmed_at: string;
  refund_approved_at: string;
  supply_amount: number;
  recovery_amount: number;
  resolved: boolean;
  origin_month: string;
  origin_pay_type: string;
  origin_commission_rate: number | null;
  eligibility_source: 'snapshot' | 'legacy_confirmation' | 'resolved';
  recovery_basis_amount: number;
}

export interface PayrollRefundCandidateRow {
  id: string;
  type: string;
  client_name: string;
  status: string;
  amount: number;
  refund_amount: number;
  proxy_cost: number;
  contract_date: string;
  deposit_date: string;
  card_deposit_date: string;
  payment_type: string;
  confirmed_at: string;
  refund_approved_at: string;
  resolved_payroll_month: string;
  resolved_recovery_amount: number;
}

function payrollMoney(value: number, month: string): number {
  return /^\d{4}-\d{2}$/.test(month) && month >= '2026-06'
    ? Math.trunc((Number(value) || 0) / 10) * 10
    : Math.round(Number(value) || 0);
}

function payrollMonthFromPeriod(period: unknown): string {
  const value = String(period || '').trim();
  if (/^\d{4}-\d{2}$/.test(value)) return value;
  const match = /^(\d{4})년\s*(\d{1,2})월$/.exec(value);
  return match ? `${match[1]}-${String(Number(match[2])).padStart(2, '0')}` : '';
}

/**
 * Returns the complete set of rows that can affect one refund-recovery payroll month.
 * A sale already resolved in another month must never re-enter a later month merely
 * because its live refund_approved_at value was edited.
 */
export async function loadPayrollRefundCandidates(
  db: D1Database,
  input: { userId: string; payrollMonth: string },
): Promise<PayrollRefundCandidateRow[]> {
  const [yearText, monthText] = input.payrollMonth.split('-');
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  if (!/^\d{4}-\d{2}$/.test(input.payrollMonth) || !year || monthNumber < 1 || monthNumber > 12) return [];

  const candidates = await db.prepare(`
    SELECT sr.id, sr.type, sr.client_name, sr.status, sr.amount, sr.refund_amount, sr.proxy_cost,
           sr.contract_date, sr.deposit_date, sr.card_deposit_date, sr.payment_type,
           sr.confirmed_at, sr.refund_approved_at, rrr.payroll_month AS resolved_payroll_month,
           rrr.recovery_amount AS resolved_recovery_amount
    FROM sales_records sr
    LEFT JOIN refund_recovery_resolutions rrr ON rrr.sales_record_id = sr.id
    WHERE sr.user_id = ?
      AND (
        rrr.payroll_month = ?
        OR (
          rrr.sales_record_id IS NULL
          AND COALESCE(sr.refund_amount, 0) > 0
          AND length(COALESCE(sr.refund_approved_at, '')) >= 7
          AND substr(COALESCE(sr.refund_approved_at, ''), 1, 7) <= ?
        )
      )
    ORDER BY sr.id
  `).bind(input.userId, input.payrollMonth, input.payrollMonth).all<any>();

  return (candidates.results || []).map((row) => ({
    id: String(row.id || ''),
    type: String(row.type || ''),
    client_name: String(row.client_name || ''),
    status: String(row.status || ''),
    amount: Number(row.amount) || 0,
    refund_amount: Number(row.refund_amount) || 0,
    proxy_cost: Number(row.proxy_cost) || 0,
    contract_date: String(row.contract_date || ''),
    deposit_date: String(row.deposit_date || ''),
    card_deposit_date: String(row.card_deposit_date || ''),
    payment_type: String(row.payment_type || ''),
    confirmed_at: String(row.confirmed_at || ''),
    refund_approved_at: String(row.refund_approved_at || ''),
    resolved_payroll_month: String(row.resolved_payroll_month || ''),
    resolved_recovery_amount: Number(row.resolved_recovery_amount) || 0,
  }));
}

/**
 * 해당 월에 급여에서 회수해야 하는 과거 지급완료 환불 건을 반환한다.
 * 이미 회수 완료된 건은 당시 확정 금액을 유지해, 확정 취소 후 재저장해도 공제가 사라지지 않게 한다.
 */
export async function loadPayrollRefundRecoveries(
  db: D1Database,
  input: {
    userId: string;
    payrollMonth: string;
    includeZero?: boolean;
    candidates?: readonly PayrollRefundCandidateRow[];
  },
): Promise<PayrollRefundRecoveryRow[]> {
  const [yearText, monthText] = input.payrollMonth.split('-');
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  if (!/^\d{4}-\d{2}$/.test(input.payrollMonth) || !year || monthNumber < 1 || monthNumber > 12) return [];
  const monthStart = `${input.payrollMonth}-01`;
  const previousRefunds = input.candidates
    ? [...input.candidates]
    : await loadPayrollRefundCandidates(db, input);

  const lockedSaves = await db.prepare(
    'SELECT id, period, updated_at, pay_type, data FROM payroll_saves WHERE user_id = ? AND locked = 1'
  ).bind(input.userId).all<any>();
  const lockedPayrolls: Array<{
    id: string;
    period: string;
    month: string;
    updatedAt: string;
    payType: string;
    commissionRate: number | null;
    salesRecordAmounts: Map<string, {
      amount: number;
      refundAmount: number;
      type: string;
      proxyCost: number;
      supplyAmount: number | null;
    }> | null;
  }> = [];
  for (const row of lockedSaves.results || []) {
    let snapshotRate: number | null = null;
    let salesRecordAmounts: Map<string, {
      amount: number;
      refundAmount: number;
      type: string;
      proxyCost: number;
      supplyAmount: number | null;
    }> | null = null;
    try {
      const savedData = JSON.parse(String(row.data || '{}'));
      const rawRate = savedData?.payroll_snapshot?.response?.accounting?.commission_rate;
      if (rawRate !== undefined && rawRate !== null && Number.isFinite(Number(rawRate))) {
        snapshotRate = Number(rawRate);
      }
      const snapshotRecords = savedData?.payroll_snapshot?.response?.records;
      if (Array.isArray(snapshotRecords)) {
        salesRecordAmounts = new Map<string, {
          amount: number;
          refundAmount: number;
          type: string;
          proxyCost: number;
          supplyAmount: number | null;
        }>();
        for (const record of snapshotRecords) {
          const id = String(record?.id || '');
          const amount = Number(record?.amount);
          const refundAmount = Number(record?.refund_amount) || 0;
          const supplyAmount = Number(record?.supply_amount);
          if (id && Number.isFinite(amount) && amount >= 0) {
            salesRecordAmounts.set(id, {
              amount,
              refundAmount: Math.min(Math.max(refundAmount, 0), amount),
              type: String(record?.type || ''),
              proxyCost: Math.max(Number(record?.proxy_cost) || 0, 0),
              supplyAmount: Number.isFinite(supplyAmount) ? Math.max(supplyAmount, 0) : null,
            });
          }
        }
      }
    } catch {
      snapshotRate = null;
      salesRecordAmounts = null;
    }
    const period = String(row.period || '');
    lockedPayrolls.push({
      id: String(row.id || ''),
      period,
      month: payrollMonthFromPeriod(period),
      updatedAt: String(row.updated_at || ''),
      payType: String(row.pay_type || 'salary'),
      commissionRate: snapshotRate,
      salesRecordAmounts,
    });
  }

  const result: PayrollRefundRecoveryRow[] = [];
  for (const row of previousRefunds) {
    const resolved = String(row.resolved_payroll_month || '') === input.payrollMonth;
    const recognizedDate = refundRecoveryOriginDate(row);
    let originMonth = '';
    let originPayroll: (typeof lockedPayrolls)[number] | undefined;
    let eligibilitySource: PayrollRefundRecoveryRow['eligibility_source'] = 'resolved';
    let recoveryBasisAmount = Number(row.refund_amount) || 0;
    let proxyIncomeToRecover: number | null = null;
    if (!resolved) {
      const snapshotOrigins = lockedPayrolls.filter(payroll => (
        payroll.salesRecordAmounts?.has(String(row.id || ''))
      ));
      if (snapshotOrigins.length > 1) continue;
      if (snapshotOrigins.length === 1) {
        [originPayroll] = snapshotOrigins;
        originMonth = originPayroll.month;
        if (!originMonth || originMonth >= input.payrollMonth) continue;
        const snapshotRecord = originPayroll.salesRecordAmounts!.get(String(row.id || ''));
        if (!snapshotRecord || snapshotRecord.amount <= 0) continue;
        if (snapshotRecord.type === '매수신청대리') {
          // Proxy income is paid at 100% after subtracting proxy_cost and the origin
          // settlement does not subtract refund_amount. Recover the actual margin
          // lost after applying the total approved refund, not the normal commission rate.
          recoveryBasisAmount = Math.min(Math.max(recoveryBasisAmount, 0), snapshotRecord.amount);
          const originalProxyIncome = snapshotRecord.supplyAmount
            ?? Math.max(
              payrollMoney(snapshotRecord.amount * 10 / 11, originMonth) - snapshotRecord.proxyCost,
              0,
            );
          const remainingAmount = Math.max(snapshotRecord.amount - recoveryBasisAmount, 0);
          const remainingProxyIncome = Math.max(
            payrollMoney(remainingAmount * 10 / 11, originMonth) - snapshotRecord.proxyCost,
            0,
          );
          proxyIncomeToRecover = Math.max(originalProxyIncome - remainingProxyIncome, 0);
        } else {
          recoveryBasisAmount = Math.min(
            Math.max(recoveryBasisAmount - snapshotRecord.refundAmount, 0),
            Math.max(snapshotRecord.amount - snapshotRecord.refundAmount, 0),
          );
        }
        eligibilitySource = 'snapshot';
      } else {
        originMonth = String(recognizedDate || '').slice(0, 7);
        if (!recognizedDate || String(recognizedDate) >= monthStart) continue;
        const legacyOrigins = lockedPayrolls.filter(payroll => (
          payroll.month === originMonth && payroll.salesRecordAmounts === null
        ));
        if (legacyOrigins.length !== 1) continue;
        [originPayroll] = legacyOrigins;
        if (!payrollLockPrecedesRefund(originPayroll.updatedAt, row.refund_approved_at)) continue;
        // Legacy payrolls cannot prove the proxy margin/proxy_cost that was actually paid.
        if (String(row.type || '') === '매수신청대리') continue;
        if (!salesConfirmationPrecedesPayrollLock(row.confirmed_at, originPayroll.updatedAt)) continue;
        eligibilitySource = 'legacy_confirmation';
      }
    } else {
      const snapshotOrigins = lockedPayrolls.filter(payroll => (
        payroll.salesRecordAmounts?.has(String(row.id || ''))
      ));
      if (snapshotOrigins.length === 1) {
        [originPayroll] = snapshotOrigins;
        originMonth = originPayroll.month;
      } else {
        originMonth = String(recognizedDate || '').slice(0, 7);
        [originPayroll] = lockedPayrolls.filter(payroll => payroll.month === originMonth);
      }
    }

    let recoveryAmount = Number(row.resolved_recovery_amount) || 0;
    if (!resolved) {
      let originRate = originPayroll?.commissionRate;
      if (originPayroll?.payType === 'commission' && originRate === null) {
        const currentAccounting = await db.prepare(
          'SELECT commission_rate FROM user_accounting WHERE user_id = ?'
        ).bind(input.userId).first<{ commission_rate: number }>().catch(() => null);
        const fallbackAccounting = await getPayTypeSnapshotForMonth(db, input.userId, originMonth, {
          pay_type: 'commission',
          commission_rate: Number(currentAccounting?.commission_rate) || 0,
        });
        const originOverride = await db.prepare(
          'SELECT commission_rate FROM commission_rate_overrides WHERE user_id = ? AND year_month = ?'
        ).bind(input.userId, originMonth).first<{ commission_rate: number }>().catch(() => null);
        originRate = originOverride?.commission_rate ?? fallbackAccounting.commission_rate;
      }
      recoveryAmount = proxyIncomeToRecover !== null
        ? (originPayroll?.payType === 'commission'
          ? payrollMoney(proxyIncomeToRecover * (1 - 0.033), originMonth)
          : 0)
        : calculateRefundRecoveryAmount({
          amount: recoveryBasisAmount,
          payType: originPayroll?.payType,
          commissionRate: originRate,
          payrollMonth: originMonth,
        });
    }
    if (recoveryAmount <= 0 && !input.includeZero) continue;
    result.push({
      id: String(row.id || ''),
      type: String(row.type || ''),
      client_name: String(row.client_name || ''),
      status: String(row.status || ''),
      amount: Number(row.amount) || 0,
      refund_amount: Number(row.refund_amount) || 0,
      proxy_cost: Number(row.proxy_cost) || 0,
      contract_date: String(row.contract_date || ''),
      deposit_date: String(row.deposit_date || ''),
      card_deposit_date: String(row.card_deposit_date || ''),
      payment_type: String(row.payment_type || ''),
      confirmed_at: String(row.confirmed_at || ''),
      refund_approved_at: String(row.refund_approved_at || ''),
      supply_amount: payrollMoney(recoveryBasisAmount * 10 / 11, originMonth || input.payrollMonth),
      recovery_amount: recoveryAmount,
      resolved,
      origin_month: originMonth,
      origin_pay_type: String(originPayroll?.payType || ''),
      origin_commission_rate: originPayroll?.commissionRate ?? null,
      eligibility_source: eligibilitySource,
      recovery_basis_amount: recoveryBasisAmount,
    });
  }
  return result;
}

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
    SELECT sr.id, sr.user_id, sr.status, sr.amount, sr.refund_amount, sr.refund_approved_at
    FROM sales_records sr
    WHERE sr.id = ?
  `).bind(input.salesRecordId).first<{
    id: string;
    user_id: string;
    status: string;
    amount: number;
    refund_amount: number | null;
    refund_approved_at: string | null;
  }>();
  if (!record) {
    return { success: false, status: 404, code: 'REFUND_NOT_FOUND', error: '환불 내역을 찾을 수 없습니다.' };
  }
  if ((Number(record.refund_amount) || 0) <= 0) {
    return { success: false, status: 409, code: 'REFUND_NOT_APPROVED', error: '환불(부분/전액) 처리된 내역만 회수 완료할 수 있습니다.' };
  }
  const approvedMonth = refundApprovalMonth(record.refund_approved_at);
  if (!approvedMonth || approvedMonth > input.payrollMonth) {
    return { success: false, status: 400, code: 'REFUND_MONTH_MISMATCH', error: '환불 승인월 이후 급여 정산월에서만 회수 완료할 수 있습니다.' };
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

  const authoritativeRecovery = (await loadPayrollRefundRecoveries(db, {
    userId: record.user_id,
    payrollMonth: input.payrollMonth,
    includeZero: true,
  })).find(item => item.id === record.id);
  if (!authoritativeRecovery) {
    return {
      success: false,
      status: 409,
      code: 'REFUND_RECOVERY_NOT_ELIGIBLE',
      error: '원매출 급여의 지급 확정 이력을 확인할 수 없어 환불 회수를 완료할 수 없습니다.',
    };
  }
  const recoveryAmount = authoritativeRecovery.recovery_amount;
  const originPayrollRows = await db.prepare(`
    SELECT id, period, pay_type, updated_at, data, locked
    FROM payroll_saves
    WHERE user_id = ? AND locked = 1
  `).bind(record.user_id).all<{
    id: string;
    period: string;
    pay_type: string;
    updated_at: string;
    data: string;
    locked: number;
  }>();
  const matchingOriginPayrolls = (originPayrollRows.results || []).filter(row => (
    payrollMonthFromPeriod(row.period) === authoritativeRecovery.origin_month
  ));
  if (matchingOriginPayrolls.length !== 1) {
    return {
      success: false,
      status: 409,
      code: 'REFUND_RECOVERY_ORIGIN_CHANGED',
      error: '회수 근거가 된 원매출 급여정산 상태가 변경되었습니다. 다시 확인해 주세요.',
    };
  }
  const [originPayroll] = matchingOriginPayrolls;
  const payrollSaves = await db.prepare(`
    SELECT id, locked, data FROM payroll_saves WHERE user_id = ? AND period IN (?, ?)
  `).bind(record.user_id, payrollPeriod, input.payrollMonth).all<{ id: string; locked: number; data: string }>();
  if ((payrollSaves.results || []).length > 1) {
    return {
      success: false,
      status: 409,
      code: 'DUPLICATE_PAYROLL_MONTH',
      error: '동일한 월의 급여정산서가 중복 저장되어 회수 완료할 수 없습니다.',
    };
  }
  const payrollSave = (payrollSaves.results || [])[0];
  if (!payrollSave || Number(payrollSave.locked) !== 1) {
    return {
      success: false,
      status: 409,
      code: REFUND_RECOVERY_NOT_LOCKED,
      error: '해당 직원의 환불 승인월 급여정산을 먼저 저장하고 확정해 주세요.',
    };
  }
  if (recoveryAmount > 0) {
    let savedData: { commDeductions?: Array<{ sourceId?: string; amount?: string | number; isFood?: boolean; skipTax?: boolean }> } = {};
    try {
      savedData = JSON.parse(payrollSave.data || '{}');
    } catch {
      savedData = {};
    }
    if (!isCanonicalRequiredPayrollDeduction(savedData.commDeductions, {
      label: '환불 회수',
      amount: recoveryAmount,
      sourceId: record.id,
    })) {
      return {
        success: false,
        status: 409,
        code: REFUND_RECOVERY_DEDUCTION_MISSING,
        error: `세후 공제에 환불 회수금액 ${recoveryAmount.toLocaleString('ko-KR')}원을 반영하고 정산을 다시 저장·확정해 주세요.`,
      };
    }
  }

  const insertResult = await db.prepare(`
    INSERT INTO refund_recovery_resolutions
      (sales_record_id, user_id, payroll_month, recovery_amount, resolved_by, resolved_at)
    SELECT ?, ?, ?, ?, ?, datetime('now', '+9 hours')
    WHERE NOT EXISTS (
      SELECT 1 FROM refund_recovery_resolutions WHERE sales_record_id = ?
    )
      AND EXISTS (
        SELECT 1 FROM payroll_saves
        WHERE id = ? AND locked = 1 AND data = ?
      )
      AND EXISTS (
        SELECT 1 FROM payroll_saves
        WHERE id = ? AND user_id = ? AND period = ? AND pay_type = ?
          AND updated_at = ? AND data = ? AND locked = 1
      )
      AND EXISTS (
        SELECT 1 FROM sales_records
        WHERE id = ? AND user_id = ?
          AND COALESCE(type, '') = ?
          AND COALESCE(status, '') = ?
          AND COALESCE(amount, 0) = ?
          AND COALESCE(refund_amount, 0) = ?
          AND COALESCE(proxy_cost, 0) = ?
          AND COALESCE(contract_date, '') = ?
          AND COALESCE(deposit_date, '') = ?
          AND COALESCE(card_deposit_date, '') = ?
          AND COALESCE(payment_type, '') = ?
          AND COALESCE(confirmed_at, '') = ?
          AND COALESCE(refund_approved_at, '') = ?
      )
  `).bind(
    record.id,
    record.user_id,
    input.payrollMonth,
    recoveryAmount,
    input.resolvedBy,
    record.id,
    payrollSave.id,
    payrollSave.data,
    originPayroll.id,
    record.user_id,
    originPayroll.period,
    originPayroll.pay_type,
    originPayroll.updated_at,
    originPayroll.data,
    authoritativeRecovery.id,
    record.user_id,
    authoritativeRecovery.type,
    authoritativeRecovery.status,
    authoritativeRecovery.amount,
    authoritativeRecovery.refund_amount,
    authoritativeRecovery.proxy_cost,
    authoritativeRecovery.contract_date,
    authoritativeRecovery.deposit_date,
    authoritativeRecovery.card_deposit_date,
    authoritativeRecovery.payment_type,
    authoritativeRecovery.confirmed_at,
    authoritativeRecovery.refund_approved_at,
  ).run();
  if (Number(insertResult.meta?.changes ?? 0) === 0) {
    const concurrentlyResolved = await db.prepare(`
      SELECT recovery_amount, payroll_month FROM refund_recovery_resolutions WHERE sales_record_id = ?
    `).bind(record.id).first<{ recovery_amount: number; payroll_month: string }>();
    if (concurrentlyResolved) {
      return {
        success: true,
        alreadyResolved: true,
        recoveryAmount: Number(concurrentlyResolved.recovery_amount) || 0,
        payrollPeriod: payrollPeriodLabelFromMonth(concurrentlyResolved.payroll_month) || payrollPeriod,
      };
    }
    return {
      success: false,
      status: 409,
      code: 'REFUND_RECOVERY_STATE_CHANGED',
      error: '회수 완료 처리 중 급여정산 또는 환불 상태가 변경되었습니다. 다시 확인해 주세요.',
    };
  }

  return { success: true, alreadyResolved: false, recoveryAmount, payrollPeriod };
}
