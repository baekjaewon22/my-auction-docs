import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import {
  AUCTION_SCHEDULE_MUTATION_ROLES,
  auctionScheduleKstDateKey,
  canEditAuctionScheduleEntry,
  canManageAuctionSchedule,
  getRequiredInspectionBidDateError,
  isPastAuctionScheduleDate,
  isValidAuctionScheduleDate,
} from '../src/shared/auction-schedule-write-access.ts';
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

const JWT_SECRET = 'auction-schedule-write-access-secret-1234567890';
const VALID_BID_DATA = {
  caseNo: '2099타경1', court: '의정부지방법원', client: '고객', propertyType: '아파트',
};

function setup() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT '', name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '', role TEXT NOT NULL, team_id TEXT,
      branch TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '',
      position_title TEXT NOT NULL DEFAULT '', login_type TEXT NOT NULL DEFAULT 'employee',
      approved INTEGER NOT NULL DEFAULT 1, auth_version INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE freelancer_auction_schedules (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, target_date TEXT NOT NULL,
      activity_type TEXT NOT NULL, activity_subtype TEXT NOT NULL DEFAULT '',
      data TEXT NOT NULL DEFAULT '{}', branch TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
    );
    CREATE TABLE sales_records (
      id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending',
      external_id TEXT, amount INTEGER NOT NULL DEFAULT 0,
      winning_price INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE commissions (
      id TEXT PRIMARY KEY, journal_entry_id TEXT, status TEXT NOT NULL DEFAULT 'pending', win_price TEXT
    );
  `);
  const users: Array<[string, Role, string]> = [
    ['master', 'master', 'employee'],
    ['accountant', 'accountant', 'employee'],
    ['owner', 'member', 'freelancer'],
    ['ceo', 'ceo', 'employee'],
    ['admin', 'admin', 'employee'],
    ['asst', 'accountant_asst', 'employee'],
    ['support', 'support', 'employee'],
  ];
  const insertUser = sqlite.prepare(`
    INSERT INTO users (id, email, name, role, branch, department, login_type)
    VALUES (?, ?, ?, ?, '의정부지사', '경매사업부', ?)
  `);
  for (const [id, role, loginType] of users) {
    insertUser.run(id, `${id}@example.com`, id, role, loginType);
  }

  const insertSchedule = (id: string, targetDate = '2099-12-31') => {
    sqlite.prepare(`
      INSERT INTO freelancer_auction_schedules
        (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
      VALUES (?, 'owner', ?, '입찰', '', ?, '의정부지사', '경매사업부')
    `).run(id, targetDate, JSON.stringify(VALID_BID_DATA));
  };

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

  return { sqlite, insertSchedule, request };
}

test('KST 자정 경계에서 지난 일정 잠금이 시작된다', () => {
  const justBeforeMidnight = new Date('2026-08-24T14:59:59.999Z');
  const atMidnight = new Date('2026-08-24T15:00:00.000Z');

  assert.equal(auctionScheduleKstDateKey(justBeforeMidnight), '2026-08-24');
  assert.equal(auctionScheduleKstDateKey(atMidnight), '2026-08-25');
  assert.equal(isPastAuctionScheduleDate('2026-08-24', justBeforeMidnight), false);
  assert.equal(isPastAuctionScheduleDate('2026-08-24', atMidnight), true);
  assert.equal(isPastAuctionScheduleDate('2026-08-25', atMidnight), false);
});

test('일정 날짜와 임장 입찰기일은 실제로 존재하는 YYYY-MM-DD만 허용한다', () => {
  assert.equal(isValidAuctionScheduleDate('2026-02-28'), true);
  assert.equal(isValidAuctionScheduleDate('2026-02-30'), false);
  assert.equal(isValidAuctionScheduleDate('2026-2-8'), false);
  assert.equal(getRequiredInspectionBidDateError('입찰', {}), null);
  assert.match(getRequiredInspectionBidDateError('임장', {}) || '', /반드시/);
  assert.match(getRequiredInspectionBidDateError('임장', { bidDate: '2026-02-30' }) || '', /YYYY-MM-DD/);
  assert.equal(getRequiredInspectionBidDateError('임장', { bidDate: '2026-02-28' }), null);
});

test('일반 PUT·DELETE는 날짜와 소유자에 관계없이 관리자급만 실행한다', async () => {
  assert.deepEqual([...AUCTION_SCHEDULE_MUTATION_ROLES], ['master', 'accountant', 'accountant_asst', 'ceo']);
  for (const role of AUCTION_SCHEDULE_MUTATION_ROLES) {
    assert.equal(canManageAuctionSchedule({ role }), true, role);
  }
  for (const role of ['admin', 'member', 'support']) {
    assert.equal(canManageAuctionSchedule({ role }), false, role);
  }
  assert.equal(canEditAuctionScheduleEntry(
    { role: 'member', sub: 'owner' },
    { user_id: 'owner', target_date: '2099-12-31' },
  ), false);

  const { sqlite, insertSchedule, request } = setup();
  const actors = ['master', 'accountant', 'owner', 'ceo', 'admin', 'asst', 'support'];
  const managerActors = ['master', 'accountant', 'ceo', 'asst'];
  for (const actor of actors) {
    const putId = `put-${actor}`;
    insertSchedule(putId);
    const put = await request(actor, `/${putId}`, 'PUT', { activity_subtype: `${actor}-updated` });
    assert.equal(put.status, managerActors.includes(actor) ? 200 : 403, `PUT ${actor}: ${await put.clone().text()}`);

    const deleteId = `delete-${actor}`;
    insertSchedule(deleteId);
    const remove = await request(actor, `/${deleteId}`, 'DELETE');
    assert.equal(remove.status, managerActors.includes(actor) ? 200 : 403, `DELETE ${actor}: ${await remove.clone().text()}`);
  }
  sqlite.close();
});

test('일반 PUT은 숨은 메타·결과·가격을 보존하고 활동유형 변경을 차단한다', async () => {
  const { sqlite, insertSchedule, request } = setup();
  insertSchedule('metadata-merge');
  sqlite.prepare("UPDATE freelancer_auction_schedules SET data = ? WHERE id = 'metadata-merge'").run(JSON.stringify({
    ...VALID_BID_DATA,
    clientPhone: '010-1234-5678',
    inspectionSourceId: 'inspection-origin',
    materializedBidGroup: '의정부지방법원|2099타경1',
    materializedBidItem: '2',
    memo: '화면에서 재생성하지 않는 메모',
    suggestedPrice: '123000000',
    bidPrice: '120000000',
    winPrice: '125000000',
    bidWon: false,
    bidFailed: false,
    bidCancelled: false,
    bidResultCancelled: false,
    bidResultCancelledAutomatically: false,
    bidResultCancelledAt: '',
    timeFrom: '09:00',
  }));

  const sameType = await request('accountant', '/metadata-merge', 'PUT', {
    activity_type: '입찰',
    data: {
      ...VALID_BID_DATA,
      propertyType: '연립주택',
      clientPhone: '',
      inspectionSourceId: 'tampered-source',
      materializedBidGroup: 'tampered-group',
      materializedBidItem: '99',
      suggestedPrice: '',
      actualBidPrice: '1',
      bidPrice: '1',
      winningPrice: '1',
      winPrice: '1',
      bidWon: false,
      bidFailed: true,
      bidCancelled: true,
      bidResultCancelled: true,
    },
  });
  assert.equal(sameType.status, 200, await sameType.clone().text());
  const merged = JSON.parse(sqlite.prepare("SELECT data FROM freelancer_auction_schedules WHERE id = 'metadata-merge'").pluck().get() as string);
  assert.equal(merged.propertyType, '연립주택');
  assert.equal(merged.clientPhone, '010-1234-5678');
  assert.equal(merged.inspectionSourceId, 'inspection-origin');
  assert.equal(merged.materializedBidGroup, '의정부지방법원|2099타경1');
  assert.equal(merged.materializedBidItem, '2');
  assert.equal(merged.memo, '화면에서 재생성하지 않는 메모');
  assert.equal(merged.suggestedPrice, '123000000');
  assert.equal(merged.actualBidPrice, undefined);
  assert.equal(merged.bidPrice, '120000000');
  assert.equal(merged.winningPrice, undefined);
  assert.equal(merged.winPrice, '125000000');
  assert.equal(merged.bidWon, false);
  assert.equal(merged.bidFailed, false);
  assert.equal(merged.bidCancelled, false);
  assert.equal(merged.bidResultCancelled, false);
  assert.equal(merged.timeFrom, undefined);

  const changedType = await request('master', '/metadata-merge', 'PUT', {
    activity_type: '임장',
    data: { ...VALID_BID_DATA, bidDate: '2099-12-30' },
  });
  assert.equal(changedType.status, 409, await changedType.clone().text());
  const unchanged = sqlite.prepare("SELECT activity_type, data FROM freelancer_auction_schedules WHERE id = 'metadata-merge'").get() as any;
  assert.equal(unchanged.activity_type, '입찰');
  assert.equal(JSON.parse(unchanged.data).clientPhone, '010-1234-5678');
  sqlite.close();
});

test('결과가 처리된 입찰 일정은 일반 PUT을 차단하지만 DELETE는 기존 관리 정책을 유지한다', async () => {
  const { sqlite, insertSchedule, request } = setup();
  const states = [
    ['won', { bidWon: true }],
    ['failed', { bidFailed: true }],
    ['withdrawn', { bidCancelled: true }],
    ['cancelled', { bidResultCancelled: true }],
  ] as const;
  for (const [label, state] of states) {
    const id = `resolved-${label}`;
    insertSchedule(id);
    sqlite.prepare('UPDATE freelancer_auction_schedules SET data = ? WHERE id = ?')
      .run(JSON.stringify({ ...VALID_BID_DATA, ...state }), id);
    const response = await request('master', `/${id}`, 'PUT', {
      data: { ...VALID_BID_DATA, propertyType: '연립주택' },
    });
    assert.equal(response.status, 409, `${label}: ${await response.clone().text()}`);
    const stored = JSON.parse(sqlite.prepare('SELECT data FROM freelancer_auction_schedules WHERE id = ?').pluck().get(id) as string);
    assert.equal(stored.propertyType, '아파트');
  }

  insertSchedule('delete-resolved');
  sqlite.prepare("UPDATE freelancer_auction_schedules SET data = ? WHERE id = 'delete-resolved'")
    .run(JSON.stringify({ ...VALID_BID_DATA, bidFailed: true }));
  const remove = await request('accountant', '/delete-resolved', 'DELETE');
  assert.equal(remove.status, 200, await remove.clone().text());
  sqlite.close();
});

test('과거·오늘·미래 일정 모두 관리자급만 PUT·DELETE할 수 있다', async () => {
  const { sqlite, insertSchedule, request } = setup();
  for (const actor of ['master', 'accountant', 'ceo', 'asst']) {
    const pastId = `past-${actor}`;
    insertSchedule(pastId, '2000-01-01');
    const put = await request(actor, `/${pastId}`, 'PUT', { activity_subtype: '변경' });
    assert.equal(put.status, 200, `past PUT ${actor}: ${await put.clone().text()}`);
    const remove = await request(actor, `/${pastId}`, 'DELETE');
    assert.equal(remove.status, 200, `past DELETE ${actor}: ${await remove.clone().text()}`);

    const futureId = `move-${actor}`;
    insertSchedule(futureId);
    const moveToPast = await request(actor, `/${futureId}`, 'PUT', { target_date: '2000-01-01' });
    assert.equal(moveToPast.status, 200, `move-to-past PUT ${actor}: ${await moveToPast.clone().text()}`);
  }

  insertSchedule('past-owner', '2000-01-01');
  assert.equal((await request('owner', '/past-owner', 'PUT', { activity_subtype: '변경' })).status, 403);
  assert.equal((await request('owner', '/past-owner', 'DELETE')).status, 403);
  insertSchedule('today-owner', auctionScheduleKstDateKey());
  assert.equal((await request('owner', '/today-owner', 'PUT', { activity_subtype: '변경' })).status, 403);
  assert.equal((await request('owner', '/today-owner', 'DELETE')).status, 403);
  insertSchedule('future-owner');
  assert.equal((await request('owner', '/future-owner', 'PUT', { activity_subtype: '변경' })).status, 403);
  assert.equal((await request('owner', '/future-owner', 'DELETE')).status, 403);
  sqlite.close();
});

test('과거 일정 POST는 기존 작성자에게 허용하고 accountant 작성 권한은 새로 늘리지 않는다', async () => {
  const { sqlite, request } = setup();
  const body = { target_date: '2000-01-01', activity_type: '입찰', data: VALID_BID_DATA };
  const ownerCreate = await request('owner', '', 'POST', body);
  assert.equal(ownerCreate.status, 201, await ownerCreate.clone().text());
  const masterCreate = await request('master', '', 'POST', { ...body, user_id: 'owner' });
  assert.equal(masterCreate.status, 201, await masterCreate.clone().text());
  const accountantCreate = await request('accountant', '', 'POST', { ...body, user_id: 'owner' });
  assert.equal(accountantCreate.status, 403);
  sqlite.close();
});

test('임장 POST·PUT은 유효한 data.bidDate가 필수다', async () => {
  const { sqlite, request } = setup();
  const inspectionData = { ...VALID_BID_DATA };

  const missing = await request('owner', '', 'POST', {
    target_date: '2099-12-01', activity_type: '임장', data: inspectionData,
  });
  assert.equal(missing.status, 400);
  assert.match(await missing.text(), /입찰기일/);

  const invalid = await request('owner', '', 'POST', {
    target_date: '2099-12-01', activity_type: '임장', data: { ...inspectionData, bidDate: '2099-02-30' },
  });
  assert.equal(invalid.status, 400);

  const valid = await request('owner', '', 'POST', {
    target_date: '2099-12-01', activity_type: '임장', data: { ...inspectionData, bidDate: '2099-12-31' },
  });
  assert.equal(valid.status, 201, await valid.clone().text());

  sqlite.prepare(`
    INSERT INTO freelancer_auction_schedules
      (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
    VALUES ('legacy-inspection', 'owner', '2099-12-01', '임장', '', ?, '의정부지사', '경매사업부')
  `).run(JSON.stringify(inspectionData));
  const putMissing = await request('master', '/legacy-inspection', 'PUT', {
    activity_type: '임장', data: inspectionData,
  });
  assert.equal(putMissing.status, 400);
  const putValid = await request('master', '/legacy-inspection', 'PUT', {
    activity_type: '임장', data: { ...inspectionData, bidDate: '2099-12-31' },
  });
  assert.equal(putValid.status, 200, await putValid.clone().text());
  sqlite.close();
});
