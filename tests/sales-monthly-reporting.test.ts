import assert from 'node:assert/strict';
import test from 'node:test';
import { monthlySalesContribution } from '../src/shared/sales-monthly-reporting.ts';

const septemberSale = {
  amount: 1_100_000,
  status: 'refunded',
  payment_type: '이체',
  contract_date: '2026-09-05',
  deposit_date: '2026-09-08',
  refund_amount: 1_100_000,
  refund_approved_at: '2026-10-12 14:30:00',
};

test('9월 매출을 10월 전액환불하면 9월 원매출은 유지하고 10월에 전액 차감한다', () => {
  const september = monthlySalesContribution(septemberSale, '2026-09-01', '2026-09-30');
  assert.equal(september.period_confirmed_amount, 1_100_000);
  assert.equal(september.period_refund_amount, 0);
  assert.equal(september.period_entry_kind, 'sale');

  const october = monthlySalesContribution(septemberSale, '2026-10-01', '2026-10-31');
  assert.equal(october.period_sale_amount, 0);
  assert.equal(october.period_refund_amount, 1_100_000);
  assert.equal(october.period_confirmed_amount, -1_100_000);
  assert.equal(october.period_entry_kind, 'refund');
  assert.equal(october.period_display_date, '2026-10-12');
});

test('부분환불도 원매출은 유지하고 환불 승인월에 환불액만 차감한다', () => {
  const partial = { ...septemberSale, status: 'confirmed', refund_amount: 330_000 };
  assert.equal(monthlySalesContribution(partial, '2026-09-01', '2026-09-30').period_confirmed_amount, 1_100_000);
  assert.equal(monthlySalesContribution(partial, '2026-10-01', '2026-10-31').period_confirmed_amount, -330_000);
});

test('같은 달 매출과 환불은 해당 월 순액으로 집계한다', () => {
  const sameMonth = { ...septemberSale, refund_approved_at: '2026-09-20 09:00:00', refund_amount: 330_000 };
  const result = monthlySalesContribution(sameMonth, '2026-09-01', '2026-09-30');
  assert.equal(result.period_confirmed_amount, 770_000);
  assert.equal(result.period_entry_kind, 'net');
});
