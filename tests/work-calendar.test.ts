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

test('공식 월력요항의 2026년 설 연휴와 대체공휴일을 반영한다', () => {
  for (const date of ['2026-02-16', '2026-02-17', '2026-02-18', '2026-03-02', '2026-08-17', '2026-10-05']) {
    assert.equal(isNonWorkingDate(date), true, date);
  }
  for (const staleDate of ['2026-01-28', '2026-01-29', '2026-01-30']) {
    assert.equal(isNonWorkingDate(staleDate), false, staleDate);
  }
});

test('공식 월력요항의 2027년 설·추석과 신설 공휴일을 반영한다', () => {
  for (const date of [
    '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09',
    '2027-05-01', '2027-05-03', '2027-07-17', '2027-07-19',
    '2027-09-14', '2027-09-15', '2027-09-16', '2027-10-11', '2027-12-27',
  ]) {
    assert.equal(isNonWorkingDate(date), true, date);
  }
});
