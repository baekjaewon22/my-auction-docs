import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canUseBusinessAutomation } from '../src/shared/automation-access.ts';

const JUNG_MINHO_ID = '2b6b3606-e425-4361-a115-9283cfef842f';

test('업무 자동화는 마스터와 정민호 지사장만 사용할 수 있다', () => {
  assert.equal(canUseBusinessAutomation({ id: 'master-id', role: 'master' }), true);
  assert.equal(canUseBusinessAutomation({ id: JUNG_MINHO_ID, role: 'admin' }), true);
  assert.equal(canUseBusinessAutomation({ id: 'other-admin', role: 'admin' }), false);
  assert.equal(canUseBusinessAutomation({ id: 'other-user', role: 'user' }), false);
});

test('프리랜서 모드에서도 권한이 있는 마스터에게 업무 자동화 메뉴를 숨기지 않는다', () => {
  const layout = readFileSync(new URL('../src/react-app/components/Layout.tsx', import.meta.url), 'utf8');
  const menuStart = layout.indexOf('title="업무 자동화"');
  assert.ok(menuStart >= 0);
  const nearby = layout.slice(Math.max(0, menuStart - 320), menuStart + 120);
  assert.match(nearby, /canUseDocumentGeneration/);
  assert.doesNotMatch(nearby, /!isFreelancer/);
});
