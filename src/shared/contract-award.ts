export const CONTRACT_AWARD_MONTHLY_POLICY_FROM = '2026-09';
export const CONTRACT_AWARD_MIN_COUNT = 10;

const LEGACY_BIMONTHLY_AWARDS = [300_000, 200_000, 100_000] as const;
const MONTHLY_AWARDS = [500_000, 300_000] as const;

export type ContractAwardCadence = 'bimonthly' | 'monthly';

export interface ContractAwardPeriod {
  month: string;
  cadence: ContractAwardCadence;
  isAwardMonth: boolean;
  startMonth: string;
  endMonth: string;
  startDate: string;
  endDate: string;
  label: string | null;
}

export interface ContractRankingCandidate {
  user_id: string;
  count: number;
  total_amount: number;
}

export type RankedContractAwardCandidate<T extends ContractRankingCandidate> = T & {
  rank: number;
  award: number;
};

export type RankedContractCandidate<T extends ContractRankingCandidate> = T & {
  rank: number;
};

function parseMonth(month: string): { year: number; monthNumber: number } {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('INVALID_CONTRACT_AWARD_MONTH');
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  if (!Number.isInteger(year) || monthNumber < 1 || monthNumber > 12) {
    throw new Error('INVALID_CONTRACT_AWARD_MONTH');
  }
  return { year, monthNumber };
}

function shiftMonth(month: string, delta: number): string {
  const { year, monthNumber } = parseMonth(month);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

function lastDateOfMonth(month: string): string {
  const { year, monthNumber } = parseMonth(month);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, '0')}`;
}

function periodLabel(startMonth: string, endMonth: string): string {
  const start = parseMonth(startMonth);
  const end = parseMonth(endMonth);
  if (startMonth === endMonth) return `${start.year}년 ${start.monthNumber}월`;
  if (start.year === end.year) return `${start.year}년 ${start.monthNumber}~${end.monthNumber}월`;
  return `${start.year}년 ${start.monthNumber}월~${end.year}년 ${end.monthNumber}월`;
}

/**
 * 계약포상 지급 주기와 산정 구간을 급여 귀속월 기준으로 결정한다.
 * 2026-08까지는 기존 짝수월 2개월제를 유지하고, 2026-09부터 매월 산정한다.
 */
export function getContractAwardPeriod(month: string): ContractAwardPeriod {
  const { monthNumber } = parseMonth(month);
  const cadence: ContractAwardCadence = month >= CONTRACT_AWARD_MONTHLY_POLICY_FROM
    ? 'monthly'
    : 'bimonthly';
  const isAwardMonth = cadence === 'monthly' || monthNumber % 2 === 0;
  const startMonth = cadence === 'monthly'
    ? month
    : (monthNumber % 2 === 0 ? shiftMonth(month, -1) : month);
  const endMonth = cadence === 'monthly'
    ? month
    : (monthNumber % 2 === 0 ? month : shiftMonth(month, 1));

  return {
    month,
    cadence,
    isAwardMonth,
    startMonth,
    endMonth,
    startDate: `${startMonth}-01`,
    endDate: lastDateOfMonth(endMonth),
    label: isAwardMonth ? periodLabel(startMonth, endMonth) : null,
  };
}

export function contractAwardAmountForRank(month: string, rank: number, count: number): number {
  const policy = getContractAwardPeriod(month);
  if (!policy.isAwardMonth || count < CONTRACT_AWARD_MIN_COUNT || rank < 1) return 0;
  const tiers = policy.cadence === 'monthly' ? MONTHLY_AWARDS : LEGACY_BIMONTHLY_AWARDS;
  return tiers[rank - 1] || 0;
}

/**
 * 기존 정책은 조회 순서대로 1·2·3위를 부여한다. 새 월별 정책부터는 매출 화면의
 * 기존 동률 표현과 같이 건수와 금액이 모두 같을 때 공동 순위(1,1,3)를 부여한다.
 */
function rankContractCandidates<T extends ContractRankingCandidate>(
  candidates: readonly T[],
  competitionTies: boolean,
): Array<RankedContractCandidate<T>> {
  const rankedCandidates = candidates
    .map((candidate) => ({
      ...candidate,
      count: Number(candidate.count) || 0,
      total_amount: Number(candidate.total_amount) || 0,
    }))
    .sort((a, b) => (
      b.count - a.count
      || b.total_amount - a.total_amount
      || String(a.user_id).localeCompare(String(b.user_id))
    ));

  let previous: RankedContractCandidate<T> | null = null;
  return rankedCandidates.map((candidate, index) => {
    const isTie = competitionTies
      && previous !== null
      && previous.count === candidate.count
      && previous.total_amount === candidate.total_amount;
    const rank = isTie ? previous!.rank : index + 1;
    const ranked = {
      ...candidate,
      rank,
    } as RankedContractCandidate<T>;
    previous = ranked;
    return ranked;
  });
}

/** 매출 순위 표시는 기존과 같이 동일 건수·금액에 공동 순위를 부여한다. */
export function rankContractPerformanceCandidates<T extends ContractRankingCandidate>(
  candidates: readonly T[],
): Array<RankedContractCandidate<T>> {
  return rankContractCandidates(candidates, true);
}

export function rankContractAwardCandidates<T extends ContractRankingCandidate>(
  month: string,
  candidates: readonly T[],
): Array<RankedContractAwardCandidate<T>> {
  const policy = getContractAwardPeriod(month);
  return rankContractCandidates(candidates, policy.cadence === 'monthly').map((candidate) => ({
    ...candidate,
    award: contractAwardAmountForRank(month, candidate.rank, candidate.count),
  }));
}

function contractCustomerKey(row: Record<string, unknown>): string {
  const phone = String(row.client_phone || '')
    .replaceAll('-', '')
    .replaceAll(' ', '')
    .replaceAll('(', '')
    .replaceAll(')', '');
  const name = String(row.client_name || '').trim().toLowerCase();
  if (!phone || !name) return `row:${String(row.id || `${name}:${row.amount}:${row.contract_date}`)}`;
  return `${name}|${phone}`;
}

/** 급여 응답에 이미 포함된 계약행의 기존 고객별 계약건수 산식을 그대로 적용한다. */
export function calculateContractCountFromRows(rows: readonly Record<string, any>[]): number {
  const grouped = new Map<string, number>();
  rows
    .filter((row) => row.type === '계약' && row.status === 'confirmed' && !row.exclude_from_count)
    .forEach((row) => {
      const key = contractCustomerKey(row);
      grouped.set(key, (grouped.get(key) || 0) + (Number(row.amount) || 0));
    });
  return [...grouped.values()].reduce((sum, amount) => sum + (amount >= 2_200_000 ? 2 : 1), 0);
}
