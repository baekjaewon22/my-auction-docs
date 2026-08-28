import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../src/worker/routes/approval-alerts.ts', import.meta.url), 'utf8');

test('generic approval alert backfill is human-master only and excludes receipt workflows', () => {
  assert.match(route, /approvalAlerts\.post\('\/backfill', requireHumanMaster\(\)/);
  assert.match(route, /COALESCE\(d\.template_id, ''\) != \?/);
  assert.match(route, /\.bind\(EXPENSE_RECEIPT_TEMPLATE_ID\)\.all/);
  assert.doesNotMatch(route, /approvalAlerts\.post\('\/backfill', requireRole\('master'\)/);
});
