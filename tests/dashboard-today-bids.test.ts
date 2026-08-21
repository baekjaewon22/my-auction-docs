import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { kstDateKey } from '../src/worker/lib/personal-calendar-auction-events.ts';

const route = readFileSync(new URL('../src/worker/routes/personal-calendar.ts', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/react-app/pages/Dashboard.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/react-app/api.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/react-app/index.css', import.meta.url), 'utf8');
const calendarLib = readFileSync(new URL('../src/worker/lib/personal-calendar-auction-events.ts', import.meta.url), 'utf8');

test('today bids use the KST day boundary and automatically roll off after midnight', () => {
  assert.equal(kstDateKey(new Date('2026-08-20T14:59:59.999Z')), '2026-08-20');
  assert.equal(kstDateKey(new Date('2026-08-20T15:00:00.000Z')), '2026-08-21');
});

test('today bid API is authenticated, company-wide, and deduplicates inspection bid dates with direct bids', () => {
  assert.match(route, /personalCalendar\.use\('\*', authMiddleware\)/);
  assert.match(route, /personalCalendar\.get\('\/today-bids'/);
  assert.match(route, /loadPersonalCalendarAuctionRows\(db, today, today, \{ mode: 'all' \}\)/);
  assert.match(route, /buildPersonalCalendarAuctionEvents\(rows\)/);
  assert.match(calendarLib, /u\.position_title/);
  assert.match(api, /todayBids: \(\) => request<\{ date: string; bids: TodayBidDashboardEntry\[\] \}>\('\/personal-calendar\/today-bids'\)/);
});

test('both employee and freelancer dashboards show all requested today-bid columns below the news area', () => {
  assert.equal((dashboard.match(/<TodayBidList \/>/g) || []).length, 2);
  for (const label of ['지사', '담당자', '직책', '물건카테고리', '법원', '사건번호', '낙찰유무']) {
    assert.match(dashboard, new RegExp(`data-label="${label}"`));
  }
  assert.match(dashboard, /오늘 예정된 입찰이 없습니다/);
  assert.match(dashboard, /pending: '미정'/);
  assert.match(dashboard, /won: '낙찰'/);
  assert.match(dashboard, /failed: '실패'/);
  assert.match(dashboard, /cancelled: '취소'/);
  assert.match(dashboard, /withdrawn: '취하\/변경'/);
});

test('오늘의 입찰 인원을 누르면 해당 캘린더 일정 상세 팝업으로 이동한다', () => {
  assert.match(dashboard, /to=\{`\/personal-calendar\?\$\{new URLSearchParams\(\{ date: todayDate, event: bid\.id \}\)\.toString\(\)\}`\}/);
  assert.match(dashboard, /dashboard-today-bids-row clickable/);
  const calendar = readFileSync(new URL('../src/react-app/pages/PersonalCalendar.tsx', import.meta.url), 'utf8');
  assert.match(calendar, /useSearchParams\(\)/);
  assert.match(calendar, /events\.find\(event => event\.id === focusEventId\)/);
  assert.match(calendar, /setSelectedEvent\(focusedEvent\)/);
});

test('today bid list changes from seven desktop columns to responsive cards', () => {
  assert.match(css, /\.dashboard-today-bids-row[\s\S]*?grid-template-columns:[^;]+;/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.dashboard-today-bids-list[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.dashboard-today-bids-list[\s\S]*?minmax\(0, 1fr\)/);
  assert.match(css, /content: attr\(data-label\)/);
});
