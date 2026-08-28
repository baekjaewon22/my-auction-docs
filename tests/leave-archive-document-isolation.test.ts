import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const leaveRoute = readFileSync(new URL('../src/worker/routes/leave.ts', import.meta.url), 'utf8');

test('leave archive lookup cannot claim or cancel a templated receipt document by injected content', () => {
  const guardedLookups = leaveRoute.match(/WHERE template_id IS NULL[\s\S]*?instr\(content, 'data-source="leave_request"'\) > 0[\s\S]*?instr\(content, \?\) > 0/g) || [];
  assert.equal(guardedLookups.length, 2);
});
