import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import {
  applyFreelancerSettlementToSaveData,
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

const [{ default: payrollRoute }, { createToken }] = await Promise.all([
  import('../src/worker/routes/payroll.ts'),
  import('../src/worker/middleware/auth.ts'),
]);

type D1Statement = D1PreparedStatement & { run(): Promise<D1Result> };

function d1FromSqlite(sqlite: Database.Database): D1Database {
  const prepare = (sql: string, params: unknown[] = []): D1Statement => ({
    bind: (...values: unknown[]) => prepare(sql, values),
    all: async <T>() => ({ results: sqlite.prepare(sql).all(...params) as T[] }),
    first: async <T>() => (sqlite.prepare(sql).get(...params) as T | undefined) || null,
    run: async () => {
      const result = sqlite.prepare(sql).run(...params);
      return { success: true, meta: { changes: result.changes } } as unknown as D1Result;
    },
  } as D1Statement);
  return {
    prepare: (sql: string) => prepare(sql),
    batch: async (statements: D1PreparedStatement[]) => {
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
    taxableExtraIncome: 100_000,
    taxExemptIncome: 50_000,
    preTaxDeduction: 20_000,
    postTaxDeduction: 30_000,
  });

  assert.deepEqual(result, {
    settlementIncome: 1_000_000,
    contractAward: 300_000,
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

test('POST save는 위조한 client net을 서버 산식으로 덮고 lock은 그 음수액만 익월 이월한다', async () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL, team_id TEXT, branch TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '',
      position_title TEXT NOT NULL DEFAULT '',
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
      direction TEXT NOT NULL DEFAULT 'income', external_id TEXT
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
  `);
  const insertSale = sqlite.prepare(`
    INSERT INTO sales_records (
      id, user_id, type, client_name, client_phone, amount, contract_date, deposit_date,
      payment_type, status, confirmed_at, direction
    ) VALUES (?, 'freelancer-1', '계약', ?, ?, 110000, '2026-08-01', '2026-08-01',
      '이체', 'confirmed', '2026-08-01 10:00:00', 'income')
  `);
  for (let index = 1; index <= 10; index += 1) {
    insertSale.run(`sale-${index}`, `고객${index}`, `010-0000-${String(index).padStart(4, '0')}`);
  }

  const db = d1FromSqlite(sqlite);
  const env = { DB: db, JWT_SIGNING_SECRET: JWT_SECRET } as Env;
  const app = new Hono<AuthEnv>();
  app.route('/payroll', payrollRoute);
  const savePayload = {
    user_id: 'freelancer-1',
    period: '2026년 8월',
    pay_type: 'commission',
    data: {
      settle_month: '2099-12',
      net_pay: 1,
      commDeductions: [{ label: '기타 공제', amount: '900000' }],
      payroll_snapshot: {
        month: '2026-08',
        period: '2026년 8월',
        response: {
          accounting: { pay_type: 'commission', commission_rate: 50 },
          records: [],
          is_payout_month: true,
          contract_award: { rank: 1, count: 10, award: 300000, total_amount: 1100000 },
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
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM payroll_saves').pluck().get(), 0);

  const saveResponse = await authenticatedRequest(app, env, '/payroll/save', {
    method: 'POST',
    body: JSON.stringify(savePayload),
  });
  assert.equal(saveResponse.status, 200, await saveResponse.text());

  const stored = JSON.parse(String((sqlite.prepare(
    "SELECT data FROM payroll_saves WHERE user_id = 'freelancer-1' AND period = '2026년 8월'"
  ).get() as { data: string }).data));
  assert.equal(stored.settle_month, '2026-08');
  assert.equal(stored.freelancer_settlement.settlementIncome, 500000);
  assert.equal(stored.freelancer_settlement.contractAward, 300000);
  assert.equal(stored.freelancer_settlement.withholdingTax, 26400);
  assert.equal(stored.net_pay, -126400);
  assert.deepEqual(stored.business_income_settlement, {
    amount: 800000,
    tax: 26400,
    net: 773600,
    contractAward: 300000,
  });
  assert.equal(stored.payroll_snapshot.manual.net_pay, -126400);
  assert.equal(stored.payroll_snapshot.response.records.length, 10);

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
    amount: 126400,
    status: 'pending',
  });

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
    [{ user_id: 'freelancer-1', amount: 800000, tax: 26400, net_amount: 773600 }],
  );
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
  });

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
