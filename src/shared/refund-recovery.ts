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
