import assert from 'node:assert/strict';
import test from 'node:test';
import { signatureDisplayName } from '../src/shared/signature-display.ts';

test('서명자 이름이 있으면 이름을 표시한다', () => {
  assert.equal(signatureDisplayName({ user_name: '홍길동' }), '홍길동');
});

test('삭제된 사용자 서명은 빈 문자열 대신 중립 문구를 표시한다', () => {
  assert.equal(signatureDisplayName({ user_name: null }), '탈퇴 사용자');
});
