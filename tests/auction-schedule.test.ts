import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  auctionScheduleBidResult,
  auctionScheduleBidResultMissingFields,
  auctionScheduleSalesExternalId,
  calculateAuctionScheduleWinningFee,
  canViewResignedAuctionHistory,
  canViewSuggestedBidPrice,
  getAuctionScheduleValidationError,
  getCalendarRowWeekNumber,
  getKoreanWeekLabel,
  isAuctionScheduleActivityType,
  isAuctionScheduleBidResultDue,
  normalizeAuctionCaseSearch,
  parseAuctionCaseNumber,
  redactSuggestedBidPrice,
  sanitizeAuctionScheduleData,
  canViewAuctionSchedule,
} from '../src/shared/auction-schedule.ts';
import { canViewConsultantJournal, JEONG_MINHO_USER_ID } from '../src/shared/consultant-journal-access.ts';
import { ensureAuctionScheduleTable } from '../src/worker/lib/auction-schedule-schema.ts';
import { findAuctionInspectionSuggestions } from '../src/worker/lib/auction-schedule-inspection-suggestions.ts';
import {
  AUCTION_SCHEDULE_BRANCH_OPTIONS,
  canSelectAuctionScheduleBranch,
  defaultAuctionScheduleBranch,
  normalizeAuctionScheduleBranchFilter,
} from '../src/shared/auction-schedule-branch.ts';

function d1FromSqlite(db: Database.Database): D1Database {
  return {
    prepare(sql: string) {
      const statement = db.prepare(sql);
      return {
        bind(...params: unknown[]) {
          return {
            async all() { return { results: statement.all(...params) }; },
          };
        },
      };
    },
  } as unknown as D1Database;
}

test('auction schedule is visible to every active employee and freelancer role', () => {
  for (const role of ['master', 'ceo', 'cc_ref', 'admin', 'director', 'accountant', 'accountant_asst', 'manager', 'member', 'support']) {
    assert.equal(canViewAuctionSchedule({ role }), true, role);
  }
  assert.equal(canViewAuctionSchedule({ role: 'resigned' }), false);
  assert.equal(canViewAuctionSchedule(null), false);
});

test('consultant journal page is limited to master, CEO, and Jeong Minho', () => {
  assert.equal(canViewConsultantJournal({ id: 'master', role: 'master' }), true);
  assert.equal(canViewConsultantJournal({ id: 'ceo', role: 'ceo' }), true);
  assert.equal(canViewConsultantJournal({ id: JEONG_MINHO_USER_ID, role: 'admin' }), true);
  assert.equal(canViewConsultantJournal({ id: 'other-admin', role: 'admin' }), false);
  assert.equal(canViewConsultantJournal({ id: 'member', role: 'member' }), false);
});

test('동시에 들어온 스키마 확인 요청은 D1 배치를 한 번만 실행한다', async () => {
  let batchCalls = 0;
  const db = {
    prepare(sql: string) { return { sql }; },
    async batch() {
      batchCalls += 1;
      await Promise.resolve();
      return [];
    },
  } as any;

  await Promise.all([
    ensureAuctionScheduleTable(db),
    ensureAuctionScheduleTable(db),
    ensureAuctionScheduleTable(db),
  ]);
  assert.equal(batchCalls, 1);
});

test('suggested bid price is visible only to authorized administrators', () => {
  assert.equal(canViewSuggestedBidPrice('admin'), true);
  assert.equal(canViewSuggestedBidPrice('manager'), false);
  assert.deepEqual(
    redactSuggestedBidPrice('입찰', { caseNo: '2026타경1', suggestedPrice: '100000000' }, false),
    { caseNo: '2026타경1' },
  );
  assert.deepEqual(
    redactSuggestedBidPrice('입찰', { suggestedPrice: '100000000' }, true),
    { suggestedPrice: '100000000' },
  );
});

test('퇴사자 원본 일지는 관리자만 경매 스케줄에서 열람한다', () => {
  assert.equal(canViewResignedAuctionHistory('master'), true);
  assert.equal(canViewResignedAuctionHistory('accountant_asst'), true);
  assert.equal(canViewResignedAuctionHistory('manager'), false);
  assert.equal(canViewResignedAuctionHistory('member'), false);
});

test('8월 3일이 포함된 주는 달력 행 기준 8월 둘째 주다', () => {
  const monday = new Date(2026, 7, 3);
  assert.equal(getCalendarRowWeekNumber(monday), 2);
  assert.equal(getKoreanWeekLabel(monday), '8월 둘째 주');
});

test('경매 스케줄은 입찰·임장만 허용하고 미팅은 제거한다', () => {
  assert.equal(isAuctionScheduleActivityType('입찰'), true);
  assert.equal(isAuctionScheduleActivityType('임장'), true);
  assert.equal(isAuctionScheduleActivityType('미팅'), false);
  assert.equal(isAuctionScheduleActivityType('사무'), false);
  assert.equal(isAuctionScheduleActivityType('개인'), false);
});

test('경매 스케줄 낙찰 매출은 일정별 고유 외부키를 사용한다', () => {
  assert.equal(auctionScheduleSalesExternalId('schedule-1'), 'auction-schedule:schedule-1');
  assert.equal(calculateAuctionScheduleWinningFee(100_000_000), 2_200_000);
  assert.equal(calculateAuctionScheduleWinningFee(500_000_000), 5_000_000);
});

test('입찰일 오후 3시부터 낙찰·실패 결과와 세 가지 금액을 필수로 판정한다', () => {
  assert.equal(isAuctionScheduleBidResultDue('2026-08-07', new Date('2026-08-07T05:59:59Z')), false);
  assert.equal(isAuctionScheduleBidResultDue('2026-08-07', new Date('2026-08-07T06:00:00Z')), true);
  assert.equal(isAuctionScheduleBidResultDue('2026-08-06', new Date('2026-08-07T00:00:00Z')), true);
  assert.deepEqual(auctionScheduleBidResultMissingFields({}), ['제안입찰가', '작성입찰가', '낙찰여부', '최종 낙찰가']);
  assert.equal(auctionScheduleBidResult({ bidWon: true }), 'won');
  assert.deepEqual(auctionScheduleBidResultMissingFields({ suggestedPrice: '1', bidPrice: '2', winPrice: '3', bidWon: true }), []);
  assert.equal(auctionScheduleBidResult({ bidFailed: true }), 'failed');
  assert.deepEqual(auctionScheduleBidResultMissingFields({ suggestedPrice: '1', bidPrice: '2', winPrice: '3', bidFailed: true }), []);
  assert.deepEqual(auctionScheduleBidResultMissingFields({ bidCancelled: true }), []);
});

test('시간과 현장 출퇴근 값은 일정 데이터에서 제거한다', () => {
  assert.deepEqual(sanitizeAuctionScheduleData({
    caseNo: '2026타경1234',
    timeFrom: '09:00',
    timeTo: '18:00',
    fieldCheckIn: true,
    fieldCheckOut: true,
  }), { caseNo: '2026타경1234' });
});

test('임장 자동채우기 사건번호는 공백을 무시하고 연도와 일련번호로 분리한다', () => {
  assert.equal(normalizeAuctionCaseSearch(' 2025타경  12345 '), '2025타경12345');
  assert.deepEqual(parseAuctionCaseNumber('2025타경 12345'), { year: '2025', serial: '12345' });
  assert.equal(parseAuctionCaseNumber('김민수'), null);
});

test('임장 자동채우기는 입찰기일이 있는 같은 담당자의 기록만 검색한다', async () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE freelancer_auction_schedules (
      id TEXT PRIMARY KEY, user_id TEXT, target_date TEXT, activity_type TEXT,
      data TEXT, created_at TEXT
    );
  `);
  const insert = sqlite.prepare('INSERT INTO freelancer_auction_schedules VALUES (?, ?, ?, ?, ?, ?)');
  insert.run('mine', 'owner-1', '2026-08-01', '임장', JSON.stringify({
    caseNo: '2025타경12345', client: '김민수', court: '의정부지방법원', itemNo: '2',
    propertyCategory: '주거시설', propertyType: '아파트', bidDate: '2026-09-15',
  }), '2026-08-01');
  insert.run('other-owner', 'owner-2', '2026-08-02', '임장', JSON.stringify({
    caseNo: '2025타경12345', client: '김민수', bidDate: '2026-09-16',
  }), '2026-08-02');
  insert.run('no-bid-date', 'owner-1', '2026-08-03', '임장', JSON.stringify({
    caseNo: '2025타경19999', client: '김민수',
  }), '2026-08-03');
  insert.run('companion', 'owner-1', '2026-08-04', '임장', JSON.stringify({
    caseNo: '2025타경17777', client: '김민수', bidDate: '2026-09-18', companion: true,
  }), '2026-08-04');

  const byCase = await findAuctionInspectionSuggestions(d1FromSqlite(sqlite), 'owner-1', '2025타경 1');
  const byName = await findAuctionInspectionSuggestions(d1FromSqlite(sqlite), 'owner-1', '김민수');
  assert.deepEqual(byCase.map(row => row.id), ['mine']);
  assert.deepEqual(byName.map(row => row.id), ['mine']);
  assert.equal(byCase[0].bid_date, '2026-09-15');
  assert.equal(byCase[0].property_type, '아파트');
  sqlite.close();
});

test('활동별 필수 일정 정보를 검증한다', () => {
  assert.equal(getAuctionScheduleValidationError('입찰', {
    caseNo: '2026타경1234', court: '서울중앙지방법원', client: '홍길동', propertyType: '아파트',
  }), null);
  assert.match(getAuctionScheduleValidationError('임장', {}) || '', /임장은/);
  assert.equal(getAuctionScheduleValidationError('미팅', { client: '홍길동' }), null);
});

test('프리랜서 스케줄은 정규직 일지와 별도 테이블·라우트로 저장한다', () => {
  const route = readFileSync(new URL('../src/worker/routes/auction-schedule.ts', import.meta.url), 'utf8');
  const suggestionLib = readFileSync(new URL('../src/worker/lib/auction-schedule-inspection-suggestions.ts', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../d1/migrate-freelancer-auction-schedules.sql', import.meta.url), 'utf8');
  assert.match(route, /freelancer_auction_schedules/);
  assert.doesNotMatch(route, /INSERT INTO journal_entries/);
  assert.match(route, /login_type !== 'freelancer'/);
  assert.match(route, /requireHumanUser/);
  assert.match(route, /'employee_journal' AS source_type/);
  assert.match(route, /COALESCE\(u\.login_type, 'employee'\) = 'freelancer'/);
  assert.match(route, /OR u\.role = 'resigned'/);
  assert.match(route, /post\('\/:id\/bid-result'/);
  assert.match(route, /get\('\/my-bid-result-requirements'/);
  assert.match(route, /put\('\/:id\/bid-prices'/);
  assert.match(route, /result === 'won' \|\| result === 'failed'/);
  assert.match(route, /INSERT INTO commissions/);
  assert.match(route, /'DEPOSIT_CLAIM'/);
  assert.match(route, /auctionScheduleSalesExternalId\(id\)/);
  assert.match(route, /입금신청이 연결된 낙찰 일정은 수정할 수 없습니다/);
  assert.match(route, /accounting_activity_logs/);
  assert.match(route, /'pending', 'income'/);
  assert.match(route, /normalizeWonSalesInput/);
  assert.match(route, /입금신청이 연결된 일정은 삭제할 수 없습니다/);
  assert.match(route, /ADMIN_VIEW_ROLES = new Set\(\['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'\]\)/);
  assert.match(route, /user\.role === 'master' \|\| \(user\.login_type === 'freelancer' && user\.sub === ownerId\)/);
  assert.match(route, /get\('\/create-options'/);
  assert.match(route, /get\('\/inspection-suggestions'/);
  assert.match(suggestionLib, /activity_type = '임장'/);
  assert.match(suggestionLib, /json_extract\(data, '\$\.bidDate'\) GLOB/);
  assert.match(route, /const ownerId = user\.role === 'master' \? requestedOwnerId : user\.sub/);
  assert.match(route, /user\.role !== 'master'/);
  assert.match(route, /COALESCE\(login_type, 'employee'\) = 'freelancer'/);
  assert.match(route, /requestedOwnerId && requestedOwnerId !== user\.sub/);
  assert.match(route, /const ownerId = user\.role === 'master' \? requestedOwnerId : user\.sub/);
  assert.match(route, /owner\.branch \|\| ''/);
  assert.match(route, /owner\.department \|\| ''/);
  assert.match(route, /query \+= ' AND s\.branch = \?'/);
  assert.match(route, /historyQuery \+= ' AND j\.branch = \?'/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS freelancer_auction_schedules/);
  assert.doesNotMatch(migration, /ON DELETE CASCADE/);
});

test('화면은 주말과 공휴일을 포함한 7일이며 카드 텍스트를 생략하지 않는다', () => {
  const page = readFileSync(new URL('../src/react-app/pages/AuctionSchedule.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/react-app/App.tsx', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../src/react-app/components/Layout.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/react-app/index.css', import.meta.url), 'utf8');
  const resultEditor = readFileSync(new URL('../src/react-app/components/AuctionBidResultEditor.tsx', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../src/worker/routes/auction-schedule.ts', import.meta.url), 'utf8');
  const journalForm = readFileSync(new URL('../src/react-app/journal/JournalForm.tsx', import.meta.url), 'utf8');
  assert.match(page, /Array\.from\(\{ length: 7 \}/);
  assert.match(page, /\['월', '화', '수', '목', '금', '토', '일'\]/);
  assert.match(page, /result\.holidays/);
  assert.match(page, /isWeekend/);
  assert.match(page, /isHoliday/);
  assert.doesNotMatch(page, /프리랜서의 입찰·임장·미팅 일정을 공유합니다/);
  assert.match(route, /s\.activity_type IN \('입찰', '임장'\)/);
  assert.match(route, /j\.activity_type IN \('입찰', '임장'\)/);
  assert.match(journalForm, /mode === 'auction-schedule' \? ACTIVITY_TYPES\.filter\(\(t\) => \['입찰', '임장'\]\.includes\(t\)\)/);
  assert.match(css, /\.auction-schedule-week-grid[\s\S]*?grid-template-columns:\s*repeat\(7/);
  assert.match(css, /\.auction-schedule-item[\s\S]*?white-space:\s*normal/);
  assert.match(css, /\.auction-schedule-item[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(app, /if \(!canViewAuctionSchedule\(user\)\)/);
  assert.match(layout, /const showAuctionSchedule = canViewAuctionSchedule\(user\)/);
  assert.match(layout, /const showConsultantJournal = canViewConsultantJournal\(user\)/);
  assert.ok(
    layout.indexOf('title="경매 스케줄"') < layout.indexOf('title="회의록"'),
    '마이페이지에서 경매 스케줄이 회의록보다 먼저 배치되어야 한다',
  );
  assert.match(page, /const canCreate = user\?\.role === 'master' \|\| \(user as any\)\?\.login_type === 'freelancer'/);
  assert.match(page, /const canChooseCreateAssignee = user\?\.role === 'master'/);
  assert.match(page, /auctionSchedule\.createOptions\(\)/);
  assert.match(page, /assignableMembers=\{createAssignees\}/);
  assert.match(page, /canChooseAssignee=\{canChooseCreateAssignee\}/);
  assert.match(page, /user_id: payload\.user_id/);
  assert.match(page, /\(user as any\)\?\.login_type === 'freelancer' && selected\.user_id === user\?\.id/);
  assert.match(page, /auction-schedule-team-group/);
  assert.match(page, /auction-schedule-team-label/);
  assert.match(css, /\.auction-schedule-team-group \+ \.auction-schedule-team-group[\s\S]*?border-top/);
  assert.match(page, /DatePicker/);
  assert.match(page, /setWeekStart\(mondayOf\(date\)\)/);
  assert.match(page, /aria-label="날짜를 선택하여 경매 스케줄 이동"/);
  assert.match(page, /auction-schedule-calendar-dropdown/);
  assert.match(page, /applyFinalBidResult\(selected, 'failed'\)/);
  assert.match(page, />\s*입찰가 작성\s*</);
  assert.match(resultEditor, /priceOnly \? '입찰가 저장' : '입찰 결과 저장'/);
  assert.doesNotMatch(resultEditor, /회사 낙찰 수수료 매출액/);
  assert.doesNotMatch(resultEditor, /입금자명/);
  assert.doesNotMatch(resultEditor, /결제 방식/);
  assert.match(app, /<AuctionBidResultGate \/>/);
  assert.match(page, /entry\.position_title/);
  assert.match(page, /ROLE_LABELS\[entry\.user_role as Role\]/);
  assert.match(page, /AuctionBidResultEditor/);
  assert.match(page, /bidDate', '입찰기일'/);
  assert.match(page, /취하\/변경/);
  assert.match(page, /정규직 시절 컨설턴트 일지/);
});

test('임장 입찰기일과 같은 담당자의 기존 정보 자동채우기 UI를 제공한다', () => {
  const form = readFileSync(new URL('../src/react-app/journal/JournalForm.tsx', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../src/react-app/api.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/react-app/index.css', import.meta.url), 'utf8');

  assert.match(form, /기존 임장 정보 자동채우기/);
  assert.match(form, /계약자명 또는 사건번호 검색/);
  assert.match(form, /inspectionSuggestions\(inspectionSearch, canChooseAssignee \? assigneeId : undefined\)/);
  assert.match(form, /bidDate: `\$\{inspBidYear\}-\$\{inspBidMonth\}-\$\{inspBidDay\}`/);
  assert.match(form, /입찰기일/);
  assert.match(form, /<select[\s\S]*?aria-label="입찰기일 연도"/);
  assert.match(form, /<select[\s\S]*?aria-label="입찰기일 월"/);
  assert.match(form, /<select[\s\S]*?aria-label="입찰기일 일자"/);
  assert.match(form, /<option value="">일자<\/option>/);
  assert.match(form, /setBidCaseNo\(parsedCase\.serial\)/);
  assert.match(form, /setBidBidder\(suggestion\.client/);
  assert.match(form, /setBidCourt\(suggestion\.court/);
  assert.match(api, /inspectionSuggestions: \(query: string, ownerId\?: string\)/);
  assert.match(css, /\.auction-inspection-bid-date-selects/);
  assert.match(css, /\.auction-inspection-suggestion-list/);
});

test('경매 스케줄 지사 선택지는 전체보기와 네 지사로 고정한다', () => {
  assert.deepEqual(
    AUCTION_SCHEDULE_BRANCH_OPTIONS.map(option => option.label),
    ['전체보기', '의정부', '서초', '대전', '부산'],
  );
  assert.equal(normalizeAuctionScheduleBranchFilter('의정부'), '의정부본사');
  assert.equal(normalizeAuctionScheduleBranchFilter('서초지사'), '서초지사');
  assert.equal(normalizeAuctionScheduleBranchFilter('전체보기'), 'all');
  assert.equal(normalizeAuctionScheduleBranchFilter('임의지사'), null);
});

test('담당자는 본인 지사, 정민호·대표·총무·마스터는 전체보기가 기본이다', () => {
  assert.equal(defaultAuctionScheduleBranch({ id: 'member', role: 'member', branch: '대전' }), '대전지사');
  assert.equal(defaultAuctionScheduleBranch({ id: 'freelancer', role: 'member', branch: '부산지사' }), '부산지사');
  assert.equal(defaultAuctionScheduleBranch({ id: 'master', role: 'master', branch: '의정부' }), 'all');
  assert.equal(defaultAuctionScheduleBranch({ id: 'ceo', role: 'ceo', branch: '서초' }), 'all');
  assert.equal(defaultAuctionScheduleBranch({ id: 'accountant', role: 'accountant', branch: '의정부' }), 'all');
  assert.equal(defaultAuctionScheduleBranch({ id: 'asst', role: 'accountant_asst', branch: '의정부' }), 'all');
  assert.equal(defaultAuctionScheduleBranch({ id: '2b6b3606-e425-4361-a115-9283cfef842f', role: 'admin', branch: '서초' }), 'all');
  assert.equal(defaultAuctionScheduleBranch({ id: 'admin', role: 'admin', branch: '서초' }), '서초지사');
});

test('정민호·대표·총무·마스터만 경매 스케줄 지사를 선택할 수 있다', () => {
  assert.equal(canSelectAuctionScheduleBranch({ id: 'master', role: 'master' }), true);
  assert.equal(canSelectAuctionScheduleBranch({ id: 'ceo', role: 'ceo' }), true);
  assert.equal(canSelectAuctionScheduleBranch({ id: 'accountant', role: 'accountant' }), true);
  assert.equal(canSelectAuctionScheduleBranch({ id: 'asst', role: 'accountant_asst' }), true);
  assert.equal(canSelectAuctionScheduleBranch({ id: '2b6b3606-e425-4361-a115-9283cfef842f', role: 'admin' }), true);
  assert.equal(canSelectAuctionScheduleBranch({ id: 'admin', role: 'admin' }), false);
  assert.equal(canSelectAuctionScheduleBranch({ id: 'member', role: 'member' }), false);
  assert.equal(canSelectAuctionScheduleBranch({ id: 'freelancer', role: 'member' }), false);
});

test('경매 스케줄 화면과 서버가 동일한 지사 필터를 사용한다', () => {
  const page = readFileSync(new URL('../src/react-app/pages/AuctionSchedule.tsx', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../src/react-app/api.ts', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../src/worker/routes/auction-schedule.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/react-app/index.css', import.meta.url), 'utf8');

  assert.match(page, /useState\(\(\) => defaultAuctionScheduleBranch\(user\)\)/);
  assert.match(page, /auctionSchedule\.list\(\{ start, end, branch: selectedBranch \}\)/);
  assert.match(page, /aria-label="경매 스케줄 지사 선택"/);
  assert.match(page, /\{canSelectBranch && \([\s\S]{0,180}auction-schedule-branch-filter/);
  assert.match(api, /list: \(params: \{ start: string; end: string; branch\?: string \}\)/);
  assert.match(route, /normalizeAuctionScheduleBranchFilter\(c\.req\.query\('branch'\)\)/);
  assert.match(route, /canSelectAuctionScheduleBranch\(\{ id: user\.sub, role: user\.role \}\)/);
  assert.match(route, /canSelectBranch \? requestedBranch! : \(normalizeBranchName\(user\.branch\)/);
  assert.match(route, /branchFilter !== 'all'/);
  assert.match(route, /query \+= ' AND s\.branch = \?'/);
  assert.match(route, /historyQuery \+= ' AND j\.branch = \?'/);
  assert.match(css, /\.auction-schedule-branch-filter/);
});
