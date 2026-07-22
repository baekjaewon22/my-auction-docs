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
import {
  getPushSetupStatusForViewer,
  managerMissingPushUsers,
  runWebPushSetupReminders,
  type PushSetupUser,
} from '../src/worker/lib/web-push-setup-reminders.ts';

function d1(db: Database.Database): D1Database {
  return {
    prepare(sql: string) {
      const statement = db.prepare(sql);
      const bound = (...values: unknown[]) => ({
        all: async <T>() => ({ results: statement.all(...values) as T[] }),
        first: async <T>() => (statement.get(...values) as T | undefined) || null,
        run: async () => {
          const info = statement.run(...values);
          return { meta: { changes: info.changes } };
        },
      });
      return {
        bind: (...values: unknown[]) => bound(...values),
        all: async <T>() => ({ results: statement.all() as T[] }),
        first: async <T>() => (statement.get() as T | undefined) || null,
        run: async () => {
          const info = statement.run();
          return { meta: { changes: info.changes } };
        },
      } as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

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

test('push setup reminder migration is idempotent and prevents duplicate daily reminders', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users (id) VALUES ('manager-1');`);
  const migration = readFileSync(new URL('../d1/migrate-web-push-setup-reminders.sql', import.meta.url), 'utf8');
  db.exec(migration);
  db.exec(migration);
  const insert = db.prepare(`
    INSERT INTO web_push_setup_reminder_runs
      (id, alert_date, recipient_id, recipient_role, scope_label, missing_count)
    VALUES (?, '2026-07-20', 'manager-1', 'manager', '의정부 경매사업부1팀', 1)
  `);
  insert.run('run-1');
  assert.throws(() => insert.run('run-2'));
  db.close();
});

test('manager reminder scope includes unconfigured team members even when the manager has push enabled', async () => {
  const users: PushSetupUser[] = [
    { id: 'manager-1', name: '팀장', role: 'manager', branch: '의정부', department: '경매사업부1팀', active_push_count: 1 },
    { id: 'member-1', name: '미설정 팀원', role: 'member', branch: '의정부', department: '경매사업부1팀', active_push_count: 0 },
    { id: 'member-2', name: '설정 팀원', role: 'member', branch: '의정부', department: '경매사업부1팀', active_push_count: 1 },
    { id: 'member-3', name: '다른 팀원', role: 'member', branch: '의정부', department: '경매사업부2팀', active_push_count: 0 },
  ];
  assert.deepEqual(managerMissingPushUsers(users[0], users).map((item) => item.id), ['member-1']);
  const status = await getPushSetupStatusForViewer({} as D1Database, users[0], users);
  assert.equal(status.total_count, 3);
  assert.deepEqual(status.missing.map((item) => item.id), ['member-1']);
});

test('master reminder includes an unconfigured manager for upper-level follow-up', async () => {
  const users: PushSetupUser[] = [
    { id: 'master-1', name: '마스터', role: 'master', branch: '본사', department: '', active_push_count: 1 },
    { id: 'manager-1', name: '미설정 팀장', role: 'manager', branch: '의정부', department: '경매사업부1팀', active_push_count: 0 },
  ];
  const status = await getPushSetupStatusForViewer({} as D1Database, users[0], users);
  assert.deepEqual(status.missing.map((item) => item.id), ['manager-1']);
});

test('production cron includes the weekday 09:30 KST push setup reminder', () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.json', import.meta.url), 'utf8'));
  assert.ok(config.triggers.crons.includes('30 0 * * 1-5'));
});

test('push setup reminder skips a configured weekday holiday', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE system_holidays (holiday_date TEXT PRIMARY KEY, applies_to TEXT NOT NULL, enabled INTEGER NOT NULL);
    INSERT INTO system_holidays VALUES ('2026-07-17', 'all', 1);
  `);
  const result = await runWebPushSetupReminders({ DB: d1(db) } as Env, new Date('2026-07-17T00:30:00.000Z'));
  assert.equal(result.due, false);
  assert.equal(result.reason, 'non_working_day');
  db.close();
});

test('push setup reminder claims each recipient once per business day', async () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, name TEXT, role TEXT, branch TEXT, department TEXT,
      approved INTEGER, login_type TEXT
    );
    CREATE TABLE web_push_subscriptions (
      id TEXT PRIMARY KEY, user_id TEXT, active INTEGER, updated_at TEXT
    );
    CREATE TABLE system_holidays (holiday_date TEXT PRIMARY KEY, applies_to TEXT NOT NULL, enabled INTEGER NOT NULL);
    INSERT INTO users VALUES
      ('manager-1', '팀장', 'manager', '의정부', '경매사업부1팀', 1, 'employee'),
      ('member-1', '미설정 팀원', 'member', '의정부', '경매사업부1팀', 1, 'employee');
  `);
  const env = { DB: d1(db) } as Env;
  const now = new Date('2026-07-20T00:30:00.000Z');
  const first = await runWebPushSetupReminders(env, now);
  const second = await runWebPushSetupReminders(env, now);
  assert.equal(first.recipients, 1);
  assert.equal(second.recipients, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM web_push_setup_reminder_runs').get().count, 1);
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
