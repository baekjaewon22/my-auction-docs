export function refundApprovalMonth(value: unknown): string {
  const month = String(value || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(month) ? month : '';
}

export function payrollPeriodLabelFromMonth(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return '';
  return `${Number(match[1])}년 ${Number(match[2])}월`;
}

export function refundRecoveryPayrollUrl(input: {
  salesRecordId: string;
  userId: string;
  refundApprovedAt: string;
}): string {
  const month = refundApprovalMonth(input.refundApprovedAt);
  const query = new URLSearchParams({
    branch: '__all',
    user_id: input.userId,
    month,
    refund_recovery: input.salesRecordId,
  });
  return `/payroll?${query.toString()}`;
}

export function calculateRefundRecoveryAmount(input: {
  amount: number;
  payType?: string | null;
  commissionRate?: number | null;
  payrollMonth?: string | null;
}): number {
  if (input.payType !== 'commission') return 0;
  const month = String(input.payrollMonth || '');
  const shouldTruncate = /^\d{4}-\d{2}$/.test(month) && month >= '2026-06';
  const payrollMoney = (value: number) => shouldTruncate
    ? Math.trunc((Number(value) || 0) / 10) * 10
    : Math.round(Number(value) || 0);
  const supply = payrollMoney((Number(input.amount) || 0) * 10 / 11);
  const commission = payrollMoney(supply * (Number(input.commissionRate) || 0) / 100);
  return payrollMoney(commission * (1 - 0.033));
}

export function refundRecoveryOriginDate(record: {
  payment_type?: unknown;
  card_deposit_date?: unknown;
  deposit_date?: unknown;
  contract_date?: unknown;
}): string {
  const paymentType = String(record.payment_type || '').trim();
  if (paymentType === '카드') return String(record.card_deposit_date || '').trim();
  if (paymentType) return String(record.deposit_date || '').trim();
  return String(record.contract_date || '').trim();
}

export function kstDateOnly(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function timestampWithDefaultOffset(value: unknown, defaultOffset: 'Z' | '+09:00'): number {
  const raw = String(value || '').trim();
  if (!raw) return Number.NaN;
  let normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized += 'T00:00:00';
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) normalized += defaultOffset;
  return Date.parse(normalized);
}

/** payroll_saves.updated_at(UTC)과 refund_approved_at(KST)을 실제 시각으로 비교한다. */
export function payrollLockPrecedesRefund(lockUpdatedAt: unknown, refundApprovedAt: unknown): boolean {
  const lockedAt = timestampWithDefaultOffset(lockUpdatedAt, 'Z');
  const approvedAt = timestampWithDefaultOffset(refundApprovedAt, '+09:00');
  return Number.isFinite(lockedAt) && Number.isFinite(approvedAt) && lockedAt < approvedAt;
}

/** Legacy payroll snapshots without record IDs may only use sales confirmed before the UTC payroll lock. */
export function salesConfirmationPrecedesPayrollLock(
  confirmedAt: unknown,
  lockUpdatedAt: unknown,
): boolean {
  const confirmed = timestampWithDefaultOffset(confirmedAt, '+09:00');
  const locked = timestampWithDefaultOffset(lockUpdatedAt, 'Z');
  return Number.isFinite(confirmed) && Number.isFinite(locked) && confirmed < locked;
}
