import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOrgApprovalChain } from '../src/worker/lib/org-approval-chain.ts';

type Row = Record<string, unknown> | null;

function approvalDb(rows: Record<string, Row | Row[]>) {
  return {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          bindings = values;
          return this;
        },
        async first() {
          if (sql.includes('FROM org_nodes WHERE user_id')) return rows.authorNode;
          if (sql.includes('FROM org_nodes WHERE id')) return rows.parentNode;
          if (sql.includes('SELECT role, branch FROM users')) return rows.author;
          if (sql.includes('SELECT id, login_type, role, approved FROM users')) return rows.approver;
          if (sql.includes('FROM branch_approval_overrides')) return rows.override;
          return null;
        },
        async all() {
          if (sql.includes('SELECT cc_user_id')) return { results: rows.ccList || [] };
          return { results: [] };
        },
        async run() {
          return { success: true };
        },
      };
    },
  } as unknown as D1Database;
}

test('조직도 상위 노드에 명시된 프리랜서는 결재자로 사용할 수 있다', async () => {
  const db = approvalDb({
    authorNode: { id: 'author-node', parent_id: 'parent-node', tier: 4 },
    parentNode: { id: 'parent-node', user_id: 'freelancer-approver', parent_id: null },
    author: { role: 'member', branch: '서울' },
    approver: {
      id: 'freelancer-approver',
      login_type: 'freelancer',
      role: 'manager',
      approved: 1,
    },
    override: null,
  });

  assert.deepEqual(
    await buildOrgApprovalChain(db, 'author', { allowFreelancerApprover: true }),
    ['freelancer-approver'],
  );
});

test('일반 사내 문서 결재선에서는 프리랜서 상위자를 건너뛴다', async () => {
  const db = approvalDb({
    authorNode: { id: 'author-node', parent_id: 'parent-node', tier: 4 },
    parentNode: { id: 'parent-node', user_id: 'freelancer-approver', parent_id: null },
    author: { role: 'member', branch: '서울' },
    approver: {
      id: 'freelancer-approver',
      login_type: 'freelancer',
      role: 'manager',
      approved: 1,
    },
    override: null,
  });

  assert.deepEqual(await buildOrgApprovalChain(db, 'author'), []);
});

test('조직도에 없는 작성자도 지사 상위승인자 설정을 적용한다', async () => {
  const db = approvalDb({
    authorNode: null,
    author: { role: 'member', branch: '서울지사' },
    override: { approver_id: 'branch-approver' },
  });

  assert.deepEqual(await buildOrgApprovalChain(db, 'author'), ['branch-approver']);
  assert.deepEqual(
    await buildOrgApprovalChain(db, 'author', { allowMissingOrgNode: true }),
    ['branch-approver'],
  );
});

test('프리랜서 지사 상위승인자는 마이옥션 문서에만 적용한다', async () => {
  const db = approvalDb({
    authorNode: null,
    author: { role: 'member', branch: '서울지사' },
    override: { approver_id: 'freelancer-branch-approver', login_type: 'freelancer' },
  });

  assert.deepEqual(await buildOrgApprovalChain(db, 'author'), []);
  assert.deepEqual(
    await buildOrgApprovalChain(db, 'author', {
      allowFreelancerApprover: true,
      allowMissingOrgNode: true,
    }),
    ['freelancer-branch-approver'],
  );
});

test('조직도에 없는 일반 직원은 기존 CC 대체 결재선을 유지한다', async () => {
  const db = approvalDb({
    authorNode: null,
    author: { role: 'member', branch: '서울지사' },
    override: null,
    ccList: [{ cc_user_id: 'cc-user' }],
  });

  assert.deepEqual(await buildOrgApprovalChain(db, 'author'), ['cc-user']);
  assert.deepEqual(
    await buildOrgApprovalChain(db, 'author', { allowMissingOrgNode: true }),
    ['cc-user'],
  );
});
