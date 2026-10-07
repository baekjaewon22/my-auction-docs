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
import {
  CalendarAuctionManagementError,
  deleteCalendarAuctionEvent,
  resolveCalendarAuctionEvent,
} from '../src/worker/lib/calendar-auction-management.ts';

type D1Hooks = { afterRun?: (sql: string, changes: number) => void | Promise<void> };

function d1FromSqlite(db: Database.Database, hooks: D1Hooks = {}): D1Database {
  const prepare = (sql: string) => {
    const values: unknown[] = [];
    const api = {
      bind(...params: unknown[]) { values.splice(0, values.length, ...params); return api; },
      async all<T>() { return { results: db.prepare(sql).all(...values) as T[] }; },
      async first<T>() { return (db.prepare(sql).get(...values) as T | undefined) ?? null; },
      async run() {
        const result = db.prepare(sql).run(...values);
        if (hooks.afterRun) await hooks.afterRun(sql, result.changes);
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

test('자동취소와 캘린더 삭제는 delete-first·update-first 양방향에서 orphan analysis를 만들지 않는다', async () => {
  function raceSetup() {
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
    const hooks: D1Hooks = {};
    const db = d1FromSqlite(sqlite, hooks);
    return { sqlite, db, hooks, env: { DB: db } as Pick<Env, 'DB'> };
  }

  {
    const { sqlite, db, env } = raceSetup();
    await runAuctionScheduleAutoCancellation(env, new Date('2026-08-01T00:00:00.000Z'));
    sqlite.prepare(`INSERT INTO freelancer_auction_schedules
      (id,user_id,target_date,activity_type,activity_subtype,data,branch,department)
      VALUES ('auto-delete-first','owner','2026-08-14','입찰','',?,'의정부지사','경매사업부')`).run(JSON.stringify({
        caseNo: '2026타경1', court: '의정부지방법원', itemNo: '1', propertyType: '아파트', client: '고객',
      }));
    const resolved = await resolveCalendarAuctionEvent(db, 'auction_bid', 'auto-delete-first');
    await deleteCalendarAuctionEvent(db, { sub: 'master', role: 'master' }, {
      source_type: 'auction_bid', source_id: 'auto-delete-first', revision: resolved.revision,
    });
    const result = await runAuctionScheduleAutoCancellation(env, new Date('2026-08-19T15:00:00.000Z'));
    assert.equal(result.cancelled, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM bid_analysis_entries WHERE source_id = 'auction-schedule:auto-delete-first'").pluck().get(), 0);
    sqlite.close();
  }

  {
    const { sqlite, db, hooks, env } = raceSetup();
    await runAuctionScheduleAutoCancellation(env, new Date('2026-08-01T00:00:00.000Z'));
    sqlite.prepare(`INSERT INTO freelancer_auction_schedules
      (id,user_id,target_date,activity_type,activity_subtype,data,branch,department)
      VALUES ('auto-update-first','owner','2026-08-14','입찰','',?,'의정부지사','경매사업부')`).run(JSON.stringify({
        caseNo: '2026타경2', court: '의정부지방법원', itemNo: '1', propertyType: '아파트', client: '고객',
      }));
    let concurrentError: unknown;
    hooks.afterRun = async (sql, changes) => {
      if (!sql.includes('UPDATE freelancer_auction_schedules') || !sql.includes('bidResultCancelled') || changes !== 1) return;
      hooks.afterRun = undefined;
      const resolved = await resolveCalendarAuctionEvent(db, 'auction_bid', 'auto-update-first');
      try {
        await deleteCalendarAuctionEvent(db, { sub: 'master', role: 'master' }, {
          source_type: 'auction_bid', source_id: 'auto-update-first', revision: resolved.revision,
        });
      } catch (error) {
        concurrentError = error;
      }
    };
    const result = await runAuctionScheduleAutoCancellation(env, new Date('2026-08-19T15:00:00.000Z'));
    assert.equal(result.cancelled, 1);
    assert.ok(concurrentError instanceof CalendarAuctionManagementError);
    assert.equal((concurrentError as CalendarAuctionManagementError).code, 'mutation_in_progress');
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM freelancer_auction_schedules WHERE id = 'auto-update-first'").pluck().get(), 1);
    assert.equal(sqlite.prepare("SELECT bid_result FROM bid_analysis_entries WHERE source_id = 'auction-schedule:auto-update-first'").pluck().get(), '취소');
    sqlite.close();
  }
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
  insert.run('public-within-seven-days', '2026-08-13', JSON.stringify({ ...base, auctionKind: 'public', caseNo: '공매물건1' }));
  insert.run('public-after-seven-days', '2026-08-12', JSON.stringify({ ...base, auctionKind: 'public', caseNo: '공매물건2' }));
  insert.run('won', '2026-08-13', JSON.stringify({ ...base, bidWon: true }));
  insert.run('failed', '2026-08-13', JSON.stringify({ ...base, bidFailed: true }));
  insert.run('withdrawn', '2026-08-13', JSON.stringify({ ...base, bidCancelled: true }));
  insert.run('cancelled', '2026-08-13', JSON.stringify({ ...base, bidResultCancelled: true }));

  const scheduledAt = new Date('2026-08-19T15:00:00.000Z');
  const first = await runAuctionScheduleAutoCancellation(env, scheduledAt);
  assert.equal(first.cutoff, '2026-08-14');
  assert.equal(first.cancelled, 2);

  const states = new Map((sqlite.prepare('SELECT id, data FROM freelancer_auction_schedules').all() as Array<{ id: string; data: string }>).map(row => [
    row.id,
    auctionScheduleBidResult(JSON.parse(row.data)),
  ]));
  assert.equal(states.get('pending-due'), 'cancelled');
  assert.equal(states.get('pending-new'), 'pending');
  assert.equal(states.get('public-within-seven-days'), 'pending');
  assert.equal(states.get('public-after-seven-days'), 'cancelled');
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
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM bid_analysis_entries').pluck().get(), 2);
  sqlite.close();
});
