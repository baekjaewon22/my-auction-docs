import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import {
  applyFreelancerSettlementToSaveData,
  calculateFreelancerSalesIncome,
  calculateFreelancerSavedSettlement,
  calculateFreelancerSettlement,
} from '../src/shared/freelancer-settlement.ts';
import type { AuthEnv, JwtPayload } from '../src/worker/types.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // Fall through to Node's original error for non-TypeScript relative imports.
      }
    }
    return nextResolve(specifier, context);
  },
});

const [
  { default: payrollRoute },
  { default: salesRoute },
  { default: accountingRoute },
  { finalizeCaseAllowance },
  { createToken },
] = await Promise.all([
  import('../src/worker/routes/payroll.ts'),
  import('../src/worker/routes/sales.ts'),
  import('../src/worker/routes/accounting.ts'),
  import('../src/worker/routes/cases.ts'),
  import('../src/worker/middleware/auth.ts'),
]);

type D1Statement = D1PreparedStatement & { run(): Promise<D1Result> };

type D1TestHooks = {
  beforeBatch?: () => void | Promise<void>;
  beforeRun?: (sql: string) => void | Promise<void>;
};

function d1FromSqlite(sqlite: Database.Database, hooks: D1TestHooks = {}): D1Database {
  const prepare = (sql: string, params: unknown[] = []): D1Statement => ({
    bind: (...values: unknown[]) => prepare(sql, values),
    all: async <T>() => ({ results: sqlite.prepare(sql).all(...params) as T[] }),
    first: async <T>() => (sqlite.prepare(sql).get(...params) as T | undefined) || null,
    run: async () => {
      await hooks.beforeRun?.(sql);
      const result = sqlite.prepare(sql).run(...params);
      return { success: true, meta: { changes: result.changes } } as unknown as D1Result;
    },
  } as D1Statement);
  return {
    prepare: (sql: string) => prepare(sql),
    batch: async (statements: D1PreparedStatement[]) => {
      const beforeBatch = hooks.beforeBatch;
      hooks.beforeBatch = undefined;
      await beforeBatch?.();
      const results: D1Result[] = [];
      for (const statement of statements) results.push(await (statement as D1Statement).run());
      return results;
    },
  } as unknown as D1Database;
}

const JWT_SECRET = 'freelancer-settlement-route-test-secret-123456789';

async function authenticatedRequest(
  app: Hono<AuthEnv>,
  env: Env,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const payload: JwtPayload = {
    sub: 'accountant-1',
    email: 'accountant@example.com',
    name: '총무',
    phone: '',
    role: 'accountant',
    branch: '본사관리',
    department: '총무팀',
    auth_version: 0,
  };
  const token = await createToken(payload, env);
  return app.request(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  }, env);
}

test('기존 정산수익과 계약포상을 합친 전체 과세표준에 3.3%를 한 번 적용한다', () => {
  const result = calculateFreelancerSettlement({
    settlementIncome: 1_000_000,
    contractAward: 300_000,
    videoProductionIncome: 0,
    taxableExtraIncome: 100_000,
    taxExemptIncome: 50_000,
    preTaxDeduction: 20_000,
    postTaxDeduction: 30_000,
  });

  assert.deepEqual(result, {
    settlementIncome: 1_000_000,
    contractAward: 300_000,
    videoProductionIncome: 0,
    taxableExtraIncome: 100_000,
    taxExemptIncome: 50_000,
    grossIncome: 1_450_000,
    preTaxDeduction: 20_000,
    taxableIncome: 1_380_000,
    withholdingTax: 45_540,
    postTaxDeduction: 30_000,
    netPay: 1_354_460,
  });

  // 각각 계산하면 10원 미만 절사로 0 + 0이지만, 합친 400원에는 원천세 10원이 발생한다.
  assert.equal(calculateFreelancerSettlement({
    settlementIncome: 200,
    contractAward: 200,
  }).withholdingTax, 10);
});

test('공제가 소득보다 커도 음수 원천세를 만들지 않는다', () => {
  const result = calculateFreelancerSettlement({
    settlementIncome: 100_000,
    contractAward: 0,
    preTaxDeduction: 150_000,
  });

  assert.equal(result.taxableIncome, 0);
  assert.equal(result.withholdingTax, 0);
  assert.equal(result.netPay, -50_000);
});

test('이태욱 8월 재정산 수치: 환불 회수와 매수신청대리 공제를 반영하면 510,030원이 이월된다', () => {
  const result = calculateFreelancerSettlement({
    settlementIncome: 19_090,
    postTaxDeduction: 483_500 + 45_000,
  });

  assert.equal(result.withholdingTax, 620);
  assert.equal(result.netPay, -510_030);
});

test('서버 저장 계산은 매출 정산수익과 계약포상만 합치고 구·신 안건수당을 새로 합산하지 않는다', () => {
  const result = calculateFreelancerSavedSettlement({
    accounting: { commission_rate: 50, position_allowance: 100_000 },
    summary: { position_allowance: 100_000 },
    records: [
      { type: '계약', amount: 1_100_000, supply_amount: 1_000_000, refund_amount: 110_000 },
      { type: '매수신청대리', amount: 330_000, supply_amount: 200_000, proxy_cost: 100_000 },
    ],
    is_payout_month: true,
    contract_award: { rank: 1, award: 300_000 },
    lawitgo_new_settlements: [{ amount: 999_999 }],
  }, {
    caseAllowance: { bonus: 999_999 },
    commExtras: [
      { amount: '100,000' },
      { amount: '40,000', skipRate: true, skipTax: true },
    ],
    commDeductions: [
      { amount: '20,000', isFood: true },
      { amount: '30,000' },
    ],
  }, '2026-08');

  assert.deepEqual(result, {
    settlementIncome: 750_000,
    contractAward: 300_000,
    videoProductionIncome: 0,
    taxableExtraIncome: 50_000,
    taxExemptIncome: 40_000,
    grossIncome: 1_140_000,
    preTaxDeduction: 20_000,
    taxableIncome: 1_080_000,
    withholdingTax: 35_640,
    postTaxDeduction: 30_000,
    netPay: 1_054_360,
  });
});

test('당월 일반·매수신청대리 부분환불은 급여와 사업소득에 같은 실지급 기여액을 사용한다', () => {
  const records = [
    { type: '계약', amount: 1_100_000, supply_amount: 1_000_000, refund_amount: 550_000 },
    { type: '매수신청대리', amount: 330_000, refund_amount: 110_000, proxy_cost: 100_000 },
    { type: '매수신청대리', amount: 110_000, refund_amount: 110_000, proxy_cost: 200_000 },
  ];
  const salesIncome = calculateFreelancerSalesIncome(records, 50, '2026-08');
  assert.deepEqual(salesIncome, {
    normalSupply: 1_000_000,
    normalRefundSupply: 500_000,
    commissionIncome: 250_000,
    proxyIncome: 100_000,
    totalIncome: 350_000,
  });
  const settlement = calculateFreelancerSavedSettlement({
    accounting: { commission_rate: 50 },
    records,
  }, {}, '2026-08');
  assert.equal(settlement.settlementIncome, salesIncome.totalIncome);
  assert.equal(settlement.withholdingTax, 11_550);
  assert.equal(settlement.netPay, 338_450);
});

test('canonical 지급액은 저장 루트와 스냅샷 manual에 동일하게 보존된다', () => {
  const settlement = calculateFreelancerSettlement({
    settlementIncome: 1_000_000,
    contractAward: 300_000,
  });
  const saved = applyFreelancerSettlementToSaveData({
    net_pay: 967_000,
    untouched: 'keep',
    payroll_snapshot: {
      response: { month: '2026-08' },
      manual: { net_pay: 967_000, note: 'keep' },
    },
  }, settlement);

  assert.equal(saved.net_pay, 1_257_100);
  assert.deepEqual(saved.freelancer_settlement, settlement);
  assert.equal(saved.payroll_snapshot.manual.net_pay, 1_257_100);
  assert.deepEqual(saved.payroll_snapshot.manual.freelancer_settlement, settlement);
  assert.equal(saved.payroll_snapshot.response.month, '2026-08');
  assert.equal(saved.payroll_snapshot.manual.note, 'keep');
  assert.equal(saved.untouched, 'keep');
});

test('입금 확인과 급여 확정이 경합해도 잠긴 과거월에 새 매출을 유입시키지 않는다', async () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL, team_id TEXT, branch TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '',
      login_type TEXT NOT NULL DEFAULT 'employee', approved INTEGER NOT NULL DEFAULT 1,
      auth_version INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE sales_records (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT '계약', type_detail TEXT NOT NULL DEFAULT '',
      client_name TEXT NOT NULL DEFAULT '', depositor_name TEXT NOT NULL DEFAULT '', amount INTEGER NOT NULL DEFAULT 0,
      contract_date TEXT NOT NULL DEFAULT '', deposit_date TEXT NOT NULL DEFAULT '', card_deposit_date TEXT NOT NULL DEFAULT '',
      payment_type TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', confirmed_at TEXT, confirmed_by TEXT,
      refund_amount INTEGER NOT NULL DEFAULT 0, refund_requested_at TEXT, refund_approved_at TEXT, refund_approved_by TEXT,
      direction TEXT NOT NULL DEFAULT 'income', updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE payroll_saves (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, period TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}',
      pay_type TEXT NOT NULL DEFAULT 'commission', locked INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE refund_recovery_resolutions (
      sales_record_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payroll_month TEXT NOT NULL,
      recovery_amount INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE accounting_activity_logs (
      id TEXT PRIMARY KEY, actor_id TEXT, actor_name TEXT, actor_role TEXT, action TEXT,
      target_type TEXT, target_id TEXT, target_label TEXT, diff_summary TEXT,
      before_snapshot TEXT, after_snapshot TEXT, source_page TEXT, created_at TEXT
    );
    CREATE TABLE deposit_notices (
      id TEXT PRIMARY KEY, depositor TEXT NOT NULL DEFAULT '', amount INTEGER NOT NULL DEFAULT 0,
      deposit_date TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', sales_record_id TEXT,
      approved_by TEXT, approved_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO users (id, email, name, role, branch, department)
    VALUES
      ('accountant-1', 'accountant@example.com', '총무', 'accountant', '본사관리', '총무팀'),
      ('member-1', 'member@example.com', '담당자', 'member', '의정부', '컨설팅팀');
    INSERT INTO sales_records (
      id, user_id, type, client_name, depositor_name, amount, contract_date, payment_type, status
    ) VALUES (
      'pending-sale', 'member-1', '계약', '고객', '고객', 110000, '2026-08-01', '이체', 'pending'
    );
  `);

  const hooks: D1TestHooks = {};
  const db = d1FromSqlite(sqlite, hooks);
  const env = { DB: db, JWT_SIGNING_SECRET: JWT_SECRET } as Env;
  const app = new Hono<AuthEnv>();
  app.route('/sales', salesRoute);

  hooks.beforeRun = (sql) => {
    if (!sql.includes('UPDATE sales_records SET status = ?')) return;
    hooks.beforeRun = undefined;
    sqlite.prepare(`
      INSERT INTO payroll_saves (id, user_id, period, locked)
      VALUES ('august-lock-race', 'member-1', '2026년 8월', 1)
    `).run();
  };
  const raced = await authenticatedRequest(app, env, '/sales/pending-sale/confirm', {
    method: 'POST',
    body: JSON.stringify({ deposit_date: '2026-08-10' }),
  });
  assert.equal(raced.status, 409, await raced.text());
  assert.equal(sqlite.prepare("SELECT status FROM sales_records WHERE id = 'pending-sale'").pluck().get(), 'pending');

  sqlite.prepare("DELETE FROM payroll_saves WHERE id = 'august-lock-race'").run();
  const confirmed = await authenticatedRequest(app, env, '/sales/pending-sale/confirm', {
    method: 'POST',
    body: JSON.stringify({ deposit_date: '2026-08-10' }),
  });
  assert.equal(confirmed.status, 200, await confirmed.text());
  assert.equal(sqlite.prepare("SELECT status FROM sales_records WHERE id = 'pending-sale'").pluck().get(), 'confirmed');

  sqlite.prepare("UPDATE sales_records SET status = 'refund_requested', refund_requested_at = '2026-08-20' WHERE id = 'pending-sale'").run();
  sqlite.prepare(`
    INSERT INTO payroll_saves (id, user_id, period, data, locked)
    VALUES (
      'august-locked-without-sale', 'member-1', '2026년 8월',
      '{"payroll_snapshot":{"response":{"records":[]}}}', 1
    )
  `).run();
  const blockedRestore = await authenticatedRequest(app, env, '/sales/pending-sale/refund-request-cancel', {
    method: 'POST',
    body: '{}',
  });
  assert.equal(blockedRestore.status, 409, await blockedRestore.text());
  assert.equal(sqlite.prepare("SELECT status FROM sales_records WHERE id = 'pending-sale'").pluck().get(), 'refund_requested');

  sqlite.prepare(`
    UPDATE payroll_saves
    SET data = '{"payroll_snapshot":{"response":{"records":[{"id":"pending-sale"}]}}}'
    WHERE id = 'august-locked-without-sale'
  `).run();
  const safeRestore = await authenticatedRequest(app, env, '/sales/pending-sale/refund-request-cancel', {
    method: 'POST',
    body: '{}',
  });
  assert.equal(safeRestore.status, 200, await safeRestore.text());
  assert.equal(sqlite.prepare("SELECT status FROM sales_records WHERE id = 'pending-sale'").pluck().get(), 'confirmed');

  sqlite.prepare(`
    UPDATE sales_records
    SET status = 'refunded', refund_amount = 110000, refund_approved_at = '2026-08-21', refund_approved_by = 'accountant-1'
    WHERE id = 'pending-sale'
  `).run();
  sqlite.prepare(`
    UPDATE payroll_saves
    SET data = '{"payroll_snapshot":{"response":{"records":[{"id":"pending-sale","refund_amount":50000}]}}}'
    WHERE id = 'august-locked-without-sale'
  `).run();
  const blockedRefundRevert = await authenticatedRequest(app, env, '/sales/pending-sale/refund-revert', {
    method: 'POST',
    body: '{}',
  });
  assert.equal(blockedRefundRevert.status, 409, await blockedRefundRevert.text());
  assert.deepEqual(sqlite.prepare(
    "SELECT status, refund_amount FROM sales_records WHERE id = 'pending-sale'"
  ).get(), { status: 'refunded', refund_amount: 110000 });

  sqlite.prepare(`
    UPDATE payroll_saves
    SET data = '{"payroll_snapshot":{"response":{"records":[{"id":"pending-sale","refund_amount":0}]}}}'
    WHERE id = 'august-locked-without-sale'
  `).run();
  const safeRefundRevert = await authenticatedRequest(app, env, '/sales/pending-sale/refund-revert', {
    method: 'POST',
    body: '{}',
  });
  assert.equal(safeRefundRevert.status, 200, await safeRefundRevert.text());
  assert.deepEqual(sqlite.prepare(
    "SELECT status, refund_amount FROM sales_records WHERE id = 'pending-sale'"
  ).get(), { status: 'confirmed', refund_amount: 0 });

  sqlite.prepare("UPDATE sales_records SET refund_amount = 50000 WHERE id = 'pending-sale'").run();
  sqlite.prepare(`
    UPDATE payroll_saves
    SET data = '{"payroll_snapshot":{"response":{"records":[{"id":"pending-sale","refund_amount":50000}]}}}'
    WHERE id = 'august-locked-without-sale'
  `).run();
  const lowerLockedRefund = await authenticatedRequest(app, env, '/sales/pending-sale/partial-refund', {
    method: 'POST',
    body: JSON.stringify({ refund_amount: 20000 }),
  });
  assert.equal(lowerLockedRefund.status, 409, await lowerLockedRefund.text());
  assert.equal(sqlite.prepare("SELECT refund_amount FROM sales_records WHERE id = 'pending-sale'").pluck().get(), 50000);

  const increaseLockedRefund = await authenticatedRequest(app, env, '/sales/pending-sale/partial-refund', {
    method: 'POST',
    body: JSON.stringify({ refund_amount: 70000 }),
  });
  assert.equal(increaseLockedRefund.status, 200, await increaseLockedRefund.text());
  assert.equal(sqlite.prepare("SELECT refund_amount FROM sales_records WHERE id = 'pending-sale'").pluck().get(), 70000);

  sqlite.prepare(`
    INSERT INTO sales_records (
      id, user_id, type, client_name, depositor_name, amount, contract_date, payment_type, status
    ) VALUES (
      'claimed-sale', 'member-1', '계약', '입금고객', '입금고객', 220000, '2026-09-01', '이체', 'pending'
    )
  `).run();
  sqlite.prepare(`
    INSERT INTO deposit_notices (id, depositor, amount, deposit_date, status, sales_record_id)
    VALUES ('claimed-notice', '입금고객', 220000, '2026-09-10', 'claimed', 'claimed-sale')
  `).run();
  hooks.beforeBatch = () => {
    sqlite.prepare(`
      INSERT INTO payroll_saves (id, user_id, period, locked)
      VALUES ('september-lock-race', 'member-1', '2026년 9월', 1)
    `).run();
  };
  const blockedDepositApprove = await authenticatedRequest(app, env, '/sales/deposits/claimed-notice/approve', {
    method: 'POST',
    body: '{}',
  });
  assert.equal(blockedDepositApprove.status, 409, await blockedDepositApprove.text());
  assert.deepEqual(sqlite.prepare(
    "SELECT status, deposit_date FROM sales_records WHERE id = 'claimed-sale'"
  ).get(), { status: 'pending', deposit_date: '' });
  assert.equal(sqlite.prepare("SELECT status FROM deposit_notices WHERE id = 'claimed-notice'").pluck().get(), 'claimed');

  sqlite.prepare("DELETE FROM payroll_saves WHERE id = 'september-lock-race'").run();
  const approvedDeposit = await authenticatedRequest(app, env, '/sales/deposits/claimed-notice/approve', {
    method: 'POST',
    body: '{}',
  });
  assert.equal(approvedDeposit.status, 200, await approvedDeposit.text());
  assert.deepEqual(sqlite.prepare(
    "SELECT status, deposit_date FROM sales_records WHERE id = 'claimed-sale'"
  ).get(), { status: 'confirmed', deposit_date: '2026-09-10' });
  assert.equal(sqlite.prepare("SELECT status FROM deposit_notices WHERE id = 'claimed-notice'").pluck().get(), 'approved');
  sqlite.close();
});

test('카드 정산일 입력과 급여 확정이 경합해도 잠긴 과거월 매출로 전환하지 않는다', async () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL, team_id TEXT, branch TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '',
      login_type TEXT NOT NULL DEFAULT 'employee', approved INTEGER NOT NULL DEFAULT 1,
      auth_version INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE sales_records (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'card_pending', payment_type TEXT NOT NULL DEFAULT '카드',
      card_deposit_date TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE payroll_saves (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, period TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}',
      pay_type TEXT NOT NULL DEFAULT 'commission', locked INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO users (id, email, name, role, branch, department)
    VALUES
      ('accountant-1', 'accountant@example.com', '총무', 'accountant', '본사관리', '총무팀'),
      ('member-1', 'member@example.com', '담당자', 'member', '의정부', '컨설팅팀');
    INSERT INTO sales_records (id, user_id, amount, status, payment_type)
    VALUES ('card-sale', 'member-1', 110000, 'card_pending', '카드');
  `);

  const hooks: D1TestHooks = {};
  const db = d1FromSqlite(sqlite, hooks);
  const env = { DB: db, JWT_SIGNING_SECRET: JWT_SECRET } as Env;
  const app = new Hono<AuthEnv>();
  app.route('/accounting', accountingRoute);

  hooks.beforeRun = (sql) => {
    if (!sql.includes('UPDATE sales_records') || !sql.includes('card_deposit_date = ?')) return;
    hooks.beforeRun = undefined;
    sqlite.prepare(`
      INSERT INTO payroll_saves (id, user_id, period, locked)
      VALUES ('card-august-lock-race', 'member-1', '2026-08', 1)
    `).run();
  };
  const raced = await authenticatedRequest(app, env, '/accounting/card-settlements/card-sale/confirm', {
    method: 'POST',
    body: JSON.stringify({ settlement_date: '2026-08-20', settlement_amount: 105000 }),
  });
  assert.equal(raced.status, 409, await raced.text());
  assert.equal(sqlite.prepare("SELECT card_deposit_date FROM sales_records WHERE id = 'card-sale'").pluck().get(), '');

  sqlite.prepare("DELETE FROM payroll_saves WHERE id = 'card-august-lock-race'").run();
  const confirmed = await authenticatedRequest(app, env, '/accounting/card-settlements/card-sale/confirm', {
    method: 'POST',
    body: JSON.stringify({ settlement_date: '2026-08-20', settlement_amount: 105000 }),
  });
  assert.equal(confirmed.status, 200, await confirmed.text());
  assert.equal(
    sqlite.prepare("SELECT card_deposit_date FROM sales_records WHERE id = 'card-sale'").pluck().get(),
    '2026-08-20',
  );
  sqlite.close();
});

test('구형 명도성과금 마감도 잠긴 과거 급여월에는 새 매출을 만들지 않는다', async () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'member'
    );
    CREATE TABLE user_accounting (
      user_id TEXT PRIMARY KEY, pay_type TEXT NOT NULL DEFAULT 'commission'
    );
    CREATE TABLE cases (
      id TEXT PRIMARY KEY, external_id TEXT NOT NULL, consultant_user_id TEXT,
      consultant_name TEXT, consultant_branch TEXT, consultant_department TEXT,
      fee_type TEXT NOT NULL DEFAULT 'fixed', fee_amount INTEGER NOT NULL DEFAULT 0,
      bimonthly_period TEXT NOT NULL
    );
    CREATE TABLE payroll_saves (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, period TEXT NOT NULL, locked INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE sales_records (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, type_detail TEXT NOT NULL DEFAULT '',
      client_name TEXT NOT NULL DEFAULT '', depositor_name TEXT NOT NULL DEFAULT '', depositor_different INTEGER NOT NULL DEFAULT 0,
      amount INTEGER NOT NULL DEFAULT 0, contract_date TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
      deposit_date TEXT NOT NULL DEFAULT '', payment_type TEXT NOT NULL DEFAULT '', payment_method TEXT NOT NULL DEFAULT '',
      memo TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '',
      direction TEXT NOT NULL DEFAULT 'income', external_id TEXT UNIQUE, confirmed_at TEXT
    );
    INSERT INTO users (id, name, branch, role) VALUES ('member-1', '담당자', '의정부', 'member');
    INSERT INTO user_accounting (user_id, pay_type) VALUES ('member-1', 'commission');
    INSERT INTO cases (
      id, external_id, consultant_user_id, consultant_name, consultant_branch, consultant_department,
      fee_type, fee_amount, bimonthly_period
    ) VALUES (
      'case-1', 'case-ext-1', 'member-1', '담당자', '의정부', '컨설팅팀',
      'fixed', 1000000, '2026-03_04'
    );
    INSERT INTO payroll_saves (id, user_id, period, locked)
    VALUES ('april-locked', 'member-1', '2026년 4월', 1);
  `);

  const db = d1FromSqlite(sqlite);
  const lockedResult = await finalizeCaseAllowance({ DB: db }, '2026-03_04');
  assert.equal(lockedResult.inserted, 0);
  assert.equal(lockedResult.skipped, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM sales_records').pluck().get(), 0);

  sqlite.prepare("DELETE FROM payroll_saves WHERE id = 'april-locked'").run();
  const openResult = await finalizeCaseAllowance({ DB: db }, '2026-03_04');
  assert.equal(openResult.inserted, 1);
  assert.deepEqual(sqlite.prepare(
    'SELECT amount, contract_date, deposit_date, status FROM sales_records'
  ).get(), {
    amount: 100000,
    contract_date: '2026-04-30',
    deposit_date: '2026-04-30',
    status: 'confirmed',
  });
  sqlite.close();
});

test('POST save는 위조한 client net을 서버 산식으로 덮고 lock은 그 음수액만 익월 이월한다', async () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL, team_id TEXT, branch TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '',
      position_title TEXT NOT NULL DEFAULT '', hire_date TEXT, resigned_at TEXT, updated_at TEXT,
      login_type TEXT NOT NULL DEFAULT 'employee', approved INTEGER NOT NULL DEFAULT 1,
      auth_version INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE user_accounting (
      user_id TEXT PRIMARY KEY, pay_type TEXT NOT NULL DEFAULT 'salary', commission_rate REAL NOT NULL DEFAULT 0,
      salary INTEGER NOT NULL DEFAULT 0, standard_sales INTEGER NOT NULL DEFAULT 0,
      grade TEXT NOT NULL DEFAULT '', position_allowance INTEGER NOT NULL DEFAULT 0,
      ssn TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE commission_rate_overrides (
      user_id TEXT NOT NULL, year_month TEXT NOT NULL, commission_rate REAL NOT NULL,
      PRIMARY KEY (user_id, year_month)
    );
    CREATE TABLE sales_records (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, type_detail TEXT NOT NULL DEFAULT '',
      client_name TEXT NOT NULL DEFAULT '', client_phone TEXT NOT NULL DEFAULT '',
      depositor_name TEXT NOT NULL DEFAULT '', depositor_different INTEGER NOT NULL DEFAULT 0,
      amount INTEGER NOT NULL DEFAULT 0, refund_amount INTEGER NOT NULL DEFAULT 0,
      contract_date TEXT NOT NULL DEFAULT '', deposit_date TEXT NOT NULL DEFAULT '',
      card_deposit_date TEXT NOT NULL DEFAULT '', payment_type TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending', confirmed_at TEXT, memo TEXT NOT NULL DEFAULT '',
      exclude_from_count INTEGER NOT NULL DEFAULT 0, proxy_cost INTEGER NOT NULL DEFAULT 0,
      direction TEXT NOT NULL DEFAULT 'income', external_id TEXT, refund_approved_at TEXT
    );
    CREATE TABLE cases (
      id TEXT PRIMARY KEY, consultant_user_id TEXT, bimonthly_period TEXT,
      fee_type TEXT NOT NULL DEFAULT 'fixed', fee_amount INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE payroll_saves (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, period TEXT NOT NULL, pay_type TEXT NOT NULL,
      data TEXT NOT NULL, locked INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, period)
    );
    CREATE TABLE refund_recovery_resolutions (
      sales_record_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payroll_month TEXT NOT NULL,
      recovery_amount INTEGER NOT NULL DEFAULT 0, resolved_by TEXT NOT NULL DEFAULT '', resolved_at TEXT
    );
    CREATE TABLE business_income_entries (
      id TEXT PRIMARY KEY, month TEXT NOT NULL, user_id TEXT, name TEXT NOT NULL DEFAULT '',
      ssn TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', amount INTEGER NOT NULL DEFAULT 0,
      tax INTEGER NOT NULL DEFAULT 0, net_amount INTEGER NOT NULL DEFAULT 0,
      is_ad_hoc INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO users (id, email, name, role, branch, department)
    VALUES
      ('accountant-1', 'accountant@example.com', '총무', 'accountant', '본사관리', '총무팀'),
      ('freelancer-1', 'free@example.com', '프리랜서', 'member', '의정부', '컨설팅팀');
    INSERT INTO user_accounting (user_id, pay_type, commission_rate)
    VALUES ('freelancer-1', 'commission', 50);
    INSERT INTO sales_records (
      id, user_id, type, client_name, amount, refund_amount, contract_date, deposit_date,
      payment_type, status, confirmed_at, direction, refund_approved_at
    ) VALUES (
      'refund-july', 'freelancer-1', '계약', '최윤주', 2200000, 1100000,
      '2026-07-01', '2026-07-01', '이체', 'confirmed', '2026-07-02 10:00:00', 'income', '2026-08-27 10:00:00'
    );
    INSERT INTO payroll_saves (
      id, user_id, period, pay_type, data, locked, created_by, created_at, updated_at
    ) VALUES (
      'july-locked', 'freelancer-1', '2026-07', 'commission',
      '{"payroll_snapshot":{"response":{"accounting":{"commission_rate":50},"records":[{"id":"refund-july","amount":2200000,"refund_amount":0},{"id":"refund-added-after-save","amount":110000,"refund_amount":0}]}}}', 1,
      'accountant-1', '2026-08-05 01:00:00', '2026-08-05 01:00:00'
    );
  `);
  sqlite.prepare(`
    INSERT INTO sales_records (
      id, user_id, type, client_name, client_phone, amount, contract_date, deposit_date, proxy_cost,
      payment_type, status, confirmed_at, direction
    ) VALUES ('proxy-august', 'freelancer-1', '매수신청대리', '김윤명', '010-0000-0001', 120000,
      '2026-08-01', '2026-08-01', 90000,
      '이체', 'confirmed', '2026-08-01 10:00:00', '')
  `).run();

  const hooks: D1TestHooks = {};
  const db = d1FromSqlite(sqlite, hooks);
  const env = { DB: db, JWT_SIGNING_SECRET: JWT_SECRET } as Env;
  const app = new Hono<AuthEnv>();
  app.route('/payroll', payrollRoute);
  const legacyIsoSnapshotResponse = await authenticatedRequest(
    app,
    env,
    '/payroll/freelancer-1?month=2026-07',
    { method: 'GET' },
  );
  const legacyIsoSnapshotText = await legacyIsoSnapshotResponse.text();
  assert.equal(legacyIsoSnapshotResponse.status, 200, legacyIsoSnapshotText);
  assert.equal((JSON.parse(legacyIsoSnapshotText) as any).is_snapshot, true);
  sqlite.prepare(`
    INSERT INTO payroll_saves (id, user_id, period, pay_type, data, locked, created_by)
    VALUES ('july-duplicate', 'freelancer-1', '2026년 7월', 'commission', '{}', 1, 'accountant-1')
  `).run();
  const duplicateMonthResponse = await authenticatedRequest(
    app,
    env,
    '/payroll/freelancer-1?month=2026-07',
    { method: 'GET' },
  );
  assert.equal(duplicateMonthResponse.status, 409, await duplicateMonthResponse.text());
  sqlite.prepare("DELETE FROM payroll_saves WHERE id = 'july-duplicate'").run();
  const savePayload = {
    user_id: 'freelancer-1',
    period: '2026-08',
    pay_type: 'commission',
    data: {
      settle_month: '2099-12',
      net_pay: 1,
      commDeductions: [{ label: '매수신청대리 (김윤명)', amount: '45000' }],
      payroll_snapshot: {
        month: '2026-08',
        period: '2026년 8월',
        response: {
          accounting: { pay_type: 'commission', commission_rate: 50 },
          records: [],
          is_payout_month: true,
          contract_award: { rank: null, count: 0, award: 0, total_amount: 0 },
        },
        manual: {},
      },
    },
  };
  const staleAwardPayload = structuredClone(savePayload);
  staleAwardPayload.data.payroll_snapshot.response.contract_award = {
    rank: 3, count: 10, award: 100000, total_amount: 1100000,
  };
  const staleAwardResponse = await authenticatedRequest(app, env, '/payroll/save', {
    method: 'POST',
    body: JSON.stringify(staleAwardPayload),
  });
  assert.equal(staleAwardResponse.status, 409);
  assert.equal(sqlite.prepare("SELECT COUNT(*) FROM payroll_saves WHERE period = '2026년 8월'").pluck().get(), 0);

  const saveResponse = await authenticatedRequest(app, env, '/payroll/save', {
    method: 'POST',
    body: JSON.stringify(savePayload),
  });
  assert.equal(saveResponse.status, 200, await saveResponse.text());

  const stored = JSON.parse(String((sqlite.prepare(
    "SELECT data FROM payroll_saves WHERE user_id = 'freelancer-1' AND period = '2026년 8월'"
  ).get() as { data: string }).data));
  assert.equal(stored.settle_month, '2026-08');
  assert.equal(stored.freelancer_settlement.settlementIncome, 19090);
  assert.equal(stored.freelancer_settlement.contractAward, 0);
  assert.equal(stored.freelancer_settlement.withholdingTax, 620);
  assert.equal(stored.freelancer_settlement.postTaxDeduction, 528500);
  assert.equal(stored.net_pay, -510030);
  assert.deepEqual(stored.commDeductions, [
    { label: '매수신청대리 (김윤명)', amount: '45000' },
    { label: '환불 회수 · 최윤주', amount: '483500', sourceId: 'refund-july' },
  ]);
  assert.deepEqual(stored.payroll_snapshot.manual.commDeductions, stored.commDeductions);
  assert.deepEqual(stored.business_income_settlement, {
    amount: 19090,
    tax: 620,
    net: 18470,
    contractAward: 0,
    videoProductionIncome: 0,
  });
  assert.equal(stored.payroll_snapshot.manual.net_pay, -510030);
  assert.equal(stored.payroll_snapshot.response.records.length, 1);

  sqlite.prepare(`
    INSERT INTO sales_records (
      id, user_id, type, client_name, amount, refund_amount, contract_date, deposit_date,
      payment_type, status, direction, refund_approved_at
    ) VALUES (
      'refund-added-after-save', 'freelancer-1', '계약', '추가환불', 110000, 110000,
      '2026-07-02', '2026-07-02', '이체', 'confirmed', 'income', '2026-08-28 10:00:00'
    )
  `).run();
  const staleRefundLock = await authenticatedRequest(app, env, '/payroll/lock', {
    method: 'POST',
    body: JSON.stringify({ user_id: 'freelancer-1', period: '2026년 8월' }),
  });
  assert.equal(staleRefundLock.status, 409, await staleRefundLock.text());
  assert.equal(sqlite.prepare("SELECT locked FROM payroll_saves WHERE period = '2026년 8월'").pluck().get(), 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM payroll_carryovers').pluck().get(), 0);
  sqlite.prepare("DELETE FROM sales_records WHERE id = 'refund-added-after-save'").run();

  // authoritative read 뒤 새 환불이 승인되어도 후보 집합 CAS가 stale 확정을 막는다.
  hooks.beforeBatch = () => {
    sqlite.prepare(`
      INSERT INTO sales_records (
        id, user_id, type, client_name, amount, refund_amount, contract_date, deposit_date,
        payment_type, status, confirmed_at, direction, refund_approved_at
      ) VALUES (
        'refund-added-after-save', 'freelancer-1', '계약', '경합환불', 110000, 110000,
        '2026-07-02', '2026-07-02', '이체', 'confirmed', '2026-07-02 10:00:00',
        'income', '2026-08-28 10:00:00'
      )
    `).run();
  };
  const concurrentRefundLock = await authenticatedRequest(app, env, '/payroll/lock', {
    method: 'POST',
    body: JSON.stringify({ user_id: 'freelancer-1', period: '2026년 8월' }),
  });
  assert.equal(concurrentRefundLock.status, 409, await concurrentRefundLock.text());
  assert.equal(sqlite.prepare("SELECT locked FROM payroll_saves WHERE period = '2026년 8월'").pluck().get(), 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM refund_recovery_resolutions').pluck().get(), 0);
  sqlite.prepare("DELETE FROM sales_records WHERE id = 'refund-added-after-save'").run();

  // 회수 근거인 원월 스냅샷이 authoritative read 뒤 바뀌어도 stale 금액으로 확정하지 않는다.
  const julyData = String(sqlite.prepare("SELECT data FROM payroll_saves WHERE id = 'july-locked'").pluck().get());
  hooks.beforeBatch = () => {
    sqlite.prepare("UPDATE payroll_saves SET data = ? WHERE id = 'july-locked'")
      .run(julyData.replace('commission_rate\":50', 'commission_rate\":45'));
  };
  const changedOriginLock = await authenticatedRequest(app, env, '/payroll/lock', {
    method: 'POST',
    body: JSON.stringify({ user_id: 'freelancer-1', period: '2026년 8월' }),
  });
  assert.equal(changedOriginLock.status, 409, await changedOriginLock.text());
  sqlite.prepare("UPDATE payroll_saves SET data = ? WHERE id = 'july-locked'").run(julyData);

  // authoritative read 뒤 당월 매출이 바뀌어도 저장 당시 금액으로 확정하지 않는다.
  hooks.beforeBatch = () => {
    sqlite.prepare("UPDATE sales_records SET amount = 121000 WHERE id = 'proxy-august'").run();
  };
  const changedPayrollSaleLock = await authenticatedRequest(app, env, '/payroll/lock', {
    method: 'POST',
    body: JSON.stringify({ user_id: 'freelancer-1', period: '2026년 8월' }),
  });
  assert.equal(changedPayrollSaleLock.status, 409, await changedPayrollSaleLock.text());
  assert.equal(sqlite.prepare("SELECT locked FROM payroll_saves WHERE period = '2026년 8월'").pluck().get(), 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM payroll_carryovers').pluck().get(), 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM refund_recovery_resolutions').pluck().get(), 0);
  sqlite.prepare("UPDATE sales_records SET amount = 120000 WHERE id = 'proxy-august'").run();

  // authoritative read 뒤 새 당월 매출이 생겨도 후보 집합의 no-extra CAS가 확정을 막는다.
  hooks.beforeBatch = () => {
    sqlite.prepare(`
      INSERT INTO sales_records (
        id, user_id, type, client_name, amount, contract_date, deposit_date,
        payment_type, status, confirmed_at, direction
      ) VALUES (
        'august-added-during-lock', 'freelancer-1', '계약', '경합매출', 110000,
        '2026-08-02', '2026-08-02', '이체', 'confirmed', '2026-08-02 10:00:00', 'income'
      )
    `).run();
  };
  const addedPayrollSaleLock = await authenticatedRequest(app, env, '/payroll/lock', {
    method: 'POST',
    body: JSON.stringify({ user_id: 'freelancer-1', period: '2026년 8월' }),
  });
  assert.equal(addedPayrollSaleLock.status, 409, await addedPayrollSaleLock.text());
  assert.equal(sqlite.prepare("SELECT locked FROM payroll_saves WHERE period = '2026년 8월'").pluck().get(), 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM payroll_carryovers').pluck().get(), 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM refund_recovery_resolutions').pluck().get(), 0);
  sqlite.prepare("DELETE FROM sales_records WHERE id = 'august-added-during-lock'").run();

  // 새 음수 이월이 생기기 전에 다음 달이 이미 확정됐다면 직접 차단한다.
  sqlite.prepare(`
    INSERT INTO payroll_saves (id, user_id, period, pay_type, data, locked, created_by)
    VALUES ('september-prelocked', 'freelancer-1', '2026년 9월', 'commission', '{}', 1, 'accountant-1')
  `).run();
  const lockedNextMonth = await authenticatedRequest(app, env, '/payroll/lock', {
    method: 'POST',
    body: JSON.stringify({ user_id: 'freelancer-1', period: '2026년 8월' }),
  });
  assert.equal(lockedNextMonth.status, 409, await lockedNextMonth.text());
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM payroll_carryovers').pluck().get(), 0);
  sqlite.prepare("DELETE FROM payroll_saves WHERE id = 'september-prelocked'").run();

  const lockResponse = await authenticatedRequest(app, env, '/payroll/lock', {
    method: 'POST',
    body: JSON.stringify({ user_id: 'freelancer-1', period: '2026년 8월' }),
  });
  assert.equal(lockResponse.status, 200, await lockResponse.text());
  assert.deepEqual(sqlite.prepare(
    "SELECT origin_month, target_month, amount, status FROM payroll_carryovers WHERE user_id = 'freelancer-1'"
  ).get(), {
    origin_month: '2026-08',
    target_month: '2026-09',
    amount: 510030,
    status: 'pending',
  });
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM refund_recovery_resolutions').pluck().get(), 1);

  // downstream 회수월이 잠긴 동안에는 회수 근거인 7월 원정산을 먼저 풀 수 없다.
  const blockedJulyUnlock = await authenticatedRequest(app, env, '/payroll/unlock', {
    method: 'POST',
    body: JSON.stringify({ user_id: 'freelancer-1', period: '2026년 7월' }),
  });
  assert.equal(blockedJulyUnlock.status, 409, await blockedJulyUnlock.text());
  assert.equal(sqlite.prepare("SELECT locked FROM payroll_saves WHERE id = 'july-locked'").pluck().get(), 1);

  // 확정 취소는 회수 완료 근거도 같은 batch에서 되돌리고, 재확정 시 다시 생성한다.
  const augustUnlock = await authenticatedRequest(app, env, '/payroll/unlock', {
    method: 'POST',
    body: JSON.stringify({ user_id: 'freelancer-1', period: '2026년 8월' }),
  });
  assert.equal(augustUnlock.status, 200, await augustUnlock.text());
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM refund_recovery_resolutions').pluck().get(), 0);
  const augustRelock = await authenticatedRequest(app, env, '/payroll/lock', {
    method: 'POST',
    body: JSON.stringify({ user_id: 'freelancer-1', period: '2026년 8월' }),
  });
  assert.equal(augustRelock.status, 200, await augustRelock.text());
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM refund_recovery_resolutions').pluck().get(), 1);

  const septemberPayload = {
    user_id: 'freelancer-1',
    period: '2026년 9월',
    pay_type: 'commission',
    data: {
      net_pay: -26530,
      commDeductions: [{
        label: '전월 이월 공제 (2026-08)', amount: '26530', sourceId: 'carryover',
      }],
      payroll_snapshot: {
        month: '2026-09',
        period: '2026년 9월',
        response: {
          accounting: { pay_type: 'commission', commission_rate: 50 },
          records: [],
          is_payout_month: false,
          contract_award: { rank: null, count: 0, award: 0, total_amount: 0 },
        },
        manual: {},
      },
    },
  };
  const septemberSave = await authenticatedRequest(app, env, '/payroll/save', {
    method: 'POST', body: JSON.stringify(septemberPayload),
  });
  assert.equal(septemberSave.status, 200, await septemberSave.text());
  let septemberStored = JSON.parse(String((sqlite.prepare(
    "SELECT data FROM payroll_saves WHERE user_id = 'freelancer-1' AND period = '2026년 9월'"
  ).get() as { data: string }).data));
  assert.equal(septemberStored.net_pay, -510030);
  assert.equal(septemberStored.commDeductions[0].amount, '510030');

  const septemberLock = await authenticatedRequest(app, env, '/payroll/lock', {
    method: 'POST',
    body: JSON.stringify({ user_id: 'freelancer-1', period: '2026년 9월' }),
  });
  assert.equal(septemberLock.status, 200, await septemberLock.text());
  assert.equal(sqlite.prepare(
    "SELECT status FROM payroll_carryovers WHERE user_id = 'freelancer-1' AND origin_month = '2026-08'"
  ).pluck().get(), 'resolved');

  const blockedAugustUnlock = await authenticatedRequest(app, env, '/payroll/unlock', {
    method: 'POST',
    body: JSON.stringify({ user_id: 'freelancer-1', period: '2026년 8월' }),
  });
  assert.equal(blockedAugustUnlock.status, 409, await blockedAugustUnlock.text());
  assert.equal(sqlite.prepare("SELECT locked FROM payroll_saves WHERE period = '2026년 8월'").pluck().get(), 1);

  // 기존 데이터가 이미 원월 확정취소 상태여도, 하위월이 잠겨 있으면 재확정으로 이월을 덮지 않는다.
  sqlite.prepare("UPDATE payroll_saves SET locked = 0 WHERE period = '2026년 8월'").run();
  const augustResaveWithLockedSeptember = await authenticatedRequest(app, env, '/payroll/save', {
    method: 'POST', body: JSON.stringify(savePayload),
  });
  assert.equal(augustResaveWithLockedSeptember.status, 200, await augustResaveWithLockedSeptember.text());
  const blockedAugustRelock = await authenticatedRequest(app, env, '/payroll/lock', {
    method: 'POST',
    body: JSON.stringify({ user_id: 'freelancer-1', period: '2026년 8월' }),
  });
  assert.equal(blockedAugustRelock.status, 409, await blockedAugustRelock.text());
  assert.deepEqual(sqlite.prepare(
    "SELECT amount, status FROM payroll_carryovers WHERE user_id = 'freelancer-1' AND origin_month = '2026-08'"
  ).get(), { amount: 510030, status: 'resolved' });

  sqlite.prepare("UPDATE payroll_saves SET locked = 0 WHERE period = '2026년 9월'").run();
  const septemberResave = await authenticatedRequest(app, env, '/payroll/save', {
    method: 'POST', body: JSON.stringify(septemberPayload),
  });
  assert.equal(septemberResave.status, 200, await septemberResave.text());
  septemberStored = JSON.parse(String((sqlite.prepare(
    "SELECT data FROM payroll_saves WHERE user_id = 'freelancer-1' AND period = '2026년 9월'"
  ).get() as { data: string }).data));
  assert.equal(septemberStored.net_pay, -510030);
  assert.equal(septemberStored.commDeductions[0].amount, '510030');

  const businessIncomeResponse = await authenticatedRequest(
    app,
    env,
    '/payroll/reports/business-income?month=2026-08',
    { method: 'GET' },
  );
  const businessIncomeText = await businessIncomeResponse.text();
  assert.equal(businessIncomeResponse.status, 200, businessIncomeText);
  const businessIncome = JSON.parse(businessIncomeText) as any;
  assert.deepEqual(
    businessIncome.entries.map((entry: any) => ({
      user_id: entry.user_id,
      amount: entry.amount,
      tax: entry.tax,
      net_amount: entry.net_amount,
    })),
    [{ user_id: 'freelancer-1', amount: 19090, tax: 620, net_amount: 18470 }],
  );

  // 급여 확정과 동시에 회수 완료 근거를 고정하고, 확정 취소 후에도 당시 금액을 유지한다.
  assert.deepEqual(sqlite.prepare(`
    SELECT payroll_month, recovery_amount, resolved_by
    FROM refund_recovery_resolutions WHERE sales_record_id = 'refund-july'
  `).get(), { payroll_month: '2026-08', recovery_amount: 483500, resolved_by: 'accountant-1' });
  sqlite.prepare("UPDATE payroll_saves SET locked = 0 WHERE period = '2026년 8월'").run();
  sqlite.prepare("UPDATE user_accounting SET commission_rate = 40 WHERE user_id = 'freelancer-1'").run();
  const resolvedRecoveryResave = await authenticatedRequest(app, env, '/payroll/save', {
    method: 'POST',
    body: JSON.stringify(savePayload),
  });
  assert.equal(resolvedRecoveryResave.status, 200, await resolvedRecoveryResave.text());
  const resolvedRecoveryStored = JSON.parse(String((sqlite.prepare(
    "SELECT data FROM payroll_saves WHERE user_id = 'freelancer-1' AND period = '2026년 8월'"
  ).get() as { data: string }).data));
  assert.equal(resolvedRecoveryStored.payroll_snapshot.response.accounting.commission_rate, 40);
  assert.equal(
    resolvedRecoveryStored.commDeductions.find((item: any) => item.sourceId === 'refund-july')?.amount,
    '483500',
  );

  // 원월 재정산 결과가 양수로 바뀌면 이미 resolved 된 이월도 제거되고 대상월 재저장에서 빠져야 한다.
  sqlite.prepare(`
    INSERT INTO sales_records (
      id, user_id, type, client_name, amount, contract_date, deposit_date,
      payment_type, status, confirmed_at, direction
    ) VALUES (
      'positive-august', 'freelancer-1', '계약', '추가매출', 2200000,
      '2026-08-20', '2026-08-20', '이체', 'confirmed', '2026-08-20 10:00:00', 'income'
    )
  `).run();
  const positiveAugustSave = await authenticatedRequest(app, env, '/payroll/save', {
    method: 'POST', body: JSON.stringify(savePayload),
  });
  assert.equal(positiveAugustSave.status, 200, await positiveAugustSave.text());
  const positiveAugustLock = await authenticatedRequest(app, env, '/payroll/lock', {
    method: 'POST',
    body: JSON.stringify({ user_id: 'freelancer-1', period: '2026년 8월' }),
  });
  assert.equal(positiveAugustLock.status, 200, await positiveAugustLock.text());
  assert.equal(sqlite.prepare(
    "SELECT COUNT(*) FROM payroll_carryovers WHERE user_id = 'freelancer-1' AND origin_month = '2026-08'"
  ).pluck().get(), 0);

  const septemberAfterOriginCorrection = await authenticatedRequest(app, env, '/payroll/save', {
    method: 'POST', body: JSON.stringify(septemberPayload),
  });
  assert.equal(septemberAfterOriginCorrection.status, 200, await septemberAfterOriginCorrection.text());
  septemberStored = JSON.parse(String((sqlite.prepare(
    "SELECT data FROM payroll_saves WHERE user_id = 'freelancer-1' AND period = '2026년 9월'"
  ).get() as { data: string }).data));
  assert.equal(septemberStored.net_pay, 0);
  assert.deepEqual(septemberStored.commDeductions, []);
  sqlite.close();
});

test('2026년 9월 계약포상은 급여·비율제에 당월 반영되고 저장 후 순위가 바뀌면 재저장 전 잠금을 막는다', async (t) => {
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL, team_id TEXT, branch TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '',
      position_title TEXT NOT NULL DEFAULT '', hire_date TEXT, resigned_at TEXT, updated_at TEXT,
      login_type TEXT NOT NULL DEFAULT 'employee', approved INTEGER NOT NULL DEFAULT 1,
      auth_version INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE user_accounting (
      user_id TEXT PRIMARY KEY, pay_type TEXT NOT NULL DEFAULT 'salary', commission_rate REAL NOT NULL DEFAULT 0,
      salary INTEGER NOT NULL DEFAULT 0, standard_sales INTEGER NOT NULL DEFAULT 0,
      grade TEXT NOT NULL DEFAULT '', position_allowance INTEGER NOT NULL DEFAULT 0,
      ssn TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE commission_rate_overrides (
      user_id TEXT NOT NULL, year_month TEXT NOT NULL, commission_rate REAL NOT NULL,
      PRIMARY KEY (user_id, year_month)
    );
    CREATE TABLE sales_records (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, type_detail TEXT NOT NULL DEFAULT '',
      client_name TEXT NOT NULL DEFAULT '', client_phone TEXT NOT NULL DEFAULT '',
      depositor_name TEXT NOT NULL DEFAULT '', depositor_different INTEGER NOT NULL DEFAULT 0,
      amount INTEGER NOT NULL DEFAULT 0, refund_amount INTEGER NOT NULL DEFAULT 0,
      contract_date TEXT NOT NULL DEFAULT '', deposit_date TEXT NOT NULL DEFAULT '',
      card_deposit_date TEXT NOT NULL DEFAULT '', payment_type TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending', confirmed_at TEXT, memo TEXT NOT NULL DEFAULT '',
      exclude_from_count INTEGER NOT NULL DEFAULT 0, proxy_cost INTEGER NOT NULL DEFAULT 0,
      direction TEXT NOT NULL DEFAULT 'income', external_id TEXT, refund_approved_at TEXT,
      attribution_branch TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE cases (
      id TEXT PRIMARY KEY, consultant_user_id TEXT, bimonthly_period TEXT,
      fee_type TEXT NOT NULL DEFAULT 'fixed', fee_amount INTEGER NOT NULL DEFAULT 0,
      registered_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE leave_requests (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      leave_type TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL DEFAULT '', days REAL NOT NULL DEFAULT 0, hours REAL
    );
    CREATE TABLE payroll_saves (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, period TEXT NOT NULL, pay_type TEXT NOT NULL,
      data TEXT NOT NULL, locked INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, period)
    );
    CREATE TABLE refund_recovery_resolutions (
      sales_record_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payroll_month TEXT NOT NULL,
      recovery_amount INTEGER NOT NULL DEFAULT 0, resolved_by TEXT NOT NULL DEFAULT '', resolved_at TEXT
    );
    CREATE TABLE business_income_entries (
      id TEXT PRIMARY KEY, month TEXT NOT NULL, user_id TEXT, name TEXT NOT NULL DEFAULT '',
      ssn TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', amount INTEGER NOT NULL DEFAULT 0,
      tax INTEGER NOT NULL DEFAULT 0, net_amount INTEGER NOT NULL DEFAULT 0,
      is_ad_hoc INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO users (id, email, name, role, branch, department, position_title) VALUES
      ('accountant-1', 'accountant@example.com', '총무', 'accountant', '본사관리', '총무팀', '총무'),
      ('salary-1', 'salary@example.com', '급여직원', 'member', '부산지사', '컨설팅팀', '컨설턴트'),
      ('commission-1', 'commission@example.com', '프리랜서', 'member', '의정부지사', '컨설팅팀', '컨설턴트'),
      ('challenger-1', 'challenger@example.com', '도전자', 'member', '서초지사', '컨설팅팀', '컨설턴트');
    INSERT INTO user_accounting (
      user_id, pay_type, commission_rate, salary, standard_sales, position_allowance
    ) VALUES
      ('salary-1', 'salary', 0, 3000000, 0, 0),
      ('commission-1', 'commission', 50, 0, 0, 0),
      ('challenger-1', 'salary', 0, 3000000, 0, 0);
  `);

  const insertSale = sqlite.prepare(`
    INSERT INTO sales_records (
      id, user_id, type, client_name, client_phone, amount, contract_date, deposit_date,
      payment_type, status, confirmed_at, direction, attribution_branch
    ) VALUES (?, ?, '계약', ?, ?, 110000, '2026-09-01', '2026-09-15',
      '이체', 'confirmed', '2026-09-15 10:00:00', 'income', ?)
  `);
  const addSales = (userId: string, start: number, count: number) => {
    for (let index = start; index < start + count; index += 1) {
      insertSale.run(
        `${userId}-${index}`,
        userId,
        `${userId}-고객-${index}`,
        `010-${userId}-${String(index).padStart(4, '0')}`,
        index % 2 ? '부산지사' : '서초지사',
      );
    }
  };
  addSales('salary-1', 1, 12);
  addSales('commission-1', 1, 10);

  const env = { DB: d1FromSqlite(sqlite), JWT_SIGNING_SECRET: JWT_SECRET } as Env;
  const app = new Hono<AuthEnv>();
  app.route('/payroll', payrollRoute);
  const getPayroll = async (userId: string) => {
    const response = await authenticatedRequest(app, env, `/payroll/${userId}?month=2026-09`, { method: 'GET' });
    const text = await response.text();
    assert.equal(response.status, 200, text);
    return JSON.parse(text) as any;
  };
  const savePayroll = async (userId: string, payType: 'salary' | 'commission', response: any) => (
    authenticatedRequest(app, env, '/payroll/save', {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId,
        period: '2026년 9월',
        pay_type: payType,
        data: {
          net_pay: 1,
          payroll_snapshot: {
            month: '2026-09',
            period: '2026년 9월',
            response,
            manual: {},
          },
        },
      }),
    })
  );
  const lockPayroll = (userId: string) => authenticatedRequest(app, env, '/payroll/lock', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, period: '2026년 9월' }),
  });

  const initialSalary = await getPayroll('salary-1');
  const initialCommission = await getPayroll('commission-1');
  assert.equal(initialSalary.is_payout_month, false);
  assert.equal(initialSalary.is_contract_award_month, true);
  assert.equal(initialSalary.contract_award_period_label, '2026년 9월');
  assert.deepEqual(initialSalary.contract_award, {
    rank: 1, count: 12, award: 500000, total_amount: 1320000,
  });
  assert.equal(initialSalary.summary.bonus, 0);
  assert.deepEqual(initialCommission.contract_award, {
    rank: 2, count: 10, award: 300000, total_amount: 1100000,
  });

  for (const invalidNetPay of ['', false, [], null]) {
    const invalidSalaryNet = await authenticatedRequest(app, env, '/payroll/save', {
      method: 'POST',
      body: JSON.stringify({
        user_id: 'salary-1',
        period: '2026년 9월',
        pay_type: 'salary',
        data: {
          net_pay: invalidNetPay,
          payroll_snapshot: {
            month: '2026-09', period: '2026년 9월', response: initialSalary, manual: {},
          },
        },
      }),
    });
    assert.equal(invalidSalaryNet.status, 400, await invalidSalaryNet.text());
  }
  assert.equal(sqlite.prepare("SELECT COUNT(*) FROM payroll_saves WHERE user_id = 'salary-1'").pluck().get(), 0);

  const missingSalaryNet = await authenticatedRequest(app, env, '/payroll/save', {
    method: 'POST',
    body: JSON.stringify({
      user_id: 'salary-1',
      period: '2026년 9월',
      pay_type: 'salary',
      data: {
        payroll_snapshot: {
          month: '2026-09', period: '2026년 9월', response: initialSalary, manual: {},
        },
      },
    }),
  });
  assert.equal(missingSalaryNet.status, 400, await missingSalaryNet.text());
  assert.equal(sqlite.prepare("SELECT COUNT(*) FROM payroll_saves WHERE user_id = 'salary-1'").pluck().get(), 0);

  const forgedSalary = structuredClone(initialSalary);
  forgedSalary.contract_award = { rank: 2, count: 12, award: 300000, total_amount: 1320000 };
  const forgedSalarySave = await savePayroll('salary-1', 'salary', forgedSalary);
  assert.equal(forgedSalarySave.status, 409, await forgedSalarySave.text());
  assert.equal(sqlite.prepare("SELECT COUNT(*) FROM payroll_saves WHERE user_id = 'salary-1'").pluck().get(), 0);

  const initialSalarySave = await savePayroll('salary-1', 'salary', initialSalary);
  assert.equal(initialSalarySave.status, 200, await initialSalarySave.text());
  const initialCommissionSave = await savePayroll('commission-1', 'commission', initialCommission);
  assert.equal(initialCommissionSave.status, 200, await initialCommissionSave.text());
  let storedCommission = JSON.parse(String((sqlite.prepare(
    "SELECT data FROM payroll_saves WHERE user_id = 'commission-1' AND period = '2026년 9월'"
  ).get() as { data: string }).data));
  assert.deepEqual(storedCommission.business_income_settlement, {
    amount: 800000,
    tax: 26400,
    net: 773600,
    contractAward: 300000,
    videoProductionIncome: 0,
  });
  assert.equal(storedCommission.freelancer_settlement.netPay, 773600);

  addSales('commission-1', 11, 3);
  const staleSalaryLock = await lockPayroll('salary-1');
  assert.equal(staleSalaryLock.status, 409, await staleSalaryLock.text());
  const staleCommissionLock = await lockPayroll('commission-1');
  assert.equal(staleCommissionLock.status, 409, await staleCommissionLock.text());
  assert.equal(sqlite.prepare("SELECT SUM(locked) FROM payroll_saves WHERE period = '2026년 9월'").pluck().get(), 0);

  const refreshedSalary = await getPayroll('salary-1');
  const refreshedCommission = await getPayroll('commission-1');
  assert.deepEqual(refreshedSalary.contract_award, {
    rank: 2, count: 12, award: 300000, total_amount: 1320000,
  });
  assert.deepEqual(refreshedCommission.contract_award, {
    rank: 1, count: 13, award: 500000, total_amount: 1430000,
  });
  const refreshedSalarySave = await savePayroll('salary-1', 'salary', refreshedSalary);
  assert.equal(refreshedSalarySave.status, 200, await refreshedSalarySave.text());
  const refreshedCommissionSave = await savePayroll('commission-1', 'commission', refreshedCommission);
  assert.equal(refreshedCommissionSave.status, 200, await refreshedCommissionSave.text());
  const tamperedSalaryData = JSON.parse(String((sqlite.prepare(
    "SELECT data FROM payroll_saves WHERE user_id = 'salary-1' AND period = '2026년 9월'"
  ).get() as { data: string }).data));
  tamperedSalaryData.net_pay = '';
  sqlite.prepare("UPDATE payroll_saves SET data = ? WHERE user_id = 'salary-1' AND period = '2026년 9월'")
    .run(JSON.stringify(tamperedSalaryData));
  const invalidSalaryLock = await lockPayroll('salary-1');
  assert.equal(invalidSalaryLock.status, 409, await invalidSalaryLock.text());
  const restoredSalarySave = await savePayroll('salary-1', 'salary', refreshedSalary);
  assert.equal(restoredSalarySave.status, 200, await restoredSalarySave.text());
  const salaryLock = await lockPayroll('salary-1');
  assert.equal(salaryLock.status, 200, await salaryLock.text());
  const commissionLock = await lockPayroll('commission-1');
  assert.equal(commissionLock.status, 200, await commissionLock.text());

  storedCommission = JSON.parse(String((sqlite.prepare(
    "SELECT data FROM payroll_saves WHERE user_id = 'commission-1' AND period = '2026년 9월'"
  ).get() as { data: string }).data));
  assert.deepEqual(storedCommission.business_income_settlement, {
    amount: 1150000,
    tax: 37950,
    net: 1112050,
    contractAward: 500000,
    videoProductionIncome: 0,
  });

  // 구형 ISO 기간키로 남은 잠긴 정산도 메인 조회와 사업소득 신고에서 같은 동결값을 읽는다.
  sqlite.prepare("UPDATE payroll_saves SET period = '2026-09' WHERE user_id = 'commission-1'").run();

  addSales('challenger-1', 1, 20);
  const frozenSalary = await getPayroll('salary-1');
  const frozenCommission = await getPayroll('commission-1');
  assert.equal(frozenSalary.is_snapshot, true);
  assert.deepEqual(frozenSalary.contract_award, refreshedSalary.contract_award);
  assert.equal(frozenCommission.is_snapshot, true);
  assert.deepEqual(frozenCommission.contract_award, refreshedCommission.contract_award);

  const businessIncomeResponse = await authenticatedRequest(
    app,
    env,
    '/payroll/reports/business-income?month=2026-09',
    { method: 'GET' },
  );
  const businessIncomeText = await businessIncomeResponse.text();
  assert.equal(businessIncomeResponse.status, 200, businessIncomeText);
  const businessIncome = JSON.parse(businessIncomeText) as any;
  const commissionEntry = businessIncome.entries.find((entry: any) => entry.user_id === 'commission-1');
  assert.deepEqual({
    amount: commissionEntry.amount,
    tax: commissionEntry.tax,
    net_amount: commissionEntry.net_amount,
  }, {
    amount: 1150000,
    tax: 37950,
    net_amount: 1112050,
  });
});
