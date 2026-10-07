import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canUseBusinessAutomation } from '../src/shared/automation-access.ts';

const JUNG_MINHO_ID = '2b6b3606-e425-4361-a115-9283cfef842f';

test('업무 자동화는 팀장 이상(마스터·대표·총괄이사·관리자·팀장)과 정민호 지사장이 사용할 수 있다', () => {
  // 허용: 마스터·대표·총괄이사·관리자·팀장
  assert.equal(canUseBusinessAutomation({ id: 'master-id', role: 'master' }), true);
  assert.equal(canUseBusinessAutomation({ id: 'ceo-id', role: 'ceo' }), true);
  assert.equal(canUseBusinessAutomation({ id: 'dir-id', role: 'director' }), true);
  assert.equal(canUseBusinessAutomation({ id: 'admin-id', role: 'admin' }), true);
  assert.equal(canUseBusinessAutomation({ id: 'manager-id', role: 'manager' }), true);
  // 정민호 지사장은 역할과 무관하게 예외 허용
  assert.equal(canUseBusinessAutomation({ id: JUNG_MINHO_ID, role: 'member' }), true);
  // 제외: 총무담당/총무보조, CC참조자, 팀원/지원/퇴사자
  assert.equal(canUseBusinessAutomation({ id: 'acc', role: 'accountant' }), false);
  assert.equal(canUseBusinessAutomation({ id: 'acc2', role: 'accountant_asst' }), false);
  assert.equal(canUseBusinessAutomation({ id: 'ccref', role: 'cc_ref' }), false);
  assert.equal(canUseBusinessAutomation({ id: 'member-id', role: 'member' }), false);
  assert.equal(canUseBusinessAutomation({ id: 'support-id', role: 'support' }), false);
  assert.equal(canUseBusinessAutomation({ id: 'resigned-id', role: 'resigned' }), false);
});

test('프리랜서 모드에서도 권한이 있는 마스터에게 업무 자동화 메뉴를 숨기지 않는다', () => {
  const layout = readFileSync(new URL('../src/react-app/components/Layout.tsx', import.meta.url), 'utf8');
  const menuStart = layout.indexOf('title="업무 자동화"');
  assert.ok(menuStart >= 0);
  const nearby = layout.slice(Math.max(0, menuStart - 320), menuStart + 120);
  assert.match(nearby, /canUseDocumentGeneration/);
  assert.doesNotMatch(nearby, /!isFreelancer/);
});
