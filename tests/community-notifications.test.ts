import test from 'node:test';
import assert from 'node:assert/strict';
import {
  communityCreatedNotificationMode,
  communityReplyRecipientIds,
  directRecipientId,
} from '../src/shared/community-notifications.ts';
import {
  EVICTION_QUOTE_VISIBILITY,
  JEONG_MINHO_USER_ID,
  canAccessEvictionQuote,
} from '../src/shared/eviction-quote-access.ts';
import {
  canShareCommunityWithAll,
  defaultCommunityVisibility,
} from '../src/shared/community-visibility.ts';

test('프리랜서는 명도견적을 제외한 사내 커뮤니티를 전체공개할 수 있다', () => {
  const freelancer = { role: 'member', loginType: 'freelancer' };
  assert.equal(canShareCommunityWithAll(freelancer, 'community'), true);
  assert.equal(canShareCommunityWithAll(freelancer, 'legal_support'), true);
  assert.equal(defaultCommunityVisibility(freelancer, 'community', EVICTION_QUOTE_VISIBILITY), 'all');
  assert.equal(canShareCommunityWithAll(freelancer, 'eviction_quote'), false);
  assert.equal(defaultCommunityVisibility(freelancer, 'eviction_quote', EVICTION_QUOTE_VISIBILITY), EVICTION_QUOTE_VISIBILITY);
});

test('일반 담당자의 기존 전체공개 제한은 유지한다', () => {
  const employee = { role: 'member', loginType: 'employee' };
  assert.equal(canShareCommunityWithAll(employee, 'community'), false);
  assert.equal(defaultCommunityVisibility(employee, 'community', EVICTION_QUOTE_VISIBILITY), 'branch');
});

test('일반 공개 글에는 단일 수신자가 없다', () => {
  assert.equal(directRecipientId('all'), null);
  assert.equal(directRecipientId('branch'), null);
});

test('user 공개 범위에서 단일 수신자를 식별한다', () => {
  assert.equal(directRecipientId('user:receiver-1'), 'receiver-1');
});

test('전체공개 명도견적과 법률지원 요청은 팀 알림을 유지한다', () => {
  assert.equal(communityCreatedNotificationMode({ category: 'eviction_quote', visibility: 'all' }), 'broadcast');
  assert.equal(communityCreatedNotificationMode({ category: 'legal_support', visibility: 'all', legalSubcategory: 'lawsuit' }), 'broadcast');
  assert.equal(communityCreatedNotificationMode({ category: 'legal_support', visibility: 'all', legalSubcategory: 'legal_terms' }), 'none');
});

test('명도팀 전용 공개값도 명도견적 팀 알림을 발송한다', () => {
  assert.equal(communityCreatedNotificationMode({ category: 'eviction_quote', visibility: EVICTION_QUOTE_VISIBILITY }), 'broadcast');
});

test('명도견적은 작성자·마스터·정민호 지사장·명도팀만 열람한다', () => {
  assert.equal(canAccessEvictionQuote({ userId: 'author', role: 'member', authorId: 'author' }), true);
  assert.equal(canAccessEvictionQuote({ userId: 'master', role: 'master' }), true);
  assert.equal(canAccessEvictionQuote({ userId: JEONG_MINHO_USER_ID, role: 'admin' }), true);
  assert.equal(canAccessEvictionQuote({ userId: 'eviction', role: 'support', department: '명도팀' }), true);
  assert.equal(canAccessEvictionQuote({ userId: 'team-member', role: 'support', teamName: '명도팀' }), true);
  assert.equal(canAccessEvictionQuote({ userId: 'other', role: 'admin', department: '경매사업부' }), false);
});

test('1:1 공유는 카테고리와 관계없이 단일 수신자 알림을 우선한다', () => {
  assert.equal(communityCreatedNotificationMode({ category: 'eviction_quote', visibility: 'user:receiver' }), 'direct');
  assert.equal(communityCreatedNotificationMode({ category: 'community', visibility: 'user:receiver' }), 'direct');
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
