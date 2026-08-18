import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('로그인 화면은 마지막으로 성공한 일반·프리랜서 선택을 다음 진입 때 복원한다', () => {
  const source = readFileSync(new URL('../src/react-app/pages/Login.tsx', import.meta.url), 'utf8');
  const successBlock = source.slice(
    source.indexOf('await login(email, password, loginType)'),
    source.indexOf("navigate('/dashboard')") + "navigate('/dashboard')".length,
  );

  assert.match(source, /LAST_LOGIN_TYPE_KEY = 'myauction_last_login_type'/);
  assert.match(source, /useState<'employee' \| 'freelancer'>\(loadLastLoginType\)/);
  assert.match(source, /getItem\(LAST_LOGIN_TYPE_KEY\) === 'freelancer' \? 'freelancer' : 'employee'/);
  assert.match(successBlock, /setItem\(LAST_LOGIN_TYPE_KEY, loginType\)/);
  assert.ok(
    successBlock.indexOf('await login(email, password, loginType)') < successBlock.indexOf('setItem(LAST_LOGIN_TYPE_KEY, loginType)'),
    '로그인이 성공한 뒤에만 마지막 로그인 방식을 저장해야 한다',
  );
});
