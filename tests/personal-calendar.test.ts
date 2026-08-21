import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import {
  buildPersonalCalendarAuctionEvents,
  buildPersonalCalendarInspectionEvents,
  loadPersonalCalendarAuctionRows,
  loadPersonalCalendarInspectionRows,
  type CalendarAuctionScheduleRow,
} from '../src/worker/lib/personal-calendar-auction-events.ts';

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

const route = readFileSync(new URL('../src/worker/routes/personal-calendar.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../src/worker/index.ts', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../src/react-app/components/Layout.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/react-app/App.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/react-app/pages/PersonalCalendar.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/react-app/index.css', import.meta.url), 'utf8');
const auctionCalendarLib = readFileSync(new URL('../src/worker/lib/personal-calendar-auction-events.ts', import.meta.url), 'utf8');

function auctionRow(overrides: Partial<CalendarAuctionScheduleRow>): CalendarAuctionScheduleRow {
  return {
    id: 'schedule-1', user_id: 'user-1', user_name: '김민수', position_title: '컨설턴트', source_kind: 'inspection',
    event_date: '2026-09-15', branch: '의정부지사', data: '{}', created_at: '2026-08-01', updated_at: '2026-08-01',
    ...overrides,
  };
}

test('개인 캘린더는 사용자별 별도 테이블을 사용한다', () => {
  const sql = readFileSync(new URL('../d1/migrate-personal-calendar.sql', import.meta.url), 'utf8');
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE users (id TEXT PRIMARY KEY);');
  db.exec(sql);
  db.prepare("INSERT INTO users (id) VALUES ('user-1')").run();
  db.prepare(`INSERT INTO personal_calendar_events (id, user_id, event_date, title) VALUES (?, ?, ?, ?)`)
    .run('event-1', 'user-1', '2026-08-21', '테스트');
  const row = db.prepare('SELECT user_id, event_date, title FROM personal_calendar_events WHERE id = ?').get('event-1');
  assert.deepEqual(row, { user_id: 'user-1', event_date: '2026-08-21', title: '테스트' });
});

test('캘린더 API는 인증 후 지사와 직책에 관계없이 모든 일정을 공유한다', () => {
  assert.match(route, /personalCalendar\.use\('\*', authMiddleware\)/);
  assert.doesNotMatch(route, /WHERE user_id = \?/);
  assert.match(route, /\.bind\(to, from\)/);
  assert.match(worker, /app\.route\('\/api\/personal-calendar', personalCalendarRoute\)/);
  assert.match(route, /loadPersonalCalendarAuctionRows\(db, from, to, \{ mode: 'all' \}\)/);
});

test('임장 입찰기일 또는 입찰 일정 중 하나만 있어도 캘린더 입찰로 표시한다', () => {
  const inspection = buildPersonalCalendarAuctionEvents([auctionRow({
    data: JSON.stringify({ bidDate: '2026-09-15', caseNo: '2026타경123', court: '의정부지방법원', propertyCategory: '주거시설' }),
  })]);
  const bid = buildPersonalCalendarAuctionEvents([auctionRow({
    id: 'bid-1', source_kind: 'bid',
    data: JSON.stringify({ caseNo: '2026타경456', court: '서울중앙지방법원', propertyCategory: '상업·업무시설' }),
  })]);
  assert.equal(inspection.length, 1);
  assert.equal(inspection[0].title, '[김민수] 주거시설');
  assert.equal(inspection[0].activity_type, '입찰');
  assert.equal(bid.length, 1);
  assert.equal(bid[0].title, '[김민수] 상업·업무시설');
});

test('같은 담당자·날짜·법원·사건·물건의 임장과 입찰은 실제 입찰 하나로 합친다', () => {
  const rows = [
    auctionRow({
      id: 'inspection-1', source_kind: 'inspection',
      data: JSON.stringify({ caseNo: '2026 타경 123', itemNo: '2', court: '의정부지방법원 고양지원', client: '홍길동', propertyCategory: '주거시설' }),
    }),
    auctionRow({
      id: 'bid-1', source_kind: 'bid',
      data: JSON.stringify({ caseNo: '2026타경123', itemNo: '2', court: '의정부지방법원 고양지원', client: '홍길동', propertyCategory: '주거시설', bidWon: true }),
    }),
  ];
  const events = buildPersonalCalendarAuctionEvents(rows);
  assert.equal(events.length, 1);
  assert.equal(events[0].source_id, 'bid-1');
  assert.equal(events[0].bid_result, 'won');
  assert.equal(events[0].court, '의정부지방법원 고양지원');
});

test('물건번호가 다른 입찰은 같은 사건이라도 별도 일정으로 유지한다', () => {
  const events = buildPersonalCalendarAuctionEvents([
    auctionRow({ id: 'item-1', source_kind: 'bid', data: JSON.stringify({ caseNo: '2026타경123', itemNo: '1', court: '의정부지방법원' }) }),
    auctionRow({ id: 'item-2', source_kind: 'bid', data: JSON.stringify({ caseNo: '2026타경123', itemNo: '2', court: '의정부지방법원' }) }),
  ]);
  assert.equal(events.length, 2);
});

test('마이페이지에 캘린더 메뉴와 전용 라우트를 노출한다', () => {
  assert.match(layout, /to="\/personal-calendar"/);
  assert.ok(layout.indexOf('to="/personal-calendar"') < layout.indexOf('to="/rooms"'));
  assert.match(app, /path="personal-calendar" element=\{<PersonalCalendar \/>\}/);
  assert.match(page, /Array\.from\(\{ length: 42 \}/);
});

test('캘린더는 모바일에서도 경매 일정 제목과 클릭 영역을 유지한다', () => {
  assert.match(css, /\.personal-calendar-grid[\s\S]*?grid-template-columns:\s*repeat\(7,/);
  assert.match(css, /\.personal-calendar-grid[\s\S]*?grid-auto-rows:\s*minmax\(118px, auto\)/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.personal-calendar-grid[\s\S]*?grid-auto-rows:\s*minmax\(72px, auto\)/);
  assert.match(css, /\.personal-calendar-event-chip\.auction[\s\S]*?min-height:\s*24px/);
  assert.match(css, /\.personal-calendar-event-chip\.auction[\s\S]*?white-space:\s*normal/);
});

test('캘린더만 80~140% 줌과 내부 가로 이동을 제공해 모바일 글자 눌림을 막는다', () => {
  assert.match(page, /useState\(1\)/);
  assert.match(page, /Math\.min\(1\.4, Math\.max\(0\.8,/);
  assert.match(page, /aria-label="캘린더 축소"/);
  assert.match(page, /aria-label="캘린더 확대"/);
  assert.match(page, /personal-calendar-grid-scroll/);
  assert.match(page, /minWidth: `\$\{Math\.round\(700 \* calendarZoom\)\}px`/);
  assert.match(css, /\.personal-calendar-grid-scroll[\s\S]*?overflow-x:\s*auto/);
  assert.match(css, /\.personal-calendar-grid-canvas[\s\S]*?min-width:\s*700px/);
});

test('우측 선택 날짜 박스 없이 모든 일정을 달력 칸 안에 채운다', () => {
  assert.doesNotMatch(page, /personal-calendar-detail/);
  assert.doesNotMatch(page, /dayEvents\.slice/);
  assert.match(page, /dayEvents\.map/);
  assert.match(css, /\.personal-calendar-day-events[\s\S]*?flex-wrap:\s*wrap/);
});

test('경매 입찰 일정 클릭 상세에 담당자·입찰·고객·법원·지원·사건번호·결과를 표시한다', () => {
  assert.match(auctionCalendarLib, /source_type: 'auction_bid'/);
  assert.match(page, /setSelectedEvent\(event\)/);
  assert.match(page, /<span>담당자<\/span>/);
  assert.match(page, /<strong>입찰<\/strong>/);
  assert.match(page, /<span>고객명<\/span>/);
  assert.match(page, /<span>관련법원 · 지원<\/span>/);
  assert.doesNotMatch(page, /<span>관할법원<\/span>/);
  assert.match(page, /<span>사건번호<\/span>/);
  assert.match(page, /<span>입찰결과<\/span>/);
  assert.doesNotMatch(page, /5일 경과 자동 처리/);
  assert.match(css, /\.personal-calendar-event-detail/);
});

test('확정된 입찰 결과는 캘린더 목록에 바로 표시하고 대기는 숨긴다', () => {
  assert.match(page, /event\.bid_result !== 'pending'/);
  assert.match(page, /BID_RESULT_LABELS\[event\.bid_result\]/);
  assert.match(page, /personal-calendar-event-result/);
  assert.match(css, /\.personal-calendar-event-result\.won/);
  assert.match(css, /\.personal-calendar-event-result\.failed/);
  assert.match(css, /\.personal-calendar-event-result\.cancelled/);
  assert.match(css, /\.personal-calendar-event-result\.withdrawn/);
});

test('우측 슬라이드 전환은 입찰만 보기와 임장을 포함한 전체보기를 제공한다', () => {
  assert.match(page, /useState<'bid' \| 'all'>\('bid'\)/);
  assert.match(page, />입찰<\/button>/);
  assert.match(page, /전체보기 <small>임장 포함<\/small>/);
  assert.match(page, /viewMode === 'all' \? events : events\.filter\(event => event\.source_type === 'auction_bid'\)/);
  assert.match(css, /\.personal-calendar-view-slider/);
  assert.match(css, /\.personal-calendar-event-chip\.auction\.inspection[\s\S]*?background:\s*#fff1cc/);
});

test('auction calendar loader enforces self and branch scopes and excludes companion inspections', async () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, branch TEXT NOT NULL, position_title TEXT NOT NULL);
    CREATE TABLE freelancer_auction_schedules (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, target_date TEXT NOT NULL,
      activity_type TEXT NOT NULL, data TEXT NOT NULL, branch TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  sqlite.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run('u1', '김민수', '의정부본사', '과장');
  sqlite.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run('u2', '이영희', '서초지사', '지사장');
  const insert = sqlite.prepare(`INSERT INTO freelancer_auction_schedules
    (id, user_id, target_date, activity_type, data, branch) VALUES (?, ?, ?, ?, ?, ?)`);
  insert.run('u1-inspection', 'u1', '2026-09-01', '임장', JSON.stringify({ bidDate: '2026-09-15' }), '의정부지사');
  insert.run('u1-companion', 'u1', '2026-09-01', '임장', JSON.stringify({ bidDate: '2026-09-16', companion: 1 }), '의정부지사');
  insert.run('u2-bid', 'u2', '2026-09-17', '입찰', '{}', '의정부지사');
  insert.run('other-branch', 'u2', '2026-09-18', '입찰', '{}', '부산지사');

  const db = d1FromSqlite(sqlite);
  const selfRows = await loadPersonalCalendarAuctionRows(db, '2026-09-01', '2026-09-30', { mode: 'self', value: 'u1' });
  assert.deepEqual(selfRows.map(row => row.id), ['u1-inspection']);
  const branchRows = await loadPersonalCalendarAuctionRows(db, '2026-09-01', '2026-09-30', { mode: 'branch', value: '의정부지사' });
  assert.deepEqual(branchRows.map(row => row.id).sort(), ['u1-inspection', 'u2-bid']);
  assert.equal(branchRows.find(row => row.id === 'u2-bid')?.branch, '서초지사');
  assert.equal(branchRows.find(row => row.id === 'u2-bid')?.position_title, '지사장');
  assert.equal(buildPersonalCalendarAuctionEvents(branchRows).find(event => event.source_id === 'u2-bid')?.color, '#f57c00');

  const inspectionRows = await loadPersonalCalendarInspectionRows(db, '2026-09-01', '2026-09-30');
  assert.deepEqual(inspectionRows.map(row => row.id), ['u1-inspection']);
  const [inspectionEvent] = buildPersonalCalendarInspectionEvents(inspectionRows);
  assert.equal(inspectionEvent.event_date, '2026-09-01');
  assert.equal(inspectionEvent.source_type, 'auction_inspection');
  assert.equal(inspectionEvent.title, '[김민수] 임장 · 미분류');
});

test('calendar keeps cancellation distinct from withdrawal and exposes automatic cancellation', () => {
  const [cancelled] = buildPersonalCalendarAuctionEvents([auctionRow({
    source_kind: 'bid',
    data: JSON.stringify({ bidResultCancelled: true, bidResultCancelledAutomatically: true }),
  })]);
  const [withdrawn] = buildPersonalCalendarAuctionEvents([auctionRow({
    id: 'withdrawn', source_kind: 'bid',
    data: JSON.stringify({ bidCancelled: true }),
  })]);
  assert.equal(cancelled.bid_result, 'cancelled');
  assert.equal(cancelled.automatic_cancel, 1);
  assert.equal(withdrawn.bid_result, 'withdrawn');
});

test('auction calendar uses the requested branch stripe colors', () => {
  const colors = new Map(buildPersonalCalendarAuctionEvents([
    auctionRow({ id: 'uijeongbu', event_date: '2026-09-01', branch: '의정부지사' }),
    auctionRow({ id: 'seocho', event_date: '2026-09-02', branch: '서초지사' }),
    auctionRow({ id: 'busan', event_date: '2026-09-03', branch: '부산지사' }),
    auctionRow({ id: 'daejeon', event_date: '2026-09-04', branch: '대전지사' }),
  ]).map(event => [event.branch, event.color]));
  assert.equal(colors.get('의정부지사'), '#1a73e8');
  assert.equal(colors.get('서초지사'), '#f57c00');
  assert.equal(colors.get('부산지사'), '#173b6c');
  assert.equal(colors.get('대전지사'), '#0398d1');
});
