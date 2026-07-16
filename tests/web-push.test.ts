import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import {
  isAllowedPushHost,
  isExpiredPushStatus,
  redactPushSecrets,
  validatePushEndpoint,
  validatePushKey,
} from '../src/shared/web-push.ts';
import { authMiddleware, requireHumanMaster, requireHumanUser } from '../src/worker/middleware/auth.ts';

test('known browser push services are allowed', () => {
  assert.equal(isAllowedPushHost('fcm.googleapis.com'), true);
  assert.equal(isAllowedPushHost('updates.push.services.mozilla.com'), true);
  assert.equal(isAllowedPushHost('web.push.apple.com'), true);
  assert.equal(isAllowedPushHost('db5p.notify.windows.com'), true);
  assert.equal(validatePushEndpoint('https://fcm.googleapis.com/fcm/send/example').provider, 'fcm.googleapis.com');
});

test('arbitrary, insecure, credentialed, IP and non-standard-port endpoints are rejected', () => {
  const rejected = [
    'http://fcm.googleapis.com/fcm/send/example',
    'https://example.com/push',
    'https://user:pass@fcm.googleapis.com/fcm/send/example',
    'https://127.0.0.1/push',
    'https://fcm.googleapis.com:8443/fcm/send/example',
    'https://evilnotify.windows.com/push',
  ];
  for (const endpoint of rejected) {
    assert.throws(() => validatePushEndpoint(endpoint));
  }
});

test('push encryption keys accept base64url only', () => {
  assert.equal(validatePushKey('A'.repeat(65), 'p256dh'), 'A'.repeat(65));
  assert.equal(validatePushKey('B'.repeat(22), 'auth'), 'B'.repeat(22));
  assert.throws(() => validatePushKey('short', 'p256dh'));
  assert.throws(() => validatePushKey('bad+key/value', 'auth'));
});

test('404 and 410 deactivate expired subscriptions', () => {
  assert.equal(isExpiredPushStatus(404), true);
  assert.equal(isExpiredPushStatus('410'), true);
  assert.equal(isExpiredPushStatus(500), false);
});

test('push secrets are redacted before logging', () => {
  const text = redactPushSecrets('endpoint=https://fcm.googleapis.com/fcm/send/secret p256dh=abc auth=xyz');
  assert.equal(text.includes('/secret'), false);
  assert.equal(text.includes('p256dh=abc'), false);
  assert.equal(text.includes('auth=xyz'), false);
});

function fakeEnv() {
  return {
    DB: {
      prepare: () => ({
        bind: () => ({ first: async () => ({ id: 'user-1' }) }),
      }),
    },
  };
}

test('human-only middleware rejects service and device credential paths', async () => {
  // The test app intentionally supplies a minimal mock binding instead of the full production Env.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('user', {
      sub: 'user-1', role: 'master', auth_type: 'user', name: 'Master',
    });
    await next();
  });
  app.get('/user', requireHumanUser(), (c) => c.json({ ok: true }));
  app.get('/master', requireHumanMaster(), (c) => c.json({ ok: true }));

  assert.equal((await app.request('/user', {}, fakeEnv())).status, 200);
  assert.equal((await app.request('/master', {}, fakeEnv())).status, 200);
  assert.equal((await app.request('/user', { headers: { 'X-AFO-Device-Key': 'machine' } }, fakeEnv())).status, 403);
  assert.equal((await app.request('/master', { headers: { 'X-Service-Token': 'machine' } }, fakeEnv())).status, 403);
});

test('missing JWT signing secret returns an operator-visible 503 instead of a misleading 401', async () => {
  const app = new Hono<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  app.use('*', authMiddleware);
  app.get('/', (c) => c.json({ ok: true }));
  const response = await app.request('/', { headers: { Authorization: 'Bearer user-token' } }, fakeEnv());
  assert.equal(response.status, 503);
  assert.match(await response.text(), /서버 인증 설정/);
});

test('web push migration is idempotent and enforces endpoint ownership uniqueness', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users (id) VALUES ('u1'), ('u2');`);
  const migration = readFileSync(new URL('../d1/migrate-web-push.sql', import.meta.url), 'utf8');
  db.exec(migration);
  db.exec(migration);
  const insert = db.prepare(`
    INSERT INTO web_push_subscriptions
      (id, user_id, endpoint, endpoint_hash, p256dh, auth_key)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insert.run('s1', 'u1', 'https://fcm.googleapis.com/fcm/send/one', 'same-hash', 'p'.repeat(65), 'a'.repeat(22));
  assert.throws(() => insert.run('s2', 'u2', 'https://fcm.googleapis.com/fcm/send/two', 'same-hash', 'p'.repeat(65), 'a'.repeat(22)));
  const log = db.prepare(`INSERT INTO web_push_delivery_logs (id, user_id, subscription_id, attempt_id, status) VALUES (?, 'u1', 's1', ?, 'sent')`);
  log.run('l1', 'attempt-one');
  log.run('l2', 'attempt-one');
  log.run('l3', 'attempt-one');
  log.run('l4', 'attempt-two');
  assert.equal(db.prepare(`SELECT COUNT(DISTINCT attempt_id) AS count FROM web_push_delivery_logs WHERE user_id = 'u1' AND attempt_id != ''`).get().count, 2);
  db.prepare("DELETE FROM users WHERE id = 'u1'").run();
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM web_push_subscriptions').get().count, 0);
  db.close();
});

test('service worker only handles push and notification clicks', () => {
  const source = readFileSync(new URL('../public/push-sw.js', import.meta.url), 'utf8');
  assert.match(source, /addEventListener\('push'/);
  assert.match(source, /addEventListener\('notificationclick'/);
  assert.doesNotMatch(source, /addEventListener\('fetch'/);
});

test('notification click focuses a window even when navigate rejects for an uncontrolled client', async () => {
  const source = readFileSync(new URL('../public/push-sw.js', import.meta.url), 'utf8');
  const handlers = new Map<string, (event: any) => void>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  let focused = false;
  let opened = false;
  const client = {
    url: 'https://my-docs.kr/profile',
    navigate: async () => { throw new TypeError('uncontrolled'); },
    focus: async () => { focused = true; },
  };
  const self = {
    location: { origin: 'https://my-docs.kr' },
    registration: { showNotification: async () => undefined },
    clients: {
      claim: async () => undefined,
      matchAll: async () => [client],
      openWindow: async () => { opened = true; },
    },
    addEventListener: (name: string, handler: (event: any) => void) => handlers.set(name, handler), // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  vm.runInNewContext(source, { self, URL });
  let completion: Promise<unknown> | undefined;
  handlers.get('notificationclick')?.({
    notification: { data: { url: '/dashboard' }, close: () => undefined },
    waitUntil: (promise: Promise<unknown>) => { completion = promise; },
  });
  await completion;
  assert.equal(focused, true);
  assert.equal(opened, false);
});
