import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import {
  canUploadBriefingMaterial,
  canViewBriefingMaterial,
} from '../src/shared/briefing-material-access.ts';
import { JEONG_MINHO_USER_ID } from '../src/shared/eviction-quote-access.ts';
import { hashPassword } from '../src/shared/password-security.ts';
import { createToken } from '../src/worker/middleware/auth.ts';
import { ensureBriefingMaterialSchema } from '../src/worker/lib/briefing-materials.ts';
import adminNotes from '../src/worker/routes/admin-notes.ts';
import auth from '../src/worker/routes/auth.ts';
import briefingMaterials from '../src/worker/routes/briefing-materials.ts';
import type { AuthEnv, JwtPayload, Role } from '../src/worker/types.ts';

type D1Statement = D1PreparedStatement & { run(): Promise<D1Result> };

function d1FromSqlite(sqlite: Database.Database): D1Database {
  const prepare = (sql: string, params: unknown[] = []): D1Statement => {
    const statement = () => {
      try {
        return sqlite.prepare(sql);
      } catch (error) {
        throw new Error(`Failed to prepare test SQL: ${sql}`, { cause: error });
      }
    };
    return {
      bind: (...values: unknown[]) => prepare(sql, values),
      all: async <T>() => ({ results: statement().all(...params) as T[] }),
      first: async <T>() => (statement().get(...params) as T | undefined) || null,
      run: async () => {
        const result = statement().run(...params);
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

const JWT_SECRET = 'briefing-material-access-test-secret-123456789';
const LOGIN_PASSWORD = 'briefing-access-password';

async function setup() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE teams (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, password_hash TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', role TEXT NOT NULL, team_id TEXT,
      branch TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '', position_title TEXT NOT NULL DEFAULT '',
      login_type TEXT NOT NULL DEFAULT 'employee', approved INTEGER NOT NULL DEFAULT 1,
      auth_version INTEGER NOT NULL DEFAULT 0, saved_signature TEXT,
      myauction_id TEXT NOT NULL DEFAULT '', myauction_pw TEXT NOT NULL DEFAULT '',
      report_permission TEXT NOT NULL DEFAULT 'basic', created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE admin_notes (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
      author_id TEXT NOT NULL, author_name TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE admin_note_comments (
      id TEXT PRIMARY KEY, note_id TEXT NOT NULL, author_id TEXT NOT NULL,
      author_name TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '',
      is_anonymous INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE journal_entries (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, target_date TEXT NOT NULL,
      activity_type TEXT NOT NULL, activity_subtype TEXT NOT NULL DEFAULT '', data TEXT NOT NULL DEFAULT '{}',
      branch TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE alert_personal_doc_missing (
      id TEXT PRIMARY KEY, journal_entry_id TEXT NOT NULL, doc_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', matched_doc_id TEXT, resolved_at TEXT,
      last_checked_at TEXT, reason_text TEXT
    );
    CREATE TABLE alert_bid_field_missing (
      id TEXT PRIMARY KEY, journal_entry_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
      last_checked_at TEXT
    );
    CREATE TABLE alert_business_trip_missing (
      id TEXT PRIMARY KEY, journal_entry_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
      last_checked_at TEXT
    );
    CREATE TABLE alert_schedule_gap (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, target_date TEXT NOT NULL,
      gap_count INTEGER NOT NULL DEFAULT 0, gap_details TEXT NOT NULL DEFAULT '[]',
      total_gap_minutes INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open',
      resolved_at TEXT, last_checked_at TEXT
    );
    CREATE TABLE system_holidays (
      holiday_date TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, applies_to TEXT NOT NULL DEFAULT 'all'
    );
  `);
  sqlite.prepare("INSERT INTO teams (id, name) VALUES ('eviction', '명도팀')").run();
  const insertUser = sqlite.prepare(`INSERT INTO users
    (id, email, password_hash, name, role, team_id, branch, department, login_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const users: Array<[string, Role, string | null, string, string, string]> = [
    ['master', 'master', null, '본사', '경영', 'employee'],
    ['ceo', 'ceo', null, '본사', '경영', 'employee'],
    ['cc', 'cc_ref', null, '본사', '경영', 'employee'],
    [JEONG_MINHO_USER_ID, 'member', null, '의정부', '경매사업부', 'employee'],
    ['eviction-department', 'support', null, '부산', '명도팀', 'employee'],
    ['eviction-team', 'member', 'eviction', '대전', '지원', 'employee'],
    ['admin', 'admin', null, '의정부', '경매사업부', 'employee'],
    ['accountant', 'accountant', null, '본사', '회계', 'employee'],
    ['assistant', 'accountant_asst', null, '본사', '회계', 'employee'],
    ['member', 'member', null, '서울', '경매사업부', 'employee'],
    ['freelancer', 'member', null, '서울', '경매사업부', 'freelancer'],
  ];
  const passwordHash = await hashPassword(LOGIN_PASSWORD);
  for (const [id, role, teamId, branch, department, loginType] of users) {
    insertUser.run(id, `${id}@example.com`, passwordHash, id, role, teamId, branch, department, loginType);
  }

  const db = d1FromSqlite(sqlite);
  await ensureBriefingMaterialSchema(db);
  const insertMaterial = sqlite.prepare(`INSERT INTO briefing_materials
    (id, uploaded_by, uploader_name, branch, assignee_user_id, assignee_name, case_number,
      material_month, object_key, file_name, file_type, file_size, sha256)
    VALUES (?, 'master', '마스터', ?, 'member', '담당자', ?, '2026.09', ?, ?, 'application/pdf', 5, ?)`);
  insertMaterial.run('seoul-material', '서울', '2026타경1', 'briefing-materials/seoul.pdf', '서울자료.pdf', 'hash-seoul');
  insertMaterial.run('busan-material', '부산', '2026타경2', 'briefing-materials/busan.pdf', '부산자료.pdf', 'hash-busan');

  const articleBucket = {
    get: async (key: string) => ({
      body: new Blob([key]).stream(),
      size: new TextEncoder().encode(key).byteLength,
      httpMetadata: { contentType: 'application/pdf' },
    }),
  };
  const env = { DB: db, ARTICLE_BUCKET: articleBucket, JWT_SIGNING_SECRET: JWT_SECRET } as unknown as Env;
  const materialsApp = new Hono<AuthEnv>().route('/api/briefing-materials', briefingMaterials);
  const adminNotesApp = new Hono<AuthEnv>().route('/api/admin-notes', adminNotes);
  const authApp = new Hono<AuthEnv>().route('/api/auth', auth);

  async function token(id: string): Promise<string> {
    const row = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, any>;
    const payload: JwtPayload = {
      sub: row.id, email: row.email, name: row.name, phone: row.phone,
      role: row.role, team_id: row.team_id, branch: row.branch, department: row.department,
      position_title: row.position_title, login_type: row.login_type, auth_version: row.auth_version,
    };
    return createToken(payload, env);
  }

  async function requestAs(id: string, path: string, method = 'GET'): Promise<Response> {
    return materialsApp.request(`/api/briefing-materials${path}`, {
      method,
      headers: { Authorization: `Bearer ${await token(id)}` },
    }, env);
  }

  async function requestAdminNotesAs(id: string, path: string, method = 'GET', body?: unknown): Promise<Response> {
    return adminNotesApp.request(`/api/admin-notes${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await token(id)}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env, {
      waitUntil: (promise: Promise<unknown>) => { void promise.catch(() => undefined); },
      passThroughOnException: () => undefined,
    } as ExecutionContext);
  }

  return { sqlite, env, authApp, requestAs, requestAdminNotesAs };
}

test('브리핑자료 공용 권한은 관리자 3역할·정민호·명도팀 열람과 관리자 3역할·정민호 등록을 구분한다', () => {
  for (const role of ['master', 'ceo', 'cc_ref']) {
    assert.equal(canViewBriefingMaterial({ role }), true, `${role} view`);
    assert.equal(canUploadBriefingMaterial({ role }), true, `${role} upload`);
  }
  assert.equal(canViewBriefingMaterial({ id: JEONG_MINHO_USER_ID, role: 'member', login_type: 'freelancer' }), true);
  assert.equal(canUploadBriefingMaterial({ id: JEONG_MINHO_USER_ID, role: 'member', login_type: 'freelancer' }), true);

  for (const evictionUser of [{ department: '명도팀' }, { team_name: '명도팀' }]) {
    assert.equal(canViewBriefingMaterial(evictionUser), true);
    assert.equal(canUploadBriefingMaterial(evictionUser), false);
  }
  for (const role of ['admin', 'director', 'accountant', 'accountant_asst', 'manager', 'member', 'support', 'resigned']) {
    assert.equal(canViewBriefingMaterial({ role }), false, `${role} view`);
    assert.equal(canUploadBriefingMaterial({ role }), false, `${role} upload`);
  }
  assert.equal(canViewBriefingMaterial(undefined), false);
  assert.equal(canUploadBriefingMaterial(undefined), false);
});

test('열람 허용자는 지사 제한 없이 목록과 다운로드를 사용하고 비허용자는 API에서 403을 받는다', async () => {
  const { sqlite, requestAs } = await setup();
  for (const id of ['master', 'ceo', 'cc', JEONG_MINHO_USER_ID, 'eviction-department', 'eviction-team']) {
    const response = await requestAs(id, '');
    assert.equal(response.status, 200, id);
    const payload = await response.json() as { materials: Array<{ id: string }>; total: number };
    assert.equal(payload.total, 2, id);
    assert.deepEqual(payload.materials.map((material) => material.id).sort(), ['busan-material', 'seoul-material'], id);
  }
  for (const id of ['admin', 'accountant', 'assistant', 'member', 'freelancer']) {
    assert.equal((await requestAs(id, '')).status, 403, id);
    assert.equal((await requestAs(id, '/seoul-material/download')).status, 403, `${id} download`);
  }
  const crossBranchDownload = await requestAs('eviction-team', '/seoul-material/download');
  assert.equal(crossBranchDownload.status, 200);
  assert.match(decodeURIComponent(crossBranchDownload.headers.get('Content-Disposition') || ''), /서울자료\.pdf/);
  sqlite.close();
});

test('명도팀은 업로드 옵션을 사용할 수 없고 관리자 3역할과 정민호만 사용할 수 있다', async () => {
  const { sqlite, requestAs } = await setup();
  for (const id of ['master', 'ceo', 'cc', JEONG_MINHO_USER_ID]) {
    assert.equal((await requestAs(id, '/upload-options')).status, 200, id);
    assert.equal((await requestAs(id, '', 'POST')).status, 415, `${id} upload reaches content validation`);
  }
  for (const id of ['eviction-department', 'eviction-team', 'admin', 'accountant', 'member']) {
    assert.equal((await requestAs(id, '/upload-options')).status, 403, id);
    assert.equal((await requestAs(id, '', 'POST')).status, 403, `${id} upload`);
  }
  sqlite.close();
});

test('로그인과 세션 복원 응답 모두 팀 이름을 제공한다', async () => {
  const { sqlite, env, authApp } = await setup();
  const login = await authApp.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'eviction-team@example.com',
      password: LOGIN_PASSWORD,
      login_type: 'employee',
    }),
  }, env);
  assert.equal(login.status, 200);
  const loginPayload = await login.json() as { token: string; user: { team_name?: string } };
  assert.equal(loginPayload.user.team_name, '명도팀');

  const me = await authApp.request('/api/auth/me', {
    headers: { Authorization: `Bearer ${loginPayload.token}` },
  }, env);
  assert.equal(me.status, 200);
  const mePayload = await me.json() as { user: { team_name?: string } };
  assert.equal(mePayload.user.team_name, '명도팀');
  sqlite.close();
});

test('브리핑 제출 일정 API는 기존 이력 조회와 새 등록 권한을 분리하고 정민호의 타 지사 제출을 허용한다', async () => {
  const { sqlite, requestAdminNotesAs } = await setup();

  for (const id of ['master', 'ceo', 'cc', JEONG_MINHO_USER_ID, 'admin']) {
    assert.equal((await requestAdminNotesAs(id, '?category=briefing_schedule')).status, 200, `${id} list`);
  }
  for (const id of ['master', 'ceo', 'cc', JEONG_MINHO_USER_ID]) {
    assert.equal((await requestAdminNotesAs(id, '/briefing-autofill')).status, 200, `${id} autofill`);
  }
  for (const id of ['accountant', 'eviction-team', 'member']) {
    assert.equal((await requestAdminNotesAs(id, '?category=briefing_schedule')).status, 403, `${id} list`);
  }
  for (const id of ['admin', 'accountant', 'eviction-team', 'member']) {
    assert.equal((await requestAdminNotesAs(id, '/briefing-autofill')).status, 403, `${id} autofill`);
  }

  const briefing = {
    category: 'briefing_schedule',
    assignee_id: 'member',
    target_date: '2026-09-30',
    court: '서울중앙지방법원',
    case_number: '2026타경123',
    client_name: '계약자',
  };
  assert.equal((await requestAdminNotesAs('admin', '', 'POST', briefing)).status, 403);
  const created = await requestAdminNotesAs(JEONG_MINHO_USER_ID, '', 'POST', briefing);
  assert.equal(created.status, 200, await created.clone().text());
  const { id: noteId } = await created.json() as { id: string };
  const stored = sqlite.prepare('SELECT author_id, assignee_id, author_branch FROM admin_notes WHERE id = ?')
    .get(noteId) as { author_id: string; assignee_id: string; author_branch: string };
  assert.equal(stored.author_id, JEONG_MINHO_USER_ID);
  assert.equal(stored.assignee_id, 'member');
  assert.equal(stored.author_branch, '의정부');
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS count FROM journal_entries WHERE user_id = ?')
    .get('member') as { count: number }).count, 1);

  assert.equal((await requestAdminNotesAs(JEONG_MINHO_USER_ID, `/${noteId}`)).status, 200);
  assert.equal((await requestAdminNotesAs('admin', `/${noteId}`)).status, 200);
  assert.equal((await requestAdminNotesAs('member', `/${noteId}`)).status, 403);
  sqlite.close();
});
