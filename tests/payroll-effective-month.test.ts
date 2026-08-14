import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyPayrollSavesFromMonth,
  payrollPeriodToYearMonth,
} from '../src/shared/payroll-effective-month.ts';

test('한글 급여정산 기간을 YYYY-MM으로 변환한다', () => {
  assert.equal(payrollPeriodToYearMonth('2026년 7월'), '2026-07');
  assert.equal(payrollPeriodToYearMonth('2026년 12월'), '2026-12');
  assert.equal(payrollPeriodToYearMonth('2026-07'), '2026-07');
  assert.equal(payrollPeriodToYearMonth('2026년 13월'), null);
});

test('적용월 이후 정산을 확정 여부에 따라 분리한다', () => {
  const result = classifyPayrollSavesFromMonth([
    { period: '2026년 6월', locked: 1 },
    { period: '2026년 7월', locked: 0 },
    { period: '2026년 8월', locked: 1 },
  ], '2026-07');

  assert.deepEqual(result.recalculable, ['2026년 7월']);
  assert.deepEqual(result.locked, ['2026년 8월']);
});

test('김성환 사례처럼 과거 확정월은 유지하고 7월 미확정 정산만 재계산한다', () => {
  const result = classifyPayrollSavesFromMonth([
    { period: '2026년 2월', locked: 1 },
    { period: '2026년 3월', locked: 1 },
    { period: '2026년 6월', locked: 0 },
    { period: '2026년 7월', locked: 0 },
  ], '2026-07');

  assert.deepEqual(result.locked, []);
  assert.deepEqual(result.recalculable, ['2026년 7월']);
});
