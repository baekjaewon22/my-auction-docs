import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSalesAttributionBranch } from '../src/worker/lib/sales-attribution.ts';

test('서정수의 매출은 관리 소속과 관계없이 의정부본사에 귀속된다', () => {
  assert.equal(resolveSalesAttributionBranch('서정수', '부산지사'), '의정부본사');
});

test('다른 사용자는 별도 매출 귀속 지사를 설정하지 않는다', () => {
  assert.equal(resolveSalesAttributionBranch('홍길동', '부산지사'), '부산지사');
  assert.equal(resolveSalesAttributionBranch('홍길동'), '');
});
