import assert from 'node:assert/strict';
import test from 'node:test';
import { canReadDocument } from '../src/worker/lib/document-access.ts';
import {
  isEmployeeTemplateAdmin,
  isFreelancerViewer,
  isMyAuctionTemplate,
  ensureTemplateAccessSchema,
} from '../src/worker/lib/template-access.ts';

function templateDb(markedTemplateIds: string[]) {
  return {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          bindings = values;
          return this;
        },
        async all() {
          if (sql.includes('PRAGMA table_info')) {
            return { results: [{ name: 'id' }, { name: 'is_myauction' }] };
          }
          return { results: [] };
        },
        async first() {
          if (sql.includes('FROM templates')) {
            return markedTemplateIds.includes(String(bindings[0])) ? { allowed: 1 } : null;
          }
          return null;
        },
      };
    },
  } as unknown as D1Database;
}

const freelancer = {
  sub: 'freelancer-1',
  role: 'member',
  branch: '의정부',
  department: '',
  login_type: 'freelancer',
} as const;

test('프리랜서 여부는 서버가 갱신한 login_type으로 판정한다', () => {
  assert.equal(isFreelancerViewer(freelancer), true);
  assert.equal(isFreelancerViewer({ login_type: 'employee' }), false);
  assert.equal(isFreelancerViewer({}), false);
});

test('프리랜서 로그인은 관리자 역할을 함께 가져도 템플릿 관리자가 아니다', () => {
  assert.equal(isEmployeeTemplateAdmin({ role: 'master', login_type: 'freelancer' }), false);
  assert.equal(isEmployeeTemplateAdmin({ role: 'master', login_type: 'employee' }), true);
  assert.equal(isEmployeeTemplateAdmin({ role: 'member', login_type: 'employee' }), false);
});

test('활성 마이옥션 표식이 있는 템플릿만 허용한다', async () => {
  const db = templateDb(['tpl-myauction']);
  assert.equal(await isMyAuctionTemplate(db, 'tpl-myauction'), true);
  assert.equal(await isMyAuctionTemplate(db, 'tpl-internal'), false);
  assert.equal(await isMyAuctionTemplate(db, null), false);
});

test('프리랜서는 본인 문서라도 마이옥션 템플릿이 아니면 읽을 수 없다', async () => {
  const allowed = await canReadDocument(
    templateDb([]),
    freelancer,
    {
      id: 'doc-internal',
      template_id: 'tpl-internal',
      is_myauction: 0,
      author_id: freelancer.sub,
      branch: freelancer.branch,
      department: freelancer.department,
      status: 'draft',
    },
  );
  assert.equal(allowed, false);
});

test('프리랜서는 본인이 작성한 마이옥션 문서를 읽을 수 있다', async () => {
  const allowed = await canReadDocument(
    templateDb(['tpl-myauction']),
    freelancer,
    {
      id: 'doc-myauction',
      template_id: 'tpl-myauction',
      is_myauction: 1,
      author_id: freelancer.sub,
      branch: freelancer.branch,
      department: freelancer.department,
      status: 'draft',
    },
  );
  assert.equal(allowed, true);
});

test('문서의 마이옥션 공개 스냅샷은 이후 템플릿 분류 변경과 무관하게 유지된다', async () => {
  const allowed = await canReadDocument(
    templateDb([]),
    freelancer,
    {
      id: 'doc-existing-myauction',
      template_id: 'tpl-now-internal',
      is_myauction: 1,
      author_id: freelancer.sub,
      branch: freelancer.branch,
      department: freelancer.department,
      status: 'submitted',
    },
  );
  assert.equal(allowed, true);
});

test('템플릿 접근 스키마는 같은 D1 바인딩에서 한 번만 확인한다', async () => {
  let pragmaCalls = 0;
  const db = {
    prepare(sql: string) {
      return {
        async all() {
          if (sql.includes('PRAGMA table_info')) pragmaCalls += 1;
          return { results: [{ name: 'id' }, { name: 'is_myauction' }] };
        },
      };
    },
  } as unknown as D1Database;

  await ensureTemplateAccessSchema(db);
  await ensureTemplateAccessSchema(db);

  assert.equal(pragmaCalls, 2);
});
