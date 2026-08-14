export type PayrollSavePeriodState = {
  period: string;
  locked: number | boolean;
};

export function payrollPeriodToYearMonth(period: unknown): string | null {
  const text = String(period || '').trim();
  const match = text.match(/^(\d{4})년\s*(\d{1,2})월/) || text.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${match[1]}-${String(month).padStart(2, '0')}`;
}

export function classifyPayrollSavesFromMonth(
  saves: PayrollSavePeriodState[],
  effectiveMonth: string,
): { locked: string[]; recalculable: string[] } {
  const locked: string[] = [];
  const recalculable: string[] = [];

  for (const save of saves) {
    const yearMonth = payrollPeriodToYearMonth(save.period);
    if (!yearMonth || yearMonth < effectiveMonth) continue;
    if (Number(save.locked) === 1) locked.push(save.period);
    else recalculable.push(save.period);
  }

  return { locked, recalculable };
}
