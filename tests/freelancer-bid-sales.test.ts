import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  freelancerBidSalesExternalId,
  normalizeWonSalesInput,
} from '../src/shared/freelancer-bid-sales.ts';
import {
  isFreelancerSupervisor,
  requiresEmployeeLogin,
} from '../src/shared/employment-access.ts';

test('낙찰가와 회사 수수료 매출액을 서로 다른 원 단위 금액으로 보존한다', () => {
  assert.deepEqual(normalizeWonSalesInput({
    actual_bid_price: 330_000_000,
    sales_amount: 3_300_000,
    depositor_name: '홍길동',
    payment_type: '이체',
  }), {
    winning_price: 330_000_000,
    sales_amount: 3_300_000,
    depositor_name: '홍길동',
    payment_type: '이체',
  });
  assert.equal(freelancerBidSalesExternalId('bid-1'), 'freelancer-bid:bid-1');
});

test('매출액·낙찰가·입금자 중 하나라도 없으면 낙찰 매출을 만들지 않는다', () => {
  assert.equal(normalizeWonSalesInput({ actual_bid_price: 1, sales_amount: 0, depositor_name: 'A' }), null);
  assert.equal(normalizeWonSalesInput({ actual_bid_price: 0, sales_amount: 1, depositor_name: 'A' }), null);
  assert.equal(normalizeWonSalesInput({ actual_bid_price: 1, sales_amount: 1, depositor_name: '' }), null);
});

test('팀장 프리랜서만 팀 감독 범위를 가지며 일반로그인 강제 직군은 식별된다', () => {
  assert.equal(isFreelancerSupervisor({ login_type: 'freelancer', role: 'manager' }), true);
  assert.equal(isFreelancerSupervisor({ login_type: 'freelancer', role: 'member' }), false);
  assert.equal(requiresEmployeeLogin({ role: 'member', department: '명도팀' }), true);
  assert.equal(requiresEmployeeLogin({ role: 'member', position_title: 'PD' }), true);
  assert.equal(requiresEmployeeLogin({ role: 'manager', position_title: '사무장' }), true);
  assert.equal(requiresEmployeeLogin({ role: 'director' }), true);
  assert.equal(requiresEmployeeLogin({ role: 'manager', department: '경매사업부' }), false);
});

test('입찰 내역은 경매 스케줄과 과거 기록의 통합 조회 전용이다', () => {
  const routeSource = readFileSync(new URL('../src/worker/routes/freelancer-bids.ts', import.meta.url), 'utf8');
  const executableSource = routeSource.replace(/\/\*[\s\S]*?\*\//g, '');
  const pageSource = readFileSync(new URL('../src/react-app/pages/UnifiedBidHistory.tsx', import.meta.url), 'utf8');
  const appSource = readFileSync(new URL('../src/react-app/App.tsx', import.meta.url), 'utf8');
  const layoutSource = readFileSync(new URL('../src/react-app/components/Layout.tsx', import.meta.url), 'utf8');

  assert.match(executableSource, /FROM freelancer_bid_entries f/);
  assert.match(executableSource, /FROM freelancer_auction_schedules s/);
  assert.match(executableSource, /source_type: 'auction_schedule'/);
  assert.match(executableSource, /신규 입찰은 경매 스케줄에서 등록해 주세요/);
  assert.match(executableSource, /낙찰 처리는 경매 스케줄에서만 가능합니다/);
  assert.doesNotMatch(executableSource, /INSERT OR IGNORE INTO sales_records/);
  assert.doesNotMatch(executableSource, /DELETE FROM freelancer_bid_entries/);
  assert.match(pageSource, /작성과 결과 처리는 경매 스케줄에서 진행합니다/);
  assert.match(pageSource, /\/auction-schedule\?date=/);
  assert.match(pageSource, /<th>법원<\/th>/);
  assert.match(pageSource, /<th>계약자명<\/th>/);
  assert.match(pageSource, /<th>입찰자명<\/th>/);
  assert.match(executableSource, /user\?\.role === 'master' \|\| \(!requireFreelancer\(user\)/);
  assert.match(appSource, /function BidListAdminRoute/);
  assert.match(appSource, /const isMaster = user\?\.role === 'master'/);
  assert.match(layoutSource, /const canViewFreelancerBids = role === 'master'/);
  assert.ok(
    layoutSource.indexOf('title="경매 스케줄"') < layoutSource.indexOf('title="입찰 내역"'),
    '메뉴에서 경매 스케줄이 입찰 내역보다 먼저 배치되어야 한다',
  );
});

test('낙찰 매출 생성은 경매 스케줄의 고유 외부키와 pending 상태를 사용한다', () => {
  const source = readFileSync(new URL('../src/worker/routes/auction-schedule.ts', import.meta.url), 'utf8');
  assert.match(source, /auctionScheduleSalesExternalId\(id\)/);
  assert.match(source, /INSERT OR IGNORE INTO sales_records/);
  assert.match(source, /'pending', 'income'/);
  assert.match(source, /경매 스케줄 낙찰 자동 입금신청/);
});

test('프리랜서의 일지·휴가·근태 종합분석 API를 서버에서 차단한다', () => {
  const journal = readFileSync(new URL('../src/worker/routes/journal.ts', import.meta.url), 'utf8');
  const leave = readFileSync(new URL('../src/worker/routes/leave.ts', import.meta.url), 'utf8');
  const analytics = readFileSync(new URL('../src/worker/routes/analytics-comprehensive.ts', import.meta.url), 'utf8');
  assert.match(journal, /login_type === 'freelancer'/);
  assert.match(journal, /컨설턴트 일지·근태 기능/);
  assert.match(leave, /login_type === 'freelancer'/);
  assert.match(leave, /연차·휴가 기능/);
  assert.match(analytics, /login_type === 'freelancer'/);
  assert.match(analytics, /근태·일지가 포함된 종합성과 분석/);
});
