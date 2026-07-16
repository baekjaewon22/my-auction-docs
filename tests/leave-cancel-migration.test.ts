import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  isLegacyLeaveCancelConstraintError,
  leaveRequestSchemaSupportsCancelRequested,
  LEAVE_CANCEL_SCHEMA_ERROR_CODE,
  markApprovedLeaveCancelRequested,
} from '../src/shared/leave-request-constraints.ts';
import { sumApprovedLeave } from '../src/shared/leave-balance.ts';

const MIGRATION_PATH = 'd1/migrate-leave-request-cancel-status.sql';
const EXPECTED_INDEXES = [
  'idx_leave_requests_date',
  'idx_leave_requests_status',
  'idx_leave_requests_user',
  'uq_leave_requests_active_exact',
  'uq_leave_requests_active_summer_year',
];

function createLegacyDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users (id) VALUES ('user-1'), ('approver-1');

    CREATE TABLE leave_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      leave_type TEXT NOT NULL CHECK (leave_type IN ('연차', '월차', '반차', '시간차', '특별휴가')),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      hours REAL NOT NULL DEFAULT 8,
      days REAL NOT NULL DEFAULT 1,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
      approved_by TEXT,
      approved_at TEXT,
      reject_reason TEXT,
      branch TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      half_day_period TEXT NOT NULL DEFAULT '',
      first_approved_by TEXT NOT NULL DEFAULT '',
      first_approved_at TEXT NOT NULL DEFAULT '',
      request_group_id TEXT,
      summer_request_year TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (approved_by) REFERENCES users(id)
    );

    CREATE INDEX idx_leave_requests_user ON leave_requests(user_id);
    CREATE INDEX idx_leave_requests_status ON leave_requests(status);
    CREATE INDEX idx_leave_requests_date ON leave_requests(start_date);
    CREATE UNIQUE INDEX uq_leave_requests_active_exact
      ON leave_requests (user_id, leave_type, start_date, end_date, COALESCE(half_day_period, ''))
      WHERE status IN ('pending', 'approved', 'cancel_requested');
    CREATE UNIQUE INDEX uq_leave_requests_active_summer_year
      ON leave_requests (user_id, summer_request_year)
      WHERE summer_request_year IS NOT NULL
        AND status IN ('pending', 'approved', 'cancel_requested');
  `);
  return db;
}

function insertFixtureRows(db: Database.Database) {
  const insert = db.prepare(`INSERT INTO leave_requests (
    id, user_id, leave_type, start_date, end_date, hours, days, reason, status,
    approved_by, approved_at, reject_reason, branch, department, created_at,
    updated_at, half_day_period, first_approved_by, first_approved_at,
    request_group_id, summer_request_year
  ) VALUES (
    @id, 'user-1', @leave_type, @start_date, @end_date, @hours, @days, @reason, @status,
    @approved_by, @approved_at, @reject_reason, '서울지사', '경매사업부', @created_at,
    @updated_at, @half_day_period, @first_approved_by, @first_approved_at,
    @request_group_id, @summer_request_year
  )`);

  insert.run({
    id: 'approved-annual', leave_type: '연차', start_date: '2026-07-21', end_date: '2026-07-21',
    hours: 8, days: 1, reason: '승인 연차', status: 'approved', approved_by: 'approver-1',
    approved_at: '2026-07-10 01:02:03', reject_reason: null, created_at: '2026-07-09 01:02:03',
    updated_at: '2026-07-10 01:02:03', half_day_period: '', first_approved_by: 'approver-1',
    first_approved_at: '2026-07-09 05:06:07', request_group_id: 'group-1', summer_request_year: null,
  });
  insert.run({
    id: 'pending-half', leave_type: '반차', start_date: '2026-07-22', end_date: '2026-07-22',
    hours: 4, days: 0.5, reason: '오후 반차', status: 'pending', approved_by: null,
    approved_at: null, reject_reason: null, created_at: '2026-07-11 02:03:04',
    updated_at: '2026-07-11 02:03:04', half_day_period: '오후', first_approved_by: '',
    first_approved_at: '', request_group_id: null, summer_request_year: null,
  });
  insert.run({
    id: 'cancelled-summer', leave_type: '특별휴가', start_date: '2026-07-15', end_date: '2026-07-20',
    hours: 24, days: 3, reason: '[여름휴가] 3일', status: 'cancelled', approved_by: 'approver-1',
    approved_at: '2026-07-01 01:00:00', reject_reason: null, created_at: '2026-06-30 01:00:00',
    updated_at: '2026-07-12 01:00:00', half_day_period: '', first_approved_by: 'approver-1',
    first_approved_at: '2026-07-01 00:30:00', request_group_id: 'group-2', summer_request_year: '2026',
  });
}

function snapshot(db: Database.Database) {
  return db.prepare('SELECT * FROM leave_requests ORDER BY id').all();
}

class TestD1Statement {
  private readonly db: Database.Database;
  private readonly sql: string;
  private readonly values: unknown[];

  constructor(db: Database.Database, sql: string, values: unknown[] = []) {
    this.db = db;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: unknown[]) {
    return new TestD1Statement(this.db, this.sql, values);
  }

  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }

  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[] };
  }

  async run() {
    const result = this.db.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: result.changes } };
  }
}

function d1Adapter(db: Database.Database) {
  return {
    prepare(sql: string) {
      return new TestD1Statement(db, sql);
    },
  };
}

test('구형 운영 스키마는 일반 담당자의 승인 휴가 취소요청 상태를 거절한다', () => {
  const db = createLegacyDb();
  insertFixtureRows(db);
  let caught: unknown;
  try {
    db.prepare("UPDATE leave_requests SET status = 'cancel_requested' WHERE id = 'approved-annual'").run();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  assert.equal(isLegacyLeaveCancelConstraintError(caught), true);
  assert.equal(isLegacyLeaveCancelConstraintError(new Error('D1_ERROR: CHECK constraint failed: leave_requests: SQLITE_CONSTRAINT_CHECK')), true);
  assert.equal(LEAVE_CANCEL_SCHEMA_ERROR_CODE, 'LEAVE_CANCEL_SCHEMA_OUTDATED');
  assert.equal(db.prepare("SELECT status FROM leave_requests WHERE id = 'approved-annual'").pluck().get(), 'approved');
  db.close();
});

test('취소요청 처리는 실제 테이블 스키마를 먼저 검사하고 구형 DB에서는 503 계약을 반환한다', async () => {
  const db = createLegacyDb();
  insertFixtureRows(db);
  const legacySql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='leave_requests'").pluck().get();
  assert.equal(leaveRequestSchemaSupportsCancelRequested(legacySql), false);

  const blocked = await markApprovedLeaveCancelRequested(d1Adapter(db) as any, 'approved-annual');
  assert.deepEqual(blocked, {
    success: false,
    status: 503,
    body: {
      error: '휴가 취소 신청을 처리할 수 없습니다. 관리자에게 문의해 주세요. (오류코드: LEAVE_CANCEL_SCHEMA_OUTDATED)',
      code: 'LEAVE_CANCEL_SCHEMA_OUTDATED',
    },
  });
  assert.equal(db.prepare("SELECT status FROM leave_requests WHERE id='approved-annual'").pluck().get(), 'approved');

  db.exec(readFileSync(MIGRATION_PATH, 'utf8'));
  const currentSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='leave_requests'").pluck().get();
  assert.equal(leaveRequestSchemaSupportsCancelRequested(currentSql), true);
  assert.deepEqual(await markApprovedLeaveCancelRequested(d1Adapter(db) as any, 'approved-annual'), { success: true });
  assert.equal(db.prepare("SELECT status FROM leave_requests WHERE id='approved-annual'").pluck().get(), 'cancel_requested');
  db.close();
});

test('취소요청 처리 중 일반 DB 오류는 숨기지 않고 다시 발생시킨다', async () => {
  const db = {
    prepare(sql: string) {
      if (sql.includes('sqlite_master')) {
        return { first: async () => ({ sql: "CREATE TABLE leave_requests (status TEXT CHECK(status IN ('approved','cancel_requested')))" }) };
      }
      return {
        bind() { return this; },
        async run() { throw new Error('network unavailable'); },
      };
    },
  };
  await assert.rejects(() => markApprovedLeaveCancelRequested(db as any, 'request-1'), /network unavailable/);
});

test('마이그레이션은 21개 컬럼의 데이터를 보존하고 cancel_requested와 인덱스 5개를 복원한다', () => {
  const db = createLegacyDb();
  insertFixtureRows(db);
  const before = snapshot(db);
  const migration = readFileSync(MIGRATION_PATH, 'utf8');

  db.transaction(() => db.exec(migration))();

  const after = snapshot(db);
  assert.deepEqual(after, before);
  assert.equal(db.prepare("SELECT COUNT(*) FROM pragma_table_info('leave_requests')").pluck().get(), 21);

  const tableSql = String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='leave_requests'").pluck().get());
  assert.match(tableSql, /cancel_requested/);
  assert.deepEqual(
    db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='leave_requests' AND sql IS NOT NULL ORDER BY name").pluck().all(),
    EXPECTED_INDEXES,
  );

  db.prepare("UPDATE leave_requests SET status = 'cancel_requested' WHERE id = 'approved-annual'").run();
  assert.equal(db.prepare("SELECT status FROM leave_requests WHERE id = 'approved-annual'").pluck().get(), 'cancel_requested');
  db.prepare("UPDATE leave_requests SET status = 'cancelled' WHERE id = 'approved-annual'").run();
  assert.equal(db.prepare("SELECT status FROM leave_requests WHERE id = 'approved-annual'").pluck().get(), 'cancelled');
  assert.equal(db.pragma('foreign_key_check').length, 0);
  db.close();
});

test('마이그레이션 전체가 실패하면 원본 구형 테이블과 데이터가 롤백된다', () => {
  const db = createLegacyDb();
  insertFixtureRows(db);
  const before = snapshot(db);
  const migration = readFileSync(MIGRATION_PATH, 'utf8');

  assert.throws(() => db.transaction(() => {
    db.exec(migration);
    throw new Error('forced verification failure');
  })(), /forced verification failure/);

  assert.deepEqual(snapshot(db), before);
  const tableSql = String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='leave_requests'").pluck().get());
  assert.doesNotMatch(tableSql, /cancel_requested/);
  db.close();
});

test('실제 승인휴가 합산 로직은 취소요청을 제외하고 관리자 최종 승인 후 복원값을 계산한다', async () => {
  const db = createLegacyDb();
  insertFixtureRows(db);
  db.exec(readFileSync(MIGRATION_PATH, 'utf8'));
  db.exec(`
    CREATE TABLE annual_leave (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      total_days REAL NOT NULL DEFAULT 15,
      used_days REAL NOT NULL DEFAULT 0,
      monthly_days REAL NOT NULL DEFAULT 0,
      monthly_used REAL NOT NULL DEFAULT 0,
      manual_total_adjust_days REAL NOT NULL DEFAULT 0,
      manual_used_adjust_days REAL NOT NULL DEFAULT 0,
      leave_type TEXT NOT NULL DEFAULT 'annual',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO annual_leave (id, user_id, total_days, used_days, leave_type)
    VALUES ('annual-1', 'user-1', 15, 1, 'annual');
  `);

  const d1 = d1Adapter(db) as any;
  const approvedUsage = await sumApprovedLeave(d1, 'user-1', 'annual', null);
  assert.equal(approvedUsage.used_days, 1);
  db.prepare("UPDATE annual_leave SET used_days = ? WHERE user_id = 'user-1'").run(approvedUsage.used_days);

  db.prepare("UPDATE leave_requests SET status = 'cancel_requested' WHERE id = 'approved-annual'").run();
  assert.equal(db.prepare("SELECT used_days FROM annual_leave WHERE user_id = 'user-1'").pluck().get(), 1);
  assert.equal((await sumApprovedLeave(d1, 'user-1', 'annual', null)).used_days, 0);

  db.prepare("UPDATE leave_requests SET status = 'cancelled' WHERE id = 'approved-annual'").run();
  const restoredUsage = await sumApprovedLeave(d1, 'user-1', 'annual', null);
  db.prepare("UPDATE annual_leave SET used_days = ? WHERE user_id = 'user-1'").run(restoredUsage.used_days);
  assert.equal(db.prepare("SELECT used_days FROM annual_leave WHERE user_id = 'user-1'").pluck().get(), 0);
  db.close();
});
