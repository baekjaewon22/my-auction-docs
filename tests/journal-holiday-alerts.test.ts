import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { refreshScheduleGapForUserDate } from '../src/worker/lib/journal-alerts.ts';
import { loadSystemHolidayDates } from '../src/worker/lib/system-holidays.ts';

function d1(db: Database.Database): D1Database {
  return {
    prepare(sql: string) {
      const statement = db.prepare(sql);
      const bound = (...values: unknown[]) => ({
        all: async <T>() => ({ results: statement.all(...values) as T[] }),
        first: async <T>() => (statement.get(...values) as T | undefined) || null,
        run: async () => statement.run(...values),
      });
      return {
        bind: (...values: unknown[]) => bound(...values),
        all: async <T>() => ({ results: statement.all() as T[] }),
        first: async <T>() => (statement.get() as T | undefined) || null,
        run: async () => statement.run(),
      } as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

function schema(db: Database.Database) {
  db.exec(`
    CREATE TABLE system_holidays (
      holiday_date TEXT PRIMARY KEY,
      applies_to TEXT NOT NULL,
      enabled INTEGER NOT NULL
    );
    CREATE TABLE journal_entries (
      id TEXT PRIMARY KEY, user_id TEXT, target_date TEXT, activity_type TEXT,
      activity_subtype TEXT, data TEXT
    );
    CREATE TABLE alert_schedule_gap (
      id TEXT PRIMARY KEY, user_id TEXT, target_date TEXT, gap_count INTEGER,
      gap_details TEXT, total_gap_minutes INTEGER, status TEXT DEFAULT 'open',
      resolved_at TEXT, last_checked_at TEXT
    );
  `);
}

test('공휴일 적용범위와 활성값을 공용 조회에서 구분한다', async () => {
  const db = new Database(':memory:');
  schema(db);
  db.exec(`
    INSERT INTO system_holidays VALUES ('2026-07-17', 'all', 1);
    INSERT INTO system_holidays VALUES ('2026-07-21', 'statistics', 1);
    INSERT INTO system_holidays VALUES ('2026-07-22', 'journal', 0);
  `);
  const journal = await loadSystemHolidayDates(d1(db), ['2026'], 'journal');
  const statistics = await loadSystemHolidayDates(d1(db), ['2026'], ['journal', 'statistics']);
  assert.deepEqual([...journal].sort(), ['2026-07-17']);
  assert.deepEqual([...statistics].sort(), ['2026-07-17', '2026-07-21']);
  db.close();
});

test('공휴일에 이미 열린 일정 공백 알림을 해결 상태로 전환한다', async () => {
  const db = new Database(':memory:');
  schema(db);
  db.exec(`
    INSERT INTO system_holidays VALUES ('2026-07-17', 'all', 1);
    INSERT INTO journal_entries VALUES ('j1', 'u1', '2026-07-17', '사무', '', '{"timeFrom":"09:00","timeTo":"10:00"}');
    INSERT INTO alert_schedule_gap (id, user_id, target_date, status) VALUES ('a1', 'u1', '2026-07-17', 'open');
  `);
  await refreshScheduleGapForUserDate(d1(db), 'u1', '2026-07-17');
  const row = db.prepare("SELECT status, resolved_at FROM alert_schedule_gap WHERE id='a1'").get() as { status: string; resolved_at: string | null };
  assert.equal(row.status, 'resolved');
  assert.ok(row.resolved_at);
  db.close();
});
