import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  employmentTypeAtMonthSql,
  resolveEmploymentTypeFromHistory,
  type EmploymentTypeHistoryRow,
} from '../src/worker/lib/employment-conversion.ts';
import {
  payTypeAtMonthSql,
  payTypeValueAtMonthSql,
  resolvePayTypeFromHistory,
  type PayTypeHistorySnapshot,
} from '../src/worker/lib/pay-type-history.ts';

test('프리랜서→정규직→프리랜서 반복 전환은 조회 월의 고용형태를 복원한다', () => {
  const rows: EmploymentTypeHistoryRow[] = [
    {
      from_login_type: 'freelancer',
      to_login_type: 'employee',
      effective_month: '2026-04',
    },
    {
      from_login_type: 'employee',
      to_login_type: 'freelancer',
      effective_month: '2026-07',
    },
  ];

  assert.equal(resolveEmploymentTypeFromHistory(rows, '2026-03', 'freelancer'), 'freelancer');
  assert.equal(resolveEmploymentTypeFromHistory(rows, '2026-04', 'freelancer'), 'employee');
  assert.equal(resolveEmploymentTypeFromHistory(rows, '2026-06', 'freelancer'), 'employee');
  assert.equal(resolveEmploymentTypeFromHistory(rows, '2026-07', 'employee'), 'freelancer');
});

test('현재 정산유형과 무관하게 첫 이력 이전 월도 최초 저장 상태를 사용한다', () => {
  const rows: PayTypeHistorySnapshot[] = [
    {
      pay_type: 'salary',
      commission_rate: 0,
      salary: 3_000_000,
      standard_sales: 15_600_000,
      grade: 'M2',
      position_allowance: 200_000,
      effective_month: '2026-06',
    },
    {
      pay_type: 'commission',
      commission_rate: 50,
      salary: 0,
      standard_sales: 0,
      grade: '',
      position_allowance: 0,
      effective_month: '2026-07',
    },
  ];

  assert.equal(resolvePayTypeFromHistory(rows, '2026-03', 'commission'), 'salary');
  assert.equal(resolvePayTypeFromHistory(rows, '2026-06', 'commission'), 'salary');
  assert.equal(resolvePayTypeFromHistory(rows, '2026-07', 'salary'), 'commission');
});

test('월별 SQL 판정은 최신 이력과 최초 이력을 모두 고려한다', () => {
  const employmentSql = employmentTypeAtMonthSql('u.id', '?', 'u.login_type');
  const payTypeSql = payTypeAtMonthSql('u.id', '?', 'ua.pay_type');
  const salarySql = payTypeValueAtMonthSql('u.id', '?', 'salary', 'ua.salary');

  assert.match(employmentSql, /to_login_type/);
  assert.match(employmentSql, /from_login_type/);
  assert.match(payTypeSql, /ORDER BY h\.effective_month ASC/);
  assert.match(salarySql, /SELECT h\.salary/);
});

test('매출성과와 종합성과는 조회 종료월의 전환 이력을 사용한다', () => {
  const salesSource = fs.readFileSync(new URL('../src/worker/routes/sales.ts', import.meta.url), 'utf8');
  const analyticsSource = fs.readFileSync(new URL('../src/worker/routes/analytics-comprehensive.ts', import.meta.url), 'utf8');

  assert.match(salesSource, /resolveEmploymentTypeFromHistory/);
  assert.match(salesSource, /resolvePayTypeSnapshotFromHistory/);
  assert.match(salesSource, /historyChunkSize = 80/);
  assert.match(salesSource, /applicableMonthsByUser/);
  assert.match(salesSource, /average_amount: Math\.round\(totalAmount \/ monthly\.length\)/);
  assert.match(analyticsSource, /employmentTypeAtMonthSql/);
  assert.match(analyticsSource, /const queryYM = periodEndMonth/);
});

test('재전환은 정산 개인정보를 지우지 않고 이전 급여정보를 제공한다', () => {
  const usersSource = fs.readFileSync(new URL('../src/worker/routes/users.ts', import.meta.url), 'utf8');
  const accountingSource = fs.readFileSync(new URL('../src/worker/routes/accounting.ts', import.meta.url), 'utf8');
  const uiSource = fs.readFileSync(new URL('../src/react-app/pages/UserManagement.tsx', import.meta.url), 'utf8');

  assert.match(usersSource, /preservedSsn/);
  assert.match(usersSource, /preservedAddress/);
  assert.doesNotMatch(usersSource, /pay_type = 'salary',\s*commission_rate = 0,\s*ssn = '',\s*address = ''/);
  assert.match(accountingSource, /previous_employee_account/);
  assert.match(uiSource, /이전 급여정보 불러오기/);
  assert.doesNotMatch(uiSource, /ssn:\s*payType === 'commission'/);
});

test('같은 적용월에 반복 전환해도 최초 전환 전 기준월 스냅샷을 덮지 않는다', () => {
  const usersSource = fs.readFileSync(new URL('../src/worker/routes/users.ts', import.meta.url), 'utf8');
  const payTypeHistorySource = fs.readFileSync(new URL('../src/worker/lib/pay-type-history.ts', import.meta.url), 'utf8');
  const employmentConversionSource = fs.readFileSync(new URL('../src/worker/lib/employment-conversion.ts', import.meta.url), 'utf8');

  assert.match(
    usersSource,
    /before_employee_conversion[\s\S]*?WHERE NOT EXISTS \(\s*SELECT 1 FROM user_pay_type_history WHERE user_id = \?/,
  );
  assert.match(
    usersSource,
    /before_freelancer_conversion[\s\S]*?AND NOT EXISTS \(SELECT 1 FROM user_pay_type_history WHERE user_id = \?\)/,
  );
  assert.match(payTypeHistorySource, /created_at DESC, rowid DESC/);
  assert.match(employmentConversionSource, /created_at DESC, h\.rowid DESC/);
});

test('급여·직급 수정과 동시 전환은 이력과 원자성 가드를 함께 갱신한다', () => {
  const usersSource = fs.readFileSync(new URL('../src/worker/routes/users.ts', import.meta.url), 'utf8');
  const accountingSource = fs.readFileSync(new URL('../src/worker/routes/accounting.ts', import.meta.url), 'utf8');

  assert.match(accountingSource, /source = 'accounting_update'/);
  assert.match(accountingSource, /snapshotInvalidationStatements/);
  assert.match(accountingSource, /shouldUpdateCurrentAccount/);
  assert.match(accountingSource, /\.\.\.\(accountingStatement \? \[accountingStatement\] : \[\]\)/);
  assert.match(accountingSource, /historyStatement/);
  assert.match(accountingSource, /\.\.\.snapshotInvalidationStatements/);
  assert.match(usersSource, /user_employment_conversion_claims/);
  assert.match(usersSource, /총무담당은 전환 과정에서 직책을 변경할 수 없습니다/);
});
