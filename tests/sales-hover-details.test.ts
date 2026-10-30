import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const salesPage = readFileSync(new URL('../src/react-app/pages/Sales.tsx', import.meta.url), 'utf8');

test('미작성 사유 호버는 총무메모와 분리된 전용 팝업을 사용한다', () => {
  assert.match(salesPage, /const \[hoveredMissingReason, setHoveredMissingReason\]/);
  assert.equal((salesPage.match(/data-missing-reason/g) || []).length >= 4, true);
  assert.match(salesPage, /hoveredMemoRow && !hoveredMissingReason && adminMemosMap/);
  assert.match(salesPage, /미작성 사유 hover 팝업: 총무메모보다 우선 표시/);
  assert.match(salesPage, /setHoveredMemoRow\(null\);\s*setHoveredMissingReason/);
});

test('미작성 사유 밖으로 이동하면 행 총무메모 호버가 다시 동작한다', () => {
  assert.match(salesPage, /closest\('\[data-missing-reason\]'\)/);
  assert.match(salesPage, /if \(\(isAccountant \|\| isMaster\) && adminMemosMap\[r\.id\]\) setHoveredMemoRow/);
});
