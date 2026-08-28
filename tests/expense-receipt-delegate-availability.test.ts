import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const documentRoute = readFileSync(new URL('../src/worker/routes/documents.ts', import.meta.url), 'utf8');

test('receipt submission snapshots available accounting delegates but does not require one', () => {
  assert.match(
    documentRoute,
    /expenseReceiptDelegates = await listExpenseReceiptDelegates\(db, doc\.author_id\);\s*chain = \[representative\.id\]/,
  );
  assert.doesNotMatch(
    documentRoute,
    /expenseReceiptDelegates\.length === 0|expenseReceiptDelegates\.some\(\(delegate\) => delegate\.role === 'accountant'\)/,
  );
});
