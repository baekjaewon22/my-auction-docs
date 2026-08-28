import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const approval = readFileSync(new URL('../src/worker/lib/expense-receipt-approval.ts', import.meta.url), 'utf8');
const documents = readFileSync(new URL('../src/worker/routes/documents.ts', import.meta.url), 'utf8');

test('receipt author is excluded from delegate snapshot and blocked again at action time', () => {
  assert.match(documents, /listExpenseReceiptDelegates\(db, doc\.author_id\)/);
  assert.match(approval, /AND \(\? = '' OR id != \?\)/);
  assert.match(approval, /document\.author_id === input\.actorId[\s\S]*?ExpenseReceiptApprovalError/);
  assert.match(documents, /const canAct = doc\.author_id !== user\.sub[\s\S]*?!!activeActor/);
});
