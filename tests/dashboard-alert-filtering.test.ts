import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DASHBOARD_PHONE_ALERT_FROM,
  isCurrentEmployeeDashboardEntry,
  isDashboardPhoneAlertDate,
} from '../src/react-app/lib/dashboard-alerts.ts';

test('고객 전화번호 알림은 2026년 8월 계약부터 표시한다', () => {
  assert.equal(DASHBOARD_PHONE_ALERT_FROM, '2026-08-01');
  assert.equal(isDashboardPhoneAlertDate('2026-07-31'), false);
  assert.equal(isDashboardPhoneAlertDate('2026-08-01'), true);
  assert.equal(isDashboardPhoneAlertDate('2026-08-19'), true);
  assert.equal(isDashboardPhoneAlertDate(''), false);
});

test('일반 대시보드 미제출 감지에서 현재 프리랜서 계정을 제외한다', () => {
  assert.equal(isCurrentEmployeeDashboardEntry({ user_login_type: 'freelancer' }), false);
  assert.equal(isCurrentEmployeeDashboardEntry({ user_login_type: 'employee' }), true);
  assert.equal(isCurrentEmployeeDashboardEntry({}), true);
});

test('대시보드 조회 경로가 프리랜서 일지·매출평가와 8월 이전 전화번호 건을 제외한다', () => {
  const dashboard = readFileSync('src/react-app/pages/Dashboard.tsx', 'utf8');
  const journal = readFileSync('src/worker/routes/journal.ts', 'utf8');
  const accounting = readFileSync('src/worker/routes/accounting.ts', 'utf8');

  assert.match(journal, /u\.login_type as user_login_type/);
  assert.match(dashboard, /entriesForDetect = entriesForDetect\.filter\(isCurrentEmployeeDashboardEntry\)/);
  assert.match(dashboard, /isDashboardPhoneAlertDate\(r\.contract_date\)/);
  assert.match(accounting, /COALESCE\(u\.login_type, 'employee'\) != 'freelancer'/);
});
