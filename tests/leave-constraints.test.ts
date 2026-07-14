import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE leave_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      leave_type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      hours REAL NOT NULL DEFAULT 8,
      days REAL NOT NULL DEFAULT 1,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      half_day_period TEXT NOT NULL DEFAULT ''
    );
  `);
  const migration = readFileSync('d1/migrate-leave-request-atomic-constraints.sql', 'utf8');
  db.exec(migration);
  return db;
}

const insertSql = `INSERT INTO leave_requests
  (id, user_id, leave_type, start_date, end_date, hours, days, reason, status, half_day_period, summer_request_year)
  VALUES (?, ?, ?, ?, ?, 8, 1, ?, 'pending', '', ?)`;

test('동시 여름휴가 제출은 사용자·연도당 활성 1건만 성립한다', () => {
  const db = createDb();
  const insert = db.prepare(insertSql);
  insert.run('summer-1', 'user-1', '특별휴가', '2026-07-15', '2026-07-20', '[여름휴가] 3일', '2026');
  assert.throws(() => insert.run(
    'summer-2', 'user-1', '특별휴가', '2026-08-03', '2026-08-05', '[여름휴가] 3일', '2026'
  ), /UNIQUE constraint failed/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM leave_requests WHERE user_id='user-1'").get().count, 1);
  db.close();
});

test('연결 연차 실패 시 같은 트랜잭션의 특별휴가도 저장되지 않는다', () => {
  const db = createDb();
  const insert = db.prepare(insertSql);
  insert.run('existing-annual', 'user-2', '연차', '2026-07-21', '2026-07-21', '기존 연차', null);
  const createSummerWithAnnual = db.transaction(() => {
    insert.run('summer-atomic', 'user-2', '특별휴가', '2026-07-15', '2026-07-20', '[여름휴가] 3일 (연차 1일 연결 뒤)', '2026');
    insert.run('annual-conflict', 'user-2', '연차', '2026-07-21', '2026-07-21', '[여름휴가 연결] 1일', null);
  });
  assert.throws(createSummerWithAnnual, /UNIQUE constraint failed/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM leave_requests WHERE id='summer-atomic'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM leave_requests WHERE user_id='user-2'").get().count, 1);
  db.close();
});

test('반려된 여름휴가는 연 1회 유니크 제약을 점유하지 않는다', () => {
  const db = createDb();
  db.prepare(insertSql).run(
    'rejected-summer', 'user-3', '특별휴가', '2026-07-01', '2026-07-03', '[여름휴가] 3일', '2026'
  );
  db.prepare("UPDATE leave_requests SET status='rejected' WHERE id='rejected-summer'").run();
  db.prepare(insertSql).run(
    'retry-summer', 'user-3', '특별휴가', '2026-08-03', '2026-08-05', '[여름휴가] 3일', '2026'
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM leave_requests WHERE user_id='user-3'").get().count, 2);
  db.close();
});

test('연도 키가 없는 과거 승인 분할 휴가는 그대로 유지할 수 있다', () => {
  const db = createDb();
  const insert = db.prepare(insertSql);
  insert.run('legacy-2days', 'user-4', '특별휴가', '2026-07-27', '2026-07-28', '[여름휴가] 2일', null);
  insert.run('legacy-1day', 'user-4', '특별휴가', '2026-07-29', '2026-07-29', '[여름휴가] 1일', null);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM leave_requests WHERE user_id='user-4'").get().count, 2);
  db.close();
});

test('런타임 스키마 보정 경로에도 두 활성 유니크 인덱스 생성문이 있다', () => {
  const routeSource = readFileSync('src/worker/routes/leave.ts', 'utf8');
  assert.match(routeSource, /CREATE UNIQUE INDEX IF NOT EXISTS \$\{ACTIVE_EXACT_LEAVE_INDEX\}/);
  assert.match(routeSource, /CREATE UNIQUE INDEX IF NOT EXISTS \$\{ACTIVE_SUMMER_LEAVE_INDEX\}/);
  assert.match(routeSource, /await ensureActiveLeaveRequestIndexes\(db\)/);
});
