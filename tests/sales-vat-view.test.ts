import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canUseSalesVatView, salesDisplayAmount } from '../src/shared/sales-vat-view.ts';

test('VAT 제외 열람 토글은 마스터와 총무담당에게만 보인다', () => {
  assert.equal(canUseSalesVatView('accountant'), true);
  assert.equal(canUseSalesVatView('master'), true);
  assert.equal(canUseSalesVatView('accountant_asst'), false);
  assert.equal(canUseSalesVatView('ceo'), false);
});

test('토글 기본값은 원금이고 실행 시 1.1로 나눈 정수 금액을 표시한다', () => {
  assert.equal(salesDisplayAmount(1_100_000, false), 1_100_000);
  assert.equal(salesDisplayAmount(1_100_000, true), 1_000_000);
  assert.equal(salesDisplayAmount(-330_000, true), -300_000);
});

test('업무성과 우측 상단 토글은 저장 API 없이 화면 표시 함수만 사용한다', () => {
  const page = readFileSync(new URL('../src/react-app/pages/Sales.tsx', import.meta.url), 'utf8');
  const headerStart = page.indexOf('<div className="page-header">');
  const headerEnd = page.indexOf('{loadError &&', headerStart);
  const header = page.slice(headerStart, headerEnd);
  assert.match(header, /role="switch"/);
  assert.match(header, /aria-checked=\{excludeVatView\}/);
  assert.match(header, /VAT 제외/);
  assert.match(page, /salesDisplayAmount\(amount, canUseVatView && excludeVatView\)/);
  assert.match(page, /formatCurrency\(confirmedTotal\)/);
  assert.match(page, /summarySalesAmount\(r, r\.period_confirmed_amount/);
  assert.match(page, /summaryPeriodLabel\}\{excludeVatView \? ' · VAT 제외' : ''\}/);
  assert.doesNotMatch(header, /api\./);
});
