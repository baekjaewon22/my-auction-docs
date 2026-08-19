import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  DASHBOARD_PHONE_ALERT_FROM,
  isCurrentEmployeeDashboardEntry,
  isDashboardPhoneAlertDate,
} from '../src/react-app/lib/dashboard-alerts.ts';
import {
  SALES_EVALUATION_EMPLOYEE_FILTER,
  SALES_EVALUATION_EXCLUDED_USER_ID,
} from '../src/worker/lib/sales-evaluation-eligibility.ts';

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
  assert.match(accounting, /AND \$\{SALES_EVALUATION_EMPLOYEE_FILTER\}/);
});

test('기준매출 평가는 영업 컨설턴트만 남기고 퇴사자와 모든 내근직을 제외한다', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE users (
    id TEXT, name TEXT, role TEXT, branch TEXT, department TEXT, login_type TEXT
  )`);
  const insert = db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)');
  const rows = [
    ['consultant', '영업 담당자', 'member', '서초지사', '경매사업부1팀', 'employee'],
    ['resigned', '퇴사자', 'resigned', '서초지사', '경매사업부1팀', 'employee'],
    ['accountant', '총무', 'accountant', '본사관리', '총무팀', 'employee'],
    ['support', '지원', 'support', '의정부본사', '지원팀', 'employee'],
    ['freelancer', '프리랜서', 'member', '대전지사', '경매사업부1팀', 'freelancer'],
    [SALES_EVALUATION_EXCLUDED_USER_ID, '정민호', 'admin', '의정부본사', '', 'employee'],
  ];
  for (const row of rows) insert.run(...row);

  const eligible = db.prepare(`SELECT u.id FROM users u WHERE ${SALES_EVALUATION_EMPLOYEE_FILTER}`)
    .all(SALES_EVALUATION_EXCLUDED_USER_ID) as Array<{ id: string }>;
  assert.deepEqual(eligible.map((row) => row.id), ['consultant']);
  db.close();
});
