import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import {
  buildAuctionStoryAnomalies,
  loadAuctionStoryStageRows,
  type AuctionStoryStageRow,
} from '../src/worker/lib/auction-story-anomalies.ts';
import { auctionStoryAnomalyBranches } from '../src/shared/auction-story-anomaly-access.ts';

function row(activity_type: AuctionStoryStageRow['activity_type'], overrides: Partial<AuctionStoryStageRow> = {}): AuctionStoryStageRow {
  return {
    id: `${activity_type}-1`, user_id: 'user-1', user_name: '김담당', position_title: '컨설턴트',
    branch: '부산지사', activity_type, activity_subtype: '', target_date: '2026-08-26',
    data: JSON.stringify({ court: '부산지방법원 동부지원', caseNo: '2026타경5101', itemNo: '1' }),
    source_kind: activity_type === '브리핑자료제출' ? 'journal' : 'freelancer', updated_at: '2026-08-20 10:00:00',
    ...overrides,
  };
}

function d1FromSqlite(db: Database.Database): D1Database {
  return {
    prepare(sql: string) {
      const values: unknown[] = [];
      const statement = {
        bind(...params: unknown[]) { values.splice(0, values.length, ...params); return statement; },
        async all<T>() { return { results: db.prepare(sql).all(...values) as T[] }; },
      };
      return statement;
    },
  } as unknown as D1Database;
}

test('임장·브리핑자료 제출·입찰이 모두 있으면 이상현황에서 제외한다', () => {
  const anomalies = buildAuctionStoryAnomalies([
    row('임장', { target_date: '2026-08-22', data: JSON.stringify({ court: '부산지방법원 동부지원', caseNo: '2026타경5101', itemNo: '1', bidDate: '2026-08-26' }) }),
    row('브리핑자료제출'),
    row('입찰'),
  ], '2026-08-01', '2026-08-31');
  assert.equal(anomalies.length, 0);
});

test('임장과 브리핑자료가 있어도 입찰이 없으면 관리 대상에서 제외한다', () => {
  const anomalies = buildAuctionStoryAnomalies([
    row('임장', { target_date: '2026-08-22', data: JSON.stringify({ court: '부산지방법원 동부지원', caseNo: '2026타경5101', bidDate: '2026-08-26' }) }),
    row('브리핑자료제출', { activity_subtype: '2026타경5101', data: JSON.stringify({ briefingCourt: '부산지방법원 동부지원' }) }),
  ], '2026-08-01', '2026-08-31');
  assert.equal(anomalies.length, 0);
});

test('입찰이 있으면 임장과 브리핑자료 중 누락된 단계만 관리 대상으로 표시한다', () => {
  const anomalies = buildAuctionStoryAnomalies([
    row('임장', { target_date: '2026-08-22', data: JSON.stringify({ court: '부산지방법원 동부지원', caseNo: '2026타경5101', itemNo: '1', bidDate: '2026-08-26' }) }),
    row('입찰'),
  ], '2026-08-01', '2026-08-31');
  assert.equal(anomalies.length, 1);
  assert.deepEqual(anomalies[0].missing_stages, ['briefing']);
  assert.equal(anomalies[0].bid_date, '2026-08-26');
});

test('물건번호가 비어 있으면 같은 사건과 합치고 서로 다른 명시 물건번호는 분리한다', () => {
  const anomalies = buildAuctionStoryAnomalies([
    row('임장', { id: 'inspection-blank', data: JSON.stringify({ court: '부산지방법원', caseNo: '2026타경9', bidDate: '2026-08-26' }) }),
    row('입찰', { id: 'bid-1', data: JSON.stringify({ court: '부산지방법원', caseNo: '2026타경9', itemNo: '1' }) }),
    row('입찰', { id: 'bid-2', data: JSON.stringify({ court: '부산지방법원', caseNo: '2026타경9', itemNo: '2' }) }),
  ], '2026-08-01', '2026-08-31');
  assert.equal(anomalies.length, 2);
  assert.ok(anomalies.some(item => item.item_no === '1' && item.missing_stages.includes('briefing')));
  assert.ok(anomalies.some(item => item.item_no === '2' && item.missing_stages.includes('inspection')));
});

test('관리자별 지사 범위는 의정부 전체, 진성헌 서초·대전 별도, 서정수 부산으로 제한한다', () => {
  assert.deepEqual(auctionStoryAnomalyBranches({ name: '정민호', role: 'admin' }), ['의정부본사', '서초지사', '대전지사', '부산지사']);
  assert.deepEqual(auctionStoryAnomalyBranches({ name: '진성헌', role: 'admin' }), ['서초지사', '대전지사']);
  assert.deepEqual(auctionStoryAnomalyBranches({ name: '서정수', role: 'director' }), ['부산지사']);
  assert.deepEqual(auctionStoryAnomalyBranches({ name: '일반관리자', role: 'admin' }), []);
});

test('DB 조회는 선택 지사만 읽고 동행 임장은 제외하며 두 원천을 함께 반환한다', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, position_title TEXT, branch TEXT, approved INTEGER, role TEXT);
    CREATE TABLE freelancer_auction_schedules (id TEXT PRIMARY KEY, user_id TEXT, target_date TEXT, activity_type TEXT, activity_subtype TEXT, data TEXT, updated_at TEXT);
    CREATE TABLE journal_entries (id TEXT PRIMARY KEY, user_id TEXT, target_date TEXT, activity_type TEXT, activity_subtype TEXT, data TEXT, updated_at TEXT);
    INSERT INTO users VALUES ('u1','부산담당','컨설턴트','부산',1,'member'), ('u2','서초담당','컨설턴트','서초지사',1,'member');
  `);
  db.prepare('INSERT INTO freelancer_auction_schedules VALUES (?,?,?,?,?,?,?)').run('i1', 'u1', '2026-08-20', '임장', '', JSON.stringify({ caseNo: '2026타경1', court: '부산지방법원', bidDate: '2026-08-26' }), '2026-08-20');
  db.prepare('INSERT INTO freelancer_auction_schedules VALUES (?,?,?,?,?,?,?)').run('i2', 'u1', '2026-08-20', '임장', '', JSON.stringify({ companion: 1, caseNo: '2026타경2', court: '부산지방법원', bidDate: '2026-08-26' }), '2026-08-20');
  db.prepare('INSERT INTO journal_entries VALUES (?,?,?,?,?,?,?)').run('b1', 'u1', '2026-08-26', '브리핑자료제출', '2026타경1', JSON.stringify({ briefingCourt: '부산지방법원' }), '2026-08-21');
  db.prepare('INSERT INTO journal_entries VALUES (?,?,?,?,?,?,?)').run('x1', 'u2', '2026-08-26', '입찰', '', JSON.stringify({ caseNo: '2026타경3', court: '서울중앙지방법원' }), '2026-08-21');

  const rows = await loadAuctionStoryStageRows(d1FromSqlite(db), '2026-08-01', '2026-08-31', ['부산지사', '부산']);
  assert.deepEqual(rows.map(item => item.id).sort(), ['b1', 'i1']);
});

test('캘린더와 입찰 스토리 관리자 페이지에 보호 라우트가 연결된다', () => {
  const calendar = readFileSync(new URL('../src/react-app/pages/PersonalCalendar.tsx', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../src/react-app/pages/AuctionStoryAnomalies.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/react-app/App.tsx', import.meta.url), 'utf8');
  assert.match(calendar, /to="\/personal-calendar\/anomalies"/);
  assert.match(calendar, /canViewAuctionStoryAnomalies/);
  assert.match(calendar, /> 관리자 페이지/);
  assert.match(page, /입찰 일정은 있으나 임장 또는 브리핑자료 제출이 누락된 사건만 표시합니다/);
  assert.doesNotMatch(page, /입찰 누락/);
  assert.match(page, /브리핑자료 제출/);
  assert.match(page, /auction-story-branch-tabs/);
  assert.match(app, /AuctionStoryAnomalyRoute/);
});
