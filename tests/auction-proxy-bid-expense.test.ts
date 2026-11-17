import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { isSalesIncomeRecord } from '../src/shared/sales-recognition.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('지출 레코드는 매출(수입) 레코드가 아니다', () => {
  assert.equal(isSalesIncomeRecord({ direction: 'income' }), true);
  assert.equal(isSalesIncomeRecord({ direction: '' }), true);
  assert.equal(isSalesIncomeRecord({ direction: null }), true);
  assert.equal(isSalesIncomeRecord({}), true);
  assert.equal(isSalesIncomeRecord({ direction: 'expense' }), false);
});

test('경매스케줄 대리입찰 비용은 확정 지출로 등록되고 업무성과·대시보드·엑셀에서 빠진다', () => {
  const route = read('../src/worker/routes/auction-schedule.ts');
  const proxy = route.match(/function auctionProxySaleStatements[\s\S]*?\n}\n/)?.[0] || '';
  assert.match(proxy, /'confirmed', datetime\('now', '\+9 hours'\), \?, 'expense'/);
  assert.doesNotMatch(proxy, /'income'/);

  const sales = read('../src/react-app/pages/Sales.tsx');
  assert.match(sales, /setRecords\(salesRes\.records\.filter\(isSalesIncomeRecord\)/);
  assert.match(sales, /setAllRecords\(sRes\.records\.filter\(isSalesIncomeRecord\)/);
  const dashboard = read('../src/react-app/pages/Dashboard.tsx');
  assert.match(dashboard, /\(salesRes\.records \|\| \[\]\)\.filter\(isSalesIncomeRecord\)/);
  const salesRoute = read('../src/worker/routes/sales.ts');
  assert.match(salesRoute, /salesMonthlyReportingPeriodSql\('sr'\),\n\s+`COALESCE\(NULLIF\(sr\.direction, ''\), 'income'\) != 'expense'`/);
});
