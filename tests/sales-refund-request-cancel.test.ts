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

test('엑셀 일괄환불도 전액 환불액을 기록해 급여 자동회수 대상에 포함한다', () => {
  const route = readFileSync(new URL('../src/worker/routes/sales.ts', import.meta.url), 'utf8');
  const start = route.indexOf("sales.post('/bulk-import'");
  assert.ok(start >= 0);
  const bulkImportRoute = route.slice(start);
  assert.match(bulkImportRoute, /SET status = 'refunded', refund_amount = amount, refund_approved_at = \?/);
  assert.match(bulkImportRoute, /refund_recovery_resolved/);
  assert.match(bulkImportRoute, /refund_already_recovered/);
  assert.match(bulkImportRoute, /NOT EXISTS \(\s*SELECT 1 FROM refund_recovery_resolutions/);
});

test('회수 완료된 환불은 금액 변경과 원본 매출 삭제를 서버에서 차단한다', () => {
  const route = readFileSync(new URL('../src/worker/routes/sales.ts', import.meta.url), 'utf8');
  const partialStart = route.indexOf("sales.post('/:id/partial-refund'");
  const partialEnd = route.indexOf("sales.put('/:id/contract-check'");
  const deleteStart = route.indexOf("sales.delete('/:id'");
  const deleteEnd = route.indexOf("sales.put('/:id/phone'");
  assert.ok(partialStart >= 0 && partialEnd > partialStart);
  assert.ok(deleteStart >= 0 && deleteEnd > deleteStart);
  const partialRoute = route.slice(partialStart, partialEnd);
  const deleteRoute = route.slice(deleteStart, deleteEnd);
  assert.match(partialRoute, /refund_recovery_resolutions/);
  assert.match(partialRoute, /NOT EXISTS/);
  assert.match(deleteRoute, /refund_recovery_resolutions/);
  assert.match(deleteRoute, /deletionStatements/);
  assert.match(deleteRoute, /NOT EXISTS/);
});

test('확정된 과거 급여월에는 새 매출 인식일을 원자적으로 유입시키지 않는다', () => {
  const salesRoute = readFileSync(new URL('../src/worker/routes/sales.ts', import.meta.url), 'utf8');
  const accountingRoute = readFileSync(new URL('../src/worker/routes/accounting.ts', import.meta.url), 'utf8');
  const confirmStart = salesRoute.indexOf("sales.post('/:id/confirm'");
  const confirmEnd = salesRoute.indexOf("sales.post('/:id/unconfirm'");
  const bulkStart = salesRoute.indexOf("sales.post('/bulk-import'");
  const cardStart = accountingRoute.indexOf("accounting.post('/card-settlements/:id/confirm'");
  const uploadStart = accountingRoute.indexOf("accounting.post('/upload-bank'");
  const stagingStart = accountingRoute.indexOf("accounting.post('/staging/:id/to-sales'");
  assert.ok(confirmStart >= 0 && confirmEnd > confirmStart);
  assert.ok(bulkStart >= 0);
  assert.ok(cardStart >= 0 && uploadStart > cardStart && stagingStart > uploadStart);

  assert.match(salesRoute, /NO_LOCKED_PAYROLL_MONTH_SQL/);
  assert.match(salesRoute.slice(confirmStart, confirmEnd), /lockedDestinationPayrollGuardSql/);
  assert.match(salesRoute.slice(bulkStart), /lockedPayrollMonths/);
  assert.match(salesRoute.slice(bulkStart), /NO_LOCKED_PAYROLL_MONTH_SQL/);
  assert.match(accountingRoute.slice(cardStart, uploadStart), /NO_LOCKED_PAYROLL_MONTH_SQL/);
  assert.match(accountingRoute.slice(uploadStart, stagingStart), /NO_LOCKED_PAYROLL_MONTH_SQL/);
  assert.match(accountingRoute.slice(stagingStart), /NO_LOCKED_PAYROLL_MONTH_SQL/);
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
