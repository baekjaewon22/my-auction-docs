import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/worker/index.ts', import.meta.url), 'utf8');

test('alimtalk bulk test sender is restricted to an active human master', () => {
  assert.match(
    source,
    /app\.post\('\/api\/_test-alimtalk-all',\s*authMiddleware,\s*requireHumanMaster\(\),\s*async \(c\)/,
  );
  assert.doesNotMatch(source, /alimtalk-test-2026/);
});
