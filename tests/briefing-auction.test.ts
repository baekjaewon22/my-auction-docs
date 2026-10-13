import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { briefingCaseNumber, normalizeBriefingAuction, briefingAuctionError } from '../src/shared/briefing-auction.ts';
import { syncBriefingSchedulesFromJournal } from '../src/worker/routes/admin-notes.ts';

test('공매는 물건번호를 그대로 저장하고 법원 및 경매 부번호를 제거한다', () => {
  const identity = briefingCaseNumber('public', '2026', ' 2026-0100-001234 ');
  assert.equal(identity, '2026-0100-001234');
  const input = normalizeBriefingAuction({ auction_kind: 'public', court: '서울중앙지방법원', case_number: identity, item_no: '1' });
  assert.deepEqual(input, { auctionKind: 'public', court: '', caseNumber: identity, itemNo: '' });
  assert.equal(briefingAuctionError(input), '');
  assert.match(briefingAuctionError(normalizeBriefingAuction({ auction_kind: 'public' })), /공매 물건번호/);
  assert.match(briefingAuctionError({ ...input, caseNumber: '1'.repeat(101) }), /100자/);
});

test('기존 경매 입력은 기본값과 법원 필수 검사를 유지한다', () => {
  const identity = briefingCaseNumber('court', '2026', '12345');
  assert.equal(identity, '2026타경12345');
  const input = normalizeBriefingAuction({ court: '서울중앙지방법원', case_number: identity, item_no: '2' });
  assert.equal(input.auctionKind, 'court');
  assert.equal(input.itemNo, '2');
  assert.equal(briefingAuctionError(input), '');
  assert.match(briefingAuctionError({ ...input, court: '' }), /법원/);
});

test('공매 업무일지 동기화는 등록과 재동기화에서 구분·물건번호를 보존한다', async () => {
  const sqlite = new Database(':memory:');
  try {
    sqlite.exec(`
      CREATE TABLE users (id TEXT, name TEXT, branch TEXT, department TEXT);
      CREATE TABLE journal_entries (id TEXT, user_id TEXT, target_date TEXT, activity_type TEXT, activity_subtype TEXT, data TEXT, branch TEXT, department TEXT, created_at TEXT);
      CREATE TABLE admin_notes (id TEXT PRIMARY KEY, title TEXT, content TEXT, author_id TEXT, author_name TEXT, pinned INTEGER, source_type TEXT, source_id TEXT, is_anonymous INTEGER, visibility TEXT, author_branch TEXT, author_department TEXT, category TEXT, court TEXT, case_number TEXT, auction_kind TEXT DEFAULT 'court', assignee_id TEXT, target_date TEXT, item_no TEXT, client_name TEXT, journal_entry_id TEXT, created_at TEXT, updated_at TEXT);
      INSERT INTO users VALUES ('u1', '담당자', '서울', '컨설팅');
    `);
    sqlite.prepare('INSERT INTO journal_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'j1', 'u1', '2026-10-07', '브리핑자료제출', '브리핑자료 제출',
      JSON.stringify({ auctionKind: 'public', briefingCaseNo: '2026-0100-001234', briefingCourt: '잘못 남은 법원', itemNo: '1', client: '계약자' }), '서울', '컨설팅', '2026-10-07',
    );
    const db = { prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...args: unknown[]) { values = args; return statement; },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
        async first() { return sqlite.prepare(sql).get(...values) || null; },
        async run() { return sqlite.prepare(sql).run(...values); },
      };
      return statement;
    } };
    await syncBriefingSchedulesFromJournal(db as any);
    await syncBriefingSchedulesFromJournal(db as any);
    const rows = sqlite.prepare('SELECT * FROM admin_notes').all() as any[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].auction_kind, 'public');
    assert.equal(rows[0].case_number, '2026-0100-001234');
    assert.equal(rows[0].court, '');
    assert.equal(rows[0].item_no, '');
    assert.match(rows[0].content, /구분: 공매/);
    assert.match(rows[0].content, /물건번호: 2026-0100-001234/);
    assert.doesNotMatch(rows[0].content, /법원:|타경/);
    // An old journal entry without a discriminator remains a court auction.
    sqlite.prepare('INSERT INTO journal_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'j2', 'u1', '2026-10-07', '브리핑자료제출', '브리핑자료 제출',
      JSON.stringify({ briefingCaseNo: '2026타경12345', briefingCourt: '서울중앙지방법원', itemNo: '2', client: '계약자' }), '서울', '컨설팅', '2026-10-07',
    );
    await syncBriefingSchedulesFromJournal(db as any);
    const legacy = sqlite.prepare("SELECT * FROM admin_notes WHERE journal_entry_id = 'j2'").get() as any;
    assert.equal(legacy.auction_kind, 'court');
    assert.equal(legacy.court, '서울중앙지방법원');
    assert.equal(legacy.case_number, '2026타경12345');
    assert.equal(legacy.item_no, '2');
    assert.equal((sqlite.prepare('SELECT COUNT(*) AS count FROM admin_notes').get() as any).count, 2);
  } finally { sqlite.close(); }
});
