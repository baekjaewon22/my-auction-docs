import test from 'node:test';
import assert from 'node:assert/strict';
import {
  businessDaysInMonth,
  countBusinessDates,
  isNonWorkingDate,
  nextWorkDate,
  previousWorkDate,
} from '../src/shared/work-calendar.ts';

const customHolidays = new Set(['2026-07-17']);

test('운영에서 추가한 평일 공휴일을 비근무일로 판정한다', () => {
  assert.equal(isNonWorkingDate('2026-07-17', customHolidays), true);
  assert.equal(isNonWorkingDate('2026-07-16', customHolidays), false);
});

test('월간 근무일 표에서 동적 공휴일을 제외한다', () => {
  const days = businessDaysInMonth(2026, 7, customHolidays);
  assert.equal(days.includes(17), false);
  assert.equal(days.includes(16), true);
  assert.equal(days.includes(18), false);
});

test('작성률 분모에서 주말과 동적 공휴일을 제외한다', () => {
  assert.equal(countBusinessDates('2026-07-15', '2026-07-20', customHolidays), 3);
});

test('공휴일 전후 근무일 계산이 서버와 프론트에서 공유된다', () => {
  assert.equal(previousWorkDate('2026-07-19', customHolidays), '2026-07-16');
  assert.equal(nextWorkDate('2026-07-17', customHolidays), '2026-07-20');
});
