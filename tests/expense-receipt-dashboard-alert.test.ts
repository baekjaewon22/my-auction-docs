import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  EXPENSE_RECEIPT_TEMPLATE_ID,
  canReceiveExpenseReceiptApprovalAlert,
  expenseReceiptApprovalAlertTemplateScope,
} from '../src/shared/expense-receipt.ts';

test('accounting assistant web approval inbox is restricted to receipt expense requests', () => {
  assert.equal(
    expenseReceiptApprovalAlertTemplateScope('accountant_asst'),
    EXPENSE_RECEIPT_TEMPLATE_ID,
  );
  assert.equal(
    expenseReceiptApprovalAlertTemplateScope('accountant_asst', 'tpl-unrelated'),
    EXPENSE_RECEIPT_TEMPLATE_ID,
  );
  assert.equal(expenseReceiptApprovalAlertTemplateScope('accountant'), '');
  assert.equal(
    expenseReceiptApprovalAlertTemplateScope('accountant', EXPENSE_RECEIPT_TEMPLATE_ID),
    EXPENSE_RECEIPT_TEMPLATE_ID,
  );
});

test('receipt approval inbox rechecks the current human employee role', () => {
  assert.equal(canReceiveExpenseReceiptApprovalAlert({
    sub: 'accountant', role: 'accountant', login_type: 'employee', auth_type: 'user',
  }), true);
  assert.equal(canReceiveExpenseReceiptApprovalAlert({
    sub: 'assistant', role: 'accountant_asst', login_type: 'employee', auth_type: 'user',
  }), true);
  assert.equal(canReceiveExpenseReceiptApprovalAlert({
    sub: 'representative', role: 'ceo', login_type: 'employee', auth_type: 'user',
  }), true);
  assert.equal(canReceiveExpenseReceiptApprovalAlert({
    sub: 'master', role: 'master', login_type: 'employee', auth_type: 'user',
  }), true);
  assert.equal(canReceiveExpenseReceiptApprovalAlert({
    sub: 'former-accountant', role: 'member', login_type: 'employee', auth_type: 'user',
  }), false);
  assert.equal(canReceiveExpenseReceiptApprovalAlert({
    sub: 'freelancer-accountant', role: 'accountant', login_type: 'freelancer', auth_type: 'user',
  }), false);
  assert.equal(canReceiveExpenseReceiptApprovalAlert({
    sub: 'service-token:admin', role: 'master', login_type: 'employee', auth_type: 'service_token',
  }), false);
});

test('dashboard loads the receipt-only web alert inbox for accounting assistants', () => {
  const dashboard = readFileSync('src/react-app/pages/Dashboard.tsx', 'utf8');
  const api = readFileSync('src/react-app/api.ts', 'utf8');
  const route = readFileSync('src/worker/routes/approval-alerts.ts', 'utf8');

  assert.match(dashboard, /const isExpenseReceiptAssistant = user\?\.role === 'accountant_asst'/);
  assert.match(
    dashboard,
    /canApprove \|\| isExpenseReceiptAssistant[\s\S]*?api\.approvalAlerts\.list\(isExpenseReceiptAssistant[\s\S]*?template_id: EXPENSE_RECEIPT_TEMPLATE_ID/,
  );
  assert.match(api, /list: \(filters\?: \{ template_id\?: string \}\)/);
  assert.match(api, /query\.set\('template_id', filters\.template_id\)/);
  assert.match(route, /expenseReceiptApprovalAlertTemplateScope\(user\.role, c\.req\.query\('template_id'\)\)/);
  assert.match(route, /canReceiveExpenseReceiptApprovalAlert\(user\)/);
  assert.match(route, /COALESCE\(d\.template_id, a\.document_template_id, ''\)/);
  assert.match(route, /LEFT JOIN documents d ON d\.id = a\.document_id/);
});
