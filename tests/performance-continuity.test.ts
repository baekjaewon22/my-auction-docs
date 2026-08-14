import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  archivedPerformanceMemberPredicateSql,
  findCanonicalBidSale,
  isSupplementalBidAnalysisSource,
  matchingAuctionScheduleExistsSql,
  performanceActivityCountsSql,
} from '../src/worker/lib/performance-activity.ts';
import { payTypeAtMonthSql } from '../src/worker/lib/pay-type-history.ts';
import { makeBidDedupeKey, upsertBidAnalysisEntry } from '../src/worker/lib/bid-analysis.ts';

function d1FromSqlite(db: Database.Database): any {
  return {
    prepare(sql: string) {
      const statement = db.prepare(sql);
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              const info = statement.run(...params);
              return { meta: { changes: info.changes } };
            },
            async all() { return { results: statement.all(...params) }; },
            async first() { return statement.get(...params) || null; },
          };
        },
        async run() {
          const info = statement.run();
          return { meta: { changes: info.changes } };
        },
        async all() { return { results: statement.all() }; },
        async first() { return statement.get() || null; },
      };
    },
  };
}

test('정규직 일지와 프리랜서 경매 스케줄은 같은 user_id의 연속 활동으로 합산된다', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE journal_entries (
      id TEXT PRIMARY KEY, user_id TEXT, target_date TEXT, activity_type TEXT, data TEXT
    );
    CREATE TABLE freelancer_auction_schedules (
      id TEXT PRIMARY KEY, user_id TEXT, target_date TEXT, activity_type TEXT, data TEXT
    );
    INSERT INTO journal_entries VALUES
      ('j1', 'same-user', '2026-07-10', '임장', '{}'),
      ('j2', 'same-user', '2026-07-11', '미팅', '{}'),
      ('j3', 'same-user', '2026-07-12', '임장', '{"companion":1}');
    INSERT INTO freelancer_auction_schedules VALUES
      ('s1', 'same-user', '2026-08-03', '임장', '{}'),
      ('s2', 'same-user', '2026-08-04', '미팅', '{}'),
      ('s3', 'other-user', '2026-08-04', '임장', '{}');
  `);

  const rows = db.prepare(performanceActivityCountsSql())
    .all('2026-07-01', '2026-08-31') as Array<{ user_id: string; activity_type: string; cnt: number }>;
  const sameUser = Object.fromEntries(
    rows.filter((row) => row.user_id === 'same-user').map((row) => [row.activity_type, row.cnt]),
  );

  assert.deepEqual(sameUser, { 미팅: 2, 임장: 2 });
  assert.equal(rows.find((row) => row.user_id === 'other-user')?.cnt, 1);
  db.close();
});

test('퇴사자는 조회 기간에 과거 일정이 있을 때만 성과 대상에 남는다', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, role TEXT);
    CREATE TABLE journal_entries (id TEXT PRIMARY KEY, user_id TEXT, target_date TEXT);
    CREATE TABLE freelancer_auction_schedules (id TEXT PRIMARY KEY, user_id TEXT, target_date TEXT);
    INSERT INTO users VALUES ('active', 'member'), ('resigned-with-history', 'resigned'), ('resigned-empty', 'resigned');
    INSERT INTO journal_entries VALUES ('j1', 'resigned-with-history', '2026-07-15');
  `);
  const rows = db.prepare(`
    SELECT u.id FROM users u
    WHERE ${archivedPerformanceMemberPredicateSql('u')}
    ORDER BY u.id
  `).all('2026-07-01', '2026-07-31', '2026-07-01', '2026-07-31') as Array<{ id: string }>;
  assert.deepEqual(rows.map((row) => row.id), ['active', 'resigned-with-history']);
  db.close();
});

test('급여형태 이력이 없고 user_accounting도 NULL이면 기존처럼 salary로 판정한다', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE user_pay_type_history (
      user_id TEXT, effective_month TEXT, pay_type TEXT, created_at TEXT
    );
  `);
  const sql = `SELECT ${payTypeAtMonthSql("'user-without-accounting'", "'2026-08'", 'NULL')} AS pay_type`;
  const row = db.prepare(sql).get() as { pay_type: string };
  assert.equal(row.pay_type, 'salary');
  db.close();
});

test('신규 경매 스케줄 입찰 분석 키는 기존 일지 및 다른 일정과 충돌하지 않는다', () => {
  const base = {
    bid_datetime: '2026-08-07',
    case_number: '2026타경1234',
    client_name: '동일고객',
    assignee_name: '동일담당자',
  };
  const journal = makeBidDedupeKey({ ...base, source_type: 'journal', source_id: 'journal-1' });
  const scheduleOne = makeBidDedupeKey({ ...base, source_type: 'freelancer', source_id: 'auction-schedule:one' });
  const scheduleTwo = makeBidDedupeKey({ ...base, source_type: 'freelancer', source_id: 'auction-schedule:two' });

  assert.notEqual(scheduleOne, journal);
  assert.notEqual(scheduleOne, scheduleTwo);
});

test('입찰 분석은 이름이 같아도 담당자 user_id를 권위 식별자로 저장한다', async () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE journal_entries (id TEXT PRIMARY KEY, user_id TEXT);
  `);
  const db = d1FromSqlite(sqlite);

  await upsertBidAnalysisEntry(db, {
    bid_datetime: '2026-08-07',
    assignee_user_id: 'authoritative-user-id',
    assignee_name: '동명이인',
    branch_name: '대전지사',
    case_number: '2026타경777',
    bid_result: '낙찰',
    source_type: 'freelancer',
    source_id: 'auction-schedule:schedule-1',
    uploaded_by: 'authoritative-user-id',
  });

  const row = sqlite.prepare(`
    SELECT assignee_user_id, assignee_name, source_type, source_id
    FROM bid_analysis_entries
  `).get() as Record<string, string>;
  assert.deepEqual(row, {
    assignee_user_id: 'authoritative-user-id',
    assignee_name: '동명이인',
    source_type: 'freelancer',
    source_id: 'auction-schedule:schedule-1',
  });
  sqlite.close();
});

test('일지·경매 스케줄 입찰은 활동 분모에서 중복하지 않고 외부·수동 분석만 보충한다', () => {
  assert.equal(isSupplementalBidAnalysisSource('journal', 'journal-1'), false);
  assert.equal(isSupplementalBidAnalysisSource('freelancer', 'auction-schedule:schedule-1'), false);
  assert.equal(isSupplementalBidAnalysisSource('freelancer', 'freelancer-bid-1'), true);
  assert.equal(isSupplementalBidAnalysisSource('excel', 'upload-1'), true);
  assert.equal(isSupplementalBidAnalysisSource('manual', 'manual-1'), true);
});

test('동일 담당자·입찰일·사건번호의 과거 입찰과 경매 스케줄은 교차 중복으로 식별한다', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE freelancer_bid_entries (id TEXT, user_id TEXT, bid_date TEXT, case_number TEXT);
    CREATE TABLE freelancer_auction_schedules (id TEXT, user_id TEXT, target_date TEXT, activity_type TEXT, data TEXT);
    INSERT INTO freelancer_bid_entries VALUES
      ('legacy-duplicate', 'u1', '2026-08-07', '2026 타경 1234'),
      ('legacy-only', 'u1', '2026-08-08', '2026타경9999');
    INSERT INTO freelancer_auction_schedules VALUES
      ('schedule-1', 'u1', '2026-08-07', '입찰', '{"caseNo":"2026타경1234"}');
  `);
  const rows = db.prepare(`
    SELECT f.id, ${matchingAuctionScheduleExistsSql('f.user_id', 'f.bid_date', 'f.case_number')} AS duplicated
    FROM freelancer_bid_entries f ORDER BY f.id
  `).all() as Array<{ id: string; duplicated: number }>;
  assert.deepEqual(rows, [
    { id: 'legacy-duplicate', duplicated: 1 },
    { id: 'legacy-only', duplicated: 0 },
  ]);
  db.close();
});

test('경매 스케줄 낙찰은 동일 사건의 기존 입금신청을 재사용해 중복 매출을 막는다', async () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE freelancer_bid_entries (
      id TEXT PRIMARY KEY, user_id TEXT, bid_date TEXT, case_number TEXT, updated_at TEXT
    );
    CREATE TABLE sales_records (
      id TEXT PRIMARY KEY, status TEXT, amount INTEGER, winning_price INTEGER, external_id TEXT
    );
    INSERT INTO freelancer_bid_entries VALUES
      ('legacy-1', 'u1', '2026-08-07', '2026 타경 1234', '2026-08-07 15:00:00');
    INSERT INTO sales_records VALUES
      ('sale-legacy', 'pending', 3300000, 330000000, 'freelancer-bid:legacy-1');
  `);
  const db = d1FromSqlite(sqlite);

  const legacy = await findCanonicalBidSale(
    db,
    'auction-schedule:schedule-1',
    'u1',
    '2026-08-07',
    '2026타경1234',
  );
  assert.equal(legacy?.id, 'sale-legacy');
  assert.equal(legacy?.source, 'legacy');

  sqlite.prepare(`INSERT INTO sales_records VALUES (?, ?, ?, ?, ?)`).run(
    'sale-schedule', 'pending', 3300000, 330000000, 'auction-schedule:schedule-1',
  );
  const direct = await findCanonicalBidSale(
    db,
    'auction-schedule:schedule-1',
    'u1',
    '2026-08-07',
    '2026타경1234',
  );
  assert.equal(direct?.id, 'sale-schedule');
  assert.equal(direct?.source, 'schedule');
  sqlite.close();
});
