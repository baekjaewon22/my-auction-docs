import test from 'node:test';
import assert from 'node:assert/strict';
import {
  communityReplyRecipientIds,
  directRecipientId,
} from '../src/shared/community-notifications.ts';

test('일반 공개 글에는 단일 수신자가 없다', () => {
  assert.equal(directRecipientId('all'), null);
  assert.equal(directRecipientId('branch'), null);
});

test('user 공개 범위에서 단일 수신자를 식별한다', () => {
  assert.equal(directRecipientId('user:receiver-1'), 'receiver-1');
});

test('댓글 작성자를 제외하고 글 작성자와 1:1 상대만 알린다', () => {
  assert.deepEqual(communityReplyRecipientIds({
    category: 'community',
    authorId: 'author',
    visibility: 'user:receiver',
    actorId: 'commenter',
  }), ['author', 'receiver']);
  assert.deepEqual(communityReplyRecipientIds({
    category: 'community',
    authorId: 'author',
    visibility: 'user:receiver',
    actorId: 'receiver',
  }), ['author']);
});

test('대상 카테고리가 아닌 글에는 댓글 웹푸시를 만들지 않는다', () => {
  assert.deepEqual(communityReplyRecipientIds({
    category: 'notice',
    authorId: 'author',
    visibility: 'all',
    actorId: 'commenter',
  }), []);
});
