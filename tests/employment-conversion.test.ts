import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canConvertEmployeeRoleToFreelancer,
  freelancerConversionBlockers,
  normalizeCommissionRate,
  restoreEmployeeRoleFromSnapshot,
} from '../src/shared/employment-conversion.ts';

test('업무형 정규직 역할만 프리랜서 전환 대상이다', () => {
  assert.equal(canConvertEmployeeRoleToFreelancer('director'), true);
  assert.equal(canConvertEmployeeRoleToFreelancer('manager'), true);
  assert.equal(canConvertEmployeeRoleToFreelancer('member'), true);
  assert.equal(canConvertEmployeeRoleToFreelancer('master'), false);
  assert.equal(canConvertEmployeeRoleToFreelancer('ceo'), false);
  assert.equal(canConvertEmployeeRoleToFreelancer('admin'), false);
  assert.equal(canConvertEmployeeRoleToFreelancer('accountant'), false);
  assert.equal(canConvertEmployeeRoleToFreelancer('resigned'), false);
});

test('프리랜서 지급 비율은 0 초과 100 이하만 허용한다', () => {
  assert.equal(normalizeCommissionRate(50), 50);
  assert.equal(normalizeCommissionRate('33.333'), 33.33);
  assert.equal(normalizeCommissionRate(0), null);
  assert.equal(normalizeCommissionRate(101), null);
  assert.equal(normalizeCommissionRate('invalid'), null);
});

test('정규직 재전환은 전환 전 업무 역할을 안전하게 복원한다', () => {
  assert.equal(restoreEmployeeRoleFromSnapshot('{"previous_role":"director"}'), 'director');
  assert.equal(restoreEmployeeRoleFromSnapshot('{"previous_role":"manager"}'), 'manager');
  assert.equal(restoreEmployeeRoleFromSnapshot('{"previous_role":"member"}'), 'member');
  assert.equal(restoreEmployeeRoleFromSnapshot('{"previous_role":"master"}'), 'member');
  assert.equal(restoreEmployeeRoleFromSnapshot('invalid-json'), 'member');
  assert.equal(restoreEmployeeRoleFromSnapshot(null), 'member');
});

test('처리 중 휴가와 결재는 전환 차단 사유가 된다', () => {
  assert.deepEqual(
    freelancerConversionBlockers({
      pending_leave_requests: 2,
      pending_approval_steps: 1,
      active_non_myauction_documents: 3,
    }),
    ['처리 중인 휴가 요청 2건', '승인 대기 결재 1건', '처리 중인 사내 문서 3건'],
  );
  assert.deepEqual(
    freelancerConversionBlockers({
      pending_leave_requests: 0,
      pending_approval_steps: 0,
      active_non_myauction_documents: 0,
    }),
    [],
  );
});

test('전환 API는 기존 업무 데이터를 삭제하지 않고 이력과 계정 유형을 갱신한다', () => {
  const source = readFileSync(
    new URL('../src/worker/routes/users.ts', import.meta.url),
    'utf8',
  );
  const routeStart = source.indexOf("users.put('/:id/convert-to-freelancer'");
  assert.notEqual(routeStart, -1);
  const routeEnd = source.indexOf("users.delete('/:id'", routeStart);
  assert.notEqual(routeEnd, -1);
  const routeSource = source.slice(routeStart, routeEnd);

  assert.match(routeSource, /login_type = 'freelancer'/);
  assert.match(routeSource, /role = 'member'/);
  assert.match(routeSource, /auth_version = COALESCE\(auth_version, 0\) \+ 1/);
  assert.match(routeSource, /before_freelancer_conversion/);
  assert.match(routeSource, /source = 'freelancer_conversion'/);
  assert.match(routeSource, /user_employment_type_history/);
  assert.doesNotMatch(routeSource, /user: \{ \.\.\.target/);
  assert.match(routeSource, /conversionUserResponse\(target, 'freelancer', 'member'\)/);
  assert.doesNotMatch(routeSource, /DELETE FROM (documents|sales_records|cases|annual_leave|leave_requests)/);
});

test('정규직 재전환 API는 같은 사용자 계정과 전환 전 역할을 이어서 사용한다', () => {
  const source = readFileSync(
    new URL('../src/worker/routes/users.ts', import.meta.url),
    'utf8',
  );
  const routeStart = source.indexOf("users.put('/:id/convert-to-employee'");
  const routeEnd = source.indexOf("users.put('/:id/convert-to-freelancer'", routeStart);
  const routeSource = source.slice(routeStart, routeEnd);

  assert.match(routeSource, /restoreEmployeeRoleFromSnapshot/);
  assert.match(routeSource, /SET login_type = 'employee', role = \?/);
  assert.match(routeSource, /conversionUserResponse\(target, 'employee', restoredRole\)/);
  assert.doesNotMatch(routeSource, /INSERT INTO users/);
  assert.doesNotMatch(routeSource, /DELETE FROM/);
});

test('사용자 관리 화면에는 역방향 전환 버튼과 데이터 보존 안내가 있다', () => {
  const source = readFileSync(
    new URL('../src/react-app/pages/UserManagement.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /프리랜서 전환 저장/);
  assert.match(source, /기존 매출·문서·사건·연차 이력은 삭제되지 않습니다/);
  assert.match(source, /freelancerConversionImpact/);
});
