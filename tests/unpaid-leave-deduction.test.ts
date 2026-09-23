import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import { sumApprovedLeave } from '../src/shared/leave-balance.ts';
import { calculateUnpaidLeavePayrollSettlement } from '../src/shared/unpaid-leave-settlement.ts';

function d1FromSqlite(db: Database.Database): D1Database {
  return {
    prepare(sql: string) {
      const values: unknown[] = [];
      const statement = {
        bind(...params: unknown[]) { values.splice(0, values.length, ...params); return statement; },
        async all<T>() { return { results: db.prepare(sql).all(...values) as T[] }; },
        async first<T>() { return db.prepare(sql).get(...values) as T | null; },
      };
      return statement;
    },
  } as unknown as D1Database;
}

function createLeaveSettlementDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE leave_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      leave_type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      hours REAL NOT NULL DEFAULT 8,
      days REAL NOT NULL DEFAULT 1,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE system_holidays (
      holiday_date TEXT PRIMARY KEY,
      name TEXT
    );
  `);
  return db;
}

test('무급 특별휴가는 연차 사용량에서 제외되고 일반 연차만 차감된다', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE leave_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      leave_type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      hours REAL NOT NULL DEFAULT 8,
      days REAL NOT NULL DEFAULT 1,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending'
    );
    INSERT INTO leave_requests VALUES
      ('annual-1', 'user-1', '연차', '2026-09-01', '2026-09-01', 8, 1, '개인사유', 'approved'),
      ('unpaid-1', 'user-1', '특별휴가', '2026-09-02', '2026-09-03', 16, 2, '[무급][연차차감제외] 개인사유', 'approved'),
      ('pending-1', 'user-1', '연차', '2026-09-04', '2026-09-04', 8, 1, '대기건', 'pending');
  `);

  const usage = await sumApprovedLeave(d1FromSqlite(db), 'user-1', 'annual', null);
  assert.equal(usage.used_days, 1);
  assert.equal(usage.used_hours, 8);
});

test('무급휴가 UI는 연차 차감 제외 체크박스와 급여 공제 저장 태그를 가진다', () => {
  const leavePage = readFileSync(new URL('../src/react-app/pages/Leave.tsx', import.meta.url), 'utf8');
  assert.match(leavePage, /unpaidNoAnnualDeduction/);
  assert.match(leavePage, /연차\/월차에서 차감하지 않음/);
  assert.match(leavePage, /\[무급\]\[연차차감제외\]/);
  assert.match(leavePage, /급여 공제 시간/);
});

test('급여정산은 승인된 무급휴가를 월 급여에서 자동 공제한다', () => {
  const payrollRoute = readFileSync(new URL('../src/worker/routes/payroll.ts', import.meta.url), 'utf8');
  const unpaidSettlement = readFileSync(new URL('../src/shared/unpaid-leave-settlement.ts', import.meta.url), 'utf8');
  const payrollPage = readFileSync(new URL('../src/react-app/pages/Payroll.tsx', import.meta.url), 'utf8');
  assert.match(payrollRoute, /무급휴가 공제 계산/);
  assert.match(unpaidSettlement, /leave_type = '특별휴가'/);
  assert.match(unpaidSettlement, /\[무급\]/);
  assert.match(unpaidSettlement, /reasonExpr/);
  assert.match(payrollRoute, /unpaid_leave_deduction/);
  assert.match(payrollPage, /무급휴가 공제/);
});

test('육아휴직 시작월은 휴직 전 근무일수만 30일 기준으로 일할 지급한다', async () => {
  const db = createLeaveSettlementDb();
  db.prepare(`
    INSERT INTO leave_requests
      (id, user_id, leave_type, start_date, end_date, hours, days, reason, status)
    VALUES
      ('parental-1', 'user-1', '특별휴가', '2026-09-14', '2026-12-13', 520, 65, '[무급][연차차감제외] 육아휴직', 'approved')
  `).run();

  const settlement = await calculateUnpaidLeavePayrollSettlement(
    d1FromSqlite(db),
    'user-1',
    '2026-09',
    3_050_000,
  );

  assert.equal(settlement.leave_of_absence, true);
  assert.equal(settlement.absence_paid_days, 13);
  assert.equal(settlement.absence_unpaid_days, 17);
  assert.equal(settlement.payroll_base_days, 30);
  assert.equal(settlement.absence_prorated_base_pay, 1_321_660);
  assert.equal(settlement.absence_base_deduction, 1_728_340);
  assert.equal(settlement.unpaid_leave_deduction, 1_728_340);
  assert.equal(settlement.unpaid_leave_days, 17);
});

test('육아휴직 전체월은 기본급 전액을 공제하고 복귀월은 복귀 후 일수만 지급한다', async () => {
  const db = createLeaveSettlementDb();
  db.prepare(`
    INSERT INTO leave_requests
      (id, user_id, leave_type, start_date, end_date, hours, days, reason, status)
    VALUES
      ('parental-1', 'user-1', '특별휴가', '2026-09-14', '2026-12-13', 520, 65, '[무급][연차차감제외] 육아휴직', 'approved')
  `).run();

  const october = await calculateUnpaidLeavePayrollSettlement(
    d1FromSqlite(db),
    'user-1',
    '2026-10',
    3_050_000,
  );
  assert.equal(october.absence_paid_days, 0);
  assert.equal(october.absence_unpaid_days, 30);
  assert.equal(october.absence_prorated_base_pay, 0);
  assert.equal(october.unpaid_leave_deduction, 3_050_000);

  const december = await calculateUnpaidLeavePayrollSettlement(
    d1FromSqlite(db),
    'user-1',
    '2026-12',
    3_050_000,
  );
  assert.equal(december.absence_paid_days, 17);
  assert.equal(december.absence_unpaid_days, 13);
  assert.equal(december.absence_prorated_base_pay, 1_728_330);
  assert.equal(december.absence_base_deduction, 1_321_670);
});

test('단기 무급휴가가 월을 걸치면 해당 월과 겹치는 영업일만 시간제로 공제한다', async () => {
  const db = createLeaveSettlementDb();
  db.prepare(`
    INSERT INTO leave_requests
      (id, user_id, leave_type, start_date, end_date, hours, days, reason, status)
    VALUES
      ('unpaid-cross-month', 'user-1', '특별휴가', '2026-09-30', '2026-10-02', 24, 3, '[무급] 개인사유', 'approved')
  `).run();

  const settlement = await calculateUnpaidLeavePayrollSettlement(
    d1FromSqlite(db),
    'user-1',
    '2026-09',
    3_050_000,
  );

  assert.equal(settlement.leave_of_absence, false);
  assert.equal(settlement.hourly_unpaid_leave_hours, 8);
  assert.equal(settlement.unpaid_leave_days, 1);
  assert.equal(settlement.unpaid_leave_deduction, Math.trunc((3_050_000 / 209 * 8) / 10) * 10);
});
