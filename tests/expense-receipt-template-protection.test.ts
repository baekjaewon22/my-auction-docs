import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routeSource = readFileSync(new URL('../src/worker/routes/templates.ts', import.meta.url), 'utf8');

test('generic template mutation routes cannot alter the fixed receipt workflow template', () => {
  assert.match(routeSource, /templates\.put\('\/:id'[\s\S]*?if \(isExpenseReceiptTemplate\(id\)\)[\s\S]*?409/);
  assert.match(routeSource, /templates\.delete\('\/:id'[\s\S]*?if \(isExpenseReceiptTemplate\(id\)\)[\s\S]*?409/);
  assert.match(routeSource, /import \{ isExpenseReceiptTemplate \} from '\.\.\/\.\.\/shared\/expense-receipt'/);
});
