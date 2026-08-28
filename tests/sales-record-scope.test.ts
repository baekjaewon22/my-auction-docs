import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  JEONG_MINHO_SALES_SCOPE_USER_ID,
  salesDirectorManagedBranch,
  salesMissingAlertScopeTitle,
  salesRecordScopeKind,
} from '../src/shared/sales-record-scope.ts';
import {
  buildSalesRecordSqlScope,
  resolveSalesRecordSqlScope,
} from '../src/worker/lib/sales-record-scope.ts';

type ScopeViewer = Parameters<typeof buildSalesRecordSqlScope>[0];

function d1FromSqlite(db: Database.Database): D1Database {
  return {
    prepare(sql: string) {
      const values: unknown[] = [];
      const statement = {
        bind(...params: unknown[]) {
          values.splice(0, values.length, ...params);
          return statement;
        },
        async all<T>() {
          return { results: db.prepare(sql).all(...values) as T[] };
        },
        async run() {
          const result = db.prepare(sql).run(...values);
          return { success: true, meta: { changes: result.changes } };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

function fixtureDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, branch TEXT, department TEXT);
    CREATE TABLE sales_records (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      branch TEXT,
      attribution_branch TEXT
    );
    INSERT INTO users VALUES
      ('seo-jeongsu', '부산지사', ''),
      ('c32c3021-b8f6-42f8-b977-7e6e53a7e6f6', '서초지사', ''),
      ('busan-owner', '부산지사', '영업팀'),
      ('daejeon-owner', '대전지사', '영업팀'),
      ('seocho-owner', '서초지사', '영업팀'),
      ('uijeongbu-owner', '의정부본사', '영업팀');
    INSERT INTO sales_records VALUES
      ('seo-own-uijeongbu', 'seo-jeongsu', '부산지사', '의정부본사'),
      ('busan-by-owner-branch', 'busan-owner', '부산지사', ''),
      ('busan-by-attribution', 'uijeongbu-owner', '의정부본사', '부산지사'),
      ('daejeon-by-owner-branch', 'daejeon-owner', '대전지사', ''),
      ('daejeon-by-attribution', 'uijeongbu-owner', '의정부본사', '대전지사'),
      ('seocho-by-owner-branch', 'seocho-owner', '서초지사', ''),
      ('jin-own-uijeongbu', 'c32c3021-b8f6-42f8-b977-7e6e53a7e6f6', '의정부본사', '의정부본사'),
      ('uijeongbu-only', 'uijeongbu-owner', '의정부본사', '');
  `);
  return db;
}

function visibleIds(db: Database.Database, scope: Awaited<ReturnType<typeof resolveSalesRecordSqlScope>>): string[] {
  const where = scope.sql ? `WHERE ${scope.sql}` : '';
  return (db.prepare(`
    SELECT sr.id
    FROM sales_records sr
    JOIN users u ON u.id = sr.user_id
    ${where}
    ORDER BY sr.id
  `).all(...scope.params) as Array<{ id: string }>).map((row) => row.id);
}

test('서정수 director는 부산 지사 건과 본인 건만 보고 대전 건은 보지 않는다', async () => {
  const db = fixtureDatabase();
  const scope = await resolveSalesRecordSqlScope({} as D1Database, {
    sub: 'seo-jeongsu',
    name: '서정수',
    role: 'director',
    branch: '대전지사', // 계정 지사가 잘못 저장돼도 고정 관리 범위를 넘지 않는다.
    department: '',
  });

  assert.deepEqual(visibleIds(db, scope), [
    'busan-by-attribution',
    'busan-by-owner-branch',
    'seo-own-uijeongbu',
  ]);
  assert.equal(scope.visibleBranches.includes('대전지사'), false);
  assert.equal(salesDirectorManagedBranch({ name: '서정수', branch: '대전지사' }), '부산지사');
  db.close();
});

test('진성헌 admin은 서초·대전 지사 건과 본인 건을 함께 본다', async () => {
  const db = fixtureDatabase();
  const scope = await resolveSalesRecordSqlScope(d1FromSqlite(db), {
    sub: 'c32c3021-b8f6-42f8-b977-7e6e53a7e6f6',
    name: '진성헌',
    role: 'admin',
    branch: '서초지사',
    department: '',
  });

  assert.deepEqual(visibleIds(db, scope), [
    'daejeon-by-attribution',
    'daejeon-by-owner-branch',
    'jin-own-uijeongbu',
    'seocho-by-owner-branch',
  ]);
  db.close();
});

test('정민호 admin과 전사 역할은 전체, 다른 admin은 관할지사와 본인 범위다', () => {
  const minho = {
    sub: JEONG_MINHO_SALES_SCOPE_USER_ID,
    name: '정민호',
    role: 'admin',
    branch: '의정부본사',
    department: '',
  } satisfies ScopeViewer;
  const otherHeadOfficeAdmin = {
    sub: 'other-admin',
    name: '다른 관리자',
    role: 'admin',
    branch: '의정부본사',
    department: '',
  } satisfies ScopeViewer;

  assert.equal(salesRecordScopeKind(minho), 'all');
  assert.equal(buildSalesRecordSqlScope(minho).sql, '');
  assert.equal(salesMissingAlertScopeTitle(minho), '전체 미작성 알림');
  assert.equal(salesRecordScopeKind({ role: 'master' }), 'all');
  assert.equal(salesRecordScopeKind(otherHeadOfficeAdmin), 'branches-and-self');
  assert.equal(salesMissingAlertScopeTitle(otherHeadOfficeAdmin), '관할지사·본인 미작성 알림');
});

test('일반 director는 본인 지사 aliases와 본인 매출만 사용한다', () => {
  const scope = buildSalesRecordSqlScope({
    sub: 'other-director',
    name: '다른 이사',
    role: 'director',
    branch: '서초지사',
    department: '',
  }, ['서초지사']);

  assert.equal(scope.kind, 'branches-and-self');
  assert.match(scope.sql, /sr\.user_id = \?/);
  assert.match(scope.sql, /sr\.branch IN/);
  assert.match(scope.sql, /sr\.attribution_branch IN/);
  assert.equal(scope.visibleBranches.includes('대전지사'), false);
});

test('일반 목록과 미작성 목록은 같은 서버 범위 resolver를 사용하고 director UI에 대전 선택을 노출하지 않는다', () => {
  const route = readFileSync(new URL('../src/worker/routes/sales.ts', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../src/react-app/pages/Dashboard.tsx', import.meta.url), 'utf8');
  const salesPage = readFileSync(new URL('../src/react-app/pages/Sales.tsx', import.meta.url), 'utf8');

  assert.equal((route.match(/resolveSalesRecordSqlScope\(db, user\)/g) || []).length, 2);
  assert.match(dashboard, /salesMissingAlertScopeTitle\(user \|\| \{\}\)/);
  const directorFilterStart = salesPage.indexOf('{/* 총괄이사: 본인 관할 지사 + 본인 매출 */}');
  const directorFilterEnd = salesPage.indexOf('{/* 담당자 필터:', directorFilterStart);
  const directorFilter = salesPage.slice(directorFilterStart, directorFilterEnd);
  assert.match(directorFilter, /관할지사·본인/);
  assert.match(directorFilter, /directorManagedBranch/);
  assert.doesNotMatch(directorFilter, /대전지사|대전\/부산/);
  assert.match(salesPage, /const scopeMembers = isDirector[\s\S]*?sameBranchName\(m\.branch, directorManagedBranch\)/);
});
