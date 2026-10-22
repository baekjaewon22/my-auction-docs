import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canViewAllMyStatistics, canViewMyStatistics } from '../src/shared/my-statistics-access.ts';
import { buildMyStatistics, dedupeMyStatisticsBids, type MyStatisticsBid } from '../src/worker/lib/my-statistics.ts';

const bid = (overrides: Partial<MyStatisticsBid> = {}): MyStatisticsBid => ({
  source: 'journal', sourceId: Math.random().toString(), userId: 'u1', bidDate: '2026-10-26',
  court: '서울중앙지방법원', caseNumber: '2026타경100', itemNumber: '1', propertyType: '아파트', result: 'lost',
  ...overrides,
});

test('마이통계는 컨설턴트·대표·총무담당에게 보이고 총무보조·명도·PD에는 보이지 않는다', () => {
  for (const role of ['master', 'ceo', 'accountant', 'cc_ref', 'admin', 'director', 'manager', 'member']) {
    assert.equal(canViewMyStatistics({ role }), true, role);
  }
  for (const role of ['accountant_asst', 'support', 'resigned']) {
    assert.equal(canViewMyStatistics({ role }), false, role);
  }
  assert.equal(canViewMyStatistics({ role: 'member', department: '명도팀' }), false);
  assert.equal(canViewMyStatistics({ role: 'member', position_title: '영상 PD' }), false);
  assert.equal(canViewAllMyStatistics({ role: 'master' }), true);
  assert.equal(canViewAllMyStatistics({ role: 'admin' }), false);
  assert.equal(canViewAllMyStatistics({ role: 'ceo' }), true);
  assert.equal(canViewAllMyStatistics({ role: 'accountant' }), true);
  assert.equal(canViewAllMyStatistics({ role: 'accountant_asst' }), false);
  assert.equal(canViewAllMyStatistics({
    id: '2b6b3606-e425-4361-a115-9283cfef842f',
    role: 'member',
    department: '명도팀',
  }), true, '정민호 지사장은 저장된 역할·부서와 무관하게 전 인원을 조회한다');
  assert.equal(canViewAllMyStatistics({
    id: '2b6b3606-e425-4361-a115-9283cfef842f',
    role: 'resigned',
  }), false, '퇴사 상태는 고정 사용자 예외에도 열지 않는다');
  assert.equal(canViewAllMyStatistics({ id: 'another-user', role: 'member' }), false);
});

test('동일 사건이라도 물건번호가 다르면 별도 건이며 같은 물건번호만 중복 제거한다', () => {
  const rows = [
    bid({ source: 'journal', sourceId: 'j1', itemNumber: '1', court: '부산지방법원 동부지원' }),
    bid({ source: 'schedule', sourceId: 's1', itemNumber: '1', result: 'won' }),
    bid({ source: 'schedule', sourceId: 's2', itemNumber: '2' }),
  ];
  const deduped = dedupeMyStatisticsBids(rows);
  assert.equal(deduped.length, 2);
  assert.equal(deduped.find((row) => row.itemNumber === '1')?.source, 'schedule');
});

test('물건·법원 점유율과 확정 결과 기준 낙찰률을 계산한다', () => {
  const result = buildMyStatistics([
    bid({ sourceId: '1', result: 'won' }),
    bid({ sourceId: '2', caseNumber: '2026타경101', result: 'lost' }),
    bid({ sourceId: '3', caseNumber: '2026타경102', propertyType: '공장', court: '수원지방법원', result: 'pending' }),
    bid({ sourceId: '4', caseNumber: '2026타경103', propertyType: '공장', court: '수원지방법원', result: 'cancelled' }),
  ]);
  assert.deepEqual(result.summary, {
    total_bids: 4, decided_bids: 2, won_bids: 1, lost_bids: 1,
    pending_bids: 1, cancelled_bids: 1, overall_win_rate: 50, result_completion_rate: 75,
  });
  assert.equal(result.property_types.find((row) => row.label === '아파트')?.total_share, 50);
  assert.equal(result.property_types.find((row) => row.label === '아파트')?.win_rate, 50);
  assert.equal(result.courts.find((row) => row.label === '수원지방법원')?.total_share, 50);
});

test('마이오피스 가격값만으로 가격 차이와 5% 이내 비율을 계산한다', () => {
  const result = buildMyStatistics([
    bid({ sourceId: 'price-1', result: 'lost', suggestedPrice: 100, actualBidPrice: 110, winningPrice: 115 }),
    bid({ sourceId: 'price-2', caseNumber: '2026타경102', result: 'won', suggestedPrice: 100, actualBidPrice: 100, winningPrice: 100 }),
    bid({ source: 'historical', sourceId: 'excel', caseNumber: '2026타경103', result: 'lost' }),
  ], '2026-10-21');
  assert.equal(result.price_accuracy.suggested_actual_count, 2);
  assert.equal(result.price_accuracy.winning_comparison_count, 2);
  assert.equal(result.price_accuracy.avg_suggested_actual_gap_rate, 5);
  assert.equal(result.price_accuracy.within_five_percent_rate, 100);
});

test('최근 3·6·12개월 낙찰률을 계산한다', () => {
  const bids = [
    bid({ sourceId: 'recent-won', bidDate: '2026-10-01', result: 'won' }),
    bid({ sourceId: 'six-lost', caseNumber: '2026타경101', bidDate: '2026-06-01', result: 'lost' }),
    bid({ sourceId: 'year-won', caseNumber: '2026타경102', bidDate: '2026-01-01', result: 'won' }),
  ];
  const result = buildMyStatistics(bids, '2026-10-21');
  assert.equal(result.rolling_win_rates.find((row) => row.months === 3)?.win_rate, 100);
  assert.equal(result.rolling_win_rates.find((row) => row.months === 6)?.win_rate, 50);
  assert.equal(result.rolling_win_rates.find((row) => row.months === 12)?.win_rate, 66.7);
});

test('낙찰에 연결된 확정매출만 집계하고 과거 미기록은 0원이 아닌 기록 없음으로 남긴다', () => {
  const result = buildMyStatistics([
    bid({ sourceId: 'revenue-1', bidDate: '2026-10-01', result: 'won', propertyType: '아파트', revenueState: 'confirmed', revenueAmount: 3_000_000, revenueDate: '2026-10-03' }),
    bid({ sourceId: 'revenue-2', caseNumber: '2026타경02', bidDate: '2026-09-01', result: 'won', propertyType: '아파트', revenueState: 'confirmed', revenueAmount: 1_000_000, revenueDate: '2026-09-05' }),
    bid({ sourceId: 'pending', caseNumber: '2026타경03', bidDate: '2026-08-01', result: 'won', revenueState: 'pending', revenueAmount: 2_000_000, revenueDate: '2026-08-01' }),
    bid({ source: 'historical', sourceId: 'old', caseNumber: '2025타경04', bidDate: '2025-01-01', result: 'won' }),
    bid({ sourceId: 'lost', caseNumber: '2026타경05', bidDate: '2026-07-01', result: 'lost' }),
  ], '2026-10-21');

  assert.equal(result.revenue.total, 4_000_000);
  assert.equal(result.revenue.confirmed_case_count, 2);
  assert.equal(result.revenue.average_per_case, 2_000_000);
  assert.equal(result.revenue.pending_case_count, 1);
  assert.equal(result.revenue.missing_record_count, 1);
  assert.equal(result.revenue.top_case_share, 75);
  assert.equal(result.revenue.coverage_from, '2026-08-01');
  assert.equal(result.property_types.find((row) => row.label === '아파트')?.total_revenue, 4_000_000);
  assert.equal(result.property_types.find((row) => row.label === '아파트')?.revenue_share, 100);
  assert.equal(result.monthly_revenue.length, 2);
});

test('중복 입찰의 우선 일정이 기존 매출 연결 정보를 이어받는다', () => {
  const deduped = dedupeMyStatisticsBids([
    bid({ source: 'legacy', sourceId: 'legacy-sale', result: 'won', revenueState: 'confirmed', revenueAmount: 2_500_000, revenueDate: '2026-10-20' }),
    bid({ source: 'schedule', sourceId: 'canonical', result: 'won', revenueState: 'missing' }),
  ]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].source, 'schedule');
  assert.equal(deduped[0].revenueState, 'confirmed');
  assert.equal(deduped[0].revenueAmount, 2_500_000);
});

test('마이통계 화면과 API는 낙찰 연결 확정매출 분석을 제공한다', () => {
  const page = readFileSync('src/react-app/pages/MyStatistics.tsx', 'utf8');
  const route = readFileSync('src/worker/routes/my-statistics.ts', 'utf8');

  assert.match(page, /매출 발생 사건 수/);
  assert.match(page, /사건당 평균매출/);
  assert.match(page, /최근 3·6·12개월 매출 변화/);
  assert.match(page, /물건 종류별 입찰·매출 점유율/);
  assert.match(page, /법원·지역별 입찰·매출 점유율/);
  assert.match(page, /입찰 점유율 <b>\{row\.total_share\}%<\/b>/);
  assert.match(page, /매출 점유율 <b>\{row\.revenue_share\}%<\/b>/);
  assert.match(page, /최고 매출 사건 의존도/);
  assert.match(page, /0원이 아닌 <em className="my-stats-no-record">기록 없음<\/em>/);
  assert.doesNotMatch(page, /현재 로그 \{data\.source_counts/);
  assert.match(page, /className="my-stats-no-record"/);
  assert.doesNotMatch(page, /입찰가격 정확도/);
  assert.match(route, /confirmedSalesSql\('sales_records'\)/);
  assert.match(route, /type = '낙찰'/);
  assert.match(route, /auction-schedule:/);
  assert.match(route, /freelancer-bid:/);
});
