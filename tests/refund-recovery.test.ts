import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  calculateRefundRecoveryAmount,
  payrollPeriodLabelFromMonth,
  refundApprovalMonth,
  refundRecoveryPayrollUrl,
} from '../src/shared/refund-recovery.ts';
import {
  REFUND_RECOVERY_DEDUCTION_MISSING,
  REFUND_RECOVERY_NOT_LOCKED,
  resolveRefundRecovery,
} from '../src/worker/lib/refund-recovery.ts';

class TestD1Statement {
  private readonly db: Database.Database;
  private readonly sql: string;
  private readonly values: unknown[];

  constructor(db: Database.Database, sql: string, values: unknown[] = []) {
    this.db = db;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: unknown[]) { return new TestD1Statement(this.db, this.sql, values); }
  async first<T>() { return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null; }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: result.changes } };
  }
}

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users (id) VALUES ('consultant-1'), ('accountant-1');
    CREATE TABLE sales_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      amount INTEGER NOT NULL,
      refund_approved_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE user_accounting (
      user_id TEXT PRIMARY KEY,
      pay_type TEXT,
      commission_rate REAL
    );
    CREATE TABLE commission_rate_overrides (
      user_id TEXT NOT NULL,
      year_month TEXT NOT NULL,
      commission_rate REAL NOT NULL,
      PRIMARY KEY (user_id, year_month)
    );
    CREATE TABLE payroll_saves (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      period TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      locked INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, period)
    );
  `);
  db.exec(readFileSync('d1/migrate-refund-recovery-resolutions.sql', 'utf8'));
  db.exec(`
    INSERT INTO sales_records VALUES ('refund-1', 'consultant-1', 'refunded', 1100000, '2026-07-16 10:00:00');
    INSERT INTO user_accounting VALUES ('consultant-1', 'commission', 50);
  `);
  return db;
}

function d1Adapter(db: Database.Database) {
  return { prepare: (sql: string) => new TestD1Statement(db, sql) };
}

test('환불 회수 링크는 담당자와 환불 승인월을 급여정산에 전달한다', () => {
  assert.equal(refundApprovalMonth('2026-07-16 10:00:00'), '2026-07');
  assert.equal(payrollPeriodLabelFromMonth('2026-07'), '2026년 7월');
  assert.equal(
    refundRecoveryPayrollUrl({ salesRecordId: 'refund-1', userId: 'consultant-1', refundApprovedAt: '2026-07-16 10:00:00' }),
    '/payroll?branch=__all&user_id=consultant-1&month=2026-07&refund_recovery=refund-1',
  );
  assert.equal(calculateRefundRecoveryAmount({ amount: 1100000, payType: 'commission', commissionRate: 50 }), 483500);
  assert.equal(calculateRefundRecoveryAmount({ amount: 500000, payType: 'commission', commissionRate: 50, payrollMonth: '2026-07' }), 219770);
  assert.equal(calculateRefundRecoveryAmount({ amount: 1100000, payType: 'salary', commissionRate: 50 }), 0);
});

test('10원 절사와 월별 수수료율 예외를 급여 표시와 회수 완료에서 동일하게 적용한다', async () => {
  const db = createDb();
  db.prepare('UPDATE sales_records SET amount = 500000 WHERE id = ?').run('refund-1');
  db.prepare('INSERT INTO commission_rate_overrides VALUES (?, ?, ?)').run('consultant-1', '2026-07', 40);
  const recoveryAmount = calculateRefundRecoveryAmount({
    amount: 500000,
    payType: 'commission',
    commissionRate: 40,
    payrollMonth: '2026-07',
  });
  assert.equal(recoveryAmount, 175810);
  db.prepare('INSERT INTO payroll_saves VALUES (?, ?, ?, ?, ?)').run('payroll-override', 'consultant-1', '2026년 7월', JSON.stringify({
    commDeductions: [{ label: '환불 회수', amount: String(recoveryAmount), sourceId: 'refund-1' }],
  }), 1);
  const result = await resolveRefundRecovery(d1Adapter(db) as D1Database, {
    salesRecordId: 'refund-1', payrollMonth: '2026-07', resolvedBy: 'accountant-1',
  });
  assert.deepEqual(result, { success: true, alreadyResolved: false, recoveryAmount: 175810, payrollPeriod: '2026년 7월' });
  db.close();
});

test('급여정산을 확정하지 않으면 환불 회수를 완료 처리할 수 없다', async () => {
  const db = createDb();
  assert.deepEqual(
    db.prepare("SELECT [table] || ':' || [from] || ':' || on_delete FROM pragma_foreign_key_list('refund_recovery_resolutions') ORDER BY [table]").pluck().all(),
    ['sales_records:sales_record_id:CASCADE', 'users:user_id:CASCADE'],
  );
  const result = await resolveRefundRecovery(d1Adapter(db) as D1Database, {
    salesRecordId: 'refund-1', payrollMonth: '2026-07', resolvedBy: 'accountant-1',
  });
  assert.equal(result.success, false);
  if (!result.success) assert.equal(result.code, REFUND_RECOVERY_NOT_LOCKED);
  assert.equal(db.prepare('SELECT COUNT(*) FROM refund_recovery_resolutions').pluck().get(), 0);
  db.close();
});

test('확정된 급여정산은 담당자·월·회수금액과 함께 한 번만 완료 기록된다', async () => {
  const db = createDb();
  db.prepare('INSERT INTO payroll_saves VALUES (?, ?, ?, ?, ?)').run('payroll-1', 'consultant-1', '2026년 7월', '{}', 1);
  const input = { salesRecordId: 'refund-1', payrollMonth: '2026-07', resolvedBy: 'accountant-1' };
  const missingDeduction = await resolveRefundRecovery(d1Adapter(db) as D1Database, input);
  assert.equal(missingDeduction.success, false);
  if (!missingDeduction.success) assert.equal(missingDeduction.code, REFUND_RECOVERY_DEDUCTION_MISSING);

  db.prepare('UPDATE payroll_saves SET data = ? WHERE id = ?').run(JSON.stringify({
    commDeductions: [{ label: '환불 회수', amount: '483500', sourceId: 'refund-1' }],
  }), 'payroll-1');
  const first = await resolveRefundRecovery(d1Adapter(db) as D1Database, input);
  const second = await resolveRefundRecovery(d1Adapter(db) as D1Database, input);

  assert.deepEqual(first, { success: true, alreadyResolved: false, recoveryAmount: 483500, payrollPeriod: '2026년 7월' });
  assert.deepEqual(second, { success: true, alreadyResolved: true, recoveryAmount: 483500, payrollPeriod: '2026년 7월' });
  assert.deepEqual(
    db.prepare('SELECT sales_record_id, user_id, payroll_month, recovery_amount, resolved_by FROM refund_recovery_resolutions').get(),
    { sales_record_id: 'refund-1', user_id: 'consultant-1', payroll_month: '2026-07', recovery_amount: 483500, resolved_by: 'accountant-1' },
  );
  db.close();
});
