import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardFocusKey, shouldPrepareDashboardFocus } from '../src/shared/dashboard-focus.ts';

test('동일한 대시보드 대상은 최초 한 번만 필터 초기화를 준비한다', () => {
  const key = dashboardFocusKey('sales', 'sale-1');
  assert.equal(shouldPrepareDashboardFocus('', key), true);
  assert.equal(shouldPrepareDashboardFocus(key, key), false);
});

test('URL의 대상이 바뀌면 새 항목 포커스를 다시 준비한다', () => {
  assert.equal(
    shouldPrepareDashboardFocus(
      dashboardFocusKey('sales', 'sale-1'),
      dashboardFocusKey('sales', 'sale-2'),
    ),
    true,
  );
});
