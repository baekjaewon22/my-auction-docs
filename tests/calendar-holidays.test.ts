import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  DEFAULT_COMPANY_HOLIDAY_DETAILS,
  DEFAULT_COMPANY_HOLIDAYS,
  defaultCompanyHolidaysBetween,
} from '../src/shared/work-calendar.ts';
import { loadCalendarHolidays } from '../src/worker/lib/calendar-holidays.ts';

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
}

function d1(sqlite: Database.Database): D1Database {
  return { prepare: (sql: string) => new TestStatement(sqlite, sql) } as unknown as D1Database;
}

test('구조화한 기본 공휴일은 기존 근무일 날짜 집합을 그대로 보존하고 이름을 제공한다', () => {
  assert.deepEqual(
    new Set(DEFAULT_COMPANY_HOLIDAY_DETAILS.map(holiday => holiday.holiday_date)),
    DEFAULT_COMPANY_HOLIDAYS,
  );
  assert.deepEqual(defaultCompanyHolidaysBetween('2026-09-24', '2026-09-26'), [
    { holiday_date: '2026-09-24', name: '추석 연휴', holiday_type: 'legal' },
    { holiday_date: '2026-09-25', name: '추석', holiday_type: 'legal' },
    { holiday_date: '2026-09-26', name: '추석 연휴', holiday_type: 'legal' },
  ]);
  assert.deepEqual(defaultCompanyHolidaysBetween('2027-07-17', '2027-07-19'), [
    { holiday_date: '2027-07-17', name: '제헌절', holiday_type: 'legal' },
    { holiday_date: '2027-07-19', name: '대체공휴일(제헌절)', holiday_type: 'substitute' },
  ]);
});

test('캘린더 휴일은 정적 기본값과 활성 all/journal 운영값을 날짜별로 병합한다', async () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE system_holidays (
      holiday_date TEXT PRIMARY KEY, name TEXT, holiday_type TEXT,
      applies_to TEXT NOT NULL, enabled INTEGER NOT NULL
    );
    INSERT INTO system_holidays VALUES
      ('2026-09-25', '추석 특별 운영명', 'company', 'all', 1),
      ('2026-09-28', '임시공휴일', 'temporary', 'all', 1),
      ('2026-09-29', '일지 휴무일', 'company', 'journal', 1),
      ('2026-09-30', '휴가 전용일', 'company', 'leave', 1),
      ('2026-09-27', '비활성일', 'temporary', 'all', 0);
  `);

  const holidays = await loadCalendarHolidays(d1(sqlite), '2026-09-24', '2026-09-30');
  assert.deepEqual(holidays, [
    { holiday_date: '2026-09-24', name: '추석 연휴', holiday_type: 'legal' },
    { holiday_date: '2026-09-25', name: '추석 특별 운영명', holiday_type: 'company' },
    { holiday_date: '2026-09-26', name: '추석 연휴', holiday_type: 'legal' },
    { holiday_date: '2026-09-28', name: '임시공휴일', holiday_type: 'temporary' },
    { holiday_date: '2026-09-29', name: '일지 휴무일', holiday_type: 'company' },
  ]);
  sqlite.close();
});

test('운영 테이블을 읽지 못해도 정적 공휴일을 fail-open으로 제공하고 외부 호출은 하지 않는다', async () => {
  const sqlite = new Database(':memory:');
  const holidays = await loadCalendarHolidays(d1(sqlite), '2026-12-25', '2026-12-25');
  assert.deepEqual(holidays, [
    { holiday_date: '2026-12-25', name: '기독탄신일', holiday_type: 'legal' },
  ]);

  const loader = readFileSync(new URL('../src/worker/lib/calendar-holidays.ts', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../src/worker/routes/personal-calendar.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(loader, /\bfetch\s*\(/);
  assert.match(route, /loadCalendarHolidays\(db, from, to\)/);
  assert.match(route, /events:[\s\S]*?holidays,/);
  sqlite.close();
});
