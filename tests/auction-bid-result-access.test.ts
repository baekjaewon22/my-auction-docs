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
import {
  CalendarAuctionManagementError,
  deleteCalendarAuctionEvent,
  resolveCalendarAuctionEvent,
} from '../src/worker/lib/calendar-auction-management.ts';
import type { AuthEnv, JwtPayload, Role } from '../src/worker/types.ts';

type D1Hooks = {
  beforeRun?: (sql: string, params: unknown[]) => void | Promise<void>;
  beforeBatch?: () => void | Promise<void>;
};

type D1Statement = D1PreparedStatement & { run(): Promise<D1Result> };

function d1FromSqlite(sqlite: Database.Database, hooks: D1Hooks): D1Database {
  const prepare = (sql: string, params: unknown[] = []): D1Statement => {
    return {
      bind: (...values: unknown[]) => prepare(sql, values),
      all: async <T>() => ({ results: sqlite.prepare(sql).all(...params) as T[] }),
      first: async <T>() => (sqlite.prepare(sql).get(...params) as T | undefined) || null,
      run: async () => {
        const beforeRun = hooks.beforeRun;
        if (beforeRun) await beforeRun(sql, params);
        const result = sqlite.prepare(sql).run(...params);
        return { success: true, meta: { changes: result.changes } } as unknown as D1Result;
      },
    } as D1Statement;
  };
  return {
    prepare: (sql: string) => prepare(sql),
    batch: async (statements: D1PreparedStatement[]) => {
      const beforeBatch = hooks.beforeBatch;
      if (beforeBatch) await beforeBatch();
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
      id TEXT PRIMARY KEY, user_id TEXT, type TEXT, type_detail TEXT,
      client_name TEXT, depositor_name TEXT, depositor_different INTEGER NOT NULL DEFAULT 0,
      amount INTEGER NOT NULL DEFAULT 0, contract_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending', direction TEXT, branch TEXT, department TEXT,
      payment_type TEXT, winning_price INTEGER NOT NULL DEFAULT 0,
      client_phone TEXT, customer_id TEXT, memo TEXT, external_id TEXT
    );
    CREATE TABLE commissions (
      id TEXT PRIMARY KEY, journal_entry_id TEXT, user_id TEXT, user_name TEXT,
      client_name TEXT, case_no TEXT, status TEXT NOT NULL DEFAULT 'pending', win_price TEXT
    );
    CREATE TABLE accounting_activity_logs (
      id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL DEFAULT '',
      actor_role TEXT NOT NULL DEFAULT '', action TEXT NOT NULL, target_type TEXT NOT NULL,
      target_id TEXT NOT NULL, target_label TEXT NOT NULL DEFAULT '', diff_summary TEXT NOT NULL DEFAULT '',
      before_snapshot TEXT, after_snapshot TEXT, source_page TEXT NOT NULL DEFAULT '', created_at TEXT
    );
    CREATE TABLE lawitgo_winning_outbox (
      id TEXT PRIMARY KEY, sales_record_id TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL DEFAULT '{}',
      missing_fields TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, claim_token TEXT,
      last_attempt_at TEXT, sent_at TEXT, response_status INTEGER, remote_request_id TEXT,
      last_error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  const hooks: D1Hooks = {};
  const db = d1FromSqlite(sqlite, hooks);
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
  return { sqlite, request, db, env, hooks };
}

const failedResult = {
  result: 'failed', suggested_price: 100_000_000,
  actual_bid_price: 90_000_000, winning_price: 110_000_000,
};

const wonResult = {
  result: 'won', suggested_price: 100_000_000,
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

test('bid-result 실제 route는 won·failed·withdrawn·cancelled·pending side effect를 일관되게 처리한다', async () => {
  const { sqlite, request } = setup();
  assert.equal((await request('owner', '/bid-1/bid-result', 'POST', failedResult)).status, 200);
  assert.equal(JSON.parse(sqlite.prepare("SELECT data FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get() as string).bidFailed, true);
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM sales_records').pluck().get(), 0);

  assert.equal((await request('owner', '/bid-1/bid-result', 'POST', { result: 'withdrawn' })).status, 200);
  assert.equal(JSON.parse(sqlite.prepare("SELECT data FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get() as string).bidCancelled, true);
  assert.equal((await request('owner', '/bid-1/bid-result', 'POST', { result: 'cancelled' })).status, 200);
  assert.equal(JSON.parse(sqlite.prepare("SELECT data FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get() as string).bidResultCancelled, true);

  const won = await request('owner', '/bid-1/bid-result', 'POST', wonResult);
  assert.equal(won.status, 200, await won.clone().text());
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM sales_records').pluck().get(), 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM commissions').pluck().get(), 1);
  assert.equal(sqlite.prepare("SELECT external_id FROM sales_records").pluck().get(), 'auction-schedule:bid-1');

  const pending = await request('owner', '/bid-1/bid-result', 'POST', { result: 'pending' });
  assert.equal(pending.status, 200, await pending.clone().text());
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM sales_records').pluck().get(), 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM commissions').pluck().get(), 0);
  const pendingData = JSON.parse(sqlite.prepare("SELECT data FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get() as string);
  assert.equal(pendingData.bidWon, false);
  assert.equal(pendingData.bidResultCancelled, false);
  sqlite.close();
});

test('신규 POST는 provenance 내부 필드를 제거하고 일반 PUT은 위조 덮어쓰기를 허용하지 않는다', async () => {
  const { sqlite, request } = setup();
  const createdResponse = await request('master', '', 'POST', {
    user_id: 'owner',
    target_date: '2026-09-20',
    activity_type: '입찰',
    activity_subtype: '위조 방지',
    data: {
      court: '의정부지방법원', caseNo: '2026타경999', itemNo: '1', client: '고객',
      propertyType: '아파트', inspectionSourceId: 'victim-inspection',
      materializedBidGroup: 'forged-group', materializedBidItem: '99',
    },
  });
  assert.equal(createdResponse.status, 201, await createdResponse.clone().text());
  const createdId = (await createdResponse.json() as any).entry.id;
  let data = JSON.parse(sqlite.prepare('SELECT data FROM freelancer_auction_schedules WHERE id = ?').pluck().get(createdId) as string);
  assert.equal(data.inspectionSourceId, undefined);
  assert.equal(data.materializedBidGroup, undefined);
  assert.equal(data.materializedBidItem, undefined);

  sqlite.prepare("UPDATE freelancer_auction_schedules SET data = json_set(data, '$.inspectionSourceId', 'server-source') WHERE id = ?").run(createdId);
  const put = await request('master', `/${createdId}`, 'PUT', {
    target_date: '2026-09-20', activity_type: '입찰', activity_subtype: '위조 방지',
    data: { ...data, inspectionSourceId: 'attacker-source', materializedBidGroup: 'attacker' },
  });
  assert.equal(put.status, 200, await put.clone().text());
  data = JSON.parse(sqlite.prepare('SELECT data FROM freelancer_auction_schedules WHERE id = ?').pluck().get(createdId) as string);
  assert.equal(data.inspectionSourceId, 'server-source');
  assert.equal(data.materializedBidGroup, undefined);
  sqlite.close();
});

test('calendar delete가 route claim보다 먼저 커밋되면 stale won·failed가 side effect를 만들지 않는다', async () => {
  for (const body of [failedResult, wonResult]) {
    const { sqlite, request, db, hooks } = setup();
    const resolved = await resolveCalendarAuctionEvent(db, 'auction_bid', 'bid-1');
    hooks.beforeRun = async (sql, params) => {
      if (!sql.includes('INSERT OR IGNORE INTO auction_schedule_mutation_claims') || !params.includes('bid_result_source')) return;
      hooks.beforeRun = undefined;
      await deleteCalendarAuctionEvent(db, { sub: 'master', role: 'master' }, {
        source_type: 'auction_bid', source_id: 'bid-1', revision: resolved.revision,
      });
    };
    const response = await request('owner', '/bid-1/bid-result', 'POST', body);
    assert.equal(response.status, 409, await response.clone().text());
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get(), 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) FROM sales_records').pluck().get(), 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) FROM commissions').pluck().get(), 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM bid_analysis_entries WHERE source_id = 'auction-schedule:bid-1'").pluck().get(), 0);
    sqlite.close();
  }
});

test('bid-result claim이 먼저면 calendar delete를 막고 won 완료 뒤 linked dependency가 삭제를 막는다', async () => {
  const { sqlite, request, db, hooks } = setup();
  const resolved = await resolveCalendarAuctionEvent(db, 'auction_bid', 'bid-1');
  let concurrentError: unknown;
  hooks.beforeRun = async (sql) => {
    if (!sql.includes('UPDATE freelancer_auction_schedules SET data = ?')) return;
    hooks.beforeRun = undefined;
    try {
      await deleteCalendarAuctionEvent(db, { sub: 'master', role: 'master' }, {
        source_type: 'auction_bid', source_id: 'bid-1', revision: resolved.revision,
      });
    } catch (error) {
      concurrentError = error;
    }
  };
  const response = await request('owner', '/bid-1/bid-result', 'POST', wonResult);
  assert.equal(response.status, 200, await response.clone().text());
  assert.ok(concurrentError instanceof CalendarAuctionManagementError);
  assert.equal((concurrentError as CalendarAuctionManagementError).code, 'mutation_in_progress');
  const current = await resolveCalendarAuctionEvent(db, 'auction_bid', 'bid-1');
  await assert.rejects(
    () => deleteCalendarAuctionEvent(db, { sub: 'master', role: 'master' }, {
      source_type: 'auction_bid', source_id: 'bid-1', revision: current.revision,
    }),
    (error: unknown) => error instanceof CalendarAuctionManagementError && error.code === 'linked_business_data',
  );
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM sales_records').pluck().get(), 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM commissions').pluck().get(), 1);
  sqlite.close();
});

test('inspection delete와 materialize도 실제 route에서 양방향으로 상호 배제한다', async () => {
  for (const order of ['delete-first', 'materialize-first'] as const) {
    const { sqlite, request, db, hooks } = setup();
    const inspectionData = {
      court: '의정부지방법원', caseNo: '2026타경7070', itemNo: '1', client: '고객',
      propertyCategory: '주거', propertyType: '아파트', bidDate: '2026-09-22',
    };
    sqlite.prepare(`INSERT INTO freelancer_auction_schedules
      (id,user_id,target_date,activity_type,activity_subtype,data,branch,department)
      VALUES ('inspection-race','owner','2026-09-01','임장','',?,'의정부지사','경매사업부')`).run(JSON.stringify(inspectionData));
    const resolved = await resolveCalendarAuctionEvent(db, 'auction_inspection', 'inspection-race');
    let concurrentError: unknown;
    hooks.beforeRun = async (sql, params) => {
      const trigger = order === 'delete-first'
        ? sql.includes('INSERT OR IGNORE INTO auction_schedule_mutation_claims') && params.includes('bid_result_source')
        : sql.includes('INSERT OR IGNORE INTO freelancer_auction_schedules');
      if (!trigger) return;
      hooks.beforeRun = undefined;
      try {
        await deleteCalendarAuctionEvent(db, { sub: 'master', role: 'master' }, {
          source_type: 'auction_inspection', source_id: 'inspection-race', revision: resolved.revision,
        });
      } catch (error) {
        concurrentError = error;
      }
    };
    const response = await request('owner', '/inspection-race/bid-result', 'POST', failedResult);
    if (order === 'delete-first') {
      assert.equal(response.status, 409, await response.clone().text());
      assert.equal(concurrentError, undefined);
      assert.equal(sqlite.prepare("SELECT COUNT(*) FROM freelancer_auction_schedules WHERE id = 'inspection-bid:inspection-race'").pluck().get(), 0);
    } else {
      assert.equal(response.status, 200, await response.clone().text());
      assert.ok(concurrentError instanceof CalendarAuctionManagementError);
      assert.equal((concurrentError as CalendarAuctionManagementError).code, 'mutation_in_progress');
      assert.equal(sqlite.prepare("SELECT COUNT(*) FROM freelancer_auction_schedules WHERE id = 'inspection-race'").pluck().get(), 1);
      assert.equal(sqlite.prepare("SELECT COUNT(*) FROM freelancer_auction_schedules WHERE id = 'inspection-bid:inspection-race'").pluck().get(), 1);
    }
    sqlite.close();
  }
});

test('claim release 실패는 성공 응답을 보존하고 TTL 뒤 캘린더 삭제가 claim을 회수한다', async () => {
  const { sqlite, request, db, hooks } = setup();
  const originalError = console.error;
  console.error = () => {};
  hooks.beforeRun = async (sql) => {
    if (!sql.includes('DELETE FROM auction_schedule_mutation_claims WHERE claim_token = ?')) return;
    hooks.beforeRun = undefined;
    throw new Error('injected claim release failure');
  };
  try {
    const response = await request('owner', '/bid-1/bid-result', 'POST', failedResult);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(JSON.parse(sqlite.prepare("SELECT data FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get() as string).bidFailed, true);
    assert.equal(sqlite.prepare('SELECT COUNT(*) FROM auction_schedule_mutation_claims').pluck().get(), 1);
    sqlite.prepare("UPDATE auction_schedule_mutation_claims SET created_at = datetime('now', '+9 hours', '-16 minutes')").run();
    const resolved = await resolveCalendarAuctionEvent(db, 'auction_bid', 'bid-1');
    await deleteCalendarAuctionEvent(db, { sub: 'master', role: 'master' }, {
      source_type: 'auction_bid', source_id: 'bid-1', revision: resolved.revision,
    });
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get(), 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) FROM auction_schedule_mutation_claims').pluck().get(), 0);
  } finally {
    console.error = originalError;
    sqlite.close();
  }
});

test('bid-prices와 일반 PUT도 calendar delete 두 순서에서 공용 claim을 따른다', async () => {
  for (const operation of ['bid-prices', 'general-put'] as const) {
    for (const order of ['delete-first', 'mutation-first'] as const) {
      const { sqlite, request, db, hooks } = setup();
      const resolved = await resolveCalendarAuctionEvent(db, 'auction_bid', 'bid-1');
      let concurrentError: unknown;
      const claimOperation = operation === 'bid-prices' ? 'bid_prices_source' : 'general_edit';
      hooks.beforeRun = async (sql, params) => {
        const trigger = order === 'delete-first'
          ? sql.includes('INSERT OR IGNORE INTO auction_schedule_mutation_claims') && params.includes(claimOperation)
          : operation === 'bid-prices'
            ? sql.includes('UPDATE freelancer_auction_schedules SET data = ?')
            : sql.includes('SET target_date = ?, activity_type = ?');
        if (!trigger) return;
        hooks.beforeRun = undefined;
        try {
          await deleteCalendarAuctionEvent(db, { sub: 'master', role: 'master' }, {
            source_type: 'auction_bid', source_id: 'bid-1', revision: resolved.revision,
          });
        } catch (error) {
          concurrentError = error;
        }
      };
      const response = operation === 'bid-prices'
        ? await request('owner', '/bid-1/bid-prices', 'PUT', { suggested_price: 77_000_000 })
        : await request('master', '/bid-1', 'PUT', {
          target_date: '2000-01-01', activity_type: '입찰', activity_subtype: '수정',
          data: JSON.parse(sqlite.prepare("SELECT data FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get() as string),
        });
      if (order === 'delete-first') {
        assert.equal(response.status, 409, `${operation}: ${await response.clone().text()}`);
        assert.equal(concurrentError, undefined);
        assert.equal(sqlite.prepare("SELECT COUNT(*) FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get(), 0);
      } else {
        assert.equal(response.status, 200, `${operation}: ${await response.clone().text()}`);
        assert.ok(concurrentError instanceof CalendarAuctionManagementError);
        assert.equal((concurrentError as CalendarAuctionManagementError).code, 'mutation_in_progress');
        assert.equal(sqlite.prepare("SELECT COUNT(*) FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get(), 1);
      }
      sqlite.close();
    }
  }
});

test('기존 원본 DELETE는 result claim을 존중하고 dependency TOCTOU를 audit guard로 차단한다', async () => {
  {
    const { sqlite, request, hooks } = setup();
    let deleteStatus = 0;
    hooks.beforeRun = async (sql) => {
      if (!sql.includes('UPDATE freelancer_auction_schedules SET data = ?')) return;
      hooks.beforeRun = undefined;
      deleteStatus = (await request('master', '/bid-1', 'DELETE')).status;
    };
    const result = await request('owner', '/bid-1/bid-result', 'POST', wonResult);
    assert.equal(result.status, 200, await result.clone().text());
    assert.equal(deleteStatus, 409);
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get(), 1);
    sqlite.close();
  }

  for (const dependency of ['sale', 'commission'] as const) {
    const { sqlite, request, hooks } = setup();
    hooks.beforeRun = async (sql) => {
      if (!sql.includes("'auction_schedule', datetime('now', '+9 hours')")) return;
      hooks.beforeRun = undefined;
      if (dependency === 'sale') {
        sqlite.prepare("INSERT INTO sales_records (id,external_id) VALUES ('raced-sale','auction-schedule:bid-1')").run();
      } else {
        sqlite.prepare("INSERT INTO commissions (id,journal_entry_id,status) VALUES ('raced-commission','auction-schedule:bid-1','pending')").run();
      }
    };
    const response = await request('master', '/bid-1', 'DELETE');
    assert.equal(response.status, 409, `${dependency}: ${await response.clone().text()}`);
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get(), 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM accounting_activity_logs WHERE target_id = 'bid-1'").pluck().get(), 0);
    sqlite.close();
  }
});

test('기존 원본 DELETE도 court·item·client exact legacy만 보호하고 ambiguity를 409로 분류한다', async () => {
  const legacySchema = `
    CREATE TABLE freelancer_bid_entries (
      id TEXT PRIMARY KEY, user_id TEXT, bid_date TEXT, court TEXT, case_number TEXT,
      item_no TEXT, client_name TEXT, bidder_name TEXT, updated_at TEXT
    )`;
  {
    const { sqlite, request } = setup();
    sqlite.exec(legacySchema);
    sqlite.prepare(`INSERT INTO freelancer_bid_entries VALUES
      ('other-court','owner','2000-01-01','서울중앙지방법원','2026 타경 1234','1','홍길동','','2000-01-01')`).run();
    sqlite.prepare("INSERT INTO sales_records (id,external_id) VALUES ('other-sale','freelancer-bid:other-court')").run();
    const response = await request('master', '/bid-1', 'DELETE');
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get(), 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM sales_records WHERE id = 'other-sale'").pluck().get(), 1);
    sqlite.close();
  }

  {
    const { sqlite, request } = setup();
    sqlite.exec(legacySchema);
    sqlite.prepare(`INSERT INTO freelancer_bid_entries VALUES
      ('exact','owner','2000-01-01','의정부지방법원','2026 타경 1234','1','홍길동','','2000-01-01')`).run();
    sqlite.prepare("INSERT INTO commissions (id,journal_entry_id,status) VALUES ('legacy-commission','freelancer-bid:exact','pending')").run();
    const response = await request('master', '/bid-1', 'DELETE');
    assert.equal(response.status, 409, await response.clone().text());
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get(), 1);
    sqlite.close();
  }

  for (const mode of ['blank-target', 'blank-legacy'] as const) {
    const { sqlite, request } = setup();
    sqlite.exec(legacySchema);
    if (mode === 'blank-target') {
      const data = JSON.parse(sqlite.prepare("SELECT data FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get() as string);
      sqlite.prepare("UPDATE freelancer_auction_schedules SET data = ? WHERE id = 'bid-1'")
        .run(JSON.stringify({ ...data, itemNo: '' }));
    }
    sqlite.prepare(`INSERT INTO freelancer_bid_entries VALUES
      ('one-side-blank','owner','2000-01-01','의정부지방법원','2026 타경 1234',?,'홍길동','','2000-01-01')`)
      .run(mode === 'blank-legacy' ? '' : '1');
    sqlite.prepare("INSERT INTO sales_records (id,external_id) VALUES ('one-side-sale','freelancer-bid:one-side-blank')").run();
    const response = await request('master', '/bid-1', 'DELETE');
    assert.equal(response.status, 409, `${mode}: ${await response.clone().text()}`);
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get(), 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM sales_records WHERE id = 'one-side-sale'").pluck().get(), 1);
    sqlite.close();
  }

  {
    const { sqlite, request, hooks } = setup();
    sqlite.exec(legacySchema);
    hooks.beforeRun = async (sql) => {
      if (!sql.includes("'auction_schedule', datetime('now', '+9 hours')")) return;
      hooks.beforeRun = undefined;
      sqlite.prepare(`INSERT INTO freelancer_bid_entries VALUES
        ('ambiguous','owner','2000-01-01','의정부지방법원','2026 타경 1234','1','','','2000-01-01')`).run();
    };
    const response = await request('master', '/bid-1', 'DELETE');
    assert.equal(response.status, 409, await response.clone().text());
    assert.notEqual(response.status, 401);
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get(), 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM accounting_activity_logs WHERE target_id = 'bid-1'").pluck().get(), 0);
    sqlite.close();
  }
});

test('historical underscore alias pair와 Lawitgo sent가 있으면 결과 reset을 fail-closed한다', async () => {
  const { sqlite, request } = setup();
  const won = await request('owner', '/bid-1/bid-result', 'POST', wonResult);
  assert.equal(won.status, 200, await won.clone().text());
  const canonicalSale = sqlite.prepare("SELECT * FROM sales_records WHERE external_id = 'auction-schedule:bid-1'").get() as any;
  sqlite.prepare(`INSERT INTO sales_records (
    id,user_id,type,type_detail,client_name,depositor_name,depositor_different,amount,contract_date,
    status,direction,branch,department,payment_type,winning_price,client_phone,customer_id,memo,external_id
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'underscore-sale', canonicalSale.user_id, canonicalSale.type, canonicalSale.type_detail,
    canonicalSale.client_name, canonicalSale.depositor_name, canonicalSale.depositor_different,
    canonicalSale.amount, canonicalSale.contract_date, canonicalSale.status, canonicalSale.direction,
    canonicalSale.branch, canonicalSale.department, canonicalSale.payment_type, canonicalSale.winning_price,
    canonicalSale.client_phone, canonicalSale.customer_id, canonicalSale.memo, 'auction_schedule:bid-1',
  );
  sqlite.prepare(`INSERT INTO commissions
    (id,journal_entry_id,user_id,user_name,client_name,case_no,status,win_price)
    SELECT 'underscore-commission','auction_schedule:bid-1',user_id,user_name,client_name,case_no,status,win_price
    FROM commissions WHERE journal_entry_id = 'auction-schedule:bid-1'`).run();
  sqlite.prepare(`INSERT INTO lawitgo_winning_outbox
    (id,sales_record_id,status) VALUES ('underscore-outbox','underscore-sale','sent')`).run();

  const pending = await request('owner', '/bid-1/bid-result', 'POST', { result: 'pending' });
  assert.equal(pending.status, 409, await pending.clone().text());
  assert.equal(JSON.parse(sqlite.prepare("SELECT data FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get() as string).bidWon, true);
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM sales_records').pluck().get(), 2);
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM commissions').pluck().get(), 2);
  assert.equal(sqlite.prepare("SELECT status FROM lawitgo_winning_outbox WHERE id = 'underscore-outbox'").pluck().get(), 'sent');
  sqlite.close();
});

test('underscore-only alias는 재처리·rollback을 지원하고 sent Lawitgo는 보존한다', async () => {
  for (const mode of ['idempotent-won', 'pending-reset', 'lawitgo-sent'] as const) {
    const { sqlite, request } = setup();
    const won = await request('owner', '/bid-1/bid-result', 'POST', wonResult);
    assert.equal(won.status, 200, `${mode}: ${await won.clone().text()}`);
    const saleId = sqlite.prepare("SELECT id FROM sales_records WHERE external_id = 'auction-schedule:bid-1'").pluck().get() as string;
    sqlite.prepare("UPDATE sales_records SET external_id = 'auction_schedule:bid-1' WHERE id = ?").run(saleId);
    sqlite.prepare("UPDATE commissions SET journal_entry_id = 'auction_schedule:bid-1' WHERE journal_entry_id = 'auction-schedule:bid-1'").run();
    if (mode === 'lawitgo-sent') {
      sqlite.prepare("INSERT INTO lawitgo_winning_outbox (id,sales_record_id,status) VALUES ('underscore-sent',?,'sent')").run(saleId);
    }

    const response = mode === 'idempotent-won'
      ? await request('owner', '/bid-1/bid-result', 'POST', wonResult)
      : await request('owner', '/bid-1/bid-result', 'POST', { result: 'pending' });
    if (mode === 'lawitgo-sent') {
      assert.equal(response.status, 409, await response.clone().text());
      assert.equal(JSON.parse(sqlite.prepare("SELECT data FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get() as string).bidWon, true);
      assert.equal(sqlite.prepare('SELECT COUNT(*) FROM sales_records').pluck().get(), 1);
      assert.equal(sqlite.prepare('SELECT COUNT(*) FROM commissions').pluck().get(), 1);
      assert.equal(sqlite.prepare("SELECT status FROM lawitgo_winning_outbox WHERE id = 'underscore-sent'").pluck().get(), 'sent');
    } else if (mode === 'pending-reset') {
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(sqlite.prepare('SELECT COUNT(*) FROM sales_records').pluck().get(), 0);
      assert.equal(sqlite.prepare('SELECT COUNT(*) FROM commissions').pluck().get(), 0);
      assert.notEqual(JSON.parse(sqlite.prepare("SELECT data FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get() as string).bidWon, true);
    } else {
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal((await response.json() as any).sales_record_id, saleId);
      assert.equal(sqlite.prepare('SELECT COUNT(*) FROM sales_records').pluck().get(), 1);
      assert.equal(sqlite.prepare('SELECT COUNT(*) FROM commissions').pluck().get(), 1);
      assert.equal(sqlite.prepare('SELECT external_id FROM sales_records').pluck().get(), 'auction_schedule:bid-1');
    }
    sqlite.close();
  }
});

test('bid-result financial full-snapshot gate는 sale·commission·Lawitgo 경합을 409로 중단한다', async () => {
  for (const race of ['sale-status', 'commission-status', 'lawitgo'] as const) {
    const { sqlite, request, hooks } = setup();
    const won = await request('owner', '/bid-1/bid-result', 'POST', wonResult);
    assert.equal(won.status, 200, await won.clone().text());
    if (race === 'lawitgo') {
      const saleId = sqlite.prepare('SELECT id FROM sales_records').pluck().get() as string;
      sqlite.prepare("INSERT INTO lawitgo_winning_outbox (id,sales_record_id,status) VALUES ('outbox',?,'pending')").run(saleId);
    }
    hooks.beforeRun = async (sql) => {
      if (!sql.includes('UPDATE freelancer_auction_schedules SET data = ?')) return;
      hooks.beforeRun = undefined;
      if (race === 'sale-status') sqlite.prepare("UPDATE sales_records SET status = 'confirmed'").run();
      else if (race === 'commission-status') sqlite.prepare("UPDATE commissions SET status = 'completed'").run();
      else sqlite.prepare("UPDATE lawitgo_winning_outbox SET status = 'sent'").run();
    };
    const pending = await request('owner', '/bid-1/bid-result', 'POST', { result: 'pending' });
    assert.equal(pending.status, 409, `${race}: ${await pending.clone().text()}`);
    assert.equal(JSON.parse(sqlite.prepare("SELECT data FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get() as string).bidWon, true);
    assert.equal(sqlite.prepare('SELECT COUNT(*) FROM sales_records').pluck().get(), 1);
    assert.equal(sqlite.prepare('SELECT COUNT(*) FROM commissions').pluck().get(), 1);
    sqlite.close();
  }

  {
    const { sqlite, request, hooks } = setup();
    sqlite.prepare(`INSERT INTO commissions
      (id,journal_entry_id,status,win_price) VALUES ('pending-commission','auction-schedule:bid-1','pending','2200000')`).run();
    hooks.beforeRun = async (sql) => {
      if (!sql.includes('UPDATE freelancer_auction_schedules SET data = ?')) return;
      hooks.beforeRun = undefined;
      sqlite.prepare("UPDATE commissions SET status = 'completed' WHERE id = 'pending-commission'").run();
    };
    const cancelled = await request('owner', '/bid-1/bid-result', 'POST', { result: 'cancelled' });
    assert.equal(cancelled.status, 409, await cancelled.clone().text());
    const data = JSON.parse(sqlite.prepare("SELECT data FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get() as string);
    assert.notEqual(data.bidResultCancelled, true);
    assert.equal(sqlite.prepare("SELECT status FROM commissions WHERE id = 'pending-commission'").pluck().get(), 'completed');
    sqlite.close();
  }

  {
    const { sqlite, request, hooks } = setup();
    hooks.beforeRun = async (sql) => {
      if (!sql.includes('UPDATE freelancer_auction_schedules SET data = ?')) return;
      hooks.beforeRun = undefined;
      sqlite.prepare("INSERT INTO sales_records (id,external_id) VALUES ('raced-sale','auction-schedule:bid-1')").run();
    };
    const won = await request('owner', '/bid-1/bid-result', 'POST', wonResult);
    assert.equal(won.status, 409, await won.clone().text());
    assert.notEqual(JSON.parse(sqlite.prepare("SELECT data FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get() as string).bidWon, true);
    assert.equal(sqlite.prepare('SELECT COUNT(*) FROM commissions').pluck().get(), 0);
    sqlite.close();
  }
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

test('임장 원본 identity가 바뀌면 stale deterministic child를 결과 대상으로 재사용하지 않는다', async () => {
  const { sqlite, request } = setup();
  const source = {
    court: '의정부지방법원', caseNo: '2026타경3131', itemNo: '1',
    client: '고객 A', propertyCategory: '주거', propertyType: '아파트', bidDate: '2026-09-25',
  };
  sqlite.prepare(`INSERT INTO freelancer_auction_schedules
    (id,user_id,target_date,activity_type,activity_subtype,data,branch,department)
    VALUES ('inspection-stale','owner','2026-09-01','임장','',?,'의정부지사','경매사업부')`).run(JSON.stringify(source));
  const first = await request('owner', '/inspection-stale/bid-result', 'POST', failedResult);
  assert.equal(first.status, 200, await first.clone().text());
  const childId = inspectionMaterializedBidId('inspection-stale');
  const childBefore = sqlite.prepare('SELECT data FROM freelancer_auction_schedules WHERE id = ?').pluck().get(childId);
  sqlite.prepare("UPDATE freelancer_auction_schedules SET data = ? WHERE id = 'inspection-stale'")
    .run(JSON.stringify({ ...source, caseNo: '2026타경4141', client: '고객 B' }));
  const stale = await request('owner', '/inspection-stale/bid-result', 'POST', failedResult);
  assert.equal(stale.status, 400, await stale.clone().text());
  assert.equal(sqlite.prepare('SELECT data FROM freelancer_auction_schedules WHERE id = ?').pluck().get(childId), childBefore);
  sqlite.close();
});

test('같은 사건·물건의 다른 고객 direct bid를 임장 결과 대상으로 오귀속하지 않는다', async () => {
  const { sqlite, request } = setup();
  sqlite.prepare(`
    INSERT INTO sales_records (id, user_id, amount, winning_price, status, external_id)
    VALUES ('customer-b-sale', 'owner', 2200000, 110000000, 'pending', 'auction-schedule:bid-1')
  `).run();
  sqlite.prepare(`INSERT INTO freelancer_auction_schedules
    (id,user_id,target_date,activity_type,activity_subtype,data,branch,department)
    VALUES ('inspection-customer-a','owner','1999-12-20','임장','',?,'의정부지사','경매사업부')`).run(JSON.stringify({
      court: '의정부지방법원', caseNo: '2026 타경 1234', itemNo: '1',
      client: '고객 A', bidder: '공통 입찰대리인', propertyCategory: '주거', propertyType: '아파트', bidDate: '2000-01-01',
    }));
  sqlite.prepare("UPDATE freelancer_auction_schedules SET data = json_set(data, '$.bidder', '공통 입찰대리인') WHERE id = 'bid-1'").run();
  const customerBData = sqlite.prepare("SELECT data FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get() as string;

  const prices = await request('owner', '/inspection-customer-a/bid-prices', 'PUT', { suggested_price: 80_000_000 });
  assert.equal(prices.status, 200, await prices.clone().text());
  const materializedId = inspectionMaterializedBidId('inspection-customer-a');
  assert.equal((await prices.json() as any).schedule_id, materializedId);
  const failed = await request('owner', '/inspection-customer-a/bid-result', 'POST', failedResult);
  assert.equal(failed.status, 200, await failed.clone().text());
  assert.equal((await failed.json() as any).schedule_id, materializedId);
  assert.equal(sqlite.prepare("SELECT data FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get(), customerBData);
  assert.deepEqual(sqlite.prepare("SELECT id, external_id FROM sales_records").get(), {
    id: 'customer-b-sale', external_id: 'auction-schedule:bid-1',
  });
  const materializedData = JSON.parse(sqlite.prepare('SELECT data FROM freelancer_auction_schedules WHERE id = ?').pluck().get(materializedId) as string);
  assert.equal(materializedData.client, '고객 A');
  assert.equal(materializedData.bidFailed, true);
  assert.equal(sqlite.prepare("SELECT COUNT(*) FROM bid_analysis_entries WHERE source_id = ?").pluck().get(`auction-schedule:${materializedId}`), 1);
  sqlite.close();
});

test('낙찰 매출·수수료·분석은 계약자를 고객으로, 입찰자를 입금자로 분리한다', async () => {
  const { sqlite, request } = setup();
  const data = JSON.parse(sqlite.prepare("SELECT data FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get() as string);
  sqlite.prepare("UPDATE freelancer_auction_schedules SET data = ? WHERE id = 'bid-1'")
    .run(JSON.stringify({ ...data, client: '계약자 A', bidder: '입찰대리인 B' }));
  const response = await request('owner', '/bid-1/bid-result', 'POST', wonResult);
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(sqlite.prepare('SELECT client_name, depositor_name, depositor_different FROM sales_records').get(), {
    client_name: '계약자 A', depositor_name: '입찰대리인 B', depositor_different: 1,
  });
  assert.equal(sqlite.prepare('SELECT client_name FROM commissions').pluck().get(), '계약자 A');
  assert.equal(sqlite.prepare('SELECT client_name FROM bid_analysis_entries').pluck().get(), '계약자 A');
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

test('서로 다른 동일 물건 임장은 사건 marker만으로 합치지 않고 provenance별 입찰을 만든다', async () => {
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
  assert.notEqual(firstPayload.schedule_id, secondPayload.schedule_id);

  const directBids = sqlite.prepare(`
    SELECT id, data FROM freelancer_auction_schedules
    WHERE user_id = 'owner' AND target_date = '2026-09-02' AND activity_type = '입찰'
  `).all() as Array<{ id: string; data: string }>;
  assert.equal(directBids.length, 2);
  const stored = directBids.map(row => JSON.parse(row.data));
  assert.deepEqual(stored.map(data => data.inspectionSourceId).sort(), ['inspection-race-a', 'inspection-race-b']);
  assert.ok(stored.every(data => data.materializedBidGroup === '서울중앙지방법원|2026타경4242'));
  sqlite.close();
});
