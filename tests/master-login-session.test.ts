import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveLoginSessionType } from '../src/shared/login-session.ts';

test('마스터는 계정 역할을 유지한 채 일반·프리랜서 세션을 선택한다', () => {
  assert.equal(resolveLoginSessionType('master', 'employee', 'employee'), 'employee');
  assert.equal(resolveLoginSessionType('master', 'employee', 'freelancer'), 'freelancer');
  assert.equal(resolveLoginSessionType('master', 'freelancer', 'employee'), 'employee');
});
test('마스터가 아닌 사용자는 요청값으로 고용형태를 우회할 수 없다', () => {
  assert.equal(resolveLoginSessionType('manager', 'employee', 'freelancer'), 'employee');
  assert.equal(resolveLoginSessionType('member', 'freelancer', 'employee'), 'freelancer');
  assert.equal(resolveLoginSessionType('admin', 'employee', 'freelancer'), 'employee');
});

test('인증 갱신과 내 정보 조회에서도 마스터의 선택 모드를 유지한다', () => {
  const middleware = readFileSync(new URL('../src/worker/middleware/auth.ts', import.meta.url), 'utf8');
  const authRoute = readFileSync(new URL('../src/worker/routes/auth.ts', import.meta.url), 'utf8');
  assert.match(middleware, /resolveLoginSessionType\([\s\S]*?payload\.login_type/);
  assert.match(authRoute, /const sessionLoginType = resolveLoginSessionType/);
  assert.match(authRoute, /login_type: payload\.login_type \|\|/);
});
