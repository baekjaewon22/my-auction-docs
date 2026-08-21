import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  auctionScheduleAutoCancellationCutoff,
  auctionScheduleBidResult,
  auctionScheduleBidResultMissingFields,
  isAuctionScheduleAutoCancellationDue,
} from '../src/shared/auction-schedule.ts';
import { runAuctionScheduleAutoCancellation } from '../src/worker/lib/auction-schedule-auto-cancellation.ts';

function d1FromSqlite(db: Database.Database): D1Database {
  const prepare = (sql: string) => {
    const values: unknown[] = [];
    const api = {
      bind(...params: unknown[]) { values.splice(0, values.length, ...params); return api; },
      async all<T>() { return { results: db.prepare(sql).all(...values) as T[] }; },
      async first<T>() { return (db.prepare(sql).get(...values) as T | undefined) ?? null; },
      async run() {
        const result = db.prepare(sql).run(...values);
        return { success: true, meta: { changes: result.changes } };
      },
    };
    return api;
  };
  return {
    prepare,
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  } as unknown as D1Database;
}

test('취소는 취하/변경과 별도 결과이며 결과 누락 알림 대상이 아니다', () => {
  assert.equal(auctionScheduleBidResult({ bidCancelled: true }), 'withdrawn');
  assert.equal(auctionScheduleBidResult({ bidResultCancelled: true }), 'cancelled');
  assert.deepEqual(auctionScheduleBidResultMissingFields({ bidResultCancelled: true }), []);
});

test('KST 기준 입찰일 다음 날부터 5일 전체가 지난 일정만 자동 취소 대상이다', () => {
  const atKstMidnight = new Date('2026-08-19T15:00:00.000Z'); // 2026-08-20 00:00 KST
  assert.equal(auctionScheduleAutoCancellationCutoff(atKstMidnight), '2026-08-14');
  assert.equal(isAuctionScheduleAutoCancellationDue('2026-08-14', atKstMidnight), true);
  assert.equal(isAuctionScheduleAutoCancellationDue('2026-08-15', atKstMidnight), false);
});

test('Cron 자동 취소는 pending만 조건부 갱신하고 확정 결과와 재실행을 보존한다', async () => {
  const sqlite = new Database(':memory:');
  sqlite.exec('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
  sqlite.prepare('INSERT INTO users VALUES (?, ?)').run('user-1', '김민수');
  const db = d1FromSqlite(sqlite);
  const env = { DB: db } as Pick<Env, 'DB'>;

  // 첫 실행으로 런타임 스키마를 만든다.
  await runAuctionScheduleAutoCancellation(env, new Date('2026-08-01T00:00:00.000Z'));
  const insert = sqlite.prepare(`
    INSERT INTO freelancer_auction_schedules
      (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
    VALUES (?, 'user-1', ?, '입찰', '', ?, '의정부지사', '')
  `);
  const base = { caseNo: '2026타경12345', propertyType: '아파트', client: '고객', suggestedPrice: '10', bidPrice: '9' };
  insert.run('pending-due', '2026-08-14', JSON.stringify(base));
  insert.run('pending-new', '2026-08-15', JSON.stringify(base));
  insert.run('won', '2026-08-13', JSON.stringify({ ...base, bidWon: true }));
  insert.run('failed', '2026-08-13', JSON.stringify({ ...base, bidFailed: true }));
  insert.run('withdrawn', '2026-08-13', JSON.stringify({ ...base, bidCancelled: true }));
  insert.run('cancelled', '2026-08-13', JSON.stringify({ ...base, bidResultCancelled: true }));

  const scheduledAt = new Date('2026-08-19T15:00:00.000Z');
  const first = await runAuctionScheduleAutoCancellation(env, scheduledAt);
  assert.equal(first.cutoff, '2026-08-14');
  assert.equal(first.cancelled, 1);

  const states = new Map((sqlite.prepare('SELECT id, data FROM freelancer_auction_schedules').all() as Array<{ id: string; data: string }>).map(row => [
    row.id,
    auctionScheduleBidResult(JSON.parse(row.data)),
  ]));
  assert.equal(states.get('pending-due'), 'cancelled');
  assert.equal(states.get('pending-new'), 'pending');
  assert.equal(states.get('won'), 'won');
  assert.equal(states.get('failed'), 'failed');
  assert.equal(states.get('withdrawn'), 'withdrawn');
  assert.equal(states.get('cancelled'), 'cancelled');

  const saved = JSON.parse(String(sqlite.prepare("SELECT data FROM freelancer_auction_schedules WHERE id = 'pending-due'").pluck().get()));
  assert.equal(saved.bidResultCancelledAutomatically, true);
  assert.equal(saved.bidResultCancelledAt, '2026-08-20 00:00:00');
  assert.equal(sqlite.prepare("SELECT bid_result FROM bid_analysis_entries WHERE source_id = 'auction-schedule:pending-due'").pluck().get(), '취소');

  const second = await runAuctionScheduleAutoCancellation(env, scheduledAt);
  assert.equal(second.cancelled, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM bid_analysis_entries').pluck().get(), 1);
  sqlite.close();
});
