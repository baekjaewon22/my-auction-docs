import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const orgRoute = readFileSync(new URL('../src/worker/routes/org.ts', import.meta.url), 'utf8');

test('branch approver backfill cannot insert a step into the fixed receipt approval flow', () => {
  assert.match(orgRoute, /COALESCE\(template_id, ''\) != \?/);
  assert.match(
    orgRoute,
    /\.bind\(EXPENSE_RECEIPT_TEMPLATE_ID, \.\.\.aliases, approverId, approverId\)/,
  );
});
