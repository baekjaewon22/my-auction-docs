import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { EXPENSE_RECEIPT_TEMPLATE_ID } from '../src/shared/expense-receipt.ts';
import { createToken } from '../src/worker/middleware/auth.ts';
import {
  canAccessDriveDocument,
  driveDocumentAccessSql,
} from '../src/worker/lib/drive-document-access.ts';
import drive from '../src/worker/routes/drive.ts';
import type { AuthEnv, JwtPayload, Role } from '../src/worker/types.ts';

type D1Statement = D1PreparedStatement & { run(): Promise<D1Result> };

function d1FromSqlite(sqlite: Database.Database): D1Database {
  const prepare = (sql: string, params: unknown[] = []): D1Statement => {
    return {
      bind: (...values: unknown[]) => prepare(sql, values),
      all: async <T>() => ({ results: sqlite.prepare(sql).all(...params) as T[] }),
      first: async <T>() => (sqlite.prepare(sql).get(...params) as T | undefined) || null,
      run: async () => {
        const result = sqlite.prepare(sql).run(...params);
        return { success: true, meta: { changes: result.changes } } as unknown as D1Result;
      },
    } as D1Statement;
  };
  return {
    prepare: (sql: string) => prepare(sql),
    batch: async (statements: D1PreparedStatement[]) => {
      const results: D1Result[] = [];
      for (const statement of statements) results.push(await (statement as D1Statement).run());
      return results;
    },
  } as unknown as D1Database;
}

const JWT_SECRET = 'drive-expense-receipt-access-test-secret-123456789';

function setup() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT '', name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '', role TEXT NOT NULL, team_id TEXT,
      branch TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '',
      position_title TEXT NOT NULL DEFAULT '', login_type TEXT NOT NULL DEFAULT 'employee',
      approved INTEGER NOT NULL DEFAULT 1, auth_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE templates (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '{}', category TEXT NOT NULL DEFAULT '',
      is_myauction INTEGER NOT NULL DEFAULT 0, created_by TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE documents (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '{}',
      template_id TEXT, author_id TEXT NOT NULL, branch TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
      cancelled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE approval_steps (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, status TEXT NOT NULL,
      signed_at TEXT
    );
    CREATE TABLE drive_backup_logs (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, run_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL, drive_file_id TEXT NOT NULL DEFAULT '',
      drive_folder_path TEXT NOT NULL DEFAULT '', file_size INTEGER NOT NULL DEFAULT 0,
      error_message TEXT NOT NULL DEFAULT '', triggered_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE drive_settings (
      id TEXT PRIMARY KEY, refresh_token_encrypted TEXT NOT NULL DEFAULT '',
      token_iv TEXT NOT NULL DEFAULT '', auto_enabled INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE signatures (
      id TEXT PRIMARY KEY, document_id TEXT, user_id TEXT, signature_data TEXT
    );
    CREATE TABLE service_tokens (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL,
      scope TEXT NOT NULL, expires_at TEXT, revoked_at TEXT, last_used_at TEXT,
      last_used_ip TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO drive_settings (id) VALUES ('default');
  `);

  const insertUser = sqlite.prepare(`INSERT INTO users
    (id, email, name, role, branch, department, login_type)
    VALUES (?, ?, ?, ?, ?, '회계', ?)`);
  const users: Array<[string, string, Role, string, string]> = [
    ['master', '마스터', 'master', '의정부', 'employee'],
    ['admin-own', '부산 관리자', 'admin', '부산', 'employee'],
    ['other-author', '대전 담당자', 'member', '대전', 'employee'],
    ['accountant', '총무', 'accountant', '의정부', 'employee'],
    ['freelance-accountant', '프리랜서 총무', 'accountant', '서초', 'freelancer'],
    ['cc', '참조', 'cc_ref', '의정부', 'employee'],
  ];
  for (const [id, name, role, branch, loginType] of users) {
    insertUser.run(id, `${id}@example.com`, name, role, branch, loginType);
  }
  sqlite.prepare(`INSERT INTO templates
    (id, title, description, content, category, is_myauction, created_by)
    VALUES ('tpl-exp-001', '지출결의서', '', '{}', '비용', 1, 'master')`).run();
  sqlite.prepare(`INSERT INTO templates
    (id, title, description, content, category, is_myauction, created_by)
    VALUES (?, '영수증 첨부 지출결의서', '', '{}', '비용', 1, 'master')`)
    .run(EXPENSE_RECEIPT_TEMPLATE_ID);
  sqlite.prepare(`INSERT INTO templates
    (id, title, description, content, category, is_myauction, created_by)
    VALUES ('tpl-generic', '일반 문서', '', '{}', '일반', 0, 'master')`).run();

  const insertDocument = sqlite.prepare(`INSERT INTO documents
    (id, title, template_id, author_id, branch, status) VALUES (?, ?, ?, ?, ?, 'approved')`);
  insertDocument.run('generic', '일반 백업', 'tpl-generic', 'other-author', '대전');
  insertDocument.run('receipt-own', '부산 영수증', EXPENSE_RECEIPT_TEMPLATE_ID, 'admin-own', '부산');
  insertDocument.run('receipt-other', '대전 영수증', EXPENSE_RECEIPT_TEMPLATE_ID, 'other-author', '대전');
  insertDocument.run('receipt-freelance-own', '서초 영수증', EXPENSE_RECEIPT_TEMPLATE_ID, 'freelance-accountant', '서초');
  for (const id of ['generic', 'receipt-own', 'receipt-other', 'receipt-freelance-own']) {
    sqlite.prepare(`INSERT INTO approval_steps (id, document_id, status, signed_at)
      VALUES (?, ?, 'approved', datetime('now'))`).run(`step-${id}`, id);
    sqlite.prepare(`INSERT INTO drive_backup_logs
      (id, document_id, status, drive_file_id, drive_folder_path, error_message, triggered_by)
      VALUES (?, ?, 'failed', ?, ?, 'upload failed', 'master')`)
      .run(`log-${id}`, id, `drive-${id}`, `/${id}`);
  }

  const db = d1FromSqlite(sqlite);
  const env = { DB: db, JWT_SIGNING_SECRET: JWT_SECRET } as Env;
  const app = new Hono<AuthEnv>().route('/api/drive', drive);

  async function humanToken(id: string): Promise<string> {
    const row = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, any>;
    const payload: JwtPayload = {
      sub: row.id, email: row.email, name: row.name, phone: row.phone,
      role: row.role, team_id: null, branch: row.branch, department: row.department,
      position_title: row.position_title, login_type: row.login_type, auth_version: 0,
    };
    return createToken(payload, env);
  }

  async function requestAs(id: string, path: string, method = 'GET', body?: unknown) {
    return app.request(`/api/drive${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await humanToken(id)}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env);
  }

  async function addServiceToken(scope: 'read' | 'write' | 'admin') {
    const token = `service-${scope}-${crypto.randomUUID()}`;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    sqlite.prepare(`INSERT INTO service_tokens (id, name, token_hash, scope)
      VALUES (?, '테스트 서비스', ?, ?)`).run(`service-${scope}`, hash, scope);
    return token;
  }

  async function requestAsService(scope: 'read' | 'write' | 'admin', path: string, method = 'GET', body?: unknown) {
    const token = await addServiceToken(scope);
    return app.request(`/api/drive${path}`, {
      method,
      headers: {
        'X-Service-Token': token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env);
  }

  return { sqlite, requestAs, requestAsService };
}

async function responseIds(response: Response, key: 'documents' | 'logs'): Promise<string[]> {
  assert.equal(response.status, 200);
  const payload = await response.json() as Record<string, Array<Record<string, string>>>;
  return payload[key].map((row) => key === 'documents' ? row.id : row.document_id).sort();
}

test('Drive receipt scope matches human role/login type and blocks synthetic service roles', () => {
  const receipt = { template_id: EXPENSE_RECEIPT_TEMPLATE_ID, author_id: 'owner', status: 'approved' };
  assert.equal(canAccessDriveDocument({ sub: 'owner', role: 'admin', login_type: 'employee', auth_type: 'user' }, receipt), true);
  assert.equal(canAccessDriveDocument({ sub: 'ceo', role: 'ceo', login_type: 'employee', auth_type: 'user' }, receipt), true);
  assert.equal(canAccessDriveDocument({ sub: 'accountant', role: 'accountant', login_type: 'freelancer', auth_type: 'user' }, receipt), false);
  assert.equal(canAccessDriveDocument({ sub: 'master', role: 'master', login_type: 'freelancer', auth_type: 'user' }, receipt), true);
  assert.equal(canAccessDriveDocument({ sub: 'service-token:x', role: 'master', auth_type: 'service_token' }, receipt), false);
  assert.equal(canAccessDriveDocument({ sub: 'service-token:x', role: 'master', auth_type: 'service_token' }, {
    ...receipt, template_id: 'tpl-generic',
  }), true);
});

test('Drive SQL scope executes with the same employee, freelancer, and service-token boundaries', () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`CREATE TABLE documents (id TEXT, template_id TEXT, author_id TEXT, status TEXT);
    INSERT INTO documents VALUES
      ('generic', 'tpl-generic', 'other', 'approved'),
      ('own', '${EXPENSE_RECEIPT_TEMPLATE_ID}', 'viewer', 'approved'),
      ('other', '${EXPENSE_RECEIPT_TEMPLATE_ID}', 'other', 'approved'),
      ('draft-other', '${EXPENSE_RECEIPT_TEMPLATE_ID}', 'other', 'draft');`);
  const ids = (user: Parameters<typeof driveDocumentAccessSql>[0]) => {
    const access = driveDocumentAccessSql(user);
    return (sqlite.prepare(`SELECT d.id FROM documents d WHERE ${access.clause} ORDER BY d.id`)
      .all(...access.bindings) as Array<{ id: string }>).map((row) => row.id);
  };
  assert.deepEqual(ids({ sub: 'viewer', role: 'admin', login_type: 'employee', auth_type: 'user' }), ['generic', 'own']);
  assert.deepEqual(ids({ sub: 'viewer', role: 'accountant', login_type: 'employee', auth_type: 'user' }), ['generic', 'other', 'own']);
  assert.deepEqual(ids({ sub: 'viewer', role: 'accountant', login_type: 'freelancer', auth_type: 'user' }), ['generic', 'own']);
  assert.deepEqual(ids({ sub: 'service-token:x', role: 'master', auth_type: 'service_token' }), ['generic']);
  sqlite.close();
});

test('pending and log APIs never expose another user receipt to admin, freelancer, or service token', async () => {
  const first = setup();
  assert.deepEqual(await responseIds(await first.requestAs('admin-own', '/pending'), 'documents'), ['generic', 'receipt-own']);
  assert.deepEqual(await responseIds(await first.requestAs('accountant', '/pending'), 'documents'), [
    'generic', 'receipt-freelance-own', 'receipt-other', 'receipt-own',
  ]);
  assert.deepEqual(await responseIds(await first.requestAs('freelance-accountant', '/pending'), 'documents'), [
    'generic', 'receipt-freelance-own',
  ]);
  assert.deepEqual(await responseIds(await first.requestAs('cc', '/pending'), 'documents'), ['generic']);
  assert.deepEqual(await responseIds(await first.requestAsService('read', '/pending'), 'documents'), ['generic']);
  first.sqlite.close();

  const second = setup();
  assert.deepEqual(await responseIds(await second.requestAs('admin-own', '/logs'), 'logs'), ['generic', 'receipt-own']);
  assert.deepEqual(await responseIds(await second.requestAsService('read', '/logs'), 'logs'), ['generic']);
  second.sqlite.close();
});

test('Drive settings counters are calculated only from receipt rows visible to the caller', async () => {
  const human = setup();
  const adminResponse = await human.requestAs('admin-own', '/settings');
  assert.equal(adminResponse.status, 200);
  const adminPayload = await adminResponse.json() as { pending_count: number; failed_last_7d: number };
  assert.equal(adminPayload.pending_count, 2);
  assert.equal(adminPayload.failed_last_7d, 2);
  human.sqlite.close();

  const service = setup();
  const serviceResponse = await service.requestAsService('read', '/settings');
  assert.equal(serviceResponse.status, 200);
  const servicePayload = await serviceResponse.json() as { pending_count: number; failed_last_7d: number };
  assert.equal(servicePayload.pending_count, 1);
  assert.equal(servicePayload.failed_last_7d, 1);
  service.sqlite.close();
});

test('Drive error summary does not aggregate failures from hidden receipts', async () => {
  const human = setup();
  const adminResponse = await human.requestAs('admin-own', '/error-summary');
  assert.equal(adminResponse.status, 200);
  const adminPayload = await adminResponse.json() as { summary: Array<{ cnt: number }> };
  assert.equal(Number(adminPayload.summary[0]?.cnt || 0), 2);
  human.sqlite.close();

  const service = setup();
  const serviceResponse = await service.requestAsService('read', '/error-summary');
  assert.equal(serviceResponse.status, 200);
  const servicePayload = await serviceResponse.json() as { summary: Array<{ cnt: number }> };
  assert.equal(Number(servicePayload.summary[0]?.cnt || 0), 1);
  service.sqlite.close();
});

test('last backup timestamp is not derived from a hidden receipt log', async () => {
  const service = setup();
  service.sqlite.prepare('DELETE FROM drive_backup_logs').run();
  service.sqlite.prepare(`INSERT INTO drive_backup_logs
    (id, document_id, run_at, status, drive_file_id)
    VALUES ('generic-success', 'generic', '2026-08-01 00:00:00', 'success', 'generic-drive')`).run();
  service.sqlite.prepare(`INSERT INTO drive_backup_logs
    (id, document_id, run_at, status, drive_file_id)
    VALUES ('receipt-success', 'receipt-other', '2026-08-02 00:00:00', 'success', 'receipt-drive')`).run();
  const response = await service.requestAsService('read', '/settings');
  assert.equal(response.status, 200);
  const payload = await response.json() as { last_backup_at: string | null };
  assert.equal(payload.last_backup_at, '2026-08-01 00:00:00');
  service.sqlite.close();
});

test('failed-log reset cannot make an unauthorized receipt eligible for resend', async () => {
  const human = setup();
  const humanResponse = await human.requestAs('admin-own', '/retry-failed', 'POST', { all: true });
  assert.equal(humanResponse.status, 200);
  assert.deepEqual(
    (human.sqlite.prepare('SELECT document_id FROM drive_backup_logs ORDER BY document_id').all() as Array<{ document_id: string }>).map((row) => row.document_id),
    ['receipt-freelance-own', 'receipt-other'],
  );
  human.sqlite.close();

  const service = setup();
  const serviceResponse = await service.requestAsService('admin', '/retry-failed', 'POST', { all: true });
  assert.equal(serviceResponse.status, 200);
  assert.deepEqual(
    (service.sqlite.prepare('SELECT document_id FROM drive_backup_logs ORDER BY document_id').all() as Array<{ document_id: string }>).map((row) => row.document_id),
    ['receipt-freelance-own', 'receipt-other', 'receipt-own'],
  );
  service.sqlite.close();
});

test('test-send denies unauthorized human and every service token before retention or delivery checks', async () => {
  const human = setup();
  const denied = await human.requestAs('admin-own', '/test-send', 'POST', { document_ids: ['receipt-other'] });
  assert.equal(denied.status, 403);
  const own = await human.requestAs('admin-own', '/test-send', 'POST', { document_ids: ['receipt-own'] });
  assert.equal(own.status, 409);
  human.sqlite.close();

  const service = setup();
  const serviceDenied = await service.requestAsService('admin', '/test-send', 'POST', { document_ids: ['receipt-other'] });
  assert.equal(serviceDenied.status, 403);
  service.sqlite.close();
});

test('manual run and explicit test send pass receipt access filter into the batch itself', () => {
  const routeSource = readFileSync(new URL('../src/worker/routes/drive.ts', import.meta.url), 'utf8');
  const runnerSource = readFileSync(new URL('../src/worker/drive-backup-runner.ts', import.meta.url), 'utf8');
  assert.match(routeSource, /drive\.post\('\/run-now'[\s\S]*?document_access_filter: \(document\) => canAccessDriveDocument\(user, document\)/);
  assert.match(routeSource, /drive\.post\('\/test-send'[\s\S]*?document_access_filter: \(document\) => canAccessDriveDocument\(user, document\)/);
  assert.match(runnerSource, /docs = \(pending\.results \|\| \[\]\)[\s\S]*?opts\.document_access_filter\(document\)[\s\S]*?\.slice\(0, limit\)/);
});
