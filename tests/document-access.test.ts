import assert from 'node:assert/strict';
import test from 'node:test';
import { canReadDocument, getDocumentAccessRecord } from '../src/worker/lib/document-access.ts';

function dbWithAssignedApprover(documentId: string, approverId: string) {
  return {
    prepare() {
      let bindings: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          bindings = values;
          return this;
        },
        async first() {
          return bindings[0] === documentId && bindings[1] === approverId
            ? { allowed: 1 }
            : null;
        },
      };
    },
  } as unknown as D1Database;
}

const submittedDocument = {
  id: 'doc-1',
  author_id: 'author',
  branch: '서울',
  department: '컨설팅',
  status: 'submitted',
} as const;

test('담당 결재자는 작성자와 다른 지사·부서여도 문서를 읽을 수 있다', async () => {
  const allowed = await canReadDocument(
    dbWithAssignedApprover('doc-1', 'override-manager'),
    {
      sub: 'override-manager',
      role: 'manager',
      branch: '부산',
      department: '관리',
    },
    submittedDocument,
  );

  assert.equal(allowed, true);
});

test('결재자로 지정되지 않은 범위 밖 사용자는 문서를 읽을 수 없다', async () => {
  const allowed = await canReadDocument(
    dbWithAssignedApprover('doc-1', 'assigned-user'),
    {
      sub: 'outsider',
      role: 'manager',
      branch: '부산',
      department: '관리',
    },
    submittedDocument,
  );

  assert.equal(allowed, false);
});

test('결재자로 지정되어도 다른 사용자의 초안은 읽을 수 없다', async () => {
  const allowed = await canReadDocument(
    dbWithAssignedApprover('doc-1', 'override-manager'),
    {
      sub: 'override-manager',
      role: 'manager',
      branch: '부산',
      department: '관리',
    },
    { ...submittedDocument, status: 'draft' },
  );

  assert.equal(allowed, false);
});

test('결재 부속정보 조회용 문서 레코드는 권한 검사에 필요한 id를 포함한다', async () => {
  let preparedSql = '';
  const db = {
    prepare(sql: string) {
      preparedSql = sql;
      return {
        bind() {
          return this;
        },
        async first() {
          return submittedDocument;
        },
      };
    },
  } as unknown as D1Database;

  const record = await getDocumentAccessRecord(db, 'doc-1');
  assert.equal(record?.id, 'doc-1');
  assert.match(preparedSql, /SELECT id, author_id, branch, department, status/);
});
