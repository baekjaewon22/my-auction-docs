import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import { runAuctionBidResultReminders } from '../src/worker/lib/auction-bid-result-reminders.ts';
import {
  CalendarAuctionManagementError,
  deleteCalendarAuctionEvent,
  resolveCalendarAuctionEvent,
} from '../src/worker/lib/calendar-auction-management.ts';

function d1FromSqlite(sqlite: Database.Database): D1Database {
  const prepare = (sql: string, params: unknown[] = []) => ({
    bind: (...values: unknown[]) => prepare(sql, values),
    all: async <T>() => ({ results: sqlite.prepare(sql).all(...params) as T[] }),
    first: async <T>() => (sqlite.prepare(sql).get(...params) as T | undefined) || null,
    run: async () => {
      const result = sqlite.prepare(sql).run(...params);
      return { success: true, meta: { changes: result.changes } } as unknown as D1Result;
    },
  });
  return {
    prepare: (sql: string) => prepare(sql),
    batch: async (statements: Array<{ run(): Promise<D1Result> }>) => {
      const results: D1Result[] = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  } as unknown as D1Database;
}

test('입찰 결과 웹푸시는 30분 cron에서 실행되고 일정별 한 번만 발송한다', () => {
  const worker = readFileSync(new URL('../src/worker/index.ts', import.meta.url), 'utf8');
  const reminder = readFileSync(new URL('../src/worker/lib/auction-bid-result-reminders.ts', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../d1/migrate-auction-bid-result-reminders.sql', import.meta.url), 'utf8');
  const delivery = readFileSync(new URL('../src/worker/lib/web-push-delivery.ts', import.meta.url), 'utf8');
  const everyThirtyMinutesBranch = worker
    .split("if (cron === '*/30 * * * *')")[1]
    ?.split('} else if (cron ===')[0] || '';
  assert.match(everyThirtyMinutesBranch, /runAuctionBidResultReminders/);
  assert.match(reminder, /Number\(kst\.slice\(11, 13\)\) < 15/);
  assert.match(reminder, /auctionScheduleBidResultMissingFields/);
  assert.match(reminder, /INSERT OR IGNORE INTO auction_bid_result_reminder_runs/);
  assert.match(reminder, /eventType: 'auction_bid_result_missing'/);
  assert.match(migration, /UNIQUE\(schedule_id\)/);
  assert.match(delivery, /auction_bid_result_missing/);
});

test('입찰 결과 알림은 15시 전에는 중단되고 15시부터 실제 조회를 수행한다', async () => {
  let scheduleQueries = 0;
  const statement = (sql: string) => ({
    bind() { return this; },
    async run() { return { meta: { changes: 0 } }; },
    async all() {
      if (sql.includes('FROM freelancer_auction_schedules')) scheduleQueries += 1;
      return { results: [] };
    },
  });
  const db = {
    prepare: statement,
    async batch(statements: unknown[]) { return statements.map(() => ({ meta: { changes: 0 } })); },
  };
  const env = { DB: db } as any;

  const before = await runAuctionBidResultReminders(env, new Date('2026-08-07T05:59:00.000Z'));
  assert.equal(before.due, false);
  assert.equal(scheduleQueries, 0);

  const atThree = await runAuctionBidResultReminders(env, new Date('2026-08-07T06:00:00.000Z'));
  assert.equal(atThree.due, true);
  assert.equal(scheduleQueries, 1);
});

test('결과 알림 claim은 send 동안 삭제를 막고 delete-first에서는 ghost push를 만들지 않는다', async () => {
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
      INSERT INTO users (id,name,role,branch,department,login_type) VALUES
        ('owner','담당자','member','의정부지사','경매사업부','freelancer'),
        ('master','마스터','master','의정부본사','관리','employee');
    `);
    const db = d1FromSqlite(sqlite);
    const env = { DB: db } as Env;
    return { sqlite, db, env };
  }
  const scheduledAt = new Date('2026-08-07T06:00:00.000Z');
  const data = JSON.stringify({
    caseNo: '2026타경1', court: '의정부지방법원', itemNo: '1',
    client: '고객', propertyType: '아파트',
  });

  {
    const { sqlite, db, env } = setup();
    await runAuctionBidResultReminders(env, scheduledAt, async () => ({ sent: 0, failed: 0 }));
    sqlite.prepare(`INSERT INTO freelancer_auction_schedules
      (id,user_id,target_date,activity_type,activity_subtype,data,branch,department)
      VALUES ('reminder-delete-first','owner','2026-08-07','입찰','오늘 입찰',?,'의정부지사','경매사업부')`).run(data);
    const resolved = await resolveCalendarAuctionEvent(db, 'auction_bid', 'reminder-delete-first');
    await deleteCalendarAuctionEvent(db, { sub: 'master', role: 'master' }, {
      source_type: 'auction_bid', source_id: 'reminder-delete-first', revision: resolved.revision,
    });
    let deliveries = 0;
    const result = await runAuctionBidResultReminders(env, scheduledAt, async () => {
      deliveries += 1;
      return { sent: 1, failed: 0 };
    });
    assert.equal(result.reminders, 0);
    assert.equal(deliveries, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) FROM auction_bid_result_reminder_runs').pluck().get(), 0);
    sqlite.close();
  }

  {
    const { sqlite, db, env } = setup();
    await runAuctionBidResultReminders(env, scheduledAt, async () => ({ sent: 0, failed: 0 }));
    sqlite.prepare(`INSERT INTO freelancer_auction_schedules
      (id,user_id,target_date,activity_type,activity_subtype,data,branch,department)
      VALUES ('reminder-send-first','owner','2026-08-07','입찰','오늘 입찰',?,'의정부지사','경매사업부')`).run(data);
    let concurrentError: unknown;
    const result = await runAuctionBidResultReminders(env, scheduledAt, async () => {
      const resolved = await resolveCalendarAuctionEvent(db, 'auction_bid', 'reminder-send-first');
      try {
        await deleteCalendarAuctionEvent(db, { sub: 'master', role: 'master' }, {
          source_type: 'auction_bid', source_id: 'reminder-send-first', revision: resolved.revision,
        });
      } catch (error) {
        concurrentError = error;
      }
      return { sent: 1, failed: 0 };
    });
    assert.equal(result.reminders, 1);
    assert.equal(result.sent, 1);
    assert.ok(concurrentError instanceof CalendarAuctionManagementError);
    assert.equal((concurrentError as CalendarAuctionManagementError).code, 'mutation_in_progress');
    assert.equal(sqlite.prepare("SELECT status FROM auction_bid_result_reminder_runs WHERE schedule_id = 'reminder-send-first'").pluck().get(), 'sent');
    const current = await resolveCalendarAuctionEvent(db, 'auction_bid', 'reminder-send-first');
    await deleteCalendarAuctionEvent(db, { sub: 'master', role: 'master' }, {
      source_type: 'auction_bid', source_id: 'reminder-send-first', revision: current.revision,
    });
    assert.equal(sqlite.prepare('SELECT COUNT(*) FROM auction_bid_result_reminder_runs').pluck().get(), 0);
    sqlite.close();
  }
});
