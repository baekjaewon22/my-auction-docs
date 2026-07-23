import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBranchSummaryQueryScope } from '../src/shared/payroll-branch-summary.ts';

test('branch summary bindings follow the two sales-period groups in SQL order', () => {
  const scope = buildBranchSummaryQueryScope('2026-02', '부산지사');
  assert.equal(scope.summaryStart, '2026-02-01');
  assert.equal(scope.summaryEnd, '2026-02-28');
  assert.equal(scope.branchWhere, ' AND sr.branch = ?');
  assert.deepEqual(scope.baseParams, [
    '2026-02-01', '2026-02-28', '2026-02-01', '2026-02-28', '부산지사',
  ]);
  assert.deepEqual(scope.contractParams, ['2026-02-01', '2026-02-28', '부산지사']);
  assert.deepEqual(scope.bindings, [...scope.baseParams, ...scope.contractParams]);
});

test('branch summary handles leap years and rejects malformed months', () => {
  assert.equal(buildBranchSummaryQueryScope('2028-02', '').summaryEnd, '2028-02-29');
  assert.throws(() => buildBranchSummaryQueryScope('2026-13', ''), /INVALID_PAYROLL_MONTH/);
  assert.throws(() => buildBranchSummaryQueryScope('2026-7', ''), /INVALID_PAYROLL_MONTH/);
});
