import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPersonalCalendarAuctionEvents,
  buildPersonalCalendarInspectionEvents,
  toPublicPersonalCalendarAuctionEvent,
  type CalendarAuctionScheduleRow,
} from '../src/worker/lib/personal-calendar-auction-events.ts';

function auctionRow(overrides: Partial<CalendarAuctionScheduleRow> = {}): CalendarAuctionScheduleRow {
  return {
    id: 'schedule-1',
    user_id: 'user-1',
    user_name: 'Kim',
    position_title: 'consultant',
    source_kind: 'bid',
    event_date: '2026-09-15',
    branch: 'branch',
    data: '{}',
    created_at: '2026-08-01',
    updated_at: '2026-08-01',
    ...overrides,
  };
}

test('숙박시설이 카테고리 칸에 저장돼도 캘린더 세부 물건종류로 표시한다', () => {
  const [bid] = buildPersonalCalendarAuctionEvents([
    auctionRow({
      id: 'hotel-bid',
      data: JSON.stringify({ propertyCategory: '숙박시설', propertyType: '기타' }),
    }),
  ]);
  assert.equal(bid.title, '[Kim] [숙박시설]');
  assert.equal(bid.property_category, '숙박시설');
  assert.equal(bid.property_type, '숙박시설');
  assert.equal(
    toPublicPersonalCalendarAuctionEvent(bid, { id: 'viewer', role: 'member' }).property_type,
    '숙박시설',
  );

  const [inspection] = buildPersonalCalendarInspectionEvents([
    auctionRow({
      id: 'hotel-inspection',
      source_kind: 'inspection',
      data: JSON.stringify({ propertyCategory: '숙박시설', propertyType: '' }),
    }),
  ]);
  assert.equal(inspection.title, '[Kim] 임장 · [숙박시설]');
  assert.equal(inspection.property_type, '숙박시설');
});
