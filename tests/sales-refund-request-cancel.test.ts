import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canCancelSalesRefundRequest,
  canRevertCompletedSalesRefund,
  REFUND_COMPLETED_REVERT_ROLES,
  REFUND_REQUEST_CANCEL_ROLES,
  restoredSalesStatusAfterRefundRequestCancel,
  restoredSalesStatusAfterRefundRevert,
} from '../src/shared/sales-refund-request-cancel.ts';

const PRIVILEGED_ROLES = ['master', 'ceo', 'accountant'];
const DENIED_ROLES = ['cc_ref', 'admin', 'accountant_asst', 'director', 'manager', 'member', 'support', 'resigned', '', null];

test('refund request cancel permission is master, ceo, and accountant only', () => {
  assert.deepEqual([...REFUND_REQUEST_CANCEL_ROLES], PRIVILEGED_ROLES);
  for (const role of PRIVILEGED_ROLES) {
    assert.equal(canCancelSalesRefundRequest(role), true);
  }
  for (const role of DENIED_ROLES) {
    assert.equal(canCancelSalesRefundRequest(role as any), false);
  }
});

test('completed refund revert permission is master, ceo, and accountant only', () => {
  assert.deepEqual([...REFUND_COMPLETED_REVERT_ROLES], PRIVILEGED_ROLES);
  for (const role of PRIVILEGED_ROLES) {
    assert.equal(canRevertCompletedSalesRefund(role), true);
  }
  for (const role of DENIED_ROLES) {
    assert.equal(canRevertCompletedSalesRefund(role as any), false);
  }
});

test('refund rollback restores card records without card deposit to card_pending and others to confirmed', () => {
  assert.equal(restoredSalesStatusAfterRefundRequestCancel({ payment_type: '카드', card_deposit_date: '' }), 'card_pending');
  assert.equal(restoredSalesStatusAfterRefundRequestCancel({ payment_type: '카드', card_deposit_date: null }), 'card_pending');
  assert.equal(restoredSalesStatusAfterRefundRequestCancel({ payment_type: '카드', card_deposit_date: '2026-09-17' }), 'confirmed');
  assert.equal(restoredSalesStatusAfterRefundRequestCancel({ payment_type: '이체', card_deposit_date: '' }), 'confirmed');
  assert.equal(restoredSalesStatusAfterRefundRequestCancel({ payment_method: '카드', card_deposit_date: '' }), 'card_pending');
  assert.equal(restoredSalesStatusAfterRefundRevert({ payment_method: '카드', card_deposit_date: '' }), 'card_pending');
});

test('refund request cancel API only cancels requested status and does not clear completed refund amount', () => {
  const route = readFileSync(new URL('../src/worker/routes/sales.ts', import.meta.url), 'utf8');
  const start = route.indexOf("sales.post('/:id/refund-request-cancel'");
  const end = route.indexOf("sales.post('/:id/refund-revert'");
  assert.ok(start >= 0);
  assert.ok(end > start);
  const refundRequestCancelRoute = route.slice(start, end);
  assert.match(refundRequestCancelRoute, /refund-request-cancel/);
  assert.match(refundRequestCancelRoute, /canCancelSalesRefundRequest\(user\.role\)/);
  assert.match(refundRequestCancelRoute, /record\.status !== 'refund_requested'/);
  assert.match(refundRequestCancelRoute, /restoredSalesStatusAfterRefundRequestCancel\(record\)/);
  assert.match(refundRequestCancelRoute, /refund_requested_at = NULL/);
  assert.doesNotMatch(refundRequestCancelRoute, /refund_amount = 0/);
});

test('completed refund revert API clears completed refund fields and blocks recovered refunds', () => {
  const route = readFileSync(new URL('../src/worker/routes/sales.ts', import.meta.url), 'utf8');
  const start = route.indexOf("sales.post('/:id/refund-revert'");
  const end = route.indexOf("sales.post('/:id/refund-approve'");
  assert.ok(start >= 0);
  assert.ok(end > start);
  const refundRevertRoute = route.slice(start, end);
  assert.match(refundRevertRoute, /refund-revert/);
  assert.match(refundRevertRoute, /canRevertCompletedSalesRefund\(user\.role\)/);
  assert.match(refundRevertRoute, /record\.status !== 'refunded'/);
  assert.match(refundRevertRoute, /refund_recovery_resolutions/);
  assert.match(refundRevertRoute, /refund_amount = 0/);
  assert.match(refundRevertRoute, /refund_requested_at = NULL/);
  assert.match(refundRevertRoute, /refund_approved_at = NULL/);
  assert.match(refundRevertRoute, /refund_approved_by = NULL/);
  assert.match(refundRevertRoute, /action: 'refund_revert'/);
});

test('sales and accounting UIs wire separate buttons for request cancel and completed refund revert', () => {
  const salesPage = readFileSync(new URL('../src/react-app/pages/Sales.tsx', import.meta.url), 'utf8');
  const accountingPage = readFileSync(new URL('../src/react-app/pages/Accounting.tsx', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../src/react-app/api.ts', import.meta.url), 'utf8');

  assert.match(api, /refundRequestCancel/);
  assert.match(api, /refund-request-cancel/);
  assert.match(api, /refundRevert/);
  assert.match(api, /refund-revert/);
  assert.match(salesPage, /canCancelSalesRefundRequest\(role\)/);
  assert.match(salesPage, /canRevertCompletedSalesRefund\(role\)/);
  assert.match(salesPage, /api\.sales\.refundRequestCancel/);
  assert.match(salesPage, /api\.sales\.refundRevert/);
  assert.match(salesPage, /refund_revert/);
  assert.match(accountingPage, /canCancelSalesRefundRequest\(currentUser\?\.role\)/);
  assert.match(accountingPage, /canRevertCompletedSalesRefund\(currentUser\?\.role\)/);
  assert.match(accountingPage, /api\.sales\.refundRequestCancel/);
  assert.match(accountingPage, /api\.sales\.refundRevert/);
  assert.match(accountingPage, /refund_revert/);
});
