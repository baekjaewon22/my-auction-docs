import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordSecuritySchemaStatements } from '../src/worker/lib/password-security-schema.ts';

test('기존 DB에는 auth_version 열과 비밀번호 재설정 저장소를 함께 보강한다', () => {
  const statements = passwordSecuritySchemaStatements(false);

  assert.equal(
    statements.some((sql) => sql.includes('ADD COLUMN auth_version')),
    true,
  );
  assert.equal(
    statements.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS password_reset_challenges')),
    true,
  );
});

test('auth_version 열이 있으면 중복 ALTER 없이 재설정 저장소만 보강한다', () => {
  const statements = passwordSecuritySchemaStatements(true);

  assert.equal(
    statements.some((sql) => sql.includes('ADD COLUMN auth_version')),
    false,
  );
  assert.equal(
    statements.some((sql) => sql.includes('idx_password_reset_token')),
    true,
  );
});
