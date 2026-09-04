import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import {
  buildPersonalCalendarAuctionEvents,
  buildPersonalCalendarInspectionEvents,
  kstDateKey,
  loadPersonalCalendarAuctionRows,
  toPublicPersonalCalendarAuctionEvent,
  toPublicPersonalCalendarInspectionEvent,
  type CalendarAuctionScheduleRow,
} from '../src/worker/lib/personal-calendar-auction-events.ts';
import {
  CalendarAuctionManagementError,
  deleteCalendarAuctionEvent,
  resolveCalendarAuctionEvent,
} from '../src/worker/lib/calendar-auction-management.ts';
import {
  acquireAuctionScheduleMutationClaim,
  releaseAuctionScheduleMutationClaim,
  type AuctionScheduleMutationSnapshot,
} from '../src/worker/lib/auction-schedule-mutation-claim.ts';
import {
  PERSONAL_CALENDAR_MANAGEMENT_ROLES,
  canManagePersonalCalendar,
} from '../src/shared/personal-calendar-management.ts';
import { createToken } from '../src/worker/middleware/auth.ts';
import personalCalendar from '../src/worker/routes/personal-calendar.ts';
import publicCalendar from '../src/worker/routes/public-calendar.ts';
import type { AuthEnv, JwtPayload, Role } from '../src/worker/types.ts';

class TestStatement {
  private readonly sqlite: Database.Database;
  private readonly sql: string;
  private readonly params: unknown[];
  constructor(sqlite: Database.Database, sql: string, params: unknown[] = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.params = params;
  }
  bind(...params: unknown[]) { return new TestStatement(this.sqlite, this.sql, params); }
  async all<T>() { return { results: this.sqlite.prepare(this.sql).all(...this.params) as T[] }; }
  async first<T>() { return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) || null; }
  execute() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: result.changes } };
  }
  async run() { return this.execute(); }
}

class TestD1 {
  beforeNextBatch?: () => void;
  readonly sqlite: Database.Database;
  constructor(sqlite: Database.Database) { this.sqlite = sqlite; }
  prepare(sql: string) { return new TestStatement(this.sqlite, sql); }
  async batch(statements: TestStatement[]) {
    const before = this.beforeNextBatch;
    this.beforeNextBatch = undefined;
    if (before) before();
    return this.sqlite.transaction((items: TestStatement[]) => items.map(statement => statement.execute()))(statements);
  }
}

function scheduleRow(overrides: Partial<CalendarAuctionScheduleRow>): CalendarAuctionScheduleRow {
  return {
    id: 'bid-1',
    user_id: 'owner',
    user_name: '담당자',
    position_title: '과장',
    source_kind: 'bid',
    event_date: '2026-09-15',
    source_target_date: '2026-09-15',
    activity_subtype: '',
    branch: '의정부지사',
    department: '경매사업부',
    data: JSON.stringify({ caseNo: '2026타경1', court: '의정부지방법원', itemNo: '1', propertyType: '아파트', client: '고객' }),
    created_at: '2026-09-01 09:00:00',
    updated_at: '2026-09-01 09:00:00',
    ...overrides,
  };
}

function setup() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
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
      department TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE sales_records (
      id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending', amount INTEGER NOT NULL DEFAULT 0,
      winning_price INTEGER NOT NULL DEFAULT 0, external_id TEXT
    );
    CREATE TABLE commissions (
      id TEXT PRIMARY KEY, journal_entry_id TEXT, status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE freelancer_bid_entries (
      id TEXT PRIMARY KEY, user_id TEXT, bid_date TEXT, case_number TEXT,
      court TEXT, item_no TEXT, client_name TEXT, bidder_name TEXT, updated_at TEXT
    );
    CREATE TABLE lawitgo_winning_outbox (
      id TEXT PRIMARY KEY, sales_record_id TEXT, status TEXT
    );
    CREATE TABLE auction_bid_result_reminder_runs (
      id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL,
      target_date TEXT NOT NULL, missing_fields_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending', sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users (id,email,name,role,branch,department,position_title,login_type) VALUES
      ('owner','owner@example.com','담당자','member','의정부지사','경매사업부','과장','freelancer'),
      ('master','master@example.com','마스터','master','의정부본사','관리','마스터','employee'),
      ('accountant','accountant@example.com','총무','accountant','의정부본사','관리','총무','employee'),
      ('ceo','ceo@example.com','대표','ceo','의정부본사','관리','대표','employee'),
      ('asst','asst@example.com','총무보조','accountant_asst','의정부본사','관리','총무보조','employee');
  `);
  const db = new TestD1(sqlite);
  const insert = sqlite.prepare(`
    INSERT INTO freelancer_auction_schedules (
      id, user_id, target_date, activity_type, activity_subtype, data, branch, department, created_at, updated_at
    ) VALUES (?, 'owner', ?, ?, '', ?, '의정부지사', '경매사업부', '2026-09-01 09:00:00', ?)
  `);
  const common = { caseNo: '2026타경1', court: '의정부지방법원', itemNo: '1', propertyType: '아파트', client: '고객' };
  const addMerged = () => {
    insert.run('inspection-1', '2026-09-01', '임장', JSON.stringify({ ...common, bidDate: '2026-09-15' }), '2026-09-01 09:00:00');
    insert.run('inspection-bid:inspection-1', '2026-09-15', '입찰', JSON.stringify({ ...common, inspectionSourceId: 'inspection-1' }), '2026-09-01 09:00:00');
  };
  return { sqlite, db, insert, common, addMerged };
}

test('캘린더 관리 역할은 master와 accountant만 공유 상수로 허용한다', () => {
  assert.deepEqual([...PERSONAL_CALENDAR_MANAGEMENT_ROLES], ['master', 'accountant']);
  assert.equal(canManagePersonalCalendar({ role: 'master' }), true);
  assert.equal(canManagePersonalCalendar({ role: 'accountant' }), true);
  assert.equal(canManagePersonalCalendar({ role: 'ceo' }), false);
  assert.equal(canManagePersonalCalendar({ role: 'accountant_asst' }), false);

  const rows = [
    scheduleRow({
      id: 'inspection-1', source_kind: 'inspection', source_target_date: '2026-09-01',
      data: JSON.stringify({ caseNo: '2026타경1', court: '의정부지방법원', itemNo: '1', propertyType: '아파트', client: '고객', bidDate: '2026-09-15' }),
    }),
    scheduleRow({ id: 'inspection-bid:inspection-1', data: JSON.stringify({
      caseNo: '2026타경1', court: '의정부지방법원', itemNo: '1',
      propertyType: '아파트', client: '고객', inspectionSourceId: 'inspection-1',
    }) }),
  ];
  const [event] = buildPersonalCalendarAuctionEvents(rows);
  const master = toPublicPersonalCalendarAuctionEvent(event, { id: 'master', role: 'master' });
  const ceo = toPublicPersonalCalendarAuctionEvent(event, { id: 'ceo', role: 'ceo' });
  assert.equal(master.management?.can_delete, 1);
  assert.equal(master.management?.origin_kind, 'direct_bid');
  assert.match(master.management?.delete_warning || '', /원본 일정 2건/);
  assert.equal(ceo.management, undefined);
  assert.doesNotMatch(JSON.stringify(master), /source_snapshots|source_data|owner_id/);
});

test('mutation claim DDL은 schema·forward migration·runtime에 있고 migration은 재적용 가능하다', () => {
  const schema = readFileSync(new URL('../d1/schema.sql', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../d1/migrate-auction-schedule-mutation-claims.sql', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../src/worker/lib/auction-schedule-mutation-claim.ts', import.meta.url), 'utf8');
  for (const source of [schema, migration, runtime]) {
    assert.match(source, /CREATE TABLE IF NOT EXISTS auction_schedule_mutation_claims/);
    assert.match(source, /schedule_id TEXT PRIMARY KEY/);
    assert.match(source, /claim_token TEXT NOT NULL UNIQUE/);
  }
  const sqlite = new Database(':memory:');
  sqlite.exec(migration);
  sqlite.exec(migration);
  assert.equal(sqlite.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='auction_schedule_mutation_claims'").pluck().get(), 1);
  sqlite.close();
});

test('병합 입찰 삭제는 direct bid와 임장 projection·분석·알림·감사로그를 한 batch로 처리한다', async () => {
  const { sqlite, db, addMerged } = setup();
  addMerged();
  sqlite.exec(`
    CREATE TABLE bid_analysis_entries (
      id TEXT PRIMARY KEY, bid_datetime TEXT, assignee_user_id TEXT, assignee_name TEXT,
      branch_name TEXT, case_number TEXT, property_type TEXT, suggested_bid_price INTEGER,
      actual_bid_price INTEGER, winning_price INTEGER, is_won INTEGER DEFAULT 0,
      bid_result TEXT DEFAULT '실패', client_name TEXT, source_type TEXT, source_id TEXT,
      source_file_name TEXT, upload_batch TEXT, uploaded_by TEXT, dedupe_key TEXT,
      manual_override INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT
    );
    INSERT INTO bid_analysis_entries (id, source_type, source_id) VALUES
      ('a1', 'freelancer', 'auction-schedule:inspection-bid:inspection-1'),
      ('a2', 'freelancer', 'auction-schedule:inspection-1'),
      ('a3', 'freelancer', 'auction_schedule:inspection-bid:inspection-1');
    INSERT INTO auction_bid_result_reminder_runs (id, schedule_id, user_id, target_date)
      VALUES ('r1', 'inspection-bid:inspection-1', 'owner', '2026-09-15');
  `);
  const resolved = await resolveCalendarAuctionEvent(db as unknown as D1Database, 'auction_bid', 'inspection-bid:inspection-1');
  assert.deepEqual(resolved.target_snapshots.map(row => row.id).sort(), ['inspection-1', 'inspection-bid:inspection-1']);
  const result = await deleteCalendarAuctionEvent(db as unknown as D1Database, {
    sub: 'master', name: '마스터', role: 'master',
  }, {
    source_type: 'auction_bid', source_id: 'inspection-bid:inspection-1', revision: resolved.revision,
  });
  assert.deepEqual(result.deleted_source_ids.sort(), ['inspection-1', 'inspection-bid:inspection-1']);
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM freelancer_auction_schedules').pluck().get(), 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM bid_analysis_entries').pluck().get(), 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM auction_bid_result_reminder_runs').pluck().get(), 0);
  const audit = sqlite.prepare(`
    SELECT actor_role, target_type, source_page, before_snapshot
    FROM accounting_activity_logs
  `).get() as any;
  assert.equal(audit.actor_role, 'master');
  assert.equal(audit.target_type, 'auction_schedule');
  assert.equal(audit.source_page, 'personal_calendar');
  assert.match(audit.before_snapshot, /activity_subtype/);
  sqlite.close();
});

test('빈 물건번호는 item 1·2를 서로 합치지 않고 선택 원본만 안전하게 삭제한다', async () => {
  const { sqlite, db, insert, common } = setup();
  insert.run('bid-item-2', '2026-09-15', '입찰', JSON.stringify({ ...common, itemNo: '2' }), '2026-09-01 09:00:01');
  insert.run('bid-item-1', '2026-09-15', '입찰', JSON.stringify({ ...common, itemNo: '1' }), '2026-09-01 09:00:02');
  insert.run('bid-item-blank', '2026-09-15', '입찰', JSON.stringify({ ...common, itemNo: '' }), '2026-09-01 09:00:03');

  const rows = [
    scheduleRow({ id: 'bid-item-2', data: JSON.stringify({ ...common, itemNo: '2' }), updated_at: '2026-09-01 09:00:01' }),
    scheduleRow({ id: 'bid-item-1', data: JSON.stringify({ ...common, itemNo: '1' }), updated_at: '2026-09-01 09:00:02' }),
    scheduleRow({ id: 'bid-item-blank', data: JSON.stringify({ ...common, itemNo: '' }), updated_at: '2026-09-01 09:00:03' }),
  ];
  const events = buildPersonalCalendarAuctionEvents(rows);
  assert.equal(events.length, 2, '빈 물건번호가 명시 물건번호 1·2를 한 이벤트로 연결하면 안 된다');
  assert.equal(events.reduce((count, event) => count + event.source_snapshots.length, 0), 3);
  for (const event of events) {
    const explicitItems = new Set(event.source_snapshots
      .map(source => String((JSON.parse(source.data) as { itemNo?: string }).itemNo || '').trim())
      .filter(Boolean));
    assert.ok(explicitItems.size <= 1, '한 이벤트에는 서로 다른 명시 물건번호가 함께 있으면 안 된다');
  }

  const publicApp = new Hono<AuthEnv>().route('/api/public/calendar', publicCalendar);
  const publicResponse = await publicApp.request('/api/public/calendar?from=2026-09-15&to=2026-09-15', {
    headers: { 'X-API-Key': 'calendar-key' },
  }, {
    DB: db as unknown as D1Database,
    CALENDAR_API_KEY: 'calendar-key',
  } as unknown as Env);
  assert.equal(publicResponse.status, 200);
  const publicPayload = await publicResponse.json() as { count: number; events: unknown[] };
  assert.equal(publicPayload.count, 2, '공개 API도 서로 다른 물건 2건을 모두 반환해야 한다');
  assert.equal(publicPayload.events.length, 2);

  const blankEvent = events.find(event => event.source_snapshots.some(source => source.id === 'bid-item-blank'));
  assert.ok(blankEvent);
  const displayed = toPublicPersonalCalendarAuctionEvent(blankEvent, { id: 'master', role: 'master' });
  assert.equal(displayed.management?.source_id, 'bid-item-blank');
  assert.equal(displayed.management?.can_delete, 1);

  const result = await deleteCalendarAuctionEvent(db as unknown as D1Database, { sub: 'master', role: 'master' }, {
    source_type: 'auction_bid',
    source_id: 'bid-item-blank',
    revision: displayed.management?.revision || '',
  });
  assert.deepEqual(result.deleted_source_ids, ['bid-item-blank']);
  assert.deepEqual(
    sqlite.prepare('SELECT id FROM freelancer_auction_schedules ORDER BY id').pluck().all(),
    ['bid-item-1', 'bid-item-2'],
  );
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM accounting_activity_logs').pluck().get(), 1);
  sqlite.close();
});

test('같은 사건·물건의 고객 A/B 일정은 표시가 합쳐져도 선택 원본만 삭제한다', async () => {
  const { sqlite, db, insert, common } = setup();
  const dataA = { ...common, client: '고객 A' };
  const dataB = { ...common, client: '고객 B' };
  insert.run('bid-customer-a', '2026-09-15', '입찰', JSON.stringify(dataA), '2026-09-01 09:00:00');
  insert.run('bid-customer-b', '2026-09-15', '입찰', JSON.stringify(dataB), '2026-09-01 09:00:01');
  const events = buildPersonalCalendarAuctionEvents([
    scheduleRow({ id: 'bid-customer-a', data: JSON.stringify(dataA), updated_at: '2026-09-01 09:00:00' }),
    scheduleRow({ id: 'bid-customer-b', data: JSON.stringify(dataB), updated_at: '2026-09-01 09:00:01' }),
  ]);
  assert.equal(events.length, 1);
  const displayed = toPublicPersonalCalendarAuctionEvent(events[0], { id: 'master', role: 'master' });
  assert.equal(displayed.management?.source_id, 'bid-customer-b');
  assert.match(displayed.management?.delete_warning || '', /같은 일정 칩이 계속 표시/);

  const resolved = await resolveCalendarAuctionEvent(db as unknown as D1Database, 'auction_bid', 'bid-customer-b');
  assert.deepEqual(resolved.target_snapshots.map(row => row.id), ['bid-customer-b']);
  await deleteCalendarAuctionEvent(db as unknown as D1Database, { sub: 'master', role: 'master' }, {
    source_type: 'auction_bid', source_id: 'bid-customer-b', revision: resolved.revision,
  });
  assert.deepEqual(sqlite.prepare('SELECT id FROM freelancer_auction_schedules ORDER BY id').pluck().all(), ['bid-customer-a']);
  sqlite.close();
});

test('deterministic materialized ID만 cascade하고 같은 표시의 다른 임장은 보존한다', async () => {
  const { sqlite, db, insert, common } = setup();
  insert.run('inspection-a', '2026-09-01', '임장', JSON.stringify({ ...common, client: 'A', bidDate: '2026-09-15' }), '2026-09-01 09:00:00');
  insert.run('inspection-b', '2026-09-01', '임장', JSON.stringify({ ...common, client: 'B', bidDate: '2026-09-15' }), '2026-09-01 09:00:01');
  insert.run('inspection-bid:inspection-a', '2026-09-15', '입찰', JSON.stringify({
    ...common,
    client: 'A',
    inspectionSourceId: 'inspection-a',
    materializedBidGroup: '의정부지방법원|2026타경1',
    materializedBidItem: '1',
  }), '2026-09-01 09:00:02');

  const resolved = await resolveCalendarAuctionEvent(
    db as unknown as D1Database,
    'auction_bid',
    'inspection-bid:inspection-a',
  );
  assert.deepEqual(resolved.target_snapshots.map(row => row.id).sort(), [
    'inspection-a',
    'inspection-bid:inspection-a',
  ]);
  await deleteCalendarAuctionEvent(db as unknown as D1Database, { sub: 'master', role: 'master' }, {
    source_type: 'auction_bid', source_id: 'inspection-bid:inspection-a', revision: resolved.revision,
  });
  assert.deepEqual(sqlite.prepare('SELECT id FROM freelancer_auction_schedules ORDER BY id').pluck().all(), ['inspection-b']);
  sqlite.close();
});

test('direct bid의 연결 원본이 표시 묶음에 없으면 삭제를 fail-closed한다', () => {
  const [event] = buildPersonalCalendarAuctionEvents([scheduleRow({
    id: 'inspection-bid:missing-inspection',
    data: JSON.stringify({
      caseNo: '2026타경1', court: '의정부지방법원', itemNo: '1',
      propertyType: '아파트', client: '고객', inspectionSourceId: 'missing-inspection',
    }),
  })]);
  const displayed = toPublicPersonalCalendarAuctionEvent(event, { id: 'master', role: 'master' });
  assert.equal(displayed.management?.can_delete, 0);
  assert.match(displayed.management?.block_reason || '', /연결된 원본 임장 일정/);
});

test('표시 지사와 저장 원본 지사를 분리해 담당자 지사 이동 뒤에도 revision 삭제가 일치한다', async () => {
  for (const kind of ['bid', 'inspection'] as const) {
    const { sqlite, db, insert, common } = setup();
    sqlite.prepare("UPDATE users SET branch = '서초지사' WHERE id = 'owner'").run();
    if (kind === 'bid') {
      insert.run('moved-bid', '2026-09-15', '입찰', JSON.stringify(common), '2026-09-01 09:00:00');
      const rows = await loadPersonalCalendarAuctionRows(
        db as unknown as D1Database,
        '2026-09-15',
        '2026-09-15',
        { mode: 'self', value: 'owner' },
      );
      assert.equal(rows[0].branch, '서초지사');
      assert.equal(rows[0].source_branch, '의정부지사');
      const [event] = buildPersonalCalendarAuctionEvents(rows);
      assert.equal(event.branch, '서초지사');
      assert.equal(event.source_snapshots[0].branch, '의정부지사');
      const resolved = await resolveCalendarAuctionEvent(db as unknown as D1Database, 'auction_bid', 'moved-bid');
      await deleteCalendarAuctionEvent(db as unknown as D1Database, { sub: 'master', role: 'master' }, {
        source_type: 'auction_bid', source_id: 'moved-bid', revision: resolved.revision,
      });
    } else {
      insert.run('moved-inspection', '2026-09-01', '임장', JSON.stringify({ ...common, bidDate: '2026-09-15' }), '2026-09-01 09:00:00');
      const resolved = await resolveCalendarAuctionEvent(db as unknown as D1Database, 'auction_inspection', 'moved-inspection');
      assert.equal(resolved.target_snapshots[0].branch, '의정부지사');
      await deleteCalendarAuctionEvent(db as unknown as D1Database, { sub: 'accountant', role: 'accountant' }, {
        source_type: 'auction_inspection', source_id: 'moved-inspection', revision: resolved.revision,
      });
    }
    assert.equal(sqlite.prepare('SELECT COUNT(*) FROM freelancer_auction_schedules').pluck().get(), 0);
    sqlite.close();
  }
});

test('mutation claim과 캘린더 삭제는 양방향으로 상호 배제한다', async () => {
  const { sqlite, db, insert, common } = setup();
  insert.run('claimed-bid', '2026-09-15', '입찰', JSON.stringify(common), '2026-09-01 09:00:00');
  const d1 = db as unknown as D1Database;
  const resolved = await resolveCalendarAuctionEvent(d1, 'auction_bid', 'claimed-bid');
  const snapshot = sqlite.prepare("SELECT * FROM freelancer_auction_schedules WHERE id = 'claimed-bid'").get() as AuctionScheduleMutationSnapshot;
  const claim = await acquireAuctionScheduleMutationClaim(d1, snapshot, 'test-result-first', 'owner');
  assert.ok(claim);
  await assert.rejects(
    () => deleteCalendarAuctionEvent(d1, { sub: 'master', role: 'master' }, {
      source_type: 'auction_bid', source_id: 'claimed-bid', revision: resolved.revision,
    }),
    (error: unknown) => error instanceof CalendarAuctionManagementError && error.code === 'mutation_in_progress',
  );
  await releaseAuctionScheduleMutationClaim(d1, claim);
  await deleteCalendarAuctionEvent(d1, { sub: 'master', role: 'master' }, {
    source_type: 'auction_bid', source_id: 'claimed-bid', revision: resolved.revision,
  });
  assert.equal(await acquireAuctionScheduleMutationClaim(d1, snapshot, 'test-delete-first', 'owner'), null);
  sqlite.close();
});

test('임장 칩 삭제는 선택한 임장 원본만 지우고 별도 direct bid는 보존한다', async () => {
  const { sqlite, db, addMerged } = setup();
  addMerged();
  const [inspectionInternal] = buildPersonalCalendarInspectionEvents([scheduleRow({
    id: 'inspection-1',
    source_kind: 'inspection',
    event_date: '2026-09-01',
    source_target_date: '2026-09-01',
    data: JSON.stringify({
      caseNo: '2026타경1', court: '의정부지방법원', itemNo: '1',
      propertyType: '아파트', client: '고객', bidDate: '2026-09-15',
    }),
  })]);
  const inspection = toPublicPersonalCalendarInspectionEvent(inspectionInternal, { id: 'master', role: 'master' });
  assert.match(inspection.management?.delete_warning || '', /원본 임장 일정만 삭제/);
  assert.match(inspection.management?.delete_warning || '', /별도 입찰 일정.*유지/);
  const resolved = await resolveCalendarAuctionEvent(db as unknown as D1Database, 'auction_inspection', 'inspection-1');
  await deleteCalendarAuctionEvent(db as unknown as D1Database, {
    sub: 'accountant', name: '총무', role: 'accountant',
  }, {
    source_type: 'auction_inspection', source_id: 'inspection-1', revision: resolved.revision,
  });
  assert.deepEqual(sqlite.prepare('SELECT id FROM freelancer_auction_schedules ORDER BY id').pluck().all(), ['inspection-bid:inspection-1']);
  sqlite.close();
});

test('낡은 revision과 캘린더 비관리 역할은 원본을 삭제하지 못한다', async () => {
  const { sqlite, db, addMerged } = setup();
  addMerged();
  const resolved = await resolveCalendarAuctionEvent(db as unknown as D1Database, 'auction_bid', 'inspection-bid:inspection-1');
  sqlite.prepare("UPDATE freelancer_auction_schedules SET data = ?, updated_at = '2026-09-01 09:00:01' WHERE id = 'inspection-bid:inspection-1'")
    .run(JSON.stringify({ caseNo: '2026타경1', court: '의정부지방법원', propertyType: '연립', client: '고객' }));
  await assert.rejects(
    () => deleteCalendarAuctionEvent(db as unknown as D1Database, { sub: 'master', role: 'master' }, {
      source_type: 'auction_bid', source_id: 'inspection-bid:inspection-1', revision: resolved.revision,
    }),
    (error: unknown) => error instanceof CalendarAuctionManagementError && error.code === 'revision_conflict',
  );
  for (const actor of [{ sub: 'ceo', role: 'ceo' }, { sub: 'asst', role: 'accountant_asst' }]) {
    await assert.rejects(
      () => deleteCalendarAuctionEvent(db as unknown as D1Database, actor, {
        source_type: 'auction_bid', source_id: 'inspection-bid:inspection-1', revision: 'ignored',
      }),
      (error: unknown) => error instanceof CalendarAuctionManagementError && error.code === 'permission_denied',
    );
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM freelancer_auction_schedules').pluck().get(), 2);
  sqlite.close();
});

test('batch 직전 비표시 필드가 updated_at 없이 바뀌어도 snapshot guard가 삭제를 중단한다', async () => {
  const { sqlite, db, insert, common } = setup();
  insert.run('snapshot-bid', '2026-09-15', '입찰', JSON.stringify(common), '2026-09-01 09:00:00');
  const resolved = await resolveCalendarAuctionEvent(db as unknown as D1Database, 'auction_bid', 'snapshot-bid');
  db.beforeNextBatch = () => {
    sqlite.prepare("UPDATE freelancer_auction_schedules SET activity_subtype = '동시 변경' WHERE id = 'snapshot-bid'").run();
  };
  await assert.rejects(
    () => deleteCalendarAuctionEvent(db as unknown as D1Database, { sub: 'master', role: 'master' }, {
      source_type: 'auction_bid', source_id: 'snapshot-bid', revision: resolved.revision,
    }),
    (error: unknown) => error instanceof CalendarAuctionManagementError && error.code === 'revision_conflict',
  );
  assert.equal(sqlite.prepare("SELECT activity_subtype FROM freelancer_auction_schedules WHERE id = 'snapshot-bid'").pluck().get(), '동시 변경');
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM accounting_activity_logs').pluck().get(), 0);
  sqlite.close();
});

test('batch 직전 관리자 role 또는 approved가 바뀌면 권한 guard가 삭제를 중단한다', async () => {
  for (const mutation of ['role', 'approved'] as const) {
    const { sqlite, db, insert, common } = setup();
    insert.run('permission-bid', '2026-09-15', '입찰', JSON.stringify(common), '2026-09-01 09:00:00');
    const resolved = await resolveCalendarAuctionEvent(db as unknown as D1Database, 'auction_bid', 'permission-bid');
    db.beforeNextBatch = () => {
      if (mutation === 'role') sqlite.prepare("UPDATE users SET role = 'member' WHERE id = 'master'").run();
      else sqlite.prepare("UPDATE users SET approved = 0 WHERE id = 'master'").run();
    };
    await assert.rejects(
      () => deleteCalendarAuctionEvent(db as unknown as D1Database, { sub: 'master', role: 'master' }, {
        source_type: 'auction_bid', source_id: 'permission-bid', revision: resolved.revision,
      }),
      (error: unknown) => error instanceof CalendarAuctionManagementError
        && error.code === 'permission_denied'
        && error.status === 403,
      mutation,
    );
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM freelancer_auction_schedules WHERE id = 'permission-bid'").pluck().get(), 1);
    assert.equal(sqlite.prepare('SELECT COUNT(*) FROM accounting_activity_logs').pluck().get(), 0);
    sqlite.close();
  }
});

test('dependency가 precheck 직후 생겨도 batch guard가 exact·alias·legacy 연결 삭제를 중단한다', async () => {
  for (const mode of ['exact', 'underscore-sale', 'underscore-commission', 'legacy', 'legacy-commission', 'blank-legacy'] as const) {
    const { sqlite, db, insert, common } = setup();
    const targetData = mode === 'blank-legacy' ? { ...common, itemNo: '' } : common;
    insert.run('bid-1', '2026-09-15', '입찰', JSON.stringify(targetData), '2026-09-01 09:00:00');
    const resolved = await resolveCalendarAuctionEvent(db as unknown as D1Database, 'auction_bid', 'bid-1');
    db.beforeNextBatch = () => {
      if (mode === 'exact') {
        sqlite.prepare("INSERT INTO sales_records (id, external_id) VALUES ('sale-1', 'auction-schedule:bid-1')").run();
      } else if (mode === 'underscore-sale') {
        sqlite.prepare("INSERT INTO sales_records (id, external_id) VALUES ('sale-1', 'auction_schedule:bid-1')").run();
      } else if (mode === 'underscore-commission') {
        sqlite.prepare("INSERT INTO commissions (id,journal_entry_id,status) VALUES ('commission-1','auction_schedule:bid-1','pending')").run();
      } else {
        const itemNo = mode === 'blank-legacy' ? '' : mode === 'legacy-commission' ? '1호' : '1';
        sqlite.prepare("INSERT INTO freelancer_bid_entries VALUES ('legacy-1', 'owner', '2026-09-15', '2026 타경 1', '의정부지방법원', ?, '고객', '', '2026-09-01')").run(itemNo);
        if (mode === 'legacy-commission') {
          sqlite.prepare("INSERT INTO commissions (id,journal_entry_id,status) VALUES ('commission-1','freelancer-bid:legacy-1','pending')").run();
        } else {
          sqlite.prepare("INSERT INTO sales_records (id, external_id) VALUES ('sale-1', 'freelancer-bid:legacy-1')").run();
        }
      }
    };
    await assert.rejects(
      () => deleteCalendarAuctionEvent(db as unknown as D1Database, { sub: 'master', role: 'master' }, {
        source_type: 'auction_bid', source_id: 'bid-1', revision: resolved.revision,
      }),
      (error: unknown) => error instanceof CalendarAuctionManagementError && error.code === 'linked_business_data',
      mode,
    );
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM freelancer_auction_schedules WHERE id = 'bid-1'").pluck().get(), 1);
    assert.equal(sqlite.prepare('SELECT COUNT(*) FROM accounting_activity_logs').pluck().get(), 0);
    sqlite.close();
  }
});

test('underscore 일정 alias의 입금·수수료·Lawitgo 연결도 캘린더 삭제를 차단한다', async () => {
  for (const mode of ['sale', 'commission', 'lawitgo-sent'] as const) {
    const { sqlite, db, insert, common } = setup();
    insert.run('alias-bid', '2026-09-15', '입찰', JSON.stringify(common), '2026-09-01 09:00:00');
    if (mode === 'commission') {
      sqlite.prepare("INSERT INTO commissions (id,journal_entry_id,status) VALUES ('alias-commission','auction_schedule:alias-bid','pending')").run();
    } else {
      sqlite.prepare("INSERT INTO sales_records (id,external_id) VALUES ('alias-sale','auction_schedule:alias-bid')").run();
      if (mode === 'lawitgo-sent') {
        sqlite.prepare("INSERT INTO lawitgo_winning_outbox (id,sales_record_id,status) VALUES ('alias-outbox','alias-sale','sent')").run();
      }
    }
    const resolved = await resolveCalendarAuctionEvent(db as unknown as D1Database, 'auction_bid', 'alias-bid');
    await assert.rejects(
      () => deleteCalendarAuctionEvent(db as unknown as D1Database, { sub: 'master', role: 'master' }, {
        source_type: 'auction_bid', source_id: 'alias-bid', revision: resolved.revision,
      }),
      (error: unknown) => error instanceof CalendarAuctionManagementError && error.code === 'linked_business_data',
      mode,
    );
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM freelancer_auction_schedules WHERE id = 'alias-bid'").pluck().get(), 1);
    sqlite.close();
  }
});

test('legacy 후보는 다른 물건·고객이면 보존하고 고객 누락 또는 복수 exact면 fail-closed한다', async () => {
  {
    const { sqlite, db, insert, common } = setup();
    insert.run('safe-bid', '2026-09-15', '입찰', JSON.stringify(common), '2026-09-01 09:00:00');
    sqlite.prepare("INSERT INTO freelancer_bid_entries VALUES ('other-legacy','owner','2026-09-15','2026 타경 1','의정부지방법원','2','다른 고객','','2026-09-01')").run();
    sqlite.prepare("INSERT INTO sales_records (id,external_id) VALUES ('other-sale','freelancer-bid:other-legacy')").run();
    const resolved = await resolveCalendarAuctionEvent(db as unknown as D1Database, 'auction_bid', 'safe-bid');
    await deleteCalendarAuctionEvent(db as unknown as D1Database, { sub: 'master', role: 'master' }, {
      source_type: 'auction_bid', source_id: 'safe-bid', revision: resolved.revision,
    });
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM freelancer_auction_schedules WHERE id = 'safe-bid'").pluck().get(), 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM sales_records WHERE id = 'other-sale'").pluck().get(), 1);
    sqlite.close();
  }

  {
    const { sqlite, db, insert, common } = setup();
    insert.run('different-court-bid', '2026-09-15', '입찰', JSON.stringify(common), '2026-09-01 09:00:00');
    sqlite.prepare("INSERT INTO freelancer_bid_entries VALUES ('other-court','owner','2026-09-15','2026 타경 1','서울중앙지방법원','','','','2026-09-01')").run();
    sqlite.prepare("INSERT INTO freelancer_bid_entries VALUES ('other-client','owner','2026-09-15','2026 타경 1','의정부지방법원','','다른 고객','','2026-09-01')").run();
    sqlite.prepare("INSERT INTO sales_records (id,external_id) VALUES ('other-court-sale','freelancer-bid:other-court')").run();
    sqlite.prepare("INSERT INTO sales_records (id,external_id) VALUES ('other-client-sale','freelancer-bid:other-client')").run();
    const resolved = await resolveCalendarAuctionEvent(db as unknown as D1Database, 'auction_bid', 'different-court-bid');
    await deleteCalendarAuctionEvent(db as unknown as D1Database, { sub: 'master', role: 'master' }, {
      source_type: 'auction_bid', source_id: 'different-court-bid', revision: resolved.revision,
    });
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM freelancer_auction_schedules WHERE id = 'different-court-bid'").pluck().get(), 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM sales_records WHERE id = 'other-court-sale'").pluck().get(), 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM sales_records WHERE id = 'other-client-sale'").pluck().get(), 1);
    sqlite.close();
  }

  for (const mode of ['missing-client', 'duplicate-exact', 'blank-target-explicit-legacy', 'explicit-target-blank-legacy'] as const) {
    const { sqlite, db, insert, common } = setup();
    const target = mode === 'blank-target-explicit-legacy' ? { ...common, itemNo: '' } : common;
    insert.run('ambiguous-bid', '2026-09-15', '입찰', JSON.stringify(target), '2026-09-01 09:00:00');
    const addLegacy = sqlite.prepare("INSERT INTO freelancer_bid_entries VALUES (?, 'owner','2026-09-15','2026 타경 1','의정부지방법원',?,?, '','2026-09-01')");
    if (mode === 'missing-client') addLegacy.run('legacy-blank', '1', '');
    else {
      const legacyItem = mode === 'explicit-target-blank-legacy' ? '' : '1';
      addLegacy.run('legacy-a', legacyItem, '고객');
      if (mode === 'duplicate-exact') addLegacy.run('legacy-b', legacyItem, '고객');
    }
    const resolved = await resolveCalendarAuctionEvent(db as unknown as D1Database, 'auction_bid', 'ambiguous-bid');
    await assert.rejects(
      () => deleteCalendarAuctionEvent(db as unknown as D1Database, { sub: 'master', role: 'master' }, {
        source_type: 'auction_bid', source_id: 'ambiguous-bid', revision: resolved.revision,
      }),
      (error: unknown) => error instanceof CalendarAuctionManagementError && error.code === 'ambiguous_source',
      mode,
    );
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM freelancer_auction_schedules WHERE id = 'ambiguous-bid'").pluck().get(), 1);
    sqlite.close();
  }
});

test('실제 calendar DELETE route는 master·accountant만 허용하고 ceo·asst·service token을 차단한다', async () => {
  const { sqlite, db, insert, common } = setup();
  sqlite.exec(`
    CREATE TABLE service_tokens (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL,
      scope TEXT NOT NULL, expires_at TEXT, revoked_at TEXT, last_used_at TEXT,
      last_used_ip TEXT, updated_at TEXT
    );
  `);
  const jwtSecret = 'calendar-management-test-secret-1234567890';
  const env = { DB: db as unknown as D1Database, JWT_SIGNING_SECRET: jwtSecret } as Env;
  const app = new Hono<AuthEnv>().route('/api/personal-calendar', personalCalendar);

  async function bearer(id: string): Promise<string> {
    const row = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    const payload: JwtPayload = {
      sub: row.id,
      email: row.email,
      name: row.name,
      phone: row.phone,
      role: row.role as Role,
      team_id: row.team_id,
      branch: row.branch,
      department: row.department,
      position_title: row.position_title,
      login_type: row.login_type,
      auth_version: row.auth_version,
    };
    return createToken(payload, env);
  }
  async function remove(id: string, actor: string, revision: string, sourceType = 'auction_bid') {
    return app.request(`/api/personal-calendar/auction-events/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${await bearer(actor)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_type: sourceType, revision }),
    }, env);
  }

  insert.run('route-bid-1', '2026-09-15', '입찰', JSON.stringify(common), '2026-09-01 09:00:00');
  const first = await resolveCalendarAuctionEvent(env.DB, 'auction_bid', 'route-bid-1');
  assert.equal((await remove('route-bid-1', 'ceo', first.revision)).status, 403);
  assert.equal((await remove('route-bid-1', 'asst', first.revision)).status, 403);
  assert.equal((await remove('route-bid-1', 'master', first.revision, 'personal')).status, 400);

  const rawServiceToken = 'calendar-service-token-for-test';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawServiceToken));
  const tokenHash = Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
  sqlite.prepare("INSERT INTO service_tokens (id,name,token_hash,scope) VALUES ('svc','calendar svc',?,'admin')").run(tokenHash);
  const serviceResponse = await app.request('/api/personal-calendar/auction-events/route-bid-1', {
    method: 'DELETE',
    headers: { 'X-Service-Token': rawServiceToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_type: 'auction_bid', revision: first.revision }),
  }, env);
  assert.equal(serviceResponse.status, 403);
  assert.match(await serviceResponse.text(), /사용자 계정/);
  assert.equal((await remove('route-bid-1', 'master', first.revision)).status, 200);

  insert.run('route-bid-2', '2026-09-16', '입찰', JSON.stringify({ ...common, caseNo: '2026타경2' }), '2026-09-01 09:00:00');
  const second = await resolveCalendarAuctionEvent(env.DB, 'auction_bid', 'route-bid-2');
  assert.equal((await remove('route-bid-2', 'accountant', second.revision)).status, 200);
  sqlite.close();
});

test('calendar DELETE route는 source type을 검증하고 human master/accountant 계약을 사용한다', () => {
  const route = readFileSync(new URL('../src/worker/routes/personal-calendar.ts', import.meta.url), 'utf8');
  assert.match(route, /delete\('\/auction-events\/:sourceId', requireHumanUser\(\)/);
  assert.match(route, /body\.source_type !== 'auction_bid' && body\.source_type !== 'auction_inspection'/);
  assert.match(route, /deleteCalendarAuctionEvent/);
});

test('공개 calendar API는 직접 입찰과 비동행 임장 입찰기일을 내부 캘린더와 동일하게 병합한다', async () => {
  const { sqlite, db, insert, common } = setup();
  insert.run('public-direct-2', '2026-09-14', '입찰', JSON.stringify({
    ...common, caseNo: '2026타경102', propertyCategory: '주거시설', propertyType: '  아파트  ',
  }), '2026-09-01 09:11:00');
  insert.run('public-direct-no-detail', '2026-09-14', '입찰', JSON.stringify({
    ...common, caseNo: '2026타경103', propertyCategory: '주거시설', propertyType: '',
  }), '2026-09-01 09:12:00');
  insert.run('public-inspection-merged', '2026-09-01', '임장', JSON.stringify({
    ...common, caseNo: '2026타경101', propertyCategory: '주거시설', propertyType: '아파트',
    client: '임장 계약자', bidDate: '2026-09-14', place: '서울 입찰법정', memo: '외부 금지',
  }), '2026-09-01 09:20:00');
  insert.run('public-inspection-1', '2026-09-02', '임장', JSON.stringify({
    ...common, caseNo: '2026타경104', propertyCategory: '주거시설', propertyType: '아파트',
    bidDate: '2026-09-14',
  }), '2026-09-01 09:21:00');
  insert.run('public-inspection-2', '2026-09-03', '임장', JSON.stringify({
    ...common, caseNo: '2026타경105', propertyCategory: '주거시설', propertyType: '단독주택',
    bidDate: '2026-09-14',
  }), '2026-09-01 09:22:00');
  insert.run('public-inspection-companion', '2026-09-04', '임장', JSON.stringify({
    ...common, caseNo: '2026타경106', propertyCategory: '주거시설', propertyType: '오피스텔',
    bidDate: '2026-09-14', companion: true,
  }), '2026-09-01 09:23:00');
  const app = new Hono<AuthEnv>().route('/api/public/calendar', publicCalendar);
  const request = (from = '2026-09-14', to = '2026-09-14') => app.request(`/api/public/calendar?from=${from}&to=${to}`, {
    headers: { 'X-API-Key': 'calendar-key' },
  }, { DB: db as unknown as D1Database, CALENDAR_API_KEY: 'calendar-key' } as unknown as Env);
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  const projectionPayload = await response.json() as any;
  assert.equal(projectionPayload.count, 5);
  const beforeMaterialization = projectionPayload.events.find((event: any) => event.caseNo === '2026타경101');
  assert.equal(beforeMaterialization.eventId, 'auction-bid:inspection-bid:public-inspection-merged');

  insert.run('inspection-bid:public-inspection-merged', '2026-09-14', '입찰', JSON.stringify({
    ...common, caseNo: '2026타경101', propertyCategory: '주거시설', propertyType: '다세대',
    client: '직접 계약자', clientPhone: '010-0000-0000', bidPrice: 100_000_000,
    inspectionSourceId: 'public-inspection-merged', bidResultCancelled: true,
  }), '2026-09-01 09:10:00');
  const payload = await (await request()).json() as any;
  assert.equal(payload.count, 5);
  assert.deepEqual(new Set(payload.events.map((event: any) => event.caseNo)), new Set([
    '2026타경101', '2026타경102', '2026타경103', '2026타경104', '2026타경105',
  ]));

  const merged = payload.events.find((event: any) => event.caseNo === '2026타경101');
  assert.equal(merged.eventId, beforeMaterialization.eventId);
  assert.equal(merged.updatedAt, '2026-09-01 09:20:00');
  assert.equal(merged.propertyType, '다세대');
  assert.equal(merged.clientName, '직접 계약자');
  assert.equal(merged.result, 'cancelled');
  assert.equal(merged.place, '서울 입찰법정');
  assert.equal(
    payload.events.find((event: any) => event.caseNo === '2026타경102').eventId,
    'auction-bid:public-direct-2',
  );
  assert.equal(payload.events.find((event: any) => event.caseNo === '2026타경102').propertyType, '아파트');

  const projection = payload.events.find((event: any) => event.caseNo === '2026타경104');
  assert.equal(projection.eventId, 'auction-bid:inspection-bid:public-inspection-1');
  assert.equal(projection.updatedAt, '2026-09-01 09:21:00');
  assert.equal(projection.propertyType, '아파트');
  const repeatedPayload = await (await request()).json() as any;
  assert.equal(
    repeatedPayload.events.find((event: any) => event.caseNo === '2026타경104').eventId,
    projection.eventId,
  );

  const noDetail = payload.events.find((event: any) => event.caseNo === '2026타경103');
  assert.equal(noDetail.propertyType, '미분류');
  assert.equal(JSON.stringify(payload).includes('주거시설'), false);
  assert.equal(JSON.stringify(payload).includes('010-0000-0000'), false);
  assert.equal(JSON.stringify(payload).includes('100000000'), false);
  assert.equal(JSON.stringify(payload).includes('외부 금지'), false);
  for (const event of payload.events) {
    assert.equal('management' in event, false);
    assert.equal('source_id' in event, false);
    assert.equal('source_snapshots' in event, false);
  }

  sqlite.prepare("DELETE FROM freelancer_auction_schedules WHERE id = 'public-inspection-merged'").run();
  const withoutInspection = await (await request()).json() as any;
  assert.equal(withoutInspection.count, 5);
  assert.equal(
    withoutInspection.events.find((event: any) => event.caseNo === '2026타경101').eventId,
    beforeMaterialization.eventId,
  );

  insert.run('public-inspection-merged', '2026-09-01', '임장', JSON.stringify({
    ...common, caseNo: '2026타경999', propertyType: '연립주택', bidDate: '2026-09-14',
  }), '2026-09-02 10:00:00');
  const staleSameDate = await (await request()).json() as any;
  const sameDateIds = staleSameDate.events
    .filter((event: any) => ['2026타경101', '2026타경999'].includes(event.caseNo))
    .map((event: any) => event.eventId);
  assert.deepEqual(new Set(sameDateIds), new Set([
    'auction-bid:inspection-bid:public-inspection-merged',
    'auction-bid-projection:public-inspection-merged',
  ]));
  assert.equal(new Set(staleSameDate.events.map((event: any) => event.eventId)).size, staleSameDate.count);

  sqlite.prepare(`
    UPDATE freelancer_auction_schedules
    SET data = ?, updated_at = '2026-09-02 11:00:00'
    WHERE id = 'public-inspection-merged'
  `).run(JSON.stringify({ ...common, caseNo: '2026타경999', propertyType: '연립주택', bidDate: '2026-09-15' }));
  const staleDifferentDate = await (await request('2026-09-14', '2026-09-15')).json() as any;
  const differentDateIds = staleDifferentDate.events
    .filter((event: any) => ['2026타경101', '2026타경999'].includes(event.caseNo))
    .map((event: any) => event.eventId);
  assert.deepEqual(differentDateIds.sort(), sameDateIds.sort());
  assert.equal(new Set(staleDifferentDate.events.map((event: any) => event.eventId)).size, staleDifferentDate.count);
  const staleRepeat = await (await request('2026-09-14', '2026-09-15')).json() as any;
  assert.deepEqual(staleRepeat.events.map((event: any) => event.eventId), staleDifferentDate.events.map((event: any) => event.eventId));
  const projectionOnlyRange = await (await request('2026-09-15', '2026-09-15')).json() as any;
  assert.equal(
    projectionOnlyRange.events.find((event: any) => event.caseNo === '2026타경999').eventId,
    'auction-bid-projection:public-inspection-merged',
  );

  assert.equal((await app.request('/api/public/calendar?from=2026-13-01', {
    headers: { 'X-API-Key': 'calendar-key' },
  }, { DB: db as unknown as D1Database, CALENDAR_API_KEY: 'calendar-key' } as unknown as Env)).status, 400);
  assert.equal((await app.request('/api/public/calendar?from=2026-02-30&to=2026-03-01', {
    headers: { 'X-API-Key': 'calendar-key' },
  }, { DB: db as unknown as D1Database, CALENDAR_API_KEY: 'calendar-key' } as unknown as Env)).status, 400);

  const route = readFileSync(new URL('../src/worker/routes/public-calendar.ts', import.meta.url), 'utf8');
  const docs = readFileSync(new URL('../docs/public-calendar-api.md', import.meta.url), 'utf8');
  assert.match(route, /loadPersonalCalendarAuctionRows\(c\.env\.DB, from, to, \{ mode: 'all' \}\)/);
  assert.match(route, /buildPersonalCalendarAuctionEvents\(rows\)/);
  assert.match(route, /eventId: stablePublicEventId\(event, existingMaterializedBidIds\)/);
  assert.match(route, /updatedAt: latestUpdatedAt\(event\)/);
  assert.match(route, /propertyType: auctionPropertyDetailLabel\(event\.property_type\)/);
  assert.match(route, /Cache-Control', 'private, no-store'/);
  assert.doesNotMatch(route, /management|can_delete|can_edit/);
  assert.match(docs, /전체 스냅샷/);
  assert.match(docs, /통째로 교체/);
  assert.match(docs, /비동행 임장/);
  assert.match(docs, /직접 입찰.*우선/);
  sqlite.close();
});

test('파생·직접 취소는 역할과 무관하게 내부 events·today-bids 및 공개 API에 모두 포함된다', async () => {
  const { sqlite, db, insert, common } = setup();
  const today = kstDateKey();
  sqlite.exec(`
    CREATE TABLE system_holidays (
      holiday_date TEXT, name TEXT, holiday_type TEXT, enabled INTEGER, applies_to TEXT
    );
    INSERT INTO users (id,email,name,role,branch,department,position_title,login_type) VALUES
      ('employee-member','employee@example.com','일반직원','member','의정부지사','경매사업부','사원','employee'),
      ('freelancer-manager','manager@example.com','프리랜서매니저','manager','의정부지사','경매사업부','매니저','freelancer');
  `);
  insert.run('cancel-inclusion-inspection', today, '임장', JSON.stringify({
    ...common, caseNo: '2026타경501', bidDate: today,
  }), '2026-09-03 09:00:00');
  insert.run('inspection-bid:cancel-inclusion-inspection', today, '입찰', JSON.stringify({
    ...common,
    caseNo: '2026타경501',
    inspectionSourceId: 'cancel-inclusion-inspection',
    bidResultCancelled: true,
  }), '2026-09-03 09:01:00');
  insert.run('cancel-inclusion-direct', today, '입찰', JSON.stringify({
    ...common, caseNo: '2026타경502', bidResultCancelled: true,
  }), '2026-09-03 09:02:00');

  const jwtSecret = 'calendar-cancel-inclusion-test-secret-12345';
  const env = { DB: db as unknown as D1Database, JWT_SIGNING_SECRET: jwtSecret } as Env;
  const internalApp = new Hono<AuthEnv>().route('/api/personal-calendar', personalCalendar);

  async function bearer(id: string): Promise<string> {
    const row = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    const payload: JwtPayload = {
      sub: row.id,
      email: row.email,
      name: row.name,
      phone: row.phone,
      role: row.role as Role,
      team_id: row.team_id,
      branch: row.branch,
      department: row.department,
      position_title: row.position_title,
      login_type: row.login_type,
      auth_version: row.auth_version,
    };
    return createToken(payload, env);
  }

  async function internalRequest(id: string, path: string): Promise<Response> {
    return internalApp.request(`/api/personal-calendar${path}`, {
      headers: { Authorization: `Bearer ${await bearer(id)}` },
    }, env);
  }

  for (const actorId of ['employee-member', 'owner', 'freelancer-manager', 'master']) {
    const eventsResponse = await internalRequest(actorId, `/events?from=${today}&to=${today}`);
    assert.equal(eventsResponse.status, 200, actorId);
    const eventsPayload = await eventsResponse.json() as any;
    const derived = eventsPayload.events.find(
      (event: any) => event.id === 'auction-bid:inspection-bid:cancel-inclusion-inspection',
    );
    assert.equal(derived?.bid_result, 'cancelled', `${actorId} /events`);

    const todayResponse = await internalRequest(actorId, '/today-bids');
    assert.equal(todayResponse.status, 200, actorId);
    const todayPayload = await todayResponse.json() as any;
    const todayDerived = todayPayload.bids.find(
      (event: any) => event.id === 'auction-bid:inspection-bid:cancel-inclusion-inspection',
    );
    assert.equal(todayDerived?.bid_result, 'cancelled', `${actorId} /today-bids`);
  }

  const publicApp = new Hono<AuthEnv>().route('/api/public/calendar', publicCalendar);
  const publicResponse = await publicApp.request(`/api/public/calendar?from=${today}&to=${today}`, {
    headers: { 'X-API-Key': 'calendar-key' },
  }, {
    DB: db as unknown as D1Database,
    CALENDAR_API_KEY: 'calendar-key',
  } as unknown as Env);
  assert.equal(publicResponse.status, 200);
  const publicPayload = await publicResponse.json() as any;
  assert.equal(publicPayload.count, 2);
  assert.deepEqual(
    new Map(publicPayload.events.map((event: any) => [event.eventId, event.result])),
    new Map([
      ['auction-bid:inspection-bid:cancel-inclusion-inspection', 'cancelled'],
      ['auction-bid:cancel-inclusion-direct', 'cancelled'],
    ]),
  );
  sqlite.close();
});
