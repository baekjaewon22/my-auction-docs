import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ensurePasswordSecuritySchemaOnce,
  passwordSecuritySchemaStatements,
} from '../src/worker/lib/password-security-schema.ts';

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

test('전역 인증의 비밀번호 스키마 확인은 같은 D1 바인딩에서 한 번만 실행한다', async () => {
  let pragmaCount = 0;
  const db = {
    prepare(sql: string) {
      return {
        async all() {
          if (sql.includes('PRAGMA table_info')) pragmaCount += 1;
          return { results: [{ name: 'auth_version' }] };
        },
        async run() {
          return { success: true };
        },
      };
    },
  } as unknown as D1Database;

  await Promise.all([
    ensurePasswordSecuritySchemaOnce(db),
    ensurePasswordSecuritySchemaOnce(db),
  ]);
  await ensurePasswordSecuritySchemaOnce(db);

  assert.equal(pragmaCount, 1);
});
