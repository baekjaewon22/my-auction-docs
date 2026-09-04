export type PayrollContractAwardResponse = {
  is_contract_award_month?: boolean;
  is_payout_month?: boolean;
  contract_award_period_label?: string | null;
  bonus_period_label?: string | null;
  contract_award?: {
    rank?: number | null;
    award?: number | null;
  } | null;
};

export type ContractRankingPeriod = {
  startMonth: string;
  endMonth: string;
  label: string;
  modeLabel: '2달' | '월별';
};

const MONTHLY_CONTRACT_AWARD_FROM = '2026-09';

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * 계약포상 지급 주기는 일반 성과금 지급 주기와 별개다.
 * 새 필드가 없는 과거 잠금 스냅샷은 기존 짝수월 필드로 판정한다.
 */
export function isContractAwardMonth(response?: PayrollContractAwardResponse | null): boolean {
  if (typeof response?.is_contract_award_month === 'boolean') {
    return response.is_contract_award_month;
  }
  return response?.is_payout_month === true;
}

export function payrollContractAwardAmount(response?: PayrollContractAwardResponse | null): number {
  if (!isContractAwardMonth(response) || !response?.contract_award?.rank) return 0;
  const amount = Number(response.contract_award.award) || 0;
  return amount > 0 ? amount : 0;
}

export function payrollContractAwardPeriodLabel(response?: PayrollContractAwardResponse | null): string {
  return response?.contract_award_period_label || response?.bonus_period_label || '';
}

/** 2026년 8월까지는 2개월 구간, 2026년 9월부터는 월별 랭킹 구간을 만든다. */
export function contractRankingPeriods(year: number): ContractRankingPeriod[] {
  const periods: ContractRankingPeriod[] = [];
  let month = 1;

  while (month <= 12) {
    const startMonth = monthKey(year, month);
    const isMonthly = startMonth >= MONTHLY_CONTRACT_AWARD_FROM;
    const end = isMonthly ? month : Math.min(month + 1, 12);
    const endMonth = monthKey(year, end);

    periods.push({
      startMonth,
      endMonth,
      label: isMonthly
        ? `${year}년 ${month}월`
        : `${year}년 ${month}~${end}월`,
      modeLabel: isMonthly ? '월별' : '2달',
    });
    month = end + 1;
  }

  return periods;
}

export function contractRankingPeriodIndex(
  periods: ContractRankingPeriod[],
  year: number,
  month: number,
): number {
  const currentMonth = monthKey(year, month);
  const index = periods.findIndex(period => (
    period.startMonth <= currentMonth && currentMonth <= period.endMonth
  ));
  return index >= 0 ? index : Math.max(periods.length - 1, 0);
}
