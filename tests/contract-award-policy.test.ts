import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import {
  calculateContractCountFromRows,
  contractAwardAmountForRank,
  getContractAwardPeriod,
  rankContractAwardCandidates,
  rankContractPerformanceCandidates,
} from '../src/shared/contract-award.ts';
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

const {
  calculateContractAwardForUser,
  isContractAwardRecipient,
  loadCompanyContractRanking,
  loadLegacyBranchContractRanking,
} = await import('../src/worker/lib/contract-award-ranking.ts');
const [{ default: salesRoute }, { createToken }] = await Promise.all([
  import('../src/worker/routes/sales.ts'),
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
  return { prepare: (sql: string) => prepare(sql) } as unknown as D1Database;
}

test('2026-08까지 기존 짝수월 2개월제, 2026-09부터 당월제를 적용한다', () => {
  assert.deepEqual(getContractAwardPeriod('2026-08'), {
    month: '2026-08',
    cadence: 'bimonthly',
    isAwardMonth: true,
    startMonth: '2026-07',
    endMonth: '2026-08',
    startDate: '2026-07-01',
    endDate: '2026-08-31',
    label: '2026년 7~8월',
  });
  assert.equal(getContractAwardPeriod('2026-07').isAwardMonth, false);
  assert.deepEqual(getContractAwardPeriod('2026-09'), {
    month: '2026-09',
    cadence: 'monthly',
    isAwardMonth: true,
    startMonth: '2026-09',
    endMonth: '2026-09',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    label: '2026년 9월',
  });
  assert.equal(getContractAwardPeriod('2026-10').startMonth, '2026-10');
  assert.throws(() => getContractAwardPeriod('2026-13'), /INVALID_CONTRACT_AWARD_MONTH/);
});

test('등수·최소건수 경계에서 구 정책과 신 정책 포상액을 정확히 구분한다', () => {
  assert.deepEqual([1, 2, 3, 4].map((rank) => contractAwardAmountForRank('2026-08', rank, 10)), [
    300_000, 200_000, 100_000, 0,
  ]);
  assert.deepEqual([1, 2, 3, 4].map((rank) => contractAwardAmountForRank('2026-09', rank, 10)), [
    500_000, 300_000, 0, 0,
  ]);
  assert.equal(contractAwardAmountForRank('2026-09', 1, 9), 0);
  assert.equal(contractAwardAmountForRank('2026-07', 1, 20), 0);
});

test('신 정책은 건수와 금액이 모두 같으면 공동순위, 금액이 다르면 금액순을 적용한다', () => {
  const exactTie = rankContractAwardCandidates('2026-09', [
    { user_id: 'b', count: 12, total_amount: 12_000_000 },
    { user_id: 'a', count: 12, total_amount: 12_000_000 },
    { user_id: 'c', count: 11, total_amount: 20_000_000 },
  ]);
  assert.deepEqual(exactTie.map(({ user_id, rank, award }) => ({ user_id, rank, award })), [
    { user_id: 'a', rank: 1, award: 500_000 },
    { user_id: 'b', rank: 1, award: 500_000 },
    { user_id: 'c', rank: 3, award: 0 },
  ]);

  const amountTieBreaker = rankContractAwardCandidates('2026-09', [
    { user_id: 'lower', count: 10, total_amount: 10_000_000 },
    { user_id: 'higher', count: 10, total_amount: 11_000_000 },
  ]);
  assert.deepEqual(amountTieBreaker.map(({ user_id, rank, award }) => ({ user_id, rank, award })), [
    { user_id: 'higher', rank: 1, award: 500_000 },
    { user_id: 'lower', rank: 2, award: 300_000 },
  ]);

  const legacyExactTie = rankContractAwardCandidates('2026-08', [
    { user_id: 'b', count: 10, total_amount: 10_000_000 },
    { user_id: 'a', count: 10, total_amount: 10_000_000 },
  ]);
  assert.deepEqual(legacyExactTie.map(({ user_id, rank, award }) => ({ user_id, rank, award })), [
    { user_id: 'a', rank: 1, award: 300_000 },
    { user_id: 'b', rank: 2, award: 200_000 },
  ]);
});

test('10건 미만도 매출 순위에는 보이되 계약포상은 지급하지 않는다', () => {
  const ranking = rankContractPerformanceCandidates([
    { user_id: 'u9', count: 9, total_amount: 9_000_000 },
    { user_id: 'u8', count: 8, total_amount: 8_000_000 },
  ]);
  assert.deepEqual(ranking.map(({ user_id, rank }) => ({ user_id, rank })), [
    { user_id: 'u9', rank: 1 },
    { user_id: 'u8', rank: 2 },
  ]);
  assert.equal(contractAwardAmountForRank('2026-09', ranking[0].rank, ranking[0].count), 0);
});

test('매출 표시 랭킹은 기존처럼 기간과 무관하게 공동순위를 사용한다', () => {
  const candidates = [
    { user_id: 'b', count: 9, total_amount: 9_000_000 },
    { user_id: 'a', count: 9, total_amount: 9_000_000 },
    { user_id: 'c', count: 8, total_amount: 8_000_000 },
  ];
  assert.deepEqual(
    rankContractPerformanceCandidates(candidates).map(({ user_id, rank }) => ({ user_id, rank })),
    [
      { user_id: 'a', rank: 1 },
      { user_id: 'b', rank: 1 },
      { user_id: 'c', rank: 3 },
    ],
  );
});

test('고객별 합산·220만원 2건·제외 규칙은 기존 계약건수 산식을 유지한다', () => {
  assert.equal(calculateContractCountFromRows([
    { id: 'a1', type: '계약', status: 'confirmed', client_name: '고객', client_phone: '010-1111-2222', amount: 1_100_000 },
    { id: 'a2', type: '계약', status: 'confirmed', client_name: ' 고객 ', client_phone: '010 1111 2222', amount: 1_100_000 },
    { id: 'b', type: '계약', status: 'confirmed', client_name: '다른고객', client_phone: '010-3333-4444', amount: 100_000 },
    { id: 'excluded', type: '계약', status: 'confirmed', client_name: '제외', client_phone: '010-5555-6666', amount: 3_000_000, exclude_from_count: 1 },
    { id: 'pending', type: '계약', status: 'pending', client_name: '대기', client_phone: '010-7777-8888', amount: 3_000_000 },
  ]), 3);
});

test('9월 전사 순위는 귀속지사가 여러 개인 담당자를 한 행으로 합치고 비수령자가 등수를 차지하지 않는다', async (t) => {
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, branch TEXT NOT NULL DEFAULT '',
      position_title TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'member'
    );
    CREATE TABLE sales_records (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      client_name TEXT NOT NULL DEFAULT '', client_phone TEXT NOT NULL DEFAULT '',
      amount INTEGER NOT NULL DEFAULT 0, exclude_from_count INTEGER NOT NULL DEFAULT 0,
      direction TEXT NOT NULL DEFAULT 'income', status TEXT NOT NULL DEFAULT 'confirmed',
      payment_type TEXT NOT NULL DEFAULT '이체', card_deposit_date TEXT NOT NULL DEFAULT '',
      deposit_date TEXT NOT NULL DEFAULT '', contract_date TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '', attribution_branch TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO users (id, name, branch, position_title, role) VALUES
      ('hq', '본사', '본사관리', '', 'member'),
      ('acct', '총무', '서초지사', '', 'accountant'),
      ('eligible-a', 'A', '부산지사', '매니저', 'manager'),
      ('eligible-b', 'B', '서초지사', '컨설턴트', 'member'),
      ('date-rules', '날짜규칙', '의정부지사', '컨설턴트', 'member');
  `);
  const insert = sqlite.prepare(`
    INSERT INTO sales_records (
      id, user_id, type, client_name, client_phone, amount,
      payment_type, deposit_date, contract_date, attribution_branch
    ) VALUES (?, ?, '계약', ?, ?, ?, '이체', '2026-09-15', '2026-09-01', ?)
  `);
  const add = (userId: string, count: number, amount: number) => {
    for (let index = 1; index <= count; index += 1) {
      insert.run(
        `${userId}-${index}`,
        userId,
        `${userId}-고객-${index}`,
        `010-${String(index).padStart(4, '0')}-${userId.length}${index}`,
        amount,
        index % 2 ? '부산지사' : '서초지사',
      );
    }
  };
  add('hq', 20, 1_000_000);
  add('acct', 18, 1_000_000);
  add('eligible-a', 12, 1_000_000);
  add('eligible-b', 10, 1_000_000);
  const insertDateRule = sqlite.prepare(`
    INSERT INTO sales_records (
      id, user_id, type, client_name, client_phone, amount, payment_type,
      card_deposit_date, deposit_date, contract_date, direction
    ) VALUES (?, 'date-rules', '계약', ?, ?, 100000, ?, ?, ?, ?, ?)
  `);
  insertDateRule.run('date-card-in', '카드안', '010-1000-0001', '카드', '2026-09-01', '2026-08-31', '2026-08-31', 'income');
  insertDateRule.run('date-card-out', '카드밖', '010-1000-0002', '카드', '2026-10-01', '2026-09-15', '2026-09-15', 'income');
  insertDateRule.run('date-transfer-in', '이체안', '010-1000-0003', '이체', '', '2026-09-30', '2026-08-31', 'income');
  insertDateRule.run('date-transfer-blank', '이체빈날짜', '010-1000-0004', '이체', '', '', '2026-09-15', 'income');
  insertDateRule.run('date-unspecified', '미지정', '010-1000-0005', '', '', '2026-08-31', '2026-09-15', 'income');
  insertDateRule.run('date-expense-card', '비용카드', '010-1000-0006', '카드', '2026-09-20', '2026-08-31', '2026-08-31', 'expense');

  const db = d1FromSqlite(sqlite);
  const raw = await loadCompanyContractRanking(db, '2026-09-01', '2026-09-30');
  assert.equal(raw.filter((row) => row.user_id === 'eligible-a').length, 1);
  assert.equal(raw.find((row) => row.user_id === 'eligible-a')?.count, 12);
  assert.equal(raw.find((row) => row.user_id === 'date-rules')?.count, 4);
  assert.equal(isContractAwardRecipient(raw.find((row) => row.user_id === 'hq')!), false);
  assert.equal(isContractAwardRecipient(raw.find((row) => row.user_id === 'acct')!), false);
  assert.deepEqual(await calculateContractAwardForUser(db, 'eligible-a', '2026-09'), {
    rank: 1, count: 12, award: 500_000, total_amount: 12_000_000,
  });
  assert.deepEqual(await calculateContractAwardForUser(db, 'eligible-b', '2026-09'), {
    rank: 2, count: 10, award: 300_000, total_amount: 10_000_000,
  });

  sqlite.exec(`
    INSERT INTO sales_records (
      id, user_id, type, client_name, client_phone, amount,
      payment_type, deposit_date, contract_date, branch, attribution_branch
    ) VALUES
      ('legacy-branch-a', 'eligible-a', '계약', '과거고객A', '010-2000-0001', 100000,
        '이체', '2026-08-10', '2026-08-01', '부산지사', '부산지사'),
      ('legacy-branch-b', 'eligible-a', '계약', '과거고객B', '010-2000-0002', 100000,
        '이체', '2026-08-10', '2026-08-01', '부산지사', '서초지사');
  `);
  const legacyBranchRows = await loadLegacyBranchContractRanking(db, '2026-07-01', '2026-08-31');
  assert.deepEqual(
    legacyBranchRows.filter((row) => row.user_id === 'eligible-a').map((row) => row.eff_branch).sort(),
    ['부산지사', '서초지사'],
  );
  const companyRows = await loadCompanyContractRanking(db, '2026-07-01', '2026-08-31');
  assert.equal(companyRows.filter((row) => row.user_id === 'eligible-a').length, 1);
});

test('9월 매출 랭킹 API는 다중 귀속지사를 한 카드로 합치고 10건 미만 1·2·3위도 숨기지 않는다', async (t) => {
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT '', name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member', team_id TEXT, branch TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL DEFAULT '', position_title TEXT NOT NULL DEFAULT '',
      login_type TEXT NOT NULL DEFAULT 'employee', approved INTEGER NOT NULL DEFAULT 1,
      auth_version INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE sales_records (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      client_name TEXT NOT NULL DEFAULT '', client_phone TEXT NOT NULL DEFAULT '',
      amount INTEGER NOT NULL DEFAULT 0, exclude_from_count INTEGER NOT NULL DEFAULT 0,
      direction TEXT NOT NULL DEFAULT 'income', status TEXT NOT NULL DEFAULT 'confirmed',
      payment_type TEXT NOT NULL DEFAULT '이체', card_deposit_date TEXT NOT NULL DEFAULT '',
      deposit_date TEXT NOT NULL DEFAULT '', contract_date TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '', attribution_branch TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO users (id, email, name, role, branch, department, position_title) VALUES
      ('viewer', 'viewer@example.com', '마스터', 'master', '본사관리', '경영지원', '마스터'),
      ('u9', 'u9@example.com', '9건', 'member', '부산지사', '컨설팅', '컨설턴트'),
      ('u8', 'u8@example.com', '8건', 'member', '서초지사', '컨설팅', '컨설턴트'),
      ('u7', 'u7@example.com', '7건', 'member', '의정부지사', '컨설팅', '컨설턴트');
  `);
  const insert = sqlite.prepare(`
    INSERT INTO sales_records (
      id, user_id, type, client_name, client_phone, amount,
      payment_type, deposit_date, contract_date, attribution_branch
    ) VALUES (?, ?, '계약', ?, ?, 1000000, '이체', '2026-09-10', '2026-09-01', ?)
  `);
  for (const [userId, count] of [['u9', 9], ['u8', 8], ['u7', 7]] as const) {
    for (let index = 1; index <= count; index += 1) {
      insert.run(
        `${userId}-${index}`,
        userId,
        `${userId}-고객-${index}`,
        `010-${userId}-${index}`,
        index % 2 ? '부산지사' : '서초지사',
      );
    }
  }

  const env = {
    DB: d1FromSqlite(sqlite),
    JWT_SIGNING_SECRET: 'contract-award-ranking-route-secret-123456789',
  } as Env;
  const payload: JwtPayload = {
    sub: 'viewer',
    email: 'viewer@example.com',
    name: '마스터',
    phone: '',
    role: 'master',
    branch: '본사관리',
    department: '경영지원',
    auth_version: 0,
  };
  const token = await createToken(payload, env);
  const app = new Hono<AuthEnv>();
  app.route('/sales', salesRoute);
  const response = await app.request(
    '/sales/ranking?period_start=2026-09&period_end=2026-09',
    { headers: { Authorization: `Bearer ${token}` } },
    env,
  );
  const responseText = await response.text();
  assert.equal(response.status, 200, responseText);
  const ranking = (JSON.parse(responseText) as any).ranking;
  assert.deepEqual(ranking.map((row: any) => ({
    user_id: row.user_id,
    rank: row.rank,
    count: row.count,
  })), [
    { user_id: 'u9', rank: 1, count: 9 },
    { user_id: 'u8', rank: 2, count: 8 },
    { user_id: 'u7', rank: 3, count: 7 },
  ]);
  assert.equal(ranking.every((row: any) => row.award === undefined), true);
  assert.equal(ranking.every((row: any) => row.eligible === undefined), true);
  assert.equal(ranking.every((row: any) => row.role === undefined), true);
  assert.equal(ranking.filter((row: any) => row.user_id === 'u9').length, 1);

  const insertLegacy = sqlite.prepare(`
    INSERT INTO sales_records (
      id, user_id, type, client_name, client_phone, amount,
      payment_type, deposit_date, contract_date, branch, attribution_branch
    ) VALUES (?, ?, '계약', ?, ?, 1000000, '이체', '2026-08-10', '2026-08-01', ?, ?)
  `);
  for (const [userId, count, branch] of [
    ['u9', 3, '부산지사'],
    ['u8', 3, '서초지사'],
    ['u7', 2, '의정부지사'],
  ] as const) {
    for (let index = 1; index <= count; index += 1) {
      insertLegacy.run(
        `legacy-${userId}-${index}`,
        userId,
        `legacy-${userId}-고객-${index}`,
        `010-legacy-${userId}-${index}`,
        branch,
        branch,
      );
    }
  }
  const legacyResponse = await app.request(
    '/sales/ranking?period_start=2026-07&period_end=2026-08',
    { headers: { Authorization: `Bearer ${token}` } },
    env,
  );
  const legacyText = await legacyResponse.text();
  assert.equal(legacyResponse.status, 200, legacyText);
  const legacyRanking = (JSON.parse(legacyText) as any).ranking;
  assert.deepEqual(
    legacyRanking.map((row: any) => ({ user_id: row.user_id, rank: row.rank, count: row.count })),
    [
      { user_id: 'u8', rank: 1, count: 3 },
      { user_id: 'u9', rank: 1, count: 3 },
      { user_id: 'u7', rank: 3, count: 2 },
    ],
  );
});
