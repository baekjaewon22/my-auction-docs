import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { createToken } from '../src/worker/middleware/auth.ts';
import leave from '../src/worker/routes/leave.ts';
import type { AuthEnv, JwtPayload, Role } from '../src/worker/types.ts';

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
  }) as D1Statement;

  return {
    prepare: (sql: string) => prepare(sql),
    batch: async (statements: D1PreparedStatement[]) => {
      const results: D1Result[] = [];
      for (const statement of statements) results.push(await (statement as D1Statement).run());
      return results;
    },
  } as unknown as D1Database;
}

const JWT_SECRET = 'freelancer-accountant-leave-access-secret';

function setup() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT '', name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '', role TEXT NOT NULL, team_id TEXT,
      branch TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '',
      position_title TEXT NOT NULL DEFAULT '', login_type TEXT NOT NULL DEFAULT 'employee',
      approved INTEGER NOT NULL DEFAULT 1, auth_version INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE leave_requests (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, leave_type TEXT NOT NULL,
      start_date TEXT NOT NULL, end_date TEXT NOT NULL, hours REAL NOT NULL DEFAULT 0,
      days REAL NOT NULL DEFAULT 1, reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending'
    );

    INSERT INTO users
      (id, email, name, role, branch, department, position_title, login_type)
    VALUES
      ('employee-member', 'employee@example.com', '일반 직원', 'member', '부산지사', '경매사업부', '사원', 'employee'),
      ('freelancer-member', 'freelancer@example.com', '프리랜서', 'member', '서초지사', '경매사업부', '사원', 'freelancer'),
      ('freelancer-manager', 'manager@example.com', '프리랜서 매니저', 'manager', '대전지사', '경매사업부', '팀장', 'freelancer'),
      ('freelancer-master', 'master@example.com', '프리랜서 마스터', 'master', '의정부본사', '경영지원부', '대표', 'freelancer'),
      ('accountant', 'accountant@example.com', '총무 담당', 'accountant', '부산지사', '경영지원부', '과장', 'employee'),
      ('ordinary-leave-user', 'ordinary@example.com', '일반 휴가자', 'member', '부산지사', '경매사업부', '대리', 'employee');

    INSERT INTO leave_requests
      (id, user_id, leave_type, start_date, end_date, hours, days, reason, status)
    VALUES
      ('accountant-leave', 'accountant', '연차', '2000-01-01', '2999-12-31', 0, 1, '총무 휴가', 'approved'),
      ('ordinary-leave', 'ordinary-leave-user', '연차', '2000-01-01', '2999-12-31', 0, 1, '일반 직원 휴가', 'approved');
  `);

  const db = d1FromSqlite(sqlite);
  const env = { DB: db, JWT_SIGNING_SECRET: JWT_SECRET } as Env;
  const app = new Hono<AuthEnv>().route('/api/leave', leave);

  async function tokenFor(id: string): Promise<string> {
    const row = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(id) as {
      id: string; email: string; name: string; phone: string; role: Role;
      team_id: string | null; branch: string; department: string;
      position_title: string; login_type: 'employee' | 'freelancer'; auth_version: number;
    };
    const payload: JwtPayload = {
      sub: row.id,
      email: row.email,
      name: row.name,
      phone: row.phone,
      role: row.role,
      team_id: row.team_id,
      branch: row.branch,
      department: row.department,
      position_title: row.position_title,
      login_type: row.login_type,
      auth_version: row.auth_version,
    };
    return createToken(payload, env);
  }

  async function requestAs(id: string, path: string, method = 'GET') {
    return app.request(`/api/leave${path}`, {
      method,
      headers: { Authorization: `Bearer ${await tokenFor(id)}` },
    }, env);
  }

  return { app, env, requestAs, sqlite };
}

test('총무 휴가 공지는 모든 프리랜서 역할에 민감정보 없이 제공된다', async (t) => {
  const { requestAs, sqlite } = setup();
  t.after(() => sqlite.close());

  const employeeResponse = await requestAs('employee-member', '/accountant-leaves');
  assert.equal(employeeResponse.status, 200, await employeeResponse.clone().text());
  const employeePayload = await employeeResponse.json() as { leaves: Array<Record<string, unknown>> };
  assert.equal(employeePayload.leaves.length, 1);
  assert.equal(employeePayload.leaves[0].id, 'accountant-leave');
  assert.equal(employeePayload.leaves[0].reason, '총무 휴가');
  assert.equal(employeePayload.leaves[0].user_id, 'accountant');
  assert.equal(employeePayload.leaves[0].department, '경영지원부');
  assert.equal(employeePayload.leaves[0].days, 1);
  assert.equal(employeePayload.leaves[0].hours, 0);

  for (const id of ['freelancer-member', 'freelancer-manager', 'freelancer-master']) {
    const response = await requestAs(id, '/accountant-leaves');
    assert.equal(response.status, 200, `${id}: ${await response.clone().text()}`);
    const payload = await response.json() as { leaves: Array<Record<string, unknown>> };
    assert.deepEqual(payload.leaves, [{
      id: 'accountant-leave',
      leave_type: '연차',
      start_date: '2000-01-01',
      end_date: '2999-12-31',
      name: '총무 담당',
      branch: '부산지사',
      position_title: '과장',
    }]);
    for (const field of ['reason', 'user_id', 'hours', 'days', 'department', 'email', 'phone']) {
      assert.equal(field in payload.leaves[0], false, `${id} must not receive ${field}`);
    }
  }
});

test('프리랜서 예외는 총무 휴가 GET 하나에만 적용되고 인증은 계속 필수다', async (t) => {
  const { app, env, requestAs, sqlite } = setup();
  t.after(() => sqlite.close());

  for (const id of ['freelancer-member', 'freelancer-manager']) {
    const otherLeaveResponse = await requestAs(id, '/requests');
    assert.equal(otherLeaveResponse.status, 403, `${id} must remain blocked from other leave APIs`);
  }

  const wrongMethodResponse = await requestAs('freelancer-member', '/accountant-leaves', 'POST');
  assert.equal(wrongMethodResponse.status, 403);

  const unauthenticatedResponse = await app.request('/api/leave/accountant-leaves', {}, env);
  assert.equal(unauthenticatedResponse.status, 401);
});
