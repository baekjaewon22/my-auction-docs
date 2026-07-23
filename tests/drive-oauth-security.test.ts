import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../src/shared/html.ts';
import { signDriveOAuthState, verifyDriveOAuthState } from '../src/worker/lib/drive-oauth-state.ts';

test('Drive OAuth state는 서버 비밀키와 사용자·nonce에 묶인다', async () => {
  const token = await signDriveOAuthState('server-secret-a', 'user-1', 'nonce-1');
  assert.deepEqual(await verifyDriveOAuthState('server-secret-a', token), {
    userId: 'user-1',
    nonce: 'nonce-1',
  });
  await assert.rejects(() => verifyDriveOAuthState('server-secret-b', token));
});

test('OAuth 콜백에 표시되는 외부 문자열은 HTML로 실행되지 않는다', () => {
  assert.equal(
    escapeHtml('<script>alert("xss")</script> & test'),
    '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; test',
  );
  assert.equal(escapeHtml("user'o@example.com"), 'user&#39;o@example.com');
});
