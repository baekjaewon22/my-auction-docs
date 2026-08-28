import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import {
  canManageAuctionBidResult,
  inspectionMaterializedBidId,
  JEONG_MINHO_AUCTION_RESULT_USER_ID,
} from '../src/shared/auction-bid-result-access.ts';
import { createToken } from '../src/worker/middleware/auth.ts';
import auctionSchedule from '../src/worker/routes/auction-schedule.ts';
import type { AuthEnv, JwtPayload, Role } from '../src/worker/types.ts';

type D1Statement = D1PreparedStatement & { run(): Promise<D1Result> };

function d1FromSqlite(sqlite: Database.Database): D1Database {
  const prepare = (sql: string, params: unknown[] = []): D1Statement => {
    const statement = sqlite.prepare(sql);
    return {
      bind: (...values: unknown[]) => prepare(sql, values),
      all: async <T>() => ({ results: statement.all(...params) as T[] }),
      first: async <T>() => (statement.get(...params) as T | undefined) || null,
      run: async () => {
        const result = statement.run(...params);
        return { success: true, meta: { changes: result.changes } } as unknown as D1Result;
      },
    } as D1Statement;
  };
  return {
    prepare: (sql: string) => prepare(sql),
    batch: async (statements: D1PreparedStatement[]) => {
      const results: D1Result[] = [];
      for (const statement of statements) results.push(await (statement as D1Statement).run());
      return results;
    },
  } as unknown as D1Database;
}

const JWT_SECRET = 'auction-bid-result-access-test-secret-1234567890';

function setup() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT '', name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '', role TEXT NOT NULL, team_id TEXT,
      branch TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '',
      position_title TEXT NOT NULL DEFAULT '', login_type TEXT NOT NULL DEFAULT 'employee',
      approved INTEGER NOT NULL DEFAULT 1, auth_version INTEGER NOT NULL DEFAULT 0,
      alimtalk_branches TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE freelancer_auction_schedules (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, target_date TEXT NOT NULL,
      activity_type TEXT NOT NULL, activity_subtype TEXT NOT NULL DEFAULT '',
      data TEXT NOT NULL DEFAULT '{}', branch TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
    );
    CREATE INDEX idx_freelancer_schedule_user_date ON freelancer_auction_schedules(user_id, target_date);
    CREATE INDEX idx_freelancer_schedule_scope_date ON freelancer_auction_schedules(branch, department, target_date);
    CREATE TABLE sales_records (
      id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending', amount INTEGER NOT NULL DEFAULT 0,
      winning_price INTEGER NOT NULL DEFAULT 0, external_id TEXT
    );
    CREATE TABLE commissions (
      id TEXT PRIMARY KEY, journal_entry_id TEXT, status TEXT NOT NULL DEFAULT 'pending', win_price TEXT
    );
  `);
  const insertUser = sqlite.prepare(`
    INSERT INTO users (id, email, name, role, branch, department, login_type)
    VALUES (?, ?, ?, ?, '의정부지사', '경매사업부', ?)
  `);
  const users: Array<[string, string, Role, string]> = [
    ['owner', '담당자', 'member', 'employee'],
    ['other-owner', '다른 담당자', 'member', 'freelancer'],
    ['master', '마스터', 'master', 'employee'],
    ['accountant', '총무담당', 'accountant', 'employee'],
    [JEONG_MINHO_AUCTION_RESULT_USER_ID, '정민호', 'admin', 'employee'],
    ['ceo', '대표', 'ceo', 'employee'],
    ['cc', '참조', 'cc_ref', 'employee'],
    ['admin', '일반 관리자', 'admin', 'employee'],
    ['asst', '총무보조', 'accountant_asst', 'employee'],
  ];
  for (const [id, name, role, loginType] of users) {
    insertUser.run(id, `${id}@example.com`, name, role, loginType);
  }
  const baseData = {
    court: '의정부지방법원', caseNo: '2026 타경 1234', itemNo: '1',
    client: '홍길동', propertyCategory: '주거', propertyType: '아파트',
    memo: '노출되면 안 되는 내부 메모', suggestedPrice: '', bidPrice: '', winPrice: '',
  };
  sqlite.prepare(`
    INSERT INTO freelancer_auction_schedules
      (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
    VALUES ('bid-1', 'owner', '2000-01-01', '입찰', '2026타경1234', ?, '의정부지사', '경매사업부')
  `).run(JSON.stringify(baseData));
  const db = d1FromSqlite(sqlite);
  const env = { DB: db, JWT_SIGNING_SECRET: JWT_SECRET } as Env;
  const app = new Hono<AuthEnv>().route('/api/auction-schedule', auctionSchedule);

  async function token(id: string): Promise<string> {
    const row = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    const payload: JwtPayload = {
      sub: row.id, email: row.email, name: row.name, phone: row.phone,
      role: row.role, team_id: null, branch: row.branch, department: row.department,
      position_title: row.position_title, login_type: row.login_type, auth_version: 0,
    };
    return createToken(payload, env);
  }

  async function request(id: string, path: string, method = 'GET', body?: unknown) {
    return app.request(`/api/auction-schedule${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await token(id)}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env);
  }
  return { sqlite, request };
}

const failedResult = {
  result: 'failed', suggested_price: 100_000_000,
  actual_bid_price: 90_000_000, winning_price: 110_000_000,
};

test('입찰 결과 전용 권한은 담당자·마스터·총무·정민호에게만 열린다', () => {
  assert.equal(canManageAuctionBidResult({ id: 'owner', role: 'member' }, 'owner'), true);
  assert.equal(canManageAuctionBidResult({ id: 'master', role: 'master' }, 'owner'), true);
  assert.equal(canManageAuctionBidResult({ id: 'accountant', role: 'accountant' }, 'owner'), true);
  assert.equal(canManageAuctionBidResult({ id: JEONG_MINHO_AUCTION_RESULT_USER_ID, role: 'admin' }, 'owner'), true);
  for (const role of ['ceo', 'cc_ref', 'admin', 'accountant_asst', 'support']) {
    assert.equal(canManageAuctionBidResult({ id: `not-${role}`, role }, 'owner'), false, role);
  }
});

test('담당자 로그인 유형과 무관하게 결과 입력이 가능하고 지정 관리자만 타인 결과를 입력한다', async () => {
  const { sqlite, request } = setup();
  for (const id of ['owner', 'master', 'accountant', JEONG_MINHO_AUCTION_RESULT_USER_ID]) {
    const response = await request(id, '/bid-1/bid-result', 'POST', failedResult);
    assert.equal(response.status, 200, `${id}: ${await response.clone().text()}`);
    const payload = await response.json() as any;
    assert.equal(payload.schedule_id, 'bid-1');
  }
  for (const id of ['other-owner', 'ceo', 'cc', 'admin', 'asst']) {
    const response = await request(id, '/bid-1/bid-result', 'POST', failedResult);
    assert.equal(response.status, 403, id);
  }
  const stored = JSON.parse((sqlite.prepare("SELECT data FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get() as string));
  assert.equal(stored.bidFailed, true);
  sqlite.close();
});

test('결과 편집 조회는 최소 DTO만 반환하며 내부 메모를 직렬화하지 않는다', async () => {
  const { sqlite, request } = setup();
  const response = await request('accountant', '/bid-1/bid-result-entry');
  assert.equal(response.status, 200);
  const payload = await response.json() as any;
  assert.deepEqual(Object.keys(payload.entry).sort(), [
    'activity_subtype', 'data', 'id', 'target_date', 'user_id', 'user_name',
  ]);
  const data = JSON.parse(payload.entry.data);
  assert.equal(data.client, '홍길동');
  assert.equal(data.memo, undefined);
  assert.equal(data.place, undefined);
  assert.equal((await request('admin', '/bid-1/bid-result-entry')).status, 403);
  sqlite.close();
});

test('과거 일정도 결과 전용 처리는 유지하며 정민호 위임은 일반 PUT·DELETE 권한을 늘리지 않는다', async () => {
  const { sqlite, request } = setup();
  const prices = await request(JEONG_MINHO_AUCTION_RESULT_USER_ID, '/bid-1/bid-prices', 'PUT', {
    suggested_price: 100_000_000,
  });
  assert.equal(prices.status, 200, await prices.clone().text());
  const result = await request(JEONG_MINHO_AUCTION_RESULT_USER_ID, '/bid-1/bid-result', 'POST', failedResult);
  assert.equal(result.status, 200, await result.clone().text());
  const put = await request(JEONG_MINHO_AUCTION_RESULT_USER_ID, '/bid-1', 'PUT', { activity_subtype: '변경 시도' });
  const remove = await request(JEONG_MINHO_AUCTION_RESULT_USER_ID, '/bid-1', 'DELETE');
  assert.equal(put.status, 403);
  assert.equal(remove.status, 403);
  assert.ok(sqlite.prepare("SELECT id FROM freelancer_auction_schedules WHERE id = 'bid-1'").get());
  sqlite.close();
});

test('임장 source 결과 입력은 실제 입찰 일정을 결정적으로 한 번만 생성하고 재사용한다', async () => {
  const { sqlite, request } = setup();
  const inspectionData = {
    court: ' 의정부지방법원 ', caseNo: '2026 타경 7777', itemNo: '2번',
    client: '김고객', propertyCategory: '주거', propertyType: '아파트',
    bidDate: '2026-08-25', memo: '임장 내부 메모',
  };
  sqlite.prepare(`
    INSERT INTO freelancer_auction_schedules
      (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
    VALUES ('inspection-1', 'owner', '2026-08-20', '임장', '2026타경7777', ?, '의정부지사', '경매사업부')
  `).run(JSON.stringify(inspectionData));

  const first = await request('accountant', '/inspection-1/bid-result', 'POST', failedResult);
  assert.equal(first.status, 200, await first.clone().text());
  const firstPayload = await first.json() as any;
  assert.equal(firstPayload.schedule_id, inspectionMaterializedBidId('inspection-1'));
  const second = await request('owner', '/inspection-1/bid-result', 'POST', failedResult);
  assert.equal(second.status, 200, await second.clone().text());
  assert.equal((await second.json() as any).schedule_id, firstPayload.schedule_id);
  assert.equal(sqlite.prepare("SELECT count(*) FROM freelancer_auction_schedules WHERE activity_type = '입찰' AND user_id = 'owner' AND target_date = '2026-08-25'").pluck().get(), 1);
  const created = sqlite.prepare('SELECT * FROM freelancer_auction_schedules WHERE id = ?').get(firstPayload.schedule_id) as any;
  assert.equal(created.activity_type, '입찰');
  assert.equal(JSON.parse(created.data).bidFailed, true);

  sqlite.prepare(`
    INSERT INTO freelancer_auction_schedules
      (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
    VALUES ('inspection-invalid', 'owner', '2026-08-20', '임장', '', ?, '의정부지사', '경매사업부')
  `).run(JSON.stringify({ ...inspectionData, caseNo: '2026타경8888', bidDate: '' }));
  const invalid = await request('owner', '/inspection-invalid/bid-result', 'POST', failedResult);
  assert.equal(invalid.status, 400);
  assert.equal(sqlite.prepare("SELECT count(*) FROM freelancer_auction_schedules WHERE id = ?").pluck().get(inspectionMaterializedBidId('inspection-invalid')), 0);
  sqlite.close();
});

test('임장 source는 동일 담당자·입찰일·사건의 기존 실제 입찰 행을 우선 재사용한다', async () => {
  const { sqlite, request } = setup();
  const source = {
    court: '서울 중앙 지방법원', caseNo: '2026 타경 9999', itemNo: '3번',
    client: '박고객', propertyCategory: '주거', propertyType: '연립', bidDate: '2026-08-27',
  };
  sqlite.prepare(`INSERT INTO freelancer_auction_schedules
    (id,user_id,target_date,activity_type,activity_subtype,data,branch,department)
    VALUES ('inspection-reuse','owner','2026-08-21','임장','',?,'의정부지사','경매사업부')`).run(JSON.stringify(source));
  sqlite.prepare(`INSERT INTO freelancer_auction_schedules
    (id,user_id,target_date,activity_type,activity_subtype,data,branch,department)
    VALUES ('existing-bid','owner','2026-08-27','입찰','',?,'의정부지사','경매사업부')`).run(JSON.stringify({
      ...source, court: '서울중앙지방법원', caseNo: '2026타경9999', itemNo: '3', bidDate: undefined,
    }));

  const response = await request(JEONG_MINHO_AUCTION_RESULT_USER_ID, '/inspection-reuse/bid-result', 'POST', failedResult);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json() as any).schedule_id, 'existing-bid');
  assert.equal(sqlite.prepare("SELECT count(*) FROM freelancer_auction_schedules WHERE activity_type = '입찰' AND target_date = '2026-08-27'").pluck().get(), 1);
  assert.equal(sqlite.prepare('SELECT count(*) FROM freelancer_auction_schedules WHERE id = ?').pluck().get(inspectionMaterializedBidId('inspection-reuse')), 0);
  sqlite.close();
});

test('임장 source 입찰가 저장도 실제 입찰 일정을 한 번만 만들고 schedule_id를 반환한다', async () => {
  const { sqlite, request } = setup();
  const inspection = {
    court: '의정부지방법원', caseNo: '2026타경5555', itemNo: '1',
    client: '최고객', propertyCategory: '상업', propertyType: '근린상가', bidDate: '2026-08-29',
  };
  sqlite.prepare(`INSERT INTO freelancer_auction_schedules
    (id,user_id,target_date,activity_type,activity_subtype,data,branch,department)
    VALUES ('inspection-price','owner','2026-08-22','임장','',?,'의정부지사','경매사업부')`).run(JSON.stringify(inspection));

  const first = await request('accountant', '/inspection-price/bid-prices', 'PUT', { suggested_price: 88_000_000 });
  assert.equal(first.status, 200, await first.clone().text());
  const firstPayload = await first.json() as any;
  assert.equal(firstPayload.schedule_id, inspectionMaterializedBidId('inspection-price'));
  const second = await request('owner', '/inspection-price/bid-prices', 'PUT', {
    suggested_price: 88_000_000, actual_bid_price: 87_000_000,
  });
  assert.equal(second.status, 200, await second.clone().text());
  assert.equal((await second.json() as any).schedule_id, firstPayload.schedule_id);
  assert.equal(sqlite.prepare("SELECT count(*) FROM freelancer_auction_schedules WHERE activity_type = '입찰' AND target_date = '2026-08-29'").pluck().get(), 1);
  const savedData = JSON.parse(sqlite.prepare('SELECT data FROM freelancer_auction_schedules WHERE id = ?').pluck().get(firstPayload.schedule_id) as string);
  assert.equal(savedData.suggestedPrice, '88000000');
  assert.equal(savedData.bidPrice, '87000000');

  sqlite.prepare(`INSERT INTO freelancer_auction_schedules
    (id,user_id,target_date,activity_type,activity_subtype,data,branch,department)
    VALUES ('inspection-empty-price','owner','2026-08-22','임장','',?,'의정부지사','경매사업부')`).run(JSON.stringify({
      ...inspection, caseNo: '2026타경6666', bidDate: '2026-08-30',
    }));
  const empty = await request('owner', '/inspection-empty-price/bid-prices', 'PUT', {});
  assert.equal(empty.status, 400);
  assert.equal(sqlite.prepare('SELECT count(*) FROM freelancer_auction_schedules WHERE id = ?').pluck().get(inspectionMaterializedBidId('inspection-empty-price')), 0);

  sqlite.prepare(`INSERT INTO freelancer_auction_schedules
    (id,user_id,target_date,activity_type,activity_subtype,data,branch,department)
    VALUES ('inspection-companion','owner','2026-08-22','임장','',?,'의정부지사','경매사업부')`).run(JSON.stringify({
      ...inspection, caseNo: '2026타경7778', bidDate: '2026-08-31', companion: true,
    }));
  const companion = await request('owner', '/inspection-companion/bid-prices', 'PUT', { suggested_price: 1 });
  assert.equal(companion.status, 400);
  assert.equal(sqlite.prepare('SELECT count(*) FROM freelancer_auction_schedules WHERE id = ?').pluck().get(inspectionMaterializedBidId('inspection-companion')), 0);
  sqlite.close();
});

test('서로 다른 동일 물건 임장을 동시에 저장해도 실제 입찰 일정은 원자적으로 한 건만 생성한다', async () => {
  const { sqlite, request } = setup();
  const common = {
    client: '동시고객', propertyCategory: '주거', propertyType: '아파트', bidDate: '2026-09-02',
  };
  const insert = sqlite.prepare(`INSERT INTO freelancer_auction_schedules
    (id,user_id,target_date,activity_type,activity_subtype,data,branch,department)
    VALUES (?, 'owner', ?, '임장', '', ?, '의정부지사', '경매사업부')`);
  insert.run('inspection-race-a', '2026-08-23', JSON.stringify({
    ...common, court: '서울 중앙 지방법원', caseNo: '2026 타경 4242', itemNo: '',
  }));
  insert.run('inspection-race-b', '2026-08-24', JSON.stringify({
    ...common, court: '서울중앙지방법원', caseNo: '2026타경4242', itemNo: '2번',
  }));

  const [first, second] = await Promise.all([
    request('accountant', '/inspection-race-a/bid-result', 'POST', failedResult),
    request(JEONG_MINHO_AUCTION_RESULT_USER_ID, '/inspection-race-b/bid-result', 'POST', failedResult),
  ]);
  assert.equal(first.status, 200, await first.clone().text());
  assert.equal(second.status, 200, await second.clone().text());
  const firstPayload = await first.json() as any;
  const secondPayload = await second.json() as any;
  assert.equal(firstPayload.schedule_id, secondPayload.schedule_id);

  const directBids = sqlite.prepare(`
    SELECT id, data FROM freelancer_auction_schedules
    WHERE user_id = 'owner' AND target_date = '2026-09-02' AND activity_type = '입찰'
  `).all() as Array<{ id: string; data: string }>;
  assert.equal(directBids.length, 1);
  const stored = JSON.parse(directBids[0].data);
  assert.equal(stored.materializedBidGroup, '서울중앙지방법원|2026타경4242');
  assert.ok(stored.materializedBidItem === '' || stored.materializedBidItem === '2');
  sqlite.close();
});
