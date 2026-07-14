import assert from 'node:assert/strict';
import test from 'node:test';
import { canUseBusinessAutomation } from '../src/shared/automation-access.ts';

const JUNG_MINHO_ID = '2b6b3606-e425-4361-a115-9283cfef842f';

test('업무 자동화는 마스터와 정민호 지사장만 사용할 수 있다', () => {
  assert.equal(canUseBusinessAutomation({ id: 'master-id', role: 'master' }), true);
  assert.equal(canUseBusinessAutomation({ id: JUNG_MINHO_ID, role: 'admin' }), true);
  assert.equal(canUseBusinessAutomation({ id: 'other-admin', role: 'admin' }), false);
  assert.equal(canUseBusinessAutomation({ id: 'other-user', role: 'user' }), false);
});
