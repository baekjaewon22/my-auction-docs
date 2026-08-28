import assert from 'node:assert/strict';
import test from 'node:test';
import { nextPayrollMonth, computePayrollCarryover } from '../src/shared/payroll-carryover.ts';

test('nextPayrollMonth은 연말을 넘겨 계산한다', () => {
  assert.equal(nextPayrollMonth('2026-08'), '2026-09');
  assert.equal(nextPayrollMonth('2026-12'), '2027-01');
  assert.equal(nextPayrollMonth('2026-01'), '2026-02');
  assert.equal(nextPayrollMonth('bad'), '');
});

test('실지급이 음수면 0 처리 + 미회수분을 이월, 0 이상이면 그대로', () => {
  assert.deepEqual(computePayrollCarryover(-300000), { paidNet: 0, carryover: 300000 });
  assert.deepEqual(computePayrollCarryover(500000), { paidNet: 500000, carryover: 0 });
  assert.deepEqual(computePayrollCarryover(0), { paidNet: 0, carryover: 0 });
});
