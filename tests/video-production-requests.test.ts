import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canManageVideoProduction,
  calculateVideoProductionNet,
  calculateVideoProductionWithholding,
  isExternalVideoProductionAssignee,
  videoProductionDefaultAmount,
} from '../src/shared/video-production.ts';

const routeSource = readFileSync(new URL('../src/worker/routes/video-production-requests.ts', import.meta.url), 'utf8');
const tableSource = readFileSync(new URL('../src/worker/lib/video-production-requests.ts', import.meta.url), 'utf8');
const payrollSource = readFileSync(new URL('../src/worker/routes/payroll.ts', import.meta.url), 'utf8');
const calendarSource = readFileSync(new URL('../src/worker/routes/personal-calendar.ts', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/react-app/App.tsx', import.meta.url), 'utf8');
const layoutSource = readFileSync(new URL('../src/react-app/components/Layout.tsx', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../src/react-app/api.ts', import.meta.url), 'utf8');
const personalCalendarPageSource = readFileSync(new URL('../src/react-app/pages/PersonalCalendar.tsx', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../src/react-app/pages/VideoProductionRequests.tsx', import.meta.url), 'utf8');
const payrollPageSource = readFileSync(new URL('../src/react-app/pages/Payroll.tsx', import.meta.url), 'utf8');
const payrollListSource = readFileSync(new URL('../src/react-app/components/EmployeePayrollListTab.tsx', import.meta.url), 'utf8');
const accountingSource = readFileSync(new URL('../src/worker/routes/accounting.ts', import.meta.url), 'utf8');
const accountingPageSource = readFileSync(new URL('../src/react-app/pages/AccountingSessionOne.tsx', import.meta.url), 'utf8');
const schemaSource = readFileSync(new URL('../d1/schema.sql', import.meta.url), 'utf8');
const migrationSource = readFileSync(new URL('../d1/migrate-video-production-requests.sql', import.meta.url), 'utf8');

test('영상제작 의뢰 권한은 대표, 마스터, 총무담당 exact role만 허용한다', () => {
  assert.equal(canManageVideoProduction({ role: 'master' }), true);
  assert.equal(canManageVideoProduction({ role: 'ceo' }), true);
  assert.equal(canManageVideoProduction({ role: 'accountant' }), true);
  assert.equal(canManageVideoProduction({ role: 'accountant_asst' }), false);
  assert.equal(canManageVideoProduction({ role: 'admin' }), false);
  assert.equal(canManageVideoProduction({ role: 'cc_ref' }), false);
  assert.equal(canManageVideoProduction({ role: 'accountant', auth_type: 'service_token' }), false);
});

test('숏폼/롱폼 기본 금액과 원천징수 산식이 고정되어 있다', () => {
  assert.equal(videoProductionDefaultAmount('short_form'), 30000);
  assert.equal(videoProductionDefaultAmount('long_form'), 200000);
  assert.equal(calculateVideoProductionWithholding(200000), 6600);
  assert.equal(calculateVideoProductionNet(200000), 193400);
  assert.equal(calculateVideoProductionWithholding(30000), 990);
  assert.equal(calculateVideoProductionNet(30000), 29010);
});

test('외부 소속 또는 외부팀 담당자는 비율제가 아니어도 영상제작 외주 정산 대상이다', () => {
  assert.equal(isExternalVideoProductionAssignee({ department: '외부' }), true);
  assert.equal(isExternalVideoProductionAssignee({ team_name: '외부' }), true);
  assert.equal(isExternalVideoProductionAssignee({ department: ' 외 부 ' }), true);
  assert.equal(isExternalVideoProductionAssignee({ department: '영업', team_name: '지원팀' }), false);
  assert.equal(isExternalVideoProductionAssignee(null), false);
});

test('별도 D1 테이블과 운영 마이그레이션이 영상제작 의뢰를 분리 저장한다', () => {
  for (const source of [schemaSource, migrationSource, tableSource]) {
    assert.match(source, /CREATE TABLE IF NOT EXISTS video_production_requests/);
    assert.match(source, /assignee_user_id TEXT NOT NULL/);
    assert.match(source, /video_type TEXT NOT NULL DEFAULT 'short_form'/);
    assert.match(source, /status TEXT NOT NULL DEFAULT 'requested'/);
    assert.match(source, /quantity INTEGER NOT NULL DEFAULT 1/);
    assert.match(source, /unit_amount INTEGER NOT NULL DEFAULT 30000/);
    assert.match(source, /result_received_date TEXT NOT NULL DEFAULT ''/);
    assert.match(source, /CHECK \(video_type IN \('short_form', 'long_form'\)\)/);
    assert.match(source, /CHECK \(status IN \('requested', 'confirmed'\)\)/);
    assert.match(source, /idx_video_production_assignee_result/);
    assert.match(source, /idx_video_production_calendar_dates/);
  }
});

test('API는 인적 로그인 권한, 결과물 날짜 전용 저장, 되돌리기, 급여 요약을 제공한다', () => {
  assert.match(routeSource, /videoProduction\.use\('\*', authMiddleware\)/);
  assert.match(routeSource, /videoProduction\.use\('\*', requireHumanUser\(\)\)/);
  assert.match(routeSource, /canManageVideoProduction\(user\)/);
  assert.match(routeSource, /videoProduction\.post\('\/:id\/result-date'/);
  assert.match(routeSource, /result_received_date = \?/);
  assert.match(routeSource, /rawDate \? 'confirmed' : 'requested'/);
  assert.match(routeSource, /status === 'confirmed' && !resultReceivedDate/);
  assert.match(routeSource, /const amount = unitAmount \* quantity/);
  assert.match(routeSource, /quantity < 1 \|\| quantity > 100/);
  assert.match(routeSource, /videoProduction\.post\('\/:id\/reopen'/);
  assert.match(routeSource, /videoProduction\.get\('\/payroll-summary\/:userId'/);
  assert.match(routeSource, /loadVideoProductionPayrollSummary/);
});

test('캘린더와 마이페이지 라우팅에 영상제작 의뢰가 연결되어 있다', () => {
  assert.match(calendarSource, /buildVideoProductionCalendarEvents/);
  assert.match(tableSource, /source_type: 'video_production'/);
  assert.match(tableSource, /phase: 'request', label: '의뢰'/);
  assert.match(tableSource, /phase: 'result', label: '결과물'/);
  assert.doesNotMatch(tableSource, /phase: 'provided'/);
  assert.doesNotMatch(tableSource, /fallbackField/);
  assert.doesNotMatch(tableSource, /label: '제출'/);
  assert.match(calendarSource, /canManageVideoProduction\(user\)/);
  assert.match(personalCalendarPageSource, /영상제작 의뢰 즉시 수정/);
  assert.match(appSource, /path="video-production"/);
  assert.match(appSource, /VideoProductionRoute/);
  assert.match(layoutSource, /to="\/video-production"/);
  assert.match(layoutSource, /영상제작 의뢰/);
  assert.match(apiSource, /videoProduction: \{/);
  assert.match(apiSource, /reopen: \(id: string\)/);
  assert.match(apiSource, /setResultDate: \(id: string, result_received_date: string\)/);
  assert.match(pageSource, /영상제작 의뢰/);
  assert.match(pageSource, /import Select from '\.\.\/components\/Select'/);
  assert.match(pageSource, /preferredAssigneeId/);
  assert.match(pageSource, /item\.name === '임은혜'/);
  assert.match(pageSource, /placeholder="담당자 이름 검색"/);
  assert.match(pageSource, /placeholder="담당자 검색"/);
  assert.match(pageSource, /isSearchable/);
  assert.match(pageSource, />건수<\/span>/);
  assert.match(pageSource, /단가/);
  assert.match(pageSource, /계산 금액/);
  assert.match(pageSource, /결과물 일자 기록/);
  assert.match(pageSource, /결과물 일자 저장/);
  assert.match(pageSource, /window\.confirm/);
  assert.match(pageSource, /api\.videoProduction\.setResultDate/);
  assert.doesNotMatch(pageSource, /제공 일정/);
  assert.doesNotMatch(pageSource, /제공 경로/);
  assert.doesNotMatch(pageSource, /제출 일정/);
  assert.doesNotMatch(pageSource, /updateForm\(\{ status/);
  assert.match(pageSource, /결과물 받은 일자를 비우고 의뢰 상태로 되돌릴까요/);
});

test('급여정산은 확정 결과물 수령월의 영상제작 금액을 프리랜서 소득에 합산한다', () => {
  assert.match(payrollSource, /loadVideoProductionPayrollSummary/);
  assert.match(payrollSource, /video_production: videoProductionSummary/);
  assert.match(payrollSource, /videoProductionIncome: videoProductionSummary\.total_amount/);
  assert.match(payrollSource, /videoProductionIncome = \(await loadVideoProductionPayrollSummary/);
  assert.match(payrollPageSource, /const videoProductionIncome = Number\(data\?\.video_production\?\.total_amount \|\| 0\)/);
  assert.match(payrollPageSource, /isExternalVideoProductionAssignee\(data\?\.user\)/);
  assert.match(payrollPageSource, /externalVideoProductionWithholding/);
  assert.match(payrollPageSource, /videoProductionIncome,/);
  assert.match(payrollPageSource, /영상제작 외주 정산/);
  assert.match(payrollPageSource, /영상제작 원천징수/);
  assert.match(payrollListSource, /const videoProductionIncome = Number\(payroll\.video_production\?\.total_amount \|\| 0\)/);
  assert.match(payrollListSource, /isExternalVideoProductionAssignee\(payroll\.user \|\| user\)/);
  assert.match(payrollListSource, /externalVideoProductionWithholding/);
  assert.match(payrollListSource, /rowExtraPay = settlement\.videoProductionIncome \+ settlement\.taxableExtraIncome \+ settlement\.taxExemptIncome/);
  assert.match(payrollSource, /COALESCE\(t\.name, ''\) AS team_name/);
  assert.match(payrollSource, /isExternalVideoProductionAssignee\(targetUser\)/);
  assert.match(payrollSource, /videoProductionSnapshotTotal/);
  assert.match(payrollSource, /video_production_requests vpr/);
  assert.match(payrollSource, /isExternalVideoProductionAssignee\(u\)/);
});

test('회계장부는 결과물 수령월 영상제작 공급가를 인건비 지출로 자동 반영한다', () => {
  assert.match(accountingSource, /videoProductionLaborRowsForAccounting/);
  assert.match(accountingSource, /videoProductionReportMonths/);
  assert.match(accountingSource, /calculateVideoProductionNet/);
  assert.match(accountingSource, /calculateVideoProductionWithholding/);
  assert.match(accountingSource, /vpr\.status = 'confirmed'/);
  assert.match(accountingSource, /vpr\.result_received_date >= \?/);
  assert.match(accountingSource, /vpr\.result_received_date <= \?/);
  assert.match(accountingSource, /category: '인건비'/);
  assert.match(accountingSource, /item: '영상제작 외주급여'/);
  assert.match(accountingSource, /amount: grossAmount/);
  assert.match(accountingSource, /withholding_tax: withholding/);
  assert.match(accountingSource, /gross_amount: grossAmount/);
  assert.match(accountingSource, /netAmount\.toLocaleString/);
  assert.match(accountingSource, /source_type: 'video_production'/);
  assert.match(accountingSource, /\['expense', 'profit-loss', 'tax'\]\.includes\(reportType\)/);
  assert.match(accountingPageSource, /isReadonlyAccountingReportRow/);
  assert.match(accountingPageSource, /accounting-ledger-auto-badge/);
});
