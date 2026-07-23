import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAssignSalesToAnotherUser,
  canUseRequestedSalesOwner,
} from '../src/shared/sales-assignment.ts';

test('마스터와 총무담당만 다른 담당자의 매출을 등록할 수 있다', () => {
  assert.equal(canAssignSalesToAnotherUser('master'), true);
  assert.equal(canAssignSalesToAnotherUser('accountant'), true);
  assert.equal(canAssignSalesToAnotherUser('accountant_asst'), false);
  assert.equal(canAssignSalesToAnotherUser('admin'), false);
  assert.equal(canAssignSalesToAnotherUser('member'), false);
});

test('모든 사용자는 본인 담당 매출을 등록할 수 있다', () => {
  assert.equal(canUseRequestedSalesOwner('member', 'user-1', undefined), true);
  assert.equal(canUseRequestedSalesOwner('member', 'user-1', ''), true);
  assert.equal(canUseRequestedSalesOwner('member', 'user-1', 'user-1'), true);
});

test('일반 사용자와 총무보조의 타인 담당자 지정은 거부된다', () => {
  assert.equal(canUseRequestedSalesOwner('member', 'user-1', 'user-2'), false);
  assert.equal(canUseRequestedSalesOwner('accountant_asst', 'user-1', 'user-2'), false);
});

test('마스터와 총무담당은 타인 담당자를 지정할 수 있다', () => {
  assert.equal(canUseRequestedSalesOwner('master', 'user-1', 'user-2'), true);
  assert.equal(canUseRequestedSalesOwner('accountant', 'user-1', 'user-2'), true);
});
