import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  calculateRefundRecoveryAmount,
  kstDateOnly,
  payrollLockPrecedesRefund,
  payrollPeriodLabelFromMonth,
  refundApprovalMonth,
  refundRecoveryOriginDate,
  refundRecoveryPayrollUrl,
  salesConfirmationPrecedesPayrollLock,
} from '../src/shared/refund-recovery.ts';
import {
  buildRequiredPayrollDeductions,
  canonicalizePayrollDeductions,
  payrollDeductionsAreCanonical,
} from '../src/shared/payroll-deductions.ts';
import {
  REFUND_RECOVERY_DEDUCTION_MISSING,
  REFUND_RECOVERY_NOT_LOCKED,
  loadPayrollRefundRecoveries,
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
  async all<T>() { return { results: this.db.prepare(this.sql).all(...this.values) as T[] }; }
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
      type TEXT NOT NULL DEFAULT '계약',
      client_name TEXT NOT NULL DEFAULT '',
      amount INTEGER NOT NULL,
      refund_amount INTEGER NOT NULL DEFAULT 0,
      proxy_cost INTEGER NOT NULL DEFAULT 0,
      contract_date TEXT NOT NULL DEFAULT '',
      deposit_date TEXT NOT NULL DEFAULT '',
      card_deposit_date TEXT NOT NULL DEFAULT '',
      payment_type TEXT NOT NULL DEFAULT '',
      confirmed_at TEXT,
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
      pay_type TEXT NOT NULL DEFAULT 'commission',
      data TEXT NOT NULL DEFAULT '{}',
      locked INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, period)
    );
  `);
  db.exec(readFileSync('d1/migrate-refund-recovery-resolutions.sql', 'utf8'));
  db.exec(`
    INSERT INTO sales_records (
      id, user_id, status, type, client_name, amount, refund_amount,
      contract_date, deposit_date, payment_type, confirmed_at, refund_approved_at
    ) VALUES (
      'refund-1', 'consultant-1', 'refunded', '계약', '환불고객', 1100000, 1100000,
      '2026-06-15', '2026-06-15', '이체', '2026-06-20 10:00:00', '2026-07-16 10:00:00'
    );
    INSERT INTO user_accounting VALUES ('consultant-1', 'commission', 50);
    INSERT INTO payroll_saves (id, user_id, period, pay_type, data, locked, updated_at)
    VALUES (
      'origin-payroll', 'consultant-1', '2026년 6월', 'commission',
      '{"payroll_snapshot":{"response":{"accounting":{"commission_rate":50},"records":[{"id":"refund-1","amount":1100000,"refund_amount":0}]}}}',
      1, '2026-07-01 00:00:00'
    );
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

test('환불 회수와 전월 이월은 최신 금액의 단일 세후공제로 정규화한다', () => {
  const required = buildRequiredPayrollDeductions({
    refundRecoveries: [{ id: 'refund-1', client_name: '최윤주', recovery_amount: 483500 }],
    carryoverDeduction: { origin_month: '2026-08', amount: 510030 },
  });
  const normalized = canonicalizePayrollDeductions([
    { label: '매수신청대리 (김윤명)', amount: '45000' },
    { label: '환불 회수 · 최윤주', amount: '100', sourceId: 'refund-1', skipTax: true },
    { label: '환불 회수 · 최윤주', amount: '200', sourceId: 'refund-1' },
    { label: '환불 회수 · 최윤주', amount: '483500' },
    { label: '전월 이월 공제 (2026-08)', amount: '26530', sourceId: 'carryover' },
    { label: '전월 이월 공제 (2026-08)', amount: '510030' },
    { label: '사용자가 바꾼 자동공제 라벨', amount: '999999', sourceId: 'stale-refund' },
  ], required);

  assert.deepEqual(normalized, [
    { label: '매수신청대리 (김윤명)', amount: '45000' },
    { label: '환불 회수 · 최윤주', amount: '483500', sourceId: 'refund-1' },
    { label: '전월 이월 공제 (2026-08)', amount: '510030', sourceId: 'carryover' },
  ]);
  assert.equal(payrollDeductionsAreCanonical(normalized, required), true);
});

test('자동 근거가 없는 급여제 수동 환불 회수 항목은 삭제하지 않는다', () => {
  const manual = [{ label: '환불 회수 (수동 조정)', amount: '120000' }];
  assert.deepEqual(canonicalizePayrollDeductions(manual, []), manual);
  assert.equal(payrollDeductionsAreCanonical(manual, []), true);
});

test('같은 금액의 다른 고객 수동 환불 공제는 자동공제로 오인하지 않는다', () => {
  const required = buildRequiredPayrollDeductions({
    refundRecoveries: [{ id: 'refund-kim', client_name: '김고객', recovery_amount: 483500 }],
    carryoverDeduction: null,
  });
  const normalized = canonicalizePayrollDeductions([
    { label: '환불 회수 · 박고객', amount: '483500' },
  ], required);

  assert.deepEqual(normalized, [
    { label: '환불 회수 · 박고객', amount: '483500' },
    { label: '환불 회수 · 김고객', amount: '483500', sourceId: 'refund-kim' },
  ]);
  assert.equal(payrollDeductionsAreCanonical(normalized, required), true);
});

test('급여 확정 UTC와 환불 승인 KST는 실제 시각으로 비교한다', () => {
  assert.equal(payrollLockPrecedesRefund('2026-08-26 23:59:00', '2026-08-27 09:00:00'), true);
  assert.equal(payrollLockPrecedesRefund('2026-08-27 00:30:00', '2026-08-27 09:00:00'), false);
  assert.equal(salesConfirmationPrecedesPayrollLock('2026-06-20 10:00:00', '2026-07-01 00:00:00'), true);
  assert.equal(salesConfirmationPrecedesPayrollLock('2026-07-01 10:00:00', '2026-07-01 00:00:00'), false);
});

test('원매출 인식일과 기본 환불일은 KST 급여 기준을 따른다', () => {
  assert.equal(refundRecoveryOriginDate({
    payment_type: '카드', card_deposit_date: '', deposit_date: '2026-06-15', contract_date: '2026-06-15',
  }), '');
  assert.equal(refundRecoveryOriginDate({
    payment_type: '이체', deposit_date: '', contract_date: '2026-06-15',
  }), '');
  assert.equal(refundRecoveryOriginDate({
    payment_type: '', deposit_date: '', contract_date: '2026-06-15',
  }), '2026-06-15');
  assert.equal(kstDateOnly(new Date('2026-09-30T15:30:00.000Z')), '2026-10-01');
});

test('월말 ISO 환불 승인도 해당 월 자동회수에 포함한다', async () => {
  const db = createDb();
  db.prepare("UPDATE sales_records SET refund_approved_at = '2026-07-31T23:59:59' WHERE id = 'refund-1'").run();
  const recoveries = await loadPayrollRefundRecoveries(d1Adapter(db) as D1Database, {
    userId: 'consultant-1', payrollMonth: '2026-07',
  });
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0].eligibility_source, 'snapshot');
  db.close();
});

test('원월 확정 후 매출액이 커져도 실제 지급 스냅샷 금액까지만 회수한다', async () => {
  const db = createDb();
  db.prepare("UPDATE sales_records SET amount = 2200000, refund_amount = 2200000 WHERE id = 'refund-1'").run();
  const recoveries = await loadPayrollRefundRecoveries(d1Adapter(db) as D1Database, {
    userId: 'consultant-1', payrollMonth: '2026-07',
  });
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0].refund_amount, 2200000);
  assert.equal(recoveries[0].recovery_basis_amount, 1100000);
  assert.equal(recoveries[0].recovery_amount, 483500);
  db.close();
});

test('원월 정산에 이미 반영된 부분환불은 제외하고 추가 환불분만 회수한다', async () => {
  const db = createDb();
  db.prepare("UPDATE payroll_saves SET data = ? WHERE id = 'origin-payroll'").run(JSON.stringify({
    payroll_snapshot: {
      response: {
        accounting: { commission_rate: 50 },
        records: [{ id: 'refund-1', amount: 1100000, refund_amount: 500000 }],
      },
    },
  }));
  const recoveries = await loadPayrollRefundRecoveries(d1Adapter(db) as D1Database, {
    userId: 'consultant-1', payrollMonth: '2026-07',
  });
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0].recovery_basis_amount, 600000);
  assert.equal(recoveries[0].recovery_amount, calculateRefundRecoveryAmount({
    amount: 600000, payType: 'commission', commissionRate: 50, payrollMonth: '2026-06',
  }));
  db.close();
});

test('원월 정산에 동일 환불액이 이미 반영됐다면 다시 회수하지 않는다', async () => {
  const db = createDb();
  const originData = JSON.parse(String(db.prepare("SELECT data FROM payroll_saves WHERE id = 'origin-payroll'").pluck().get()));
  originData.payroll_snapshot.response.records[0].refund_amount = 1100000;
  db.prepare("UPDATE payroll_saves SET data = ? WHERE id = 'origin-payroll'").run(JSON.stringify(originData));
  const recoveries = await loadPayrollRefundRecoveries(d1Adapter(db) as D1Database, {
    userId: 'consultant-1', payrollMonth: '2026-07',
  });
  assert.deepEqual(recoveries, []);
  db.close();
});

test('매수신청대리 환불은 수수료율이 아니라 실제 지급 마진 감소분을 회수한다', async () => {
  const db = createDb();
  db.prepare(`
    UPDATE sales_records
    SET type = '매수신청대리', amount = 120000, refund_amount = 120000, proxy_cost = 90000
    WHERE id = 'refund-1'
  `).run();
  const originData = JSON.parse(String(db.prepare("SELECT data FROM payroll_saves WHERE id = 'origin-payroll'").pluck().get()));
  originData.payroll_snapshot.response.records = [{
    id: 'refund-1', type: '매수신청대리', amount: 120000, refund_amount: 0,
    proxy_cost: 90000, supply_amount: 19090,
  }];
  db.prepare("UPDATE payroll_saves SET data = ? WHERE id = 'origin-payroll'").run(JSON.stringify(originData));
  const recoveries = await loadPayrollRefundRecoveries(d1Adapter(db) as D1Database, {
    userId: 'consultant-1', payrollMonth: '2026-07',
  });
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0].recovery_amount, 18460);
  assert.notEqual(recoveries[0].recovery_amount, calculateRefundRecoveryAmount({
    amount: 120000, payType: 'commission', commissionRate: 50, payrollMonth: '2026-06',
  }));
  db.close();
});

test('ID 스냅샷 지급건은 과거일자로 등록된 환불도 회수한다', async () => {
  const db = createDb();
  db.prepare("UPDATE sales_records SET refund_approved_at = '2026-06-01T00:00:00' WHERE id = 'refund-1'").run();
  const recoveries = await loadPayrollRefundRecoveries(d1Adapter(db) as D1Database, {
    userId: 'consultant-1', payrollMonth: '2026-07',
  });
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0].eligibility_source, 'snapshot');
  db.close();
});

test('승인월에 회수하지 못한 미해결 환불은 다음 정산월에 자동 이월 회수한다', async () => {
  const db = createDb();
  const recoveries = await loadPayrollRefundRecoveries(d1Adapter(db) as D1Database, {
    userId: 'consultant-1', payrollMonth: '2026-08',
  });
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0].recovery_amount, 483500);
  db.close();
});

test('다른 월에 이미 회수 완료된 환불은 승인일이 바뀌어도 재유입되지 않는다', async () => {
  const db = createDb();
  db.prepare(`
    INSERT INTO refund_recovery_resolutions
      (sales_record_id, user_id, payroll_month, recovery_amount, resolved_by)
    VALUES ('refund-1', 'consultant-1', '2026-07', 483500, 'accountant-1')
  `).run();
  db.prepare("UPDATE sales_records SET refund_approved_at = '2026-08-01 10:00:00' WHERE id = 'refund-1'").run();
  const recoveries = await loadPayrollRefundRecoveries(d1Adapter(db) as D1Database, {
    userId: 'consultant-1', payrollMonth: '2026-08',
  });
  assert.deepEqual(recoveries, []);
  db.close();
});

test('구형 ISO 기간키의 잠긴 원월 스냅샷도 회수 근거로 인식한다', async () => {
  const db = createDb();
  db.prepare("UPDATE payroll_saves SET period = '2026-06' WHERE id = 'origin-payroll'").run();
  const recoveries = await loadPayrollRefundRecoveries(d1Adapter(db) as D1Database, {
    userId: 'consultant-1', payrollMonth: '2026-07',
  });
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0].origin_month, '2026-06');
  db.close();
});

test('실제 지급 스냅샷에 없는 과거일자 매출은 자동회수하지 않는다', async () => {
  const db = createDb();
  db.prepare("UPDATE payroll_saves SET data = ? WHERE id = 'origin-payroll'").run(JSON.stringify({
    payroll_snapshot: { response: { accounting: { commission_rate: 50 }, records: [] } },
  }));
  db.prepare("UPDATE sales_records SET confirmed_at = '2026-07-02 10:00:00' WHERE id = 'refund-1'").run();
  const recoveries = await loadPayrollRefundRecoveries(d1Adapter(db) as D1Database, {
    userId: 'consultant-1', payrollMonth: '2026-07',
  });
  assert.deepEqual(recoveries, []);
  db.close();
});

test('구형 스냅샷은 잠금 전 매출 확정이 증명될 때만 보수적으로 회수한다', async () => {
  const db = createDb();
  db.prepare("UPDATE payroll_saves SET data = '{}' WHERE id = 'origin-payroll'").run();
  const recoveries = await loadPayrollRefundRecoveries(d1Adapter(db) as D1Database, {
    userId: 'consultant-1', payrollMonth: '2026-07',
  });
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0].eligibility_source, 'legacy_confirmation');
  db.close();
});

test('잠긴 스냅샷 지급건은 이후 결제수단·인식일 변경에도 회수 근거를 잃지 않는다', async () => {
  const db = createDb();
  db.prepare("UPDATE sales_records SET payment_type = '카드', card_deposit_date = '' WHERE id = 'refund-1'").run();
  let recoveries = await loadPayrollRefundRecoveries(d1Adapter(db) as D1Database, {
    userId: 'consultant-1', payrollMonth: '2026-07',
  });
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0].eligibility_source, 'snapshot');
  assert.equal(recoveries[0].origin_month, '2026-06');

  db.prepare("UPDATE sales_records SET payment_type = '이체', deposit_date = '' WHERE id = 'refund-1'").run();
  recoveries = await loadPayrollRefundRecoveries(d1Adapter(db) as D1Database, {
    userId: 'consultant-1', payrollMonth: '2026-07',
  });
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0].origin_month, '2026-06');
  db.close();
});

test('환불 승인월 예외율이 아니라 원매출 확정 당시 비율과 절사를 회수에 적용한다', async () => {
  const db = createDb();
  db.prepare('UPDATE sales_records SET amount = 500000, refund_amount = 500000 WHERE id = ?').run('refund-1');
  db.prepare('INSERT INTO commission_rate_overrides VALUES (?, ?, ?)').run('consultant-1', '2026-07', 40);
  const recoveryAmount = calculateRefundRecoveryAmount({
    amount: 500000,
    payType: 'commission',
    commissionRate: 50,
    payrollMonth: '2026-06',
  });
  assert.equal(recoveryAmount, 219770);
  db.prepare('INSERT INTO payroll_saves (id, user_id, period, data, locked) VALUES (?, ?, ?, ?, ?)').run('payroll-override', 'consultant-1', '2026-07', JSON.stringify({
    commDeductions: [{ label: '환불 회수', amount: String(recoveryAmount), sourceId: 'refund-1' }],
  }), 1);
  const result = await resolveRefundRecovery(d1Adapter(db) as D1Database, {
    salesRecordId: 'refund-1', payrollMonth: '2026-07', resolvedBy: 'accountant-1',
  });
  assert.deepEqual(result, { success: true, alreadyResolved: false, recoveryAmount: 219770, payrollPeriod: '2026년 7월' });
  db.close();
});

test('회수 완료는 현재 급여형과 환불월 이력보다 원매출 잠금 스냅샷을 우선한다', async () => {
  const db = createDb();
  db.exec(`
    CREATE TABLE user_pay_type_history (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, effective_month TEXT NOT NULL,
      pay_type TEXT NOT NULL, commission_rate REAL NOT NULL DEFAULT 0,
      salary INTEGER NOT NULL DEFAULT 0, standard_sales INTEGER NOT NULL DEFAULT 0,
      grade TEXT NOT NULL DEFAULT '', position_allowance INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT '', changed_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, effective_month, source)
    );
    INSERT INTO user_pay_type_history
      (id, user_id, effective_month, pay_type, commission_rate, source)
    VALUES ('history-july', 'consultant-1', '2026-07', 'commission', 40, 'test');
    UPDATE user_accounting SET pay_type = 'salary', commission_rate = 0 WHERE user_id = 'consultant-1';
  `);
  const expected = calculateRefundRecoveryAmount({
    amount: 1100000,
    payType: 'commission',
    commissionRate: 50,
    payrollMonth: '2026-06',
  });
  db.prepare('INSERT INTO payroll_saves (id, user_id, period, data, locked) VALUES (?, ?, ?, ?, ?)').run('payroll-history', 'consultant-1', '2026년 7월', JSON.stringify({
    commDeductions: [{ label: '환불 회수', amount: String(expected), sourceId: 'refund-1' }],
  }), 1);

  const result = await resolveRefundRecovery(d1Adapter(db) as D1Database, {
    salesRecordId: 'refund-1', payrollMonth: '2026-07', resolvedBy: 'accountant-1',
  });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.recoveryAmount, expected);
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
  db.prepare('INSERT INTO payroll_saves (id, user_id, period, data, locked) VALUES (?, ?, ?, ?, ?)').run('payroll-1', 'consultant-1', '2026년 7월', '{}', 1);
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

test('부분환불은 환불액에 비례해 회수한다 (매출은 confirmed 유지)', async () => {
  const db = createDb();
  // 총 매출 1,100,000 중 500,000만 부분환불 → status는 confirmed 유지, refund_amount=500000
  db.prepare("UPDATE sales_records SET status = 'confirmed', refund_amount = 500000 WHERE id = ?").run('refund-1');
  const expected = calculateRefundRecoveryAmount({ amount: 500000, payType: 'commission', commissionRate: 50, payrollMonth: '2026-07' });
  db.prepare('INSERT INTO payroll_saves (id, user_id, period, data, locked) VALUES (?, ?, ?, ?, ?)').run('payroll-partial', 'consultant-1', '2026년 7월', JSON.stringify({
    commDeductions: [{ label: '환불 회수', amount: String(expected), sourceId: 'refund-1' }],
  }), 1);
  const result = await resolveRefundRecovery(d1Adapter(db) as D1Database, {
    salesRecordId: 'refund-1', payrollMonth: '2026-07', resolvedBy: 'accountant-1',
  });
  assert.deepEqual(result, { success: true, alreadyResolved: false, recoveryAmount: expected, payrollPeriod: '2026년 7월' });
  // 전액(1,100,000) 기준이 아니라 환불액(500,000) 기준이어야 한다
  assert.notEqual(expected, calculateRefundRecoveryAmount({ amount: 1100000, payType: 'commission', commissionRate: 50, payrollMonth: '2026-07' }));
  db.close();
});

test('환불월 현재 급여형이 salary여도 원매출 잠금이 commission이면 회수한다', async () => {
  const db = createDb();
  db.prepare("UPDATE user_accounting SET pay_type = 'salary' WHERE user_id = ?").run('consultant-1');
  db.prepare("UPDATE sales_records SET contract_date = '2025-12-15', deposit_date = '2025-12-15', refund_approved_at = '2026-01-20 10:00:00' WHERE id = ?").run('refund-1');
  db.prepare("UPDATE payroll_saves SET period = '2025년 12월', updated_at = '2026-01-05 00:00:00' WHERE id = 'origin-payroll'").run();
  const expected = calculateRefundRecoveryAmount({ amount: 1100000, payType: 'commission', commissionRate: 50, payrollMonth: '2025-12' });
  assert.ok(expected > 0);
  db.prepare('INSERT INTO payroll_saves (id, user_id, period, data, locked) VALUES (?, ?, ?, ?, ?)').run('payroll-janfeb', 'consultant-1', '2026년 1월', JSON.stringify({
    commDeductions: [{ label: '환불 회수', amount: String(expected), sourceId: 'refund-1' }],
  }), 1);
  const result = await resolveRefundRecovery(d1Adapter(db) as D1Database, {
    salesRecordId: 'refund-1', payrollMonth: '2026-01', resolvedBy: 'accountant-1',
  });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.recoveryAmount, expected);
  db.close();
});

test('원매출 잠금이 salary면 환불월 현재 급여형이 commission이어도 커미션을 회수하지 않는다', async () => {
  const db = createDb();
  db.prepare("UPDATE payroll_saves SET pay_type = 'salary' WHERE id = 'origin-payroll'").run();
  db.prepare('INSERT INTO payroll_saves (id, user_id, period, data, locked) VALUES (?, ?, ?, ?, ?)')
    .run('payroll-salary-origin', 'consultant-1', '2026년 7월', '{}', 1);
  const result = await resolveRefundRecovery(d1Adapter(db) as D1Database, {
    salesRecordId: 'refund-1', payrollMonth: '2026-07', resolvedBy: 'accountant-1',
  });
  assert.deepEqual(result, {
    success: true, alreadyResolved: false, recoveryAmount: 0, payrollPeriod: '2026년 7월',
  });
  db.close();
});
