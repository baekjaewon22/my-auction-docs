import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canExportMonthlySales, salesExportActionLabel } from '../src/shared/sales-export.ts';

test('월별 매출 엑셀 출력은 마스터와 총무만 허용한다', () => {
  assert.equal(canExportMonthlySales('master'), true);
  assert.equal(canExportMonthlySales('accountant'), true);
  assert.equal(canExportMonthlySales('accountant_asst'), false);
  assert.equal(canExportMonthlySales('ceo'), false);
  assert.equal(canExportMonthlySales('member'), false);
});

test('엑셀 액션 열은 매출 상태에 맞는 후속 작업을 표시한다', () => {
  assert.equal(salesExportActionLabel('pending'), '결제 확인 필요');
  assert.equal(salesExportActionLabel('card_pending'), '카드 정산 확인 필요');
  assert.equal(salesExportActionLabel('refund_requested'), '환불 승인 필요');
  assert.equal(salesExportActionLabel('confirmed', '카드'), '카드 정산 완료');
  assert.equal(salesExportActionLabel('confirmed', '이체'), '확정 완료');
});

test('서버와 화면이 동일한 권한 및 8개 엑셀 열을 사용한다', () => {
  const route = readFileSync(new URL('../src/worker/routes/sales.ts', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../src/react-app/pages/Sales.tsx', import.meta.url), 'utf8');
  assert.match(route, /sales\.get\('\/export', requireRole\(\.\.\.SALES_EXPORT_ROLES\)/);
  assert.match(page, /canExportMonthlySales\(role\)/);
  assert.match(page, /\['일자', '담당자', '유형', '금액', '결제방식', '결제일', '상태', '액션'\]/);
  assert.match(page, /업무성과_매출내역_/);
  assert.match(page, /엑셀 출력/);
  const headerStart = page.indexOf('<div className="page-header">');
  const headerEnd = page.indexOf('{loadError &&', headerStart);
  const pageHeader = page.slice(headerStart, headerEnd);
  assert.match(pageHeader, /sales-header-excel/);
  assert.match(pageHeader, /aria-label="엑셀 출력 기준월"/);
  assert.match(pageHeader, /handleExportExcel/);
});
