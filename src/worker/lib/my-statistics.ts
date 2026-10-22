export type MyStatisticsBid = {
  source: 'journal' | 'schedule' | 'legacy' | 'historical';
  sourceId: string;
  userId: string;
  bidDate: string;
  court: string;
  caseNumber: string;
  itemNumber: string;
  propertyType: string;
  result: 'won' | 'lost' | 'cancelled' | 'pending';
  suggestedPrice?: number | null;
  actualBidPrice?: number | null;
  winningPrice?: number | null;
  revenueAmount?: number | null;
  revenueDate?: string;
  revenueState?: 'confirmed' | 'pending' | 'refunded' | 'missing';
};

export type MyStatisticsBreakdown = {
  label: string;
  total_count: number;
  total_share: number;
  won_count: number;
  won_share: number;
  win_rate: number;
  revenue_case_count: number;
  total_revenue: number;
  average_revenue: number;
  revenue_share: number;
  revenue_missing_count: number;
};

export type MyStatisticsResult = {
  summary: {
    total_bids: number;
    decided_bids: number;
    won_bids: number;
    lost_bids: number;
    pending_bids: number;
    cancelled_bids: number;
    overall_win_rate: number;
    result_completion_rate: number;
  };
  property_types: MyStatisticsBreakdown[];
  courts: MyStatisticsBreakdown[];
  monthly: Array<{ month: string; total_count: number; won_count: number; win_rate: number }>;
  insights: { strengths: string[]; weaknesses: string[]; notes: string[] };
  source_counts: Record<MyStatisticsBid['source'], number>;
  price_accuracy: {
    suggested_actual_count: number;
    winning_comparison_count: number;
    avg_suggested_actual_gap_rate: number;
    avg_winning_gap_rate: number;
    within_five_percent_rate: number;
    coverage_from: string;
  };
  court_property_matrix: Array<{
    court: string; property_type: string; total_count: number; won_count: number; win_rate: number;
  }>;
  rolling_win_rates: Array<{ months: 3 | 6 | 12; total_count: number; decided_count: number; won_count: number; win_rate: number }>;
  revenue: {
    coverage_from: string;
    confirmed_case_count: number;
    pending_case_count: number;
    refunded_case_count: number;
    missing_record_count: number;
    total: number;
    average_per_case: number;
    top_case_amount: number;
    top_case_share: number;
    top_three_share: number;
  };
  rolling_revenue: Array<{
    months: 3 | 6 | 12;
    total: number;
    case_count: number;
    previous_total: number;
    change_rate: number | null;
    has_records: boolean;
    coverage_complete: boolean;
  }>;
  monthly_revenue: Array<{ month: string; total: number; case_count: number }>;
};

function text(value: unknown): string {
  return String(value || '').trim();
}
function keyText(value: unknown): string {
  return text(value).toLowerCase().replace(/\s+/g, '');
}

function percent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
}

export function myStatisticsBidIdentity(bid: MyStatisticsBid): string {
  const caseNumber = keyText(bid.caseNumber);
  if (!caseNumber) return `${bid.source}:${bid.sourceId}`;
  // 법원명은 같은 법원도 "부산동부지원"/"부산지방법원 동부지원"처럼 원천별 표기가 달라
  // 중복 판정에서 제외한다. 담당자·입찰일·사건번호·물건번호가 모두 같을 때만 한 건이다.
  return [bid.userId, bid.bidDate.slice(0, 10), caseNumber, keyText(bid.itemNumber)].join('|');
}

export function dedupeMyStatisticsBids(bids: MyStatisticsBid[]): MyStatisticsBid[] {
  const priority = { schedule: 4, journal: 3, legacy: 2, historical: 1 } as const;
  const byIdentity = new Map<string, MyStatisticsBid>();
  bids.forEach((bid) => {
    const key = myStatisticsBidIdentity(bid);
    const current = byIdentity.get(key);
    if (!current) {
      byIdentity.set(key, bid);
      return;
    }
    if (priority[bid.source] > priority[current.source]) {
      byIdentity.set(key, bid.revenueState && bid.revenueState !== 'missing'
        ? bid
        : {
            ...bid,
            revenueAmount: current.revenueAmount,
            revenueDate: current.revenueDate,
            revenueState: current.revenueState || bid.revenueState,
          });
      return;
    }
    if ((!current.revenueState || current.revenueState === 'missing') && bid.revenueState && bid.revenueState !== 'missing') {
      current.revenueAmount = bid.revenueAmount;
      current.revenueDate = bid.revenueDate;
      current.revenueState = bid.revenueState;
    }
  });
  return [...byIdentity.values()].sort((a, b) => b.bidDate.localeCompare(a.bidDate));
}

function confirmedRevenue(bid: MyStatisticsBid): number {
  if (bid.result !== 'won' || bid.revenueState !== 'confirmed') return 0;
  return normalizedAmount(bid.revenueAmount) || 0;
}

function breakdown(bids: MyStatisticsBid[], labelOf: (bid: MyStatisticsBid) => string): MyStatisticsBreakdown[] {
  const totalWins = bids.filter((bid) => bid.result === 'won').length;
  const totalRevenue = bids.reduce((sum, bid) => sum + confirmedRevenue(bid), 0);
  const groups = new Map<string, { total: number; won: number; decided: number; revenue: number; revenueCases: number; revenueMissing: number }>();
  bids.forEach((bid) => {
    const label = text(labelOf(bid)) || '미분류';
    const group = groups.get(label) || { total: 0, won: 0, decided: 0, revenue: 0, revenueCases: 0, revenueMissing: 0 };
    group.total += 1;
    if (bid.result === 'won') group.won += 1;
    if (bid.result === 'won' || bid.result === 'lost') group.decided += 1;
    const revenue = confirmedRevenue(bid);
    if (revenue > 0) {
      group.revenue += revenue;
      group.revenueCases += 1;
    } else if (bid.result === 'won' && (!bid.revenueState || bid.revenueState === 'missing')) {
      group.revenueMissing += 1;
    }
    groups.set(label, group);
  });
  return [...groups.entries()].map(([label, group]) => ({
    label,
    total_count: group.total,
    total_share: percent(group.total, bids.length),
    won_count: group.won,
    won_share: percent(group.won, totalWins),
    win_rate: percent(group.won, group.decided),
    revenue_case_count: group.revenueCases,
    total_revenue: group.revenue,
    average_revenue: group.revenueCases ? Math.round(group.revenue / group.revenueCases) : 0,
    revenue_share: percent(group.revenue, totalRevenue),
    revenue_missing_count: group.revenueMissing,
  })).sort((a, b) => b.total_count - a.total_count || a.label.localeCompare(b.label, 'ko'));
}

function normalizedAmount(value: number | null | undefined): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function average(values: number[]): number {
  return values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : 0;
}

function shiftMonths(dateText: string, months: number): string {
  const [year, month, day] = dateText.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 - months, day));
  return date.toISOString().slice(0, 10);
}

export function buildMyStatistics(input: MyStatisticsBid[], referenceDate = new Date().toISOString().slice(0, 10)): MyStatisticsResult {
  const bids = dedupeMyStatisticsBids(input);
  const won = bids.filter((bid) => bid.result === 'won').length;
  const lost = bids.filter((bid) => bid.result === 'lost').length;
  const pending = bids.filter((bid) => bid.result === 'pending').length;
  const cancelled = bids.filter((bid) => bid.result === 'cancelled').length;
  const decided = won + lost;
  const propertyTypes = breakdown(bids, (bid) => bid.propertyType);
  const courts = breakdown(bids, (bid) => bid.court);
  const monthlyMap = new Map<string, { total: number; won: number; decided: number }>();
  bids.forEach((bid) => {
    const month = bid.bidDate.slice(0, 7) || '미상';
    const row = monthlyMap.get(month) || { total: 0, won: 0, decided: 0 };
    row.total += 1;
    if (bid.result === 'won') row.won += 1;
    if (bid.result === 'won' || bid.result === 'lost') row.decided += 1;
    monthlyMap.set(month, row);
  });
  const monthly = [...monthlyMap.entries()].map(([month, row]) => ({
    month,
    total_count: row.total,
    won_count: row.won,
    win_rate: percent(row.won, row.decided),
  })).sort((a, b) => a.month.localeCompare(b.month));

  const suggestedActualGaps: number[] = [];
  const winningGaps: number[] = [];
  const accuracyDates: string[] = [];
  bids.forEach((bid) => {
    const suggested = normalizedAmount(bid.suggestedPrice);
    const actual = normalizedAmount(bid.actualBidPrice);
    const winning = normalizedAmount(bid.winningPrice);
    if (suggested && actual) {
      suggestedActualGaps.push(Math.abs(actual - suggested) / suggested * 100);
      accuracyDates.push(bid.bidDate);
    }
    if (actual && winning) {
      winningGaps.push(Math.abs(actual - winning) / winning * 100);
      accuracyDates.push(bid.bidDate);
    }
  });

  const matrixMap = new Map<string, { court: string; propertyType: string; total: number; won: number; decided: number }>();
  bids.forEach((bid) => {
    const court = text(bid.court) || '미분류';
    const propertyType = text(bid.propertyType) || '미분류';
    const key = `${court}\u0000${propertyType}`;
    const row = matrixMap.get(key) || { court, propertyType, total: 0, won: 0, decided: 0 };
    row.total += 1;
    if (bid.result === 'won') row.won += 1;
    if (bid.result === 'won' || bid.result === 'lost') row.decided += 1;
    matrixMap.set(key, row);
  });
  const courtPropertyMatrix = [...matrixMap.values()].map((row) => ({
    court: row.court, property_type: row.propertyType, total_count: row.total,
    won_count: row.won, win_rate: percent(row.won, row.decided),
  })).sort((a, b) => b.total_count - a.total_count || b.win_rate - a.win_rate).slice(0, 40);

  const rollingWinRates = ([3, 6, 12] as const).map((months) => {
    const from = shiftMonths(referenceDate, months);
    const periodBids = bids.filter((bid) => bid.bidDate >= from && bid.bidDate <= referenceDate);
    const periodWon = periodBids.filter((bid) => bid.result === 'won').length;
    const periodDecided = periodBids.filter((bid) => bid.result === 'won' || bid.result === 'lost').length;
    return { months, total_count: periodBids.length, decided_count: periodDecided, won_count: periodWon, win_rate: percent(periodWon, periodDecided) };
  });

  const revenueRecordedWon = bids.filter((bid) => bid.result === 'won' && bid.revenueState && bid.revenueState !== 'missing');
  const confirmedRevenueBids = revenueRecordedWon.filter((bid) => confirmedRevenue(bid) > 0);
  const revenueDates = revenueRecordedWon.map((bid) => text(bid.revenueDate)).filter(Boolean).sort();
  const revenueCoverageFrom = revenueDates[0] || '';
  const revenueAmounts = confirmedRevenueBids.map((bid) => confirmedRevenue(bid)).sort((a, b) => b - a);
  const revenueTotal = revenueAmounts.reduce((sum, value) => sum + value, 0);
  const monthlyRevenueMap = new Map<string, { total: number; count: number }>();
  confirmedRevenueBids.forEach((bid) => {
    const month = text(bid.revenueDate).slice(0, 7);
    if (!month) return;
    const row = monthlyRevenueMap.get(month) || { total: 0, count: 0 };
    row.total += confirmedRevenue(bid);
    row.count += 1;
    monthlyRevenueMap.set(month, row);
  });
  const monthlyRevenue = [...monthlyRevenueMap.entries()]
    .map(([month, row]) => ({ month, total: row.total, case_count: row.count }))
    .sort((a, b) => a.month.localeCompare(b.month));
  const rollingRevenue = ([3, 6, 12] as const).map((months) => {
    const from = shiftMonths(referenceDate, months);
    const previousFrom = shiftMonths(referenceDate, months * 2);
    const current = confirmedRevenueBids.filter((bid) => text(bid.revenueDate) >= from && text(bid.revenueDate) <= referenceDate);
    const previous = confirmedRevenueBids.filter((bid) => text(bid.revenueDate) >= previousFrom && text(bid.revenueDate) < from);
    const total = current.reduce((sum, bid) => sum + confirmedRevenue(bid), 0);
    const previousTotal = previous.reduce((sum, bid) => sum + confirmedRevenue(bid), 0);
    const coverageComplete = Boolean(revenueCoverageFrom && revenueCoverageFrom <= previousFrom);
    const changeRate = coverageComplete && previousTotal > 0
      ? Math.round(((total - previousTotal) / previousTotal) * 1000) / 10
      : null;
    return {
      months,
      total,
      case_count: current.length,
      previous_total: previousTotal,
      change_rate: changeRate,
      has_records: Boolean(revenueCoverageFrom),
      coverage_complete: coverageComplete,
    };
  });

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const notes: string[] = [];
  const topVolume = propertyTypes[0];
  if (topVolume) strengths.push(`${topVolume.label} 입찰 경험이 ${topVolume.total_count}건(${topVolume.total_share}%)으로 가장 많습니다.`);
  const rated = propertyTypes.filter((row) => row.total_count >= 3 && row.won_count > 0);
  const best = [...rated].sort((a, b) => b.win_rate - a.win_rate)[0];
  if (best) strengths.push(`${best.label}의 낙찰률이 ${best.win_rate}%로 강점 후보입니다.`);
  const weakest = [...propertyTypes].filter((row) => row.total_count >= 3).sort((a, b) => a.win_rate - b.win_rate)[0];
  if (weakest && weakest.win_rate < 20) weaknesses.push(`${weakest.label}은 ${weakest.total_count}건 중 낙찰률 ${weakest.win_rate}%로 보완 검토가 필요합니다.`);
  if (pending > 0) weaknesses.push(`결과 미입력 ${pending}건이 있어 낙찰률 해석 전에 결과 보완이 필요합니다.`);
  if (courts[0]) notes.push(`${courts[0].label} 입찰 비중이 ${courts[0].total_share}%로 가장 높습니다.`);
  notes.push('낙찰률은 낙찰·실패 결과가 확정된 건만 분모에 포함합니다. 취소와 결과 대기는 제외됩니다.');

  return {
    summary: {
      total_bids: bids.length,
      decided_bids: decided,
      won_bids: won,
      lost_bids: lost,
      pending_bids: pending,
      cancelled_bids: cancelled,
      overall_win_rate: percent(won, decided),
      result_completion_rate: percent(decided + cancelled, bids.length),
    },
    property_types: propertyTypes,
    courts,
    monthly,
    insights: { strengths, weaknesses, notes },
    source_counts: bids.reduce((acc, bid) => {
      acc[bid.source] += 1;
      return acc;
    }, { journal: 0, schedule: 0, legacy: 0, historical: 0 }),
    price_accuracy: {
      suggested_actual_count: suggestedActualGaps.length,
      winning_comparison_count: winningGaps.length,
      avg_suggested_actual_gap_rate: average(suggestedActualGaps),
      avg_winning_gap_rate: average(winningGaps),
      within_five_percent_rate: percent(winningGaps.filter((gap) => gap <= 5).length, winningGaps.length),
      coverage_from: accuracyDates.sort()[0] || '',
    },
    court_property_matrix: courtPropertyMatrix,
    rolling_win_rates: rollingWinRates,
    revenue: {
      coverage_from: revenueCoverageFrom,
      confirmed_case_count: confirmedRevenueBids.length,
      pending_case_count: revenueRecordedWon.filter((bid) => bid.revenueState === 'pending').length,
      refunded_case_count: revenueRecordedWon.filter((bid) => bid.revenueState === 'refunded').length,
      missing_record_count: bids.filter((bid) => bid.result === 'won' && (!bid.revenueState || bid.revenueState === 'missing')).length,
      total: revenueTotal,
      average_per_case: confirmedRevenueBids.length ? Math.round(revenueTotal / confirmedRevenueBids.length) : 0,
      top_case_amount: revenueAmounts[0] || 0,
      top_case_share: percent(revenueAmounts[0] || 0, revenueTotal),
      top_three_share: percent(revenueAmounts.slice(0, 3).reduce((sum, value) => sum + value, 0), revenueTotal),
    },
    rolling_revenue: rollingRevenue,
    monthly_revenue: monthlyRevenue,
  };
}
