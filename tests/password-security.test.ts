import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import auth from '../src/worker/routes/auth.ts';
import {
  createSecureToken,
  createSixDigitCode,
  hashPassword,
  hashResetSecret,
  PBKDF2_ITERATIONS,
  passwordNeedsRehash,
  verifyPassword,
} from '../src/shared/password-security.ts';

function d1(db: Database.Database): D1Database {
  return {
    prepare(sql: string) {
      const statement = db.prepare(sql);
      const bound = (values: unknown[]) => ({
        all: async <T>() => ({ results: statement.all(...values) as T[] }),
        first: async <T>() => (statement.get(...values) as T | undefined) || null,
        run: async () => ({ meta: { changes: statement.run(...values).changes } }),
      });
      return {
        bind: (...values: unknown[]) => bound(values),
        all: async <T>() => ({ results: statement.all() as T[] }),
        first: async <T>() => (statement.get() as T | undefined) || null,
        run: async () => ({ meta: { changes: statement.run().changes } }),
      } as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

const LEGACY_HASH = '7b2572b527081a350af94572d06c4531d264a5223f14c1c3ecd459a881d50c7c';

test('new password hashes use random salts and PBKDF2 verification', async () => {
  const first = await hashPassword('strong-password');
  const second = await hashPassword('strong-password');
  assert.equal(PBKDF2_ITERATIONS, 100_000);
  assert.match(first, /^pbkdf2-sha256\$100000\$/);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('strong-password', first), true);
  assert.equal(await verifyPassword('wrong-password', first), false);
  assert.equal(passwordNeedsRehash(first), false);
});

test('legacy hashes remain valid only so a successful login can upgrade them', async () => {
  assert.equal(await verifyPassword('legacy-pass', LEGACY_HASH), true);
  assert.equal(await verifyPassword('wrong', LEGACY_HASH), false);
  assert.equal(passwordNeedsRehash(LEGACY_HASH), true);
});

test('legacy user login upgrades to the Workers-compatible PBKDF2 limit', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, password_hash TEXT NOT NULL,
      name TEXT NOT NULL, phone TEXT NOT NULL, role TEXT NOT NULL,
      team_id TEXT, branch TEXT NOT NULL, department TEXT NOT NULL,
      position_title TEXT, login_type TEXT, approved INTEGER NOT NULL,
      auth_version INTEGER NOT NULL DEFAULT 0, updated_at TEXT
    );
  `);
  db.prepare(`
    INSERT INTO users
      (id, email, password_hash, name, phone, role, branch, department, login_type, approved)
    VALUES ('user-1', 'legacy@example.com', ?, '기존 사용자', '01000000000',
      'member', '서울', '컨설팅', 'employee', 1)
  `).run(LEGACY_HASH);

  const env = {
    DB: d1(db),
    JWT_SIGNING_SECRET: 'test-signing-secret-that-is-at-least-32-characters',
  } as Env;
  const app = new Hono().route('/api/auth', auth);
  const response = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'legacy@example.com',
      password: 'legacy-pass',
      login_type: 'employee',
    }),
  }, env);

  assert.equal(response.status, 200);
  const stored = db.prepare('SELECT password_hash FROM users WHERE id = ?')
    .get('user-1') as { password_hash: string };
  assert.match(stored.password_hash, /^pbkdf2-sha256\$100000\$/);
  assert.equal(await verifyPassword('legacy-pass', stored.password_hash), true);
  db.close();
});

test('reset codes and tokens use cryptographic randomness and expected formats', () => {
  const codes = new Set(Array.from({ length: 100 }, () => createSixDigitCode()));
  assert.ok([...codes].every((code) => /^\d{6}$/.test(code)));
  const first = createSecureToken();
  const second = createSecureToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test('password security migration creates durable one-time challenges and session versions', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE users (id TEXT PRIMARY KEY);');
  const migration = readFileSync(new URL('../d1/migrate-password-security.sql', import.meta.url), 'utf8');
  db.exec(migration);
  const userColumns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
  assert.ok(userColumns.some((column) => column.name === 'auth_version'));
  const challengeColumns = db.prepare('PRAGMA table_info(password_reset_challenges)').all() as Array<{ name: string }>;
  assert.ok(challengeColumns.some((column) => column.name === 'reset_token_hash'));
  assert.ok(challengeColumns.some((column) => column.name === 'consumed_at'));
  db.close();
});

test('verified reset challenges and reset tokens can each be consumed only once', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, password_hash TEXT NOT NULL, auth_version INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT
    );
    CREATE TABLE password_reset_challenges (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, verified_at INTEGER, reset_token_hash TEXT UNIQUE,
      reset_expires_at INTEGER, consumed_at INTEGER, created_at INTEGER NOT NULL
    );
    INSERT INTO users (id, password_hash) VALUES ('user-1', '${LEGACY_HASH}');
  `);
  const challengeId = 'challenge-1';
  const code = '654321';
  const now = Date.now();
  const codeHash = await hashResetSecret(`${challengeId}:${code}`);
  db.prepare(`
    INSERT INTO password_reset_challenges
      (id, user_id, code_hash, expires_at, created_at)
    VALUES (?, 'user-1', ?, ?, ?)
  `).run(challengeId, codeHash, now + 60_000, now);

  const env = { DB: d1(db) } as Env;
  const app = new Hono().route('/api/auth', auth);
  const verify = () => app.request('/api/auth/forgot-password/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge_id: challengeId, code }),
  }, env);

  const verified = await verify();
  assert.equal(verified.status, 200);
  const { reset_token: resetToken } = await verified.json() as { reset_token: string };
  assert.equal((await verify()).status, 400);

  const reset = () => app.request('/api/auth/forgot-password/reset', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reset_token: resetToken, new_password: 'new-secure-password' }),
  }, env);
  assert.equal((await reset()).status, 200);
  assert.equal((await reset()).status, 400);

  const user = db.prepare('SELECT password_hash, auth_version FROM users WHERE id = ?').get('user-1') as {
    password_hash: string; auth_version: number;
  };
  assert.equal(await verifyPassword('new-secure-password', user.password_hash), true);
  assert.equal(user.auth_version, 1);
  db.close();
});
