import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countLeaveBusinessDays,
  isLeaveDateRange,
  leaveYearsForRange,
  planSummerLeave,
} from '../src/shared/leave-calendar.ts';

const holidays = new Set(['2026-07-17']);

test('7/15 여름 3일 뒤 연차 1일은 특별 7/15~20, 연차 7/21이다', () => {
  const plan = planSummerLeave({
    startDate: '2026-07-15',
    summerDays: 3,
    chainDays: 1,
    chainPosition: 'after',
    holidays,
  });
  assert.deepEqual(plan, {
    specialStartDate: '2026-07-15',
    specialEndDate: '2026-07-20',
    annualStartDate: '2026-07-21',
    annualEndDate: '2026-07-21',
  });
  assert.equal(countLeaveBusinessDays(plan.specialStartDate, plan.specialEndDate, holidays), 3);
  assert.equal(countLeaveBusinessDays(plan.annualStartDate!, plan.annualEndDate!, holidays), 1);
});

test('구버전 화면의 잘못된 end/date 대신 시작일과 일수로 서버 날짜를 재계산한다', () => {
  const staleClientInput = { specialEndDate: '2026-07-17', annualStartDate: '2026-07-20' };
  const plan = planSummerLeave({
    startDate: '2026-07-15',
    summerDays: 3,
    chainDays: 1,
    chainPosition: 'after',
    holidays,
  });
  assert.notEqual(plan.specialEndDate, staleClientInput.specialEndDate);
  assert.notEqual(plan.annualStartDate, staleClientInput.annualStartDate);
  assert.equal(plan.specialEndDate, '2026-07-20');
  assert.equal(plan.annualStartDate, '2026-07-21');
});

test('연차 뒤/앞 연결은 동일한 근무일 규칙으로 대칭 계산된다', () => {
  const after = planSummerLeave({
    startDate: '2026-07-15', summerDays: 3, chainDays: 1, chainPosition: 'after', holidays,
  });
  const before = planSummerLeave({
    startDate: '2026-07-15', summerDays: 3, chainDays: 1, chainPosition: 'before', holidays,
  });
  assert.deepEqual(after, {
    specialStartDate: '2026-07-15', specialEndDate: '2026-07-20',
    annualStartDate: '2026-07-21', annualEndDate: '2026-07-21',
  });
  assert.deepEqual(before, {
    specialStartDate: '2026-07-16', specialEndDate: '2026-07-21',
    annualStartDate: '2026-07-15', annualEndDate: '2026-07-15',
  });
});

test('여름휴가 시작일이 공휴일이면 거부한다', () => {
  assert.throws(() => planSummerLeave({
    startDate: '2026-07-17', summerDays: 3, chainDays: 0, chainPosition: 'after', holidays,
  }), /근무일/);
});

test('연도 경계는 양쪽 연도 공휴일 합집합으로 계산한다', () => {
  assert.deepEqual(leaveYearsForRange('2026-12-30', '2027-01-04'), ['2026', '2027']);
  const crossYearHolidays = new Set(['2026-12-31', '2027-01-01']);
  assert.equal(countLeaveBusinessDays('2026-12-30', '2027-01-04', crossYearHolidays), 2);
});

test('역전된 날짜 범위는 유효하지 않고 근무일 수가 0이다', () => {
  assert.equal(isLeaveDateRange('2026-07-21', '2026-07-20'), false);
  assert.equal(countLeaveBusinessDays('2026-07-21', '2026-07-20', holidays), 0);
});

test('주말이나 공휴일만 선택한 기간은 사용 가능한 근무일이 0일이다', () => {
  assert.equal(countLeaveBusinessDays('2026-07-17', '2026-07-19', holidays), 0);
});
