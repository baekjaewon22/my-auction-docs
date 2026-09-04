import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import {
  canEditPayrollInternalMemo,
  canViewPayrollInternalMemo,
} from '../src/shared/payroll-internal-memo-access.ts';
import type { AuthEnv, JwtPayload, Role } from '../src/worker/types.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // Fall through to Node's original resolution error.
      }
    }
    return nextResolve(specifier, context);
  },
});

const [{ default: payrollRoute }, { createToken }] = await Promise.all([
  import('../src/worker/routes/payroll.ts'),
  import('../src/worker/middleware/auth.ts'),
]);

type D1Statement = D1PreparedStatement & { run(): Promise<D1Result> };

function d1FromSqlite(sqlite: Database.Database): D1Database {
  const prepare = (sql: string, params: unknown[] = []): D1Statement => ({
    bind: (...values: unknown[]) => prepare(sql, values),
    all: async <T>() => ({ results: sqlite.prepare(sql).all(...params) as T[] }),
    first: async <T>() => (sqlite.prepare(sql).get(...params) as T | undefined) || null,
    run: async () => {
      const result = sqlite.prepare(sql).run(...params);
      return { success: true, meta: { changes: result.changes } } as unknown as D1Result;
    },
  } as D1Statement);
  return {
    prepare: (sql: string) => prepare(sql),
    batch: async (statements: D1PreparedStatement[]) => {
      const results: D1Result[] = [];
      for (const statement of statements) results.push(await (statement as D1Statement).run());
      return results;
    },
  } as unknown as D1Database;
}

const JWT_SECRET = 'payroll-internal-memo-route-secret-123456789';

function setup() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL,
      team_id TEXT,
      branch TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL DEFAULT '',
      login_type TEXT NOT NULL DEFAULT 'employee',
      approved INTEGER NOT NULL DEFAULT 1,
      auth_version INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE payroll_saves (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      period TEXT NOT NULL,
      pay_type TEXT NOT NULL,
      data TEXT NOT NULL,
      locked INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, period)
    );
    CREATE TABLE service_tokens (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      scope TEXT NOT NULL,
      expires_at TEXT,
      revoked_at TEXT,
      last_used_at TEXT,
      last_used_ip TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO users (id, email, name, role, branch, department) VALUES
      ('master-1', 'master@example.com', '마스터', 'master', '본사관리', '대표실'),
      ('ceo-1', 'ceo@example.com', '대표', 'ceo', '본사관리', '대표실'),
      ('accountant-1', 'accountant@example.com', '총무', 'accountant', '본사관리', '총무팀'),
      ('accountant-asst-1', 'accountant-asst@example.com', '총무보조', 'accountant_asst', '본사관리', '총무팀'),
      ('admin-1', 'admin@example.com', '관리자', 'admin', '본사관리', '관리팀'),
      ('cc-ref-1', 'cc-ref@example.com', '참조대표', 'cc_ref', '본사관리', '대표실'),
      ('member-1', 'member@example.com', '일반직원', 'member', '의정부', '경매사업부1팀'),
      ('target-1', 'target@example.com', '정산대상자', 'member', '의정부', '경매사업부1팀');
    INSERT INTO payroll_saves (id, user_id, period, pay_type, data, created_by)
    VALUES ('save-1', 'target-1', '2026년 9월', 'salary', '{"safe":"payroll-only"}', 'accountant-1');
  `);

  const env = { DB: d1FromSqlite(sqlite), JWT_SIGNING_SECRET: JWT_SECRET } as Env;
  const app = new Hono<AuthEnv>();
  app.route('/payroll', payrollRoute);
  return { sqlite, env, app };
}

async function requestAs(
  app: Hono<AuthEnv>,
  env: Env,
  actor: { id: string; role: Role; name: string },
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const payload: JwtPayload = {
    sub: actor.id,
    email: `${actor.id}@example.com`,
    name: actor.name,
    phone: '',
    role: actor.role,
    branch: '본사관리',
    department: '총무팀',
    auth_version: 0,
  };
  const token = await createToken(payload, env);
  return app.request(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  }, env);
}

const allowedActors: Array<{ id: string; role: Role; name: string }> = [
  { id: 'master-1', role: 'master', name: '마스터' },
  { id: 'ceo-1', role: 'ceo', name: '대표' },
  { id: 'accountant-1', role: 'accountant', name: '총무' },
  { id: 'accountant-asst-1', role: 'accountant_asst', name: '총무보조' },
];

test('급여 내부 메모 권한은 총무·총무보조·마스터·대표만 정확히 허용한다', () => {
  for (const actor of allowedActors) {
    assert.equal(canViewPayrollInternalMemo(actor), true);
  }
  assert.equal(canEditPayrollInternalMemo({ role: 'master' }), true);
  assert.equal(canEditPayrollInternalMemo({ role: 'accountant' }), true);
  assert.equal(canEditPayrollInternalMemo({ role: 'accountant_asst' }), true);
  assert.equal(canEditPayrollInternalMemo({ role: 'ceo' }), false);
  for (const role of ['cc_ref', 'admin', 'director', 'manager', 'member', 'support']) {
    assert.equal(canViewPayrollInternalMemo({ role }), false);
    assert.equal(canEditPayrollInternalMemo({ role }), false);
  }
});

test('허용 역할은 월별 메모를 작성·조회·수정하고 빈 메모로 지울 수 있다', async (t) => {
  const { sqlite, env, app } = setup();
  t.after(() => sqlite.close());

  const initial = await requestAs(app, env, allowedActors[2], '/payroll/internal-memo/target-1?period=2026-09');
  const initialText = await initial.text();
  assert.equal(initial.status, 200, initialText);
  assert.equal(initial.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(JSON.parse(initialText), { memo: null });

  const created = await requestAs(app, env, allowedActors[2], '/payroll/internal-memo', {
    method: 'PUT',
    body: JSON.stringify({ user_id: 'target-1', period: '2026-09', content: '  지급 전 계좌 확인  ' }),
  });
  const createdText = await created.text();
  assert.equal(created.status, 200, createdText);
  assert.equal(created.headers.get('Cache-Control'), 'private, no-store');
  const createdBody = JSON.parse(createdText) as any;
  assert.equal(createdBody.memo.content, '지급 전 계좌 확인');
  assert.equal(createdBody.memo.updated_by_name, '총무');
  assert.match(createdBody.memo.updated_at, /^\d{4}-\d{2}-\d{2}/);

  for (const actor of allowedActors) {
    const viewed = await requestAs(
      app,
      env,
      actor,
      '/payroll/internal-memo/target-1?period=' + encodeURIComponent('2026년 9월'),
    );
    const viewedText = await viewed.text();
    assert.equal(viewed.status, 200, `${actor.role}: ${viewedText}`);
    assert.equal((JSON.parse(viewedText) as any).memo.content, '지급 전 계좌 확인');
  }

  const ceoEdit = await requestAs(app, env, allowedActors[1], '/payroll/internal-memo', {
    method: 'PUT',
    body: JSON.stringify({ user_id: 'target-1', period: '2026-09', content: '대표 수정 시도' }),
  });
  assert.equal(ceoEdit.status, 403);

  const updated = await requestAs(app, env, allowedActors[3], '/payroll/internal-memo', {
    method: 'PUT',
    body: JSON.stringify({ user_id: 'target-1', period: '2026년 9월', content: '수정 메모' }),
  });
  const updatedText = await updated.text();
  assert.equal(updated.status, 200, updatedText);
  assert.equal((JSON.parse(updatedText) as any).memo.updated_by_name, '총무보조');

  assert.equal(
    sqlite.prepare("SELECT data FROM payroll_saves WHERE id = 'save-1'").pluck().get(),
    '{"safe":"payroll-only"}',
    '내부 메모는 급여 snapshot/save JSON을 변경하지 않아야 한다',
  );

  const cleared = await requestAs(app, env, allowedActors[0], '/payroll/internal-memo', {
    method: 'PUT',
    body: JSON.stringify({ user_id: 'target-1', period: '2026-09', content: '   ' }),
  });
  const clearedText = await cleared.text();
  assert.equal(cleared.status, 200, clearedText);
  assert.deepEqual(JSON.parse(clearedText), { success: true, memo: null });
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM payroll_internal_memos').pluck().get(), 0);
});

test('권한 없는 역할은 API 응답으로도 메모 내용을 받거나 변경할 수 없다', async (t) => {
  const { sqlite, env, app } = setup();
  t.after(() => sqlite.close());
  sqlite.exec(`
    CREATE TABLE payroll_internal_memos (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, period TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL, updated_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, period)
    );
    INSERT INTO payroll_internal_memos (id, user_id, period, content, created_by, updated_by)
    VALUES ('memo-1', 'target-1', '2026년 9월', '외부 노출 금지', 'accountant-1', 'accountant-1');
  `);

  const deniedActors: Array<{ id: string; role: Role; name: string }> = [
    { id: 'admin-1', role: 'admin', name: '관리자' },
    { id: 'cc-ref-1', role: 'cc_ref', name: '참조대표' },
    { id: 'member-1', role: 'member', name: '일반직원' },
  ];
  for (const actor of deniedActors) {
    const viewed = await requestAs(app, env, actor, '/payroll/internal-memo/target-1?period=2026-09');
    const responseText = await viewed.text();
    assert.equal(viewed.status, 403, actor.role);
    assert.equal(viewed.headers.get('Cache-Control'), 'private, no-store');
    assert.doesNotMatch(responseText, /외부 노출 금지/);
    assert.doesNotMatch(responseText, /"memo"/);

    const edited = await requestAs(app, env, actor, '/payroll/internal-memo', {
      method: 'PUT',
      body: JSON.stringify({ user_id: 'target-1', period: '2026-09', content: `${actor.role} 위조` }),
    });
    assert.equal(edited.status, 403, actor.role);
  }
  assert.equal(
    sqlite.prepare("SELECT content FROM payroll_internal_memos WHERE id = 'memo-1'").pluck().get(),
    '외부 노출 금지',
  );
});

test('master 권한으로 매핑되는 admin service token도 내부 메모 API에 접근할 수 없다', async (t) => {
  const { sqlite, env, app } = setup();
  t.after(() => sqlite.close());
  const serviceToken = 'payroll-memo-service-token';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serviceToken));
  const tokenHash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  sqlite.prepare(`
    INSERT INTO service_tokens (id, name, token_hash, scope)
    VALUES ('service-token-1', '자동화', ?, 'admin')
  `).run(tokenHash);

  const viewed = await app.request('/payroll/internal-memo/target-1?period=2026-09', {
    headers: { 'X-Service-Token': serviceToken },
  }, env);
  const viewedText = await viewed.text();
  assert.equal(viewed.status, 403, viewedText);
  assert.equal(viewed.headers.get('Cache-Control'), 'private, no-store');
  assert.doesNotMatch(viewedText, /"memo"/);

  const edited = await app.request('/payroll/internal-memo', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Service-Token': serviceToken,
    },
    body: JSON.stringify({ user_id: 'target-1', period: '2026-09', content: '자동화 수정 시도' }),
  }, env);
  assert.equal(edited.status, 403);
  assert.equal(edited.headers.get('Cache-Control'), 'private, no-store');
});

test('메모 입력은 대상·기간·2,000자 제한을 검증한다', async (t) => {
  const { sqlite, env, app } = setup();
  t.after(() => sqlite.close());
  const actor = allowedActors[2];

  const invalidPeriod = await requestAs(app, env, actor, '/payroll/internal-memo', {
    method: 'PUT',
    body: JSON.stringify({ user_id: 'target-1', period: '2026/09', content: '메모' }),
  });
  assert.equal(invalidPeriod.status, 400);
  assert.equal(invalidPeriod.headers.get('Cache-Control'), 'private, no-store');

  const impossiblePeriod = await requestAs(app, env, actor, '/payroll/internal-memo', {
    method: 'PUT',
    body: JSON.stringify({ user_id: 'target-1', period: '2026-13', content: '메모' }),
  });
  assert.equal(impossiblePeriod.status, 400);

  const unknownTarget = await requestAs(app, env, actor, '/payroll/internal-memo', {
    method: 'PUT',
    body: JSON.stringify({ user_id: 'missing', period: '2026-09', content: '메모' }),
  });
  assert.equal(unknownTarget.status, 404);
  assert.equal(unknownTarget.headers.get('Cache-Control'), 'private, no-store');

  const tooLong = await requestAs(app, env, actor, '/payroll/internal-memo', {
    method: 'PUT',
    body: JSON.stringify({ user_id: 'target-1', period: '2026-09', content: '가'.repeat(2001) }),
  });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(sqlite.prepare('SELECT COUNT(*) FROM payroll_internal_memos').pluck().get(), 0);
});
