import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { createToken } from '../src/worker/middleware/auth.ts';
import { ensureLawitgoWinningSchema } from '../src/worker/lib/lawitgo-winning-delivery.ts';
import auctionSchedule from '../src/worker/routes/auction-schedule.ts';
import type { AuthEnv, JwtPayload } from '../src/worker/types.ts';

type D1Statement = D1PreparedStatement & { run(): Promise<D1Result> };

function d1FromSqlite(sqlite: Database.Database): D1Database {
  const prepare = (sql: string, params: unknown[] = []): D1Statement => {
    return {
      bind: (...values: unknown[]) => prepare(sql, values),
      all: async <T>() => ({ results: sqlite.prepare(sql).all(...params) as T[] }),
      first: async <T>() => (sqlite.prepare(sql).get(...params) as T | undefined) || null,
      run: async () => {
        const result = sqlite.prepare(sql).run(...params);
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

const JWT_SECRET = 'lawitgo-winning-auction-reset-guard-secret';

async function setup(deliveryStatus: 'sending' | 'sent') {
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
    CREATE TABLE sales_records (
      id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending', amount INTEGER NOT NULL DEFAULT 0,
      winning_price INTEGER NOT NULL DEFAULT 0, external_id TEXT
    );
    CREATE TABLE commissions (
      id TEXT PRIMARY KEY, journal_entry_id TEXT, status TEXT NOT NULL DEFAULT 'pending', win_price TEXT
    );
    INSERT INTO users (id, email, name, role, branch, department)
      VALUES ('owner', 'owner@example.com', '담당자', 'member', '의정부지사', '경매사업부');
    INSERT INTO freelancer_auction_schedules
      (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
      VALUES (
        'bid-locked', 'owner', '2026-08-24', '입찰', '2026타경1234',
        '{"court":"의정부지방법원","caseNo":"2026타경1234","propertyType":"아파트","client":"고객","bidWon":true,"winPrice":"100000000"}',
        '의정부지사', '경매사업부'
      );
    INSERT INTO sales_records (id, status, amount, winning_price, external_id)
      VALUES ('sale-locked', 'pending', 1000000, 100000000, 'auction-schedule:bid-locked');
  `);
  const db = d1FromSqlite(sqlite);
  await ensureLawitgoWinningSchema(db);
  sqlite.prepare(`INSERT INTO lawitgo_winning_outbox
    (id, sales_record_id, payload_json, missing_fields, status)
    VALUES ('outbox-locked', 'sale-locked', '{}', '[]', ?)`
  ).run(deliveryStatus);

  const env = { DB: db, JWT_SIGNING_SECRET: JWT_SECRET } as Env;
  const app = new Hono<AuthEnv>().route('/api/auction-schedule', auctionSchedule);
  const user = sqlite.prepare("SELECT * FROM users WHERE id = 'owner'").get() as any;
  const payload: JwtPayload = {
    sub: user.id, email: user.email, name: user.name, phone: user.phone,
    role: user.role, team_id: null, branch: user.branch, department: user.department,
    position_title: user.position_title, login_type: user.login_type, auth_version: 0,
  };
  const token = await createToken(payload, env);
  const reset = () => app.request('/api/auction-schedule/bid-locked/bid-result', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ result: 'pending' }),
  }, env);
  return { sqlite, reset };
}

for (const status of ['sending', 'sent'] as const) {
  test(`Lawitgo ${status} 낙찰은 경매결과 대기 초기화로 삭제되지 않는다`, async () => {
    const { sqlite, reset } = await setup(status);
    const beforeData = sqlite.prepare("SELECT data FROM freelancer_auction_schedules WHERE id = 'bid-locked'").pluck().get();
    const response = await reset();
    assert.equal(response.status, 409, await response.clone().text());
    assert.match((await response.json() as { error: string }).error, /Lawitgo/);
    assert.ok(sqlite.prepare("SELECT id FROM sales_records WHERE id = 'sale-locked'").get());
    assert.ok(sqlite.prepare("SELECT id FROM lawitgo_winning_outbox WHERE id = 'outbox-locked'").get());
    assert.equal(
      sqlite.prepare("SELECT data FROM freelancer_auction_schedules WHERE id = 'bid-locked'").pluck().get(),
      beforeData,
    );
    sqlite.close();
  });
}
