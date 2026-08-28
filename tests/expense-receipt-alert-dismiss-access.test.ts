import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('receipt approval alerts remain visible until approval, rejection, or document cancellation', () => {
  const source = readFileSync(new URL('../src/worker/routes/approval-alerts.ts', import.meta.url), 'utf8');
  assert.match(source, /COALESCE\(d\.template_id, a\.document_template_id, ''\)/);
  assert.match(source, /document_template_id === EXPENSE_RECEIPT_TEMPLATE_ID[\s\S]*승인·반려 또는 문서 취소 전까지 숨길 수 없습니다[\s\S]*409/);
});
