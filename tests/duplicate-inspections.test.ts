import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { DUPLICATE_INSPECTIONS_QUERY } from '../src/worker/lib/duplicate-inspections.ts';

test('중복 임장은 담당자를 합치고 법원·사건번호·물건번호가 모두 같을 때만 반환한다', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, name TEXT, phone TEXT, branch TEXT, department TEXT
    );
    CREATE TABLE journal_entries (
      id TEXT PRIMARY KEY, user_id TEXT, target_date TEXT, activity_type TEXT,
      activity_subtype TEXT, data TEXT, branch TEXT, department TEXT
    );
  `);
  const today = db.prepare("SELECT date('now')").pluck().get() as string;
  const addUser = db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)');
  addUser.run('owner-current', '노연숙', '010-1111-2222', '의정부본사', '경매사업부');
  addUser.run('owner-old', '노연숙', '01011112222', '의정부본사', '경매사업부');
  addUser.run('other', '다른담당자', '010-3333-4444', '의정부본사', '경매사업부');
  const addEntry = db.prepare('INSERT INTO journal_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const data = (itemNo: string) => JSON.stringify({ court: '의정부지방법원', itemNo });

  addEntry.run('same-1', 'owner-current', today, '임장', '2026타경100', data('1'), '의정부본사', '경매사업부');
  addEntry.run('same-2', 'owner-old', today, '임장', '2026타경100', data('1번'), '의정부본사', '경매사업부');
  assert.deepEqual(db.prepare(DUPLICATE_INSPECTIONS_QUERY).all(), []);

  addEntry.run('other-item', 'other', today, '임장', '2026타경100', data('2'), '의정부본사', '경매사업부');
  assert.deepEqual(db.prepare(DUPLICATE_INSPECTIONS_QUERY).all(), []);

  addEntry.run('true-duplicate', 'other', today, '임장', '2026타경100', data('1'), '의정부본사', '경매사업부');
  const rows = db.prepare(DUPLICATE_INSPECTIONS_QUERY).all() as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].case_no, '2026타경100');
  assert.equal(rows[0].court, '의정부지방법원');
  assert.equal(rows[0].item_no, '1');
  assert.equal(rows[0].user_count, 2);
});
