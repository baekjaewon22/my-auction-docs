// 급여정산 이월(carryover)
// 실지급(급여 − 공제)이 음수면 그 달은 0으로 처리하고, 미회수분(|net|)을 익월 정산으로 이월한다.
// 결과가 0 이상이면 이월 없이 그대로 마무리한다.

export function nextPayrollMonth(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return '';
  let year = Number(m[1]);
  let mon = Number(m[2]) + 1;
  if (mon > 12) { mon = 1; year += 1; }
  return `${year}-${String(mon).padStart(2, '0')}`;
}

export function computePayrollCarryover(netPay: number): { paidNet: number; carryover: number } {
  const net = Math.round(Number(netPay) || 0);
  if (net >= 0) return { paidNet: net, carryover: 0 };
  return { paidNet: 0, carryover: -net };
}
